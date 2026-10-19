use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use axum::async_trait;
use axum::extract::{FromRequestParts, Query, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::json;
use crate::analytics::queries::{self, Scope, FILTER_COLUMNS};
use crate::analytics::{client_ip, db, now_ms, Analytics};

const COOKIE_NAME: &str = "bv_admin";
const SESSION_DAYS: i64 = 7;
const SUBJECT: &str = "analytics_admin";

#[derive(Serialize, Deserialize)]
struct AdminClaims {
    sub: String,
    iat: usize,
    exp: usize,
}

fn password_hash() -> Option<String> {
    std::env::var("ANALYTICS_PASSWORD_HASH").ok().filter(|h| !h.trim().is_empty())
}

/// Bound to the password hash as well, so changing the password logs every session out
fn signing_key() -> Option<Vec<u8>> {
    let secret = std::env::var("SECRET_KEY").ok()?;
    Some(format!("{secret}|analytics|{}", password_hash()?).into_bytes())
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

/// Proof that the request carries a valid admin session cookie
pub struct Admin;

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for Admin {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let unauthorized = || error(StatusCode::UNAUTHORIZED, "unauthorized");

        let token = parts
            .headers
            .get_all(header::COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .flat_map(|v| v.split(';'))
            .find_map(|c| c.trim().strip_prefix(COOKIE_NAME)?.strip_prefix('='))
            .ok_or_else(unauthorized)?;

        let key = signing_key().ok_or_else(unauthorized)?;
        let claims = decode::<AdminClaims>(token, &DecodingKey::from_secret(&key), &Validation::default())
            .map_err(|_| unauthorized())?
            .claims;

        if claims.sub != SUBJECT {
            return Err(unauthorized());
        }
        Ok(Admin)
    }
}

#[derive(Deserialize)]
pub struct LoginRequest {
    password: String,
}

pub async fn login(
    State(analytics): State<Arc<Analytics>>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Response {
    let ip = client_ip(&headers).unwrap_or_else(|| "unknown".to_string());
    if analytics.login_limiter.blocked(&ip) {
        return error(StatusCode::TOO_MANY_REQUESTS, "too_many_attempts");
    }

    let (Some(hash), Some(key)) = (password_hash(), signing_key()) else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "not_configured");
    };

    let password = body.password;
    let valid = password.len() <= 256
        && tokio::task::spawn_blocking(move || {
            PasswordHash::new(&hash)
                .map(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
                .unwrap_or(false)
        })
        .await
        .unwrap_or(false);

    if !valid {
        analytics.login_limiter.hit(&ip);
        tokio::time::sleep(Duration::from_millis(400)).await;
        return error(StatusCode::UNAUTHORIZED, "wrong_password");
    }
    analytics.login_limiter.clear(&ip);

    let now = Utc::now();
    let claims = AdminClaims {
        sub: SUBJECT.to_string(),
        iat: now.timestamp() as usize,
        exp: (now + chrono::Duration::days(SESSION_DAYS)).timestamp() as usize,
    };
    let Ok(token) = encode(&Header::default(), &claims, &EncodingKey::from_secret(&key)) else {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "token");
    };

    let cookie = format!(
        "{COOKIE_NAME}={token}; Path=/; Max-Age={}; HttpOnly; Secure; SameSite=Strict",
        SESSION_DAYS * 86_400
    );
    (StatusCode::NO_CONTENT, [(header::SET_COOKIE, cookie)]).into_response()
}

pub async fn logout() -> Response {
    let cookie = format!("{COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
    (StatusCode::NO_CONTENT, [(header::SET_COOKIE, cookie)]).into_response()
}

pub async fn session(_: Admin) -> StatusCode {
    StatusCode::NO_CONTENT
}

fn read_only() -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(
        db::DB_PATH,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(conn)
}

fn scope_from(params: &HashMap<String, String>) -> Scope {
    let int = |key: &str| params.get(key).and_then(|v| v.parse::<i64>().ok());

    let to = int("to").unwrap_or_else(now_ms);
    let from = int("from").filter(|f| *f < to).unwrap_or(to - 7 * 86_400_000);
    // Minutes east of UTC, i.e. -Date.prototype.getTimezoneOffset()
    let tz_offset = int("tz").unwrap_or(0).clamp(-14 * 60, 14 * 60) * 60_000;

    let filters = FILTER_COLUMNS
        .iter()
        .filter_map(|column| params.get(&format!("f_{column}")).map(|v| (*column, v.clone())))
        .collect();

    Scope { from: from.max(0), to, tz_offset, filters }
}

async fn run_query<T, F>(query: F) -> Response
where
    T: Serialize + Send + 'static,
    F: FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
{
    let result = tokio::task::spawn_blocking(move || read_only().and_then(|conn| query(&conn))).await;
    match result {
        Ok(Ok(data)) => Json(data).into_response(),
        Ok(Err(e)) => {
            eprintln!("analytics: query failed: {e}");
            error(StatusCode::INTERNAL_SERVER_ERROR, "query_failed")
        }
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "query_failed"),
    }
}

pub async fn stats(_: Admin, Query(params): Query<HashMap<String, String>>) -> Response {
    let scope = scope_from(&params);
    run_query(move |conn| queries::stats(conn, &scope)).await
}

pub async fn event_props(_: Admin, Query(params): Query<HashMap<String, String>>) -> Response {
    let scope = scope_from(&params);
    let Some(name) = params.get("name").cloned() else {
        return error(StatusCode::BAD_REQUEST, "name_required");
    };
    run_query(move |conn| queries::event_props(conn, &scope, &name)).await
}

pub async fn realtime(_: Admin) -> Response {
    run_query(|conn| queries::realtime(conn, now_ms())).await
}
