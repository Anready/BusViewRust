use std::sync::Arc;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use serde::Deserialize;
use crate::analytics::db::{Engagement, Event, PageView, Record};
use crate::analytics::{client_ip, now_ms, ua, Analytics};

const MAX_ENGAGEMENT_MS: i64 = 6 * 3_600_000;

#[derive(Deserialize)]
#[serde(tag = "t")]
enum Incoming {
    #[serde(rename = "pv")]
    PageView {
        id: String,
        vid: String,
        sid: String,
        path: String,
        #[serde(rename = "ref")]
        referrer: Option<String>,
        us: Option<String>,
        um: Option<String>,
        uc: Option<String>,
        sw: Option<u32>,
        sh: Option<u32>,
        lang: Option<String>,
        theme: Option<String>,
        tz: Option<String>,
        mode: Option<String>,
        #[serde(default)]
        new: bool,
        /// navigator.maxTouchPoints, used to tell iPads apart from Macs
        tp: Option<u32>,
    },
    #[serde(rename = "eng")]
    Engagement { id: String, vid: String, ms: i64 },
    #[serde(rename = "ev")]
    Event {
        vid: String,
        sid: String,
        path: String,
        name: String,
        props: Option<serde_json::Value>,
    },
}

/// Body is parsed manually because navigator.sendBeacon posts it as text/plain
pub async fn collect(State(analytics): State<Arc<Analytics>>, headers: HeaderMap, body: Bytes) -> StatusCode {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).unwrap_or("");

    if header("sec-fetch-site") == "cross-site" {
        return StatusCode::NO_CONTENT;
    }
    let user_agent = header("user-agent");
    if ua::is_bot(user_agent) {
        return StatusCode::NO_CONTENT;
    }
    let ip = client_ip(&headers);
    if let Some(ip) = &ip {
        if !analytics.collect_limiter.hit(ip) {
            return StatusCode::NO_CONTENT;
        }
    }

    let Ok(incoming) = serde_json::from_slice::<Incoming>(&body) else {
        return StatusCode::BAD_REQUEST;
    };

    let record = match incoming {
        Incoming::PageView { id, vid, sid, path, referrer, us, um, uc, sw, sh, lang, theme, tz, mode, new, tp } => {
            if !valid_id(&id) || !valid_id(&vid) || !valid_id(&sid) {
                return StatusCode::BAD_REQUEST;
            }
            let Some(path) = clean_path(&path) else {
                return StatusCode::BAD_REQUEST;
            };

            let mut agent = ua::parse(user_agent);
            // iPadOS Safari reports itself as desktop macOS
            if agent.os == "macOS" && tp.unwrap_or(0) > 1 {
                agent.os = "iOS";
                agent.device = "tablet";
            }

            let country = Some(header("cf-ipcountry").to_ascii_uppercase())
                .filter(|c| c.len() == 2 && c != "XX" && c != "T1");

            Record::PageView(PageView {
                id,
                ts: now_ms(),
                visitor_id: vid,
                session_id: sid,
                path,
                referrer: referrer.as_deref().and_then(|r| referrer_host(r, header("host"))),
                utm_source: clean(us, 100),
                utm_medium: clean(um, 100),
                utm_campaign: clean(uc, 100),
                country,
                timezone: clean(tz, 64),
                browser: agent.browser,
                os: agent.os,
                device: agent.device,
                screen: match (sw, sh) {
                    (Some(w), Some(h)) if w > 0 && h > 0 && w < 20_000 && h < 20_000 => Some(format!("{w}x{h}")),
                    _ => None,
                },
                lang: clean(lang, 16),
                theme: clean(theme, 16),
                app_mode: clean(mode, 16),
                is_new: new,
                daily_id: ip.as_deref().map(|ip| analytics.daily_id(ip, user_agent)),
            })
        }
        Incoming::Engagement { id, vid, ms } => {
            if !valid_id(&id) || !valid_id(&vid) {
                return StatusCode::BAD_REQUEST;
            }
            Record::Engagement(Engagement {
                ts: now_ms(),
                id,
                visitor_id: vid,
                duration_ms: ms.clamp(0, MAX_ENGAGEMENT_MS),
            })
        }
        Incoming::Event { vid, sid, path, name, props } => {
            if !valid_id(&vid) || !valid_id(&sid) {
                return StatusCode::BAD_REQUEST;
            }
            let (Some(path), Some(name)) = (clean_path(&path), clean(Some(name), 64)) else {
                return StatusCode::BAD_REQUEST;
            };
            let props = props
                .filter(|p| !p.is_null())
                .map(|p| p.to_string())
                .map(|p| if p.len() > 2_000 { r#"{"_truncated":true}"#.to_string() } else { p });

            Record::Event(Event { ts: now_ms(), visitor_id: vid, session_id: sid, path, name, props })
        }
    };

    analytics.record(record);
    StatusCode::NO_CONTENT
}

fn valid_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn clean(value: Option<String>, max_chars: usize) -> Option<String> {
    let value = value?;
    let value: String = value.trim().chars().filter(|c| !c.is_control()).take(max_chars).collect();
    (!value.is_empty()).then_some(value)
}

fn clean_path(path: &str) -> Option<String> {
    let path = path.split(['?', '#']).next()?;
    if !path.starts_with('/') {
        return None;
    }
    let path: String = path.chars().filter(|c| !c.is_control()).take(200).collect();
    // "/planTrip/" and "/planTrip" are the same page
    match path.trim_end_matches('/') {
        "" => Some("/".to_string()),
        trimmed => Some(trimmed.to_string()),
    }
}

/// Reduces a referrer URL to its host, dropping internal navigation
fn referrer_host(referrer: &str, own_host: &str) -> Option<String> {
    let rest = referrer.split_once("://").map(|(_, rest)| rest).unwrap_or(referrer);
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit('@').next()?.split(':').next()?.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();

    let own = own_host.split(':').next().unwrap_or("").to_ascii_lowercase();
    let own = own.strip_prefix("www.").unwrap_or(&own);

    if host.is_empty() || host == own || host.len() > 100 {
        return None;
    }
    Some(host)
}
