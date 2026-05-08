use serde::{Deserialize, Serialize};
use crate::emulation::structures::Buses;

#[derive(Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct GtfsResponse {
    pub status: String,
    pub realtime: Buses,
    pub emulated: Buses,
}

#[derive(Deserialize)]
pub struct DepartureFromStopParams {
    pub bus: u64,
    pub stop: u64,
}

#[derive(Serialize)]
#[serde(transparent)]
pub struct DepartureFromStopResponse {
    pub buses: Vec<String>
}