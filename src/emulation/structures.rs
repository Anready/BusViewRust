use std::collections::HashMap;
use serde::Serialize;
use crate::controllers::structures::{DepartureFromStartResponse, GtfsResponse};

pub struct Stop {
    pub stop_lat: f64,
    pub stop_lon: f64
}

#[derive(Clone, Debug)]
pub struct StopTime {
    pub trip_id: u128,
    pub departure_date: u128,
    pub departure_time: u128,
    pub stop_id: u128,
    pub stop_seq: u32
}

pub struct Shape {
    pub shape_lat: f64,
    pub shape_lon: f64
}

pub struct Trip {
    pub route_id: u128,
    pub departure_date: u128,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct BusDetails {
    pub label: String,
    pub latitude: f64,
    pub longitude: f64,
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

#[derive(Default)]
pub struct CacheData {
    pub last_buses_fetched: u128,
    pub cached_buses_data: Option<GtfsResponse>,
}

#[derive(Default)]
pub struct CacheDataDepartures {
    pub last_departure_fetched: u128,
    pub cached_departure_data: Option<DepartureFromStartResponse>,
}