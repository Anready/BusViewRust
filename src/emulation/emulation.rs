use std::collections::{HashMap, HashSet};
use std::path::Path;
use chrono::{DateTime, Datelike, Weekday};
use crate::AppState;
use crate::emulation::structures::{BusDetails, Shape, Stop, StopTime, Trip};
use crate::helpers::utils::{calculate_route_distance, get_time, is_today, load_from_disk, parse_date, parse_time_to_ms};

pub(crate) struct Emulation {
    emulation_id: u32,
    last_time_updated: u128,
    all_stops: HashMap<u128, Stop>,
    all_stop_times: HashMap<u128, Vec<StopTime>>,
    all_shapes: HashMap<u128, Vec<Shape>>,
    all_route_trips: HashMap<u128, Trip>,
    all_days_ids: HashMap<u128, u128>,
}

impl Emulation {
    pub(crate) async fn new(emulation_id: u32) -> Self {
        let full_path_str = format!("{}{}/calendar_dates.txt", AppState::FILE_PATH, emulation_id);
        let path = Path::new(&full_path_str);

        let mut self_val = Self {
            emulation_id,
            last_time_updated: 0,
            all_stops: HashMap::new(),
            all_stop_times: HashMap::new(),
            all_shapes: HashMap::new(),
            all_route_trips: HashMap::new(),
            all_days_ids: HashMap::new()
        };

        if !path.exists() {
            self_val.update().await;
        } else {
            self_val.load_all_ids().await;
            if self_val.is_update_needed() {
                self_val.update().await;
                println!("UPDATE");
            } else {
                self_val.load_data().await;
            }
        }

        self_val
    }

    fn is_update_needed(&self) -> bool {
        let mut update_needed = true;

        for id in self.all_days_ids.values() {
            if is_today(*id) {
                update_needed = false;
                break;
            }
        }

        if get_time() - self.last_time_updated > 172800000 {
            update_needed = true;
        }

        update_needed
    }

    async fn update(&mut self) {
        self.last_time_updated = get_time();

        let a = crate::helpers::update_data::download_and_unzip(self.emulation_id);

        if a.await.is_ok() {
            println!("{}", self.emulation_id);
            self.load_data().await;
        }
    }

    async fn load_all_ids(&mut self) {
        self.all_days_ids.clear();
        let date_ids = load_from_disk(self.emulation_id, "calendar_dates".parse().unwrap()).await;
        for date_id in date_ids {
            let id = date_id[0].parse::<u128>().unwrap_or(0);
            let date = parse_date(&*date_id[1]);

            if !self.all_days_ids.contains_key(&id) || is_today(date) {
                self.all_days_ids.insert(id, date);
            }
        }
    }

    async fn load_data(&mut self) {
        self.load_all_ids().await;

        self.all_route_trips.clear();
        let route_trips = load_from_disk(self.emulation_id, "trips".parse().unwrap()).await;
        for route_trip in route_trips {
            let route_id = route_trip[0].parse::<u128>().unwrap_or(0);
            let service_id = route_trip[1].parse::<u128>().unwrap_or(0);
            let trip_id = route_trip[2].parse::<u128>().unwrap_or(0);

            let date = self.all_days_ids.get(&service_id).copied().unwrap_or(0);

            let trip = Trip {
                route_id,
                departure_date: date
            };

            self.all_route_trips.insert(trip_id, trip);
        }

        self.all_stops.clear();
        let stops = load_from_disk(self.emulation_id, "stops".parse().unwrap()).await;
        for stop in stops {
            let id = stop[0].parse::<u128>().unwrap_or(0);

            let lat = stop[4].parse::<f64>().unwrap_or(0.0);
            let lon = stop[5].parse::<f64>().unwrap_or(0.0);

            self.all_stops.insert(id, Stop{stop_lat: lat, stop_lon: lon});
        }

        self.all_stop_times.clear();
        let stop_times = load_from_disk(self.emulation_id, "stop_times".parse().unwrap()).await;
        for stop_time in stop_times {
            let id = stop_time[0].parse::<u128>().unwrap_or(0);
            let departure_date = self.all_route_trips.get(&id).unwrap().departure_date;
            let departure_time = parse_time_to_ms(&*stop_time[2]);
            let stop_id = stop_time[3].parse::<u128>().unwrap_or(0);
            let stop_seq = stop_time[4].parse::<u32>().unwrap_or(0);

            let stop_time_list = self.all_stop_times.entry(id).or_insert(Vec::new());

            stop_time_list.push(StopTime {
                trip_id: id,
                departure_date,
                departure_time,
                stop_id,
                stop_seq,
            });
        }

        self.all_shapes.clear();
        let shapes = load_from_disk(self.emulation_id, "shapes".parse().unwrap()).await;
        for shape in shapes {
            let id = shape[0].parse::<u128>().unwrap_or(0);
            //let seq = shape[3].parse::<u32>().unwrap_or(0);

            let lat = shape[1].parse::<f64>().unwrap_or(0.0);
            let lon = shape[2].parse::<f64>().unwrap_or(0.0);

            let shape = Shape{shape_lat: lat, shape_lon: lon};

            let shapes_list = self.all_shapes.entry(id).or_insert(Vec::new());
            shapes_list.push(
                shape
            );
        }
    }

    pub(crate) async fn get_buses(&mut self) -> HashMap<u128, BusDetails> {
        if self.is_update_needed() {
            self.update().await;
        }

        let mut all_buses = HashMap::new();

        let current_time = get_time();

        let all_routes_now = self.find_all_next_active_stops(current_time);
        for route in all_routes_now {
            let route_id = self.all_route_trips.get(&route.trip_id).unwrap().route_id;

            let route_shape = self.all_shapes.get(&route_id).unwrap();
            let current_stop = self.all_stops.get(&route.stop_id).unwrap();

            let hours_difference = ((route.departure_date + route.departure_time) as f64 - current_time as f64) / 3_600_000.0;

            let bus_position = calculate_route_distance(current_stop, route_shape, 25.0 * hours_difference);

            let bus = BusDetails {
                label: route.trip_id.to_string(),
                latitude: bus_position.shape_lat,
                longitude: bus_position.shape_lon,
                bearing: 90f32,
                speed_km_per_hour: 6.94,
                trip_id: route.trip_id.to_string(),
                route_id: route_id.to_string(),
                route_long_name: "a".parse().unwrap(),
                rout_short_name: "s".parse().unwrap(),
            };

            all_buses.insert(route.trip_id, bus);
        }

        all_buses
    }

    pub fn find_all_next_active_stops(&self, now: u128) -> Vec<StopTime> {
        self.all_stop_times
            .values()
            .filter_map(|stops| {
                let trip_started = stops.iter().any(|s| s.stop_seq == 0 && (s.departure_date + s.departure_time) <= now);

                if !trip_started {
                    return None;
                }

                stops.iter()
                    .filter(|s| s.stop_seq != 0 && (s.departure_date + s.departure_time) > now)
                    .min_by_key(|s| s.departure_date + s.departure_time)
                    .cloned()
            })
            .collect()
    }

    pub async fn departure_time_from_stop(&mut self, bus: u128, stop_id: u128) -> Vec<String> {
        if self.is_update_needed() {
            self.update().await;
        }

        let current_time = get_time();
        let mut all_times_for_stop: Vec<String> = Vec::new();

        for (id, stop_time_list) in &self.all_stop_times {
            if self.all_route_trips.get(id).unwrap().route_id != bus {
                continue;
            }

            let last_stop = stop_time_list.last().unwrap();

            if  last_stop.departure_time + last_stop.departure_date < current_time {
                continue;
            }

            if !is_today(last_stop.departure_date) {
                continue;
            }

            for stop_time in stop_time_list {
                if stop_time.stop_id != stop_id {
                    continue;
                }

                all_times_for_stop.push(stop_time.trip_id.to_string() + &*"_".to_string() + &*(stop_time.departure_time + stop_time.departure_date).to_string());
                break
            }
        };

        all_times_for_stop
    }

    pub async fn departure_time_from_start(&mut self) -> HashMap<u128, HashSet<String>> {
        if self.is_update_needed() {
            self.update().await;
        }

        let mut all_times: HashMap<u128, HashSet<String>> = HashMap::new();

        for (id, stop_time_list) in &self.all_stop_times {
            let first_stop = stop_time_list.first().expect("Stop list is empty");

            let route_id = self.all_route_trips
                .get(&id)
                .expect("Route not found")
                .route_id;

            let current_stop_time = first_stop.departure_time;

            let date_id = self.get_date_id(first_stop.departure_date);
            let full_line = format!("{}_{}", date_id, current_stop_time);

            all_times.entry(route_id)
                .or_insert_with(HashSet::new)
                .insert(full_line);
        }

        all_times
    }

    fn get_date_id(&self, date: u128) -> &'static str {
        let datetime = DateTime::from_timestamp_millis(date as i64).unwrap();
        match datetime.weekday() {
            Weekday::Sat => "2",
            Weekday::Sun => "3",
            _ => "1",
        }
    }
}