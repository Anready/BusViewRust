use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use chrono::{Local, NaiveDate, TimeZone, Utc};
use csv::ReaderBuilder;
use serde::Deserialize;
use crate::AppState;
use crate::emulation::structures::{Shape, Stop};

pub fn get_time() -> u128 {
    let now = Local::now();

    let offset_seconds = now.offset().local_minus_utc() as i128;

    let timestamp_ms = now.timestamp_millis() as i128;
    let local_timestamp_ms = timestamp_ms + (offset_seconds * 1000);

    local_timestamp_ms as u128
}

pub fn parse_date(date_str: &str) -> u128 {
    let date = NaiveDate::parse_from_str(date_str, "%Y%m%d")
        .expect("Failed to parse date");

    let datetime = Utc.from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
        .unwrap();

    datetime.timestamp_millis() as u128
}

pub fn is_today(date_ms: u128) -> bool {
    let now = get_time();
    let day_in_ms = 24 * 60 * 60 * 1000;

    now >= date_ms && now < (date_ms + day_in_ms)
}


pub fn parse_time_to_ms(time_str: &str) -> u128 {
    let parts: Vec<&str> = time_str.split(':').collect();

    let hours: u128 = parts.get(0).and_then(|s| s.parse().ok()).unwrap_or(0);
    let minutes: u128 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let seconds: u128 = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);

    (hours * 3_600_000) + (minutes * 60_000) + (seconds * 1_000)
}

pub(crate) async fn load_from_disk<T>(e_id: u32, file_name: &str) -> Vec<T>
where
    T: for<'de> Deserialize<'de>,
{
    let path_str = format!("{}{}/{}.txt", AppState::FILE_PATH, e_id, file_name);
    let mut all_data = Vec::new();

    if !Path::new(&path_str).exists() {
        eprintln!("File does not exist: {}", path_str);
        return all_data;
    }

    if let Ok(file) = File::open(&path_str) {
        let mut rdr = ReaderBuilder::new()
            .has_headers(true)
            .trim(csv::Trim::All)
            .from_reader(file);

        for result in rdr.deserialize::<T>() {
            match result {
                Ok(record) => all_data.push(record),
                Err(e) => eprintln!("Error parsing row in {}.txt: {:?}", file_name, e),
            }
        }
    } else {
        eprintln!("Failed to open file: {}", path_str);
    }

    all_data
}

fn calculate_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 6371.0;
    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (lon2 - lon1).to_radians();

    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon / 2.0).sin().powi(2);

    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    r * c
}

fn find_nearest_point_index(stop: &Stop, route_coordinates: &[Shape]) -> usize {
    if route_coordinates.is_empty() { return 0; }

    let lat_rad = stop.stop_lat.to_radians();
    let cos_lat = lat_rad.cos();

    let mut min_dist_sq = f64::MAX;
    let mut nearest_index = 0;

    for (i, point) in route_coordinates.iter().enumerate() {
        let d_lat = point.shape_lat - stop.stop_lat;
        let d_lon = point.shape_lon - stop.stop_lon;

        let x = d_lon * cos_lat;
        let y = d_lat;

        let dist_sq = (x * x) + (y * y);

        if dist_sq < min_dist_sq {
            min_dist_sq = dist_sq;
            nearest_index = i;
        }
    }

    nearest_index
}

pub fn total_distance(start_index: usize, end_index: usize, route: &[Shape]) -> f64 {
    let mut total = 0.0;
    for i in start_index..end_index {
        total += calculate_distance(
            route[i].shape_lat, route[i].shape_lon,
            route[i + 1].shape_lat, route[i + 1].shape_lon,
        );
    }
    total
}

pub fn calculate_route_distance(current: &Stop, route: &[Shape], needed_distance: f64) -> Shape {
    if route.is_empty() {
        return Shape { shape_lat: 0.0, shape_lon: 0.0 };
    }

    let nearest_end_index = find_nearest_point_index(current, route);

    if nearest_end_index == 0 {
        return Shape {
            shape_lat: route[0].shape_lat,
            shape_lon: route[0].shape_lon,
        };
    }

    let start_index = nearest_end_index - 1;

    let mut total_dist = 0.0;
    let mut final_index = start_index;

    for i in (0..=start_index).rev() {
        final_index = i;
        if total_dist >= needed_distance {
            break;
        }

        if i > 0 {
            total_dist += calculate_distance(
                route[i - 1].shape_lat, route[i - 1].shape_lon,
                route[i].shape_lat, route[i].shape_lon,
            );
        }
    }

    Shape {
        shape_lat: route[final_index].shape_lat,
        shape_lon: route[final_index].shape_lon,
    }
}

