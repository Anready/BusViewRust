use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response, Html},
    Json,
};
use serde::{Deserialize, Serialize};
use jsonwebtoken::{encode, decode, Header, EncodingKey, DecodingKey, Validation};
use chrono::{Utc, Duration};
use serde_json::json;
use crate::Errors;


#[derive(Serialize)]
struct TurnstileRequest {
    secret: String,
    response: String,
    remoteip: Option<String>,
}

#[derive(Deserialize)]
struct TurnstileResponse {
    success: bool,
    #[serde(rename = "error-codes")]
    error_codes: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    pub iat: usize,
}

#[derive(Deserialize)]
pub struct GetToken {
    #[serde(rename = "turnstileToken")]
    pub token: String,
}

pub fn create_jwt() -> Result<String, jsonwebtoken::errors::Error> {
    let secret = std::env::var("SECRET_KEY")
        .expect("FATAL: SECRET_KEY environment variable is not set");

    let now = Utc::now();
    let expiration = now + Duration::hours(24);

    let my_claims = Claims {
        sub: "anonymous_user".to_owned(),
        iat: now.timestamp() as usize,
        exp: expiration.timestamp() as usize,
    };

    encode(
        &Header::default(),
        &my_claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn verify_jwt(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let secret = std::env::var("SECRET_KEY")
        .expect("FATAL: SECRET_KEY environment variable is not set");

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    ).map(|data| data.claims)
}

async fn verify_turnstile(token: &str) -> bool {
    let secret_key = std::env::var("SECRET_KEY_T")
        .expect("FATAL: SECRET_KEY_T environment variable is not set");
    let client = reqwest::Client::new();

    let res = client
        .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
        .form(&TurnstileRequest {
            secret: secret_key,
            response: token.to_string(),
            remoteip: None,
        })
        .send()
        .await;

    match res {
        Ok(response) => {
            let data: TurnstileResponse = response.json().await.unwrap_or(TurnstileResponse {
                success: false,
                error_codes: None,
            });
            data.success
        }
        Err(_) => false,
    }
}

pub async fn verify_and_issue_token(Json(payload): Json<GetToken>) -> Result<impl IntoResponse, Errors> {
    if !verify_turnstile(&payload.token).await {
        return Err(Errors::Unauthorized);
    }

    let token = create_jwt().map_err(|_| Errors::DbError)?;

    Ok(Json(json!({
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": 86400
    })))
}

pub async fn verify_token(_: Claims) -> Result<impl IntoResponse, Errors> {
    Ok(Json(json!({
        "response": "ok",
    })))
}


#[async_trait]
impl<S> FromRequestParts<S> for Claims
where
    S: Send + Sync,
{
    type Rejection = Response;
    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {

        let auth_header = parts.headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok());

        match auth_header {
            Some(header) if header.starts_with("Bearer ") => {
                let token = &header[7..];

                verify_jwt(token).map_err(|_| {
                    let html_content = include_str!("../../static/error/403.html");
                    (StatusCode::FORBIDDEN, Html(html_content)).into_response()
                })
            }
            _ => {
                let html_content = include_str!("../../static/error/403.html");
                Err((StatusCode::FORBIDDEN, Html(html_content)).into_response())
            }
        }
    }
}