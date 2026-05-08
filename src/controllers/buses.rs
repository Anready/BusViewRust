use std::collections::HashMap;
use std::sync::Arc;
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use axum::response::IntoResponse;
use futures::future::join_all;
use gtfs_rt::FeedMessage;
use prost::Message;
use reqwest::Client;
use crate::controllers::access::Claims;
use crate::emulation::structures::{BusDetails, Buses};
use crate::{Errors, ServerData};
use crate::controllers::structures::{DepartureFromStopParams, DepartureFromStopResponse, GtfsResponse};
use crate::helpers::utils::get_time;

pub async fn get_vehicles_json(
    _: Claims,
    State(data): State<Arc<ServerData>>
) -> Result<Json<GtfsResponse>, Errors> {
    {
        let cache = data.cache_buses.read().await;
        if let Some(ref val) = cache.cached_buses_data {
            if get_time() - 10_000 < cache.last_buses_fetched {
                return Ok(Json(val.clone()));
            }
        }
    }

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
    let emulated_bus_map = get_emulated_buses(data.clone()).await;

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
                        latitude: pos.latitude as f64,
                        longitude: pos.longitude as f64,
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

    let response = GtfsResponse {
        status: "success".to_string(),
        realtime: Buses{
            bus_map: realtime_bus_map,
            is_emulated: false,
        },
        emulated: Buses{
            bus_map: emulated_bus_map,
            is_emulated: true,
        },
    };

    {
        let mut cache = data.cache_buses.write().await;
        cache.cached_buses_data = Some(response.clone());
        cache.last_buses_fetched = get_time();
    }

    Ok(Json(response))
}

pub async fn get_emulated_buses(data: Arc<ServerData>) -> HashMap<String, BusDetails> {
    let mut tasks = Vec::new();

    let d = data.clone();
    tasks.push(tokio::spawn(async move {
        d.limassol.write().await.get_buses().await
    }));

    let d = data.clone();
    tasks.push(tokio::spawn(async move {
        d.paphos.write().await.get_buses().await
    }));

    let d = data.clone();
    tasks.push(tokio::spawn(async move {
        d.larnaca.write().await.get_buses().await
    }));

    let d = data.clone();
    tasks.push(tokio::spawn(async move {
        d.nicosia.write().await.get_buses().await
    }));

    let d = data.clone();
    tasks.push(tokio::spawn(async move {
        d.intercity.write().await.get_buses().await
    }));

    let results = join_all(tasks).await;

    let mut all_buses = HashMap::new();
    for res in results {
        if let Ok(buses) = res {
            for (id, bus) in buses {
                all_buses.insert(id.to_string(), bus);
            }
        }
    }

    all_buses
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

pub async fn departure_time_from_stop(
    _claims: Claims,
    Query(params): Query<DepartureFromStopParams>,
    State(data): State<Arc<ServerData>>
) -> Result<Json<DepartureFromStopResponse>, Errors> {
    let bus_id = params.bus.to_string();
    let mut all_times = Vec::new();
    if bus_id.starts_with('9') {
        let mut nicosia_lock = data.nicosia.write().await;
        all_times = nicosia_lock.departure_time_from_stop(params.bus as u128, params.stop as u128).await
    } else if bus_id.starts_with('2') {
        let mut larnaca_lock = data.larnaca.write().await;
        all_times = larnaca_lock.departure_time_from_stop(params.bus as u128, params.stop as u128).await
    } else if bus_id.starts_with('3') {
        let mut paphos_lock = data.paphos.write().await;
        all_times = paphos_lock.departure_time_from_stop(params.bus as u128, params.stop as u128).await
    } else if bus_id.starts_with('5') {
        let mut intercity_lock = data.intercity.write().await;
        all_times = intercity_lock.departure_time_from_stop(params.bus as u128, params.stop as u128).await
    } else if bus_id.starts_with('1') {
        let mut limassol_lock = data.limassol.write().await;
        all_times = limassol_lock.departure_time_from_stop(params.bus as u128, params.stop as u128).await
    }

    Ok(Json(DepartureFromStopResponse{
        buses: all_times,
    }))
}
