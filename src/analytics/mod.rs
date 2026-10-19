//! Self-hosted analytics, running alongside Google Analytics.
//! Pages load `static/js/pulse_*.js`, which posts pageviews/engagement/events to `/api/pulse`;
//! everything lands in SQLite and is browsed on the password-protected `/analytics` page.

pub mod db;
pub mod queries;
mod admin;
mod collect;
mod ua;

use std::collections::HashMap;
use std::sync::mpsc::SyncSender;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use axum::extract::{DefaultBodyLimit, MatchedPath, Request, State};
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::Response;
use axum::routing::{get, get_service, post};
use axum::Router;
use blake2::{Blake2b512, Digest};
use password_hash::rand_core::{OsRng, RngCore};
use tower_http::services::ServeFile;
use crate::analytics::db::{ApiHit, Record};

pub struct Analytics {
    writer: SyncSender<Record>,
    collect_limiter: RateLimiter,
    login_limiter: RateLimiter,
    /// (UTC day number, salt) used for daily_id
    salt: Mutex<(i64, Vec<u8>)>,
}

impl Analytics {
    pub fn new() -> Arc<Self> {
        let conn = db::init().expect("FATAL: failed to open analytics database");
        // Reuse today's salt after a restart so visitors keep the same daily_id
        let today = utc_day(now_ms());
        let stored_salt = db::load_salt(&conn, today).expect("FATAL: failed to read analytics salt");

        let analytics = Arc::new(Analytics {
            writer: db::spawn_writer(conn),
            collect_limiter: RateLimiter::new(600, Duration::from_secs(10 * 60)),
            login_limiter: RateLimiter::new(10, Duration::from_secs(15 * 60)),
            salt: Mutex::new((today, stored_salt.clone().unwrap_or_default())),
        });
        if stored_salt.is_none() {
            analytics.rotate_salt(&mut analytics.salt.lock().unwrap(), today);
        }
        analytics
    }

    fn rotate_salt(&self, current: &mut (i64, Vec<u8>), day: i64) {
        let mut salt = vec![0u8; 32];
        OsRng.fill_bytes(&mut salt);
        *current = (day, salt.clone());
        // Blocking send: this happens once a day and must not be dropped
        let _ = self.writer.send(Record::Salt { day, salt });
    }

    /// Same IP + browser on the same UTC day gives the same id; the raw IP is never stored
    fn daily_id(&self, ip: &str, user_agent: &str) -> String {
        let today = utc_day(now_ms());
        let mut current = self.salt.lock().unwrap();
        if current.0 != today {
            self.rotate_salt(&mut current, today);
        }

        let mut hasher = Blake2b512::new();
        hasher.update(&current.1);
        hasher.update(ip.as_bytes());
        hasher.update([0]);
        hasher.update(user_agent.as_bytes());
        hasher.finalize()[..16].iter().map(|b| format!("{b:02x}")).collect()
    }

    /// Never blocks: if the writer falls behind, the record is dropped
    fn record(&self, record: Record) {
        let _ = self.writer.try_send(record);
    }
}

pub fn router(state: Arc<Analytics>) -> Router {
    Router::new()
        .route("/analytics", get_service(ServeFile::new("./templates/analytics/index.html")))
        .route("/api/pulse", post(collect::collect).layer(DefaultBodyLimit::max(16 * 1024)))
        .route("/api/admin/login", post(admin::login).layer(DefaultBodyLimit::max(4 * 1024)))
        .route("/api/admin/logout", post(admin::logout))
        .route("/api/admin/session", get(admin::session))
        .route("/api/admin/stats", get(admin::stats))
        .route("/api/admin/event", get(admin::event_props))
        .route("/api/admin/realtime", get(admin::realtime))
        .with_state(state)
}

/// Records request count, status and latency for the app's own API routes
pub async fn track_api(State(analytics): State<Arc<Analytics>>, req: Request, next: Next) -> Response {
    let path = req.uri().path();
    if !path.starts_with("/api/") || path.starts_with("/api/pulse") || path.starts_with("/api/admin/") {
        return next.run(req).await;
    }

    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| path.to_string());

    let started = Instant::now();
    let response = next.run(req).await;

    analytics.record(Record::ApiHit(ApiHit {
        ts: now_ms(),
        route,
        status: response.status().as_u16(),
        ms: started.elapsed().as_millis() as i64,
    }));

    response
}

fn utc_day(ts_ms: i64) -> i64 {
    ts_ms.div_euclid(86_400_000)
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// The server sits behind a reverse proxy, so the peer address is always the proxy itself.
/// nginx overwrites X-Real-IP, so it goes first; the others can be sent by the client itself.
fn client_ip(headers: &HeaderMap) -> Option<String> {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).map(str::trim);

    header("x-real-ip")
        .or_else(|| header("cf-connecting-ip"))
        .or_else(|| header("x-forwarded-for").and_then(|v| v.split(',').next()).map(str::trim))
        .filter(|ip| !ip.is_empty())
        .map(str::to_string)
}

/// Fixed-window counter per key
struct RateLimiter {
    max: u32,
    window: Duration,
    hits: Mutex<HashMap<String, (u32, Instant)>>,
}

impl RateLimiter {
    fn new(max: u32, window: Duration) -> Self {
        RateLimiter { max, window, hits: Mutex::new(HashMap::new()) }
    }

    fn blocked(&self, key: &str) -> bool {
        let hits = self.hits.lock().unwrap();
        hits.get(key).is_some_and(|(n, start)| start.elapsed() < self.window && *n >= self.max)
    }

    /// Counts a hit and returns whether it is still within the limit
    fn hit(&self, key: &str) -> bool {
        let mut hits = self.hits.lock().unwrap();
        if hits.len() > 50_000 {
            hits.retain(|_, (_, start)| start.elapsed() < self.window);
        }

        let now = Instant::now();
        let entry = hits.entry(key.to_string()).or_insert((0, now));
        if entry.1.elapsed() >= self.window {
            *entry = (0, now);
        }
        entry.0 += 1;
        entry.0 <= self.max
    }

    fn clear(&self, key: &str) {
        self.hits.lock().unwrap().remove(key);
    }
}
