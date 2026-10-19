mod controllers;
mod helpers;
mod emulation;
mod analytics;

use std::sync::{Arc, Mutex};
use axum::{routing::get, Router};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get_service, post};
use axum::middleware;
use tower_http::services::{ServeDir, ServeFile};
use crate::emulation::emulation::Emulation;
use crate::emulation::structures::{CacheData, CacheDataDepartures};

impl AppState {
    const FILE_PATH: &str = "./server_data/";
}

pub struct AppState {
    pub last_updated: Mutex<u128>,
}

pub struct ServerData {
    limassol: tokio::sync::RwLock<Emulation>,
    paphos: tokio::sync::RwLock<Emulation>,
    larnaca: tokio::sync::RwLock<Emulation>,
    nicosia: tokio::sync::RwLock<Emulation>,
    intercity: tokio::sync::RwLock<Emulation>,

    pub cache_buses: tokio::sync::RwLock<CacheData>,
    pub cache_departures: tokio::sync::RwLock<CacheDataDepartures>,
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    // `BusView-Rust hash-password` reads a password from stdin and prints the value for ANALYTICS_PASSWORD_HASH
    if std::env::args().nth(1).as_deref() == Some("hash-password") {
        hash_password();
        return;
    }

    let analytics = analytics::Analytics::new();

    let server_data = Arc::new(ServerData {
        limassol: tokio::sync::RwLock::new(Emulation::new(6).await),
        paphos: tokio::sync::RwLock::new(Emulation::new(2).await),
        larnaca: tokio::sync::RwLock::new(Emulation::new(10).await),
        nicosia: tokio::sync::RwLock::new(Emulation::new(9).await),
        intercity: tokio::sync::RwLock::new(Emulation::new(5).await),
        cache_buses: tokio::sync::RwLock::new(CacheData::default()),
        cache_departures: tokio::sync::RwLock::new(CacheDataDepartures::default()),
    });

    let app = Router::new()
        .route("/", get_service(ServeFile::new("./templates/index.html")))
        .route("/allBuses", get_service(ServeFile::new("./templates/allBuses/index.html")))
        .route("/favoriteStops", get_service(ServeFile::new("./templates/favoriteStops/index.html")))
        .route("/planTrip", get_service(ServeFile::new("./templates/planTrip/index.html")))
        .route("/savedTrips", get_service(ServeFile::new("./templates/savedTrips/index.html")))
        .route("/settings", get_service(ServeFile::new("./templates/settings/index.html")))
        .route("/stopsMap", get_service(ServeFile::new("./templates/stopsMap/index.html")))
        .route("/tutorials", get_service(ServeFile::new("./templates/tutorials/index.html")))

        .nest_service("/static", ServeDir::new("./static"))

        .route("/api/buses", get(controllers::buses::get_vehicles_json))
        .route("/api/planJourney", post(controllers::buses::proxy_plan_journey))
        .route("/api/departureTimeStop", get(controllers::buses::departure_time_from_stop))
        .route("/api/departureTime", get(controllers::buses::get_departure_start_time))

        .route("/api/verify-human", post(controllers::access::verify_and_issue_token))
        .route("/api/validate-token", post(controllers::access::verify_token))
        .with_state(server_data.clone())
        .merge(analytics::router(analytics.clone()))
        .route_layer(middleware::from_fn_with_state(analytics, analytics::track_api))
        .fallback_service(ServeFile::new("./static/error/404.html"));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8443")
        .await
        .unwrap();

    println!("Listening.. ");
    axum::serve(listener, app).await.unwrap();
}

fn hash_password() {
    use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};

    let mut password = String::new();
    std::io::stdin().read_line(&mut password).expect("failed to read password from stdin");
    let password = password.trim_end_matches(['\r', '\n']);
    if password.is_empty() {
        eprintln!("Empty password");
        std::process::exit(1);
    }

    let salt = SaltString::generate(&mut OsRng);
    let hash = argon2::Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("failed to hash password");
    // Single quotes stop dotenv from expanding the `$` separators
    println!("ANALYTICS_PASSWORD_HASH='{hash}'");
}

impl IntoResponse for Errors {
    fn into_response(self) -> Response {
        match self {
            Errors::NotFound => (StatusCode::NOT_FOUND, "Not found").into_response(),
            Errors::DbError => (StatusCode::INTERNAL_SERVER_ERROR, "DB error").into_response(),
            Errors::Unauthorized => {
                let html_content = include_str!("../static/error/403.html");
                (StatusCode::FORBIDDEN, Html(html_content)).into_response()
            }
        }
    }
}

#[derive(thiserror::Error, Debug)]
pub enum Errors {
    #[error("Not found")]
    NotFound,
    #[error("User unauthorized")]
    Unauthorized,
    #[error("Database died")]
    DbError,
}
