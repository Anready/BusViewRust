use std::collections::HashMap;
use axum::body::Bytes;
use axum::http::StatusCode;
use axum::Json;
use axum::response::IntoResponse;
use gtfs_rt::FeedMessage;
use prost::Message;
use reqwest::Client;
use serde::Serialize;
use crate::controllers::access::Claims;
use crate::Errors;

#[derive(Serialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct BusDetails {
    pub label: String,
    pub latitude: f32,
    pub longitude: f32,
    pub bearing: f32,
    pub speed_km_per_hour: f32,
    pub trip_id: String,
    pub route_id: String,
    pub rout_short_name: String,
    pub route_long_name: String,
}
#[derive(Serialize, Clone)]
pub struct Buses {
    #[serde(rename = "Buses")]
    pub bus_map: HashMap<String, BusDetails>,
    pub is_emulated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct GtfsResponse {
    pub status: String,
    pub realtime: Buses,
    pub emulated: Buses,
}

pub async fn get_vehicles_json(_: Claims) -> Result<Json<GtfsResponse>, Errors> {
    let url = "http://20.19.98.194:8328/Api/api/gtfs-realtime";

    let response = reqwest::get(url)
        .await
        .map_err(|_| Errors::DbError)?
        .bytes()
        .await
        .map_err(|_| Errors::DbError)?;

    let feed = FeedMessage::decode(&response[..])
        .map_err(|_| Errors::DbError)?;

    let mut realtime_bus_map = HashMap::new();
    let mut emulated_bus_map = get_emulated_buses().await;

    for entity in feed.entity {
        if let Some(v_event) = entity.vehicle {
            let id = v_event.vehicle
                .as_ref()
                .and_then(|v| v.id.clone())
                .unwrap_or_else(|| "Unknown".to_string());

            if let Some(pos) = v_event.position {
                realtime_bus_map.insert(
                    id,
                    BusDetails {
                        label: v_event.vehicle.and_then(|v| v.label).unwrap_or_default(),
                        latitude: pos.latitude,
                        longitude: pos.longitude,
                        bearing: pos.bearing.unwrap_or(0.0),
                        speed_km_per_hour: pos.speed.unwrap_or(0.0),
                        trip_id: v_event.trip.as_ref().and_then(|t| t.trip_id.clone()).unwrap_or_default(),
                        route_id: v_event.trip.as_ref().and_then(|t| t.route_id.clone()).unwrap_or_default(),
                        rout_short_name: "q".parse().unwrap(),
                        route_long_name: "l".parse().unwrap(),
                    },
                );
            }
        }
    }

    Ok(Json(GtfsResponse {
        status: "success".to_string(),
        realtime: Buses{
            bus_map: realtime_bus_map,
            is_emulated: false,
        },
        emulated: Buses{
            bus_map: emulated_bus_map,
            is_emulated: true,
        },
    }))
}

pub async fn get_emulated_buses() -> HashMap<String, BusDetails> {
    HashMap::new()
}

pub async fn proxy_plan_journey(
    _claims: Claims,
    body: Bytes,
) -> impl IntoResponse {
    let target_url = "https://api.cyprusbybus.com/solverservice/api/v1/solver/planjourney";
    let client = Client::new();

    // Отправляем POST запрос на целевой сервер
    let response = client
        .post(target_url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await;

    match response {
        Ok(res) => {
            let status = StatusCode::from_u16(res.status().as_u16())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

            let res_body = res.bytes().await.unwrap_or_default();
            (status, res_body).into_response()
        }
        Err(_) => {
            (
                StatusCode::BAD_GATEWAY,
                "Error: Unable to fetch content from target server.",
            ).into_response()
        }
    }
}
