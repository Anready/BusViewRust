mod controllers;
mod helpers;
mod emulation;

use std::sync::{Arc, Mutex};
use axum::{routing::get, Router};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get_service, post};
use serde::Deserialize;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use tower_http::services::{ServeDir, ServeFile};
use crate::emulation::emulation::Emulation;


impl AppState {
    const FILE_PATH: &str = "./server_data/";
}

pub struct AppState {
    pub last_updated: Mutex<u128>,
    db: SqlitePool,
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    let db_url = std::env::var("DATABASE_URL").unwrap_or("sqlite:contacts.db".into());

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .expect("Не удалось подключиться к SQLite");

    sqlx::query("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)")
        .execute(&pool)
        .await
        .expect("Не удалось создать таблицу");


    let shared_state = Arc::new(AppState {
        db: pool,
        last_updated: Mutex::new(0),
    });

    let mut limassol = Emulation::new(
        6,
        shared_state.clone(),
    ).await;

    let app = Router::new()
        .route("/", get_service(ServeFile::new("./templates/index.html")))
        .route("/favoriteStops", get_service(ServeFile::new("./templates/favoriteStops/index.html")))
        .route("/planTrip", get_service(ServeFile::new("./templates/planTrip/index.html")))
        .route("/savedTrips", get_service(ServeFile::new("./templates/savedTrips/index.html")))
        .route("/settings", get_service(ServeFile::new("./templates/settings/index.html")))
        .route("/stopsMap", get_service(ServeFile::new("./templates/stopsMap/index.html")))
        .route("/tutorials", get_service(ServeFile::new("./templates/tutorials/index.html")))

        .nest_service("/static", ServeDir::new("./static"))

        .route("/api/buses", get(controllers::buses::get_vehicles_json))
        .route("/api/planJourney", post(controllers::buses::proxy_plan_journey))

        .route("/api/verify-human", post(controllers::access::verify_and_issue_token))
        .route("/api/validate-token", post(controllers::access::verify_token))
        .with_state(shared_state)
        .fallback_service(ServeFile::new("./static/error/404.html"));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .unwrap();

    println!("listening.. ");
    axum::serve(listener, app).await.unwrap();
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
