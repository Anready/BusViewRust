use std::fs::File;
use std::io::{BufRead, BufReader};
use chrono::{Local, NaiveDate, TimeZone, Utc};
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

pub(crate) async fn load_from_disk(e_id: u32, file_name: String) -> Vec<Vec<String>> {
    let path_str = format!("{}{}/{}.txt", AppState::FILE_PATH, e_id, file_name);

    let mut all_data = Vec::new();

    if let Ok(file) = File::open(path_str.clone()) {
        let reader = BufReader::new(file);

        for line in reader.lines().skip(1) {
            if let Ok(l) = line {
                let columns: Vec<String> = l
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .collect();

                all_data.push(columns);
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
    (0..route_coordinates.len())
        .min_by(|&i, &j| {
            let dist_i = calculate_distance(
                stop.stop_lat, stop.stop_lon,
                route_coordinates[i].shape_lat, route_coordinates[i].shape_lon
            );
            let dist_j = calculate_distance(
                stop.stop_lat, stop.stop_lon,
                route_coordinates[j].shape_lat, route_coordinates[j].shape_lon
            );
            dist_i.partial_cmp(&dist_j).unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or(0)
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
    let nearest_end_index = find_nearest_point_index(current, route);

    if nearest_end_index == 0 {
        return Shape {
            shape_lat: route[0].shape_lat,
            shape_lon: route[0].shape_lon,
        };
    }

    let nearest_start_index = nearest_end_index - 1;

    let start_index = nearest_start_index.min(nearest_end_index);
    let end_index = nearest_start_index.max(nearest_end_index);

    let mut total_dist = total_distance(start_index, end_index, route);

    let mut i = 1;
    while total_dist < needed_distance && start_index >= i {
        let new_start = start_index - i;
        if new_start == 0 { break; }

        total_dist = total_distance(new_start, end_index, route);
        i += 1;
    }

    let final_index = if start_index >= i - 1 { start_index - (i - 1) } else { 0 };

    Shape {
        shape_lat: route[final_index].shape_lat,
        shape_lon: route[final_index].shape_lon,
    }
}

