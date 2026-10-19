use std::collections::{HashMap, HashSet};
use std::path::Path;
use chrono::{DateTime, Datelike, Weekday};
use crate::AppState;
use crate::emulation::structures::{BusDetails, CalendarDateRow, Shape, ShapeRow, Stop, StopRow, StopTime, StopTimeRow, Trip, TripRow};
use crate::helpers::utils::{calculate_route_distance, get_time, is_today, load_from_disk, parse_date, parse_time_to_ms};

pub(crate) struct Emulation {
    emulation_id: u32,
    last_time_updated: u128,
    all_stops: HashMap<u128, Stop>,
    all_stop_times: HashMap<u128, Vec<StopTime>>,
    all_shapes: HashMap<u128, Vec<Shape>>,
    all_route_trips: HashMap<u128, Trip>,
    all_days_ids: HashMap<u128, u128>,
    service_day_types: HashMap<u128, Vec<&'static str>>,
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
            all_days_ids: HashMap::new(),
            service_day_types: HashMap::new()
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

        self.service_day_types.clear();

        let date_ids: Vec<CalendarDateRow> = load_from_disk(self.emulation_id, "calendar_dates").await;

        // Count how often each service runs on weekdays / Saturdays / Sundays
        let mut day_counts: HashMap<u128, [u32; 3]> = HashMap::new();

        for date_id in date_ids {
            let id = date_id.service_id;
            let date = parse_date(&date_id.date);

            if !self.all_days_ids.contains_key(&id) || is_today(date) {
                self.all_days_ids.insert(id, date);
            }

            let idx = match Self::get_date_id(date) {
                "2" => 1,
                "3" => 2,
                _ => 0,
            };
            day_counts.entry(id).or_insert([0; 3])[idx] += 1;
        }

        // Normalize per single day (weekdays = 5 days) and drop rare exceptions like holidays
        for (id, counts) in day_counts {
            let per_day = [counts[0] as f64 / 5.0, counts[1] as f64, counts[2] as f64];
            let max = per_day.iter().cloned().fold(0.0, f64::max);

            let types: Vec<&'static str> = ["1", "2", "3"]
                .into_iter()
                .zip(per_day)
                .filter(|(_, v)| *v > 0.0 && *v >= max * 0.5)
                .map(|(t, _)| t)
                .collect();

            self.service_day_types.insert(id, types);
        }
    }

    async fn load_data(&mut self) {
        self.load_all_ids().await;

        // 2. TRIPS
        self.all_route_trips.clear();
        let route_trips: Vec<TripRow> = load_from_disk(self.emulation_id, "trips").await;
        for route_trip in route_trips {
            let date = self.all_days_ids.get(&route_trip.service_id).copied().unwrap_or(0);
            let trip = Trip {
                route_id: route_trip.route_id,
                service_id: route_trip.service_id,
                departure_date: date,
            };
            self.all_route_trips.insert(route_trip.trip_id, trip);
        }

        // 3. STOPS
        self.all_stops.clear();
        let stops: Vec<StopRow> = load_from_disk(self.emulation_id, "stops").await;
        for stop in stops {
            self.all_stops.insert(stop.stop_id, Stop {
                stop_lat: stop.stop_lat,
                stop_lon: stop.stop_lon,
            });
        }

        // 4. STOP TIMES
        self.all_stop_times.clear();
        let stop_times: Vec<StopTimeRow> = load_from_disk(self.emulation_id, "stop_times").await;
        for stop_time in stop_times {
            // Защита от кривых данных: проверяем, есть ли trip в базе
            if let Some(trip) = self.all_route_trips.get(&stop_time.trip_id) {
                let departure_time = parse_time_to_ms(&stop_time.departure_time);

                let stop_time_list = self.all_stop_times.entry(stop_time.trip_id).or_insert(Vec::new());
                stop_time_list.push(StopTime {
                    trip_id: stop_time.trip_id,
                    departure_date: trip.departure_date,
                    departure_time,
                    stop_id: stop_time.stop_id,
                    stop_seq: stop_time.stop_sequence,
                });
            }
        }

        // 5. SHAPES
        self.all_shapes.clear();
        let shapes: Vec<ShapeRow> = load_from_disk(self.emulation_id, "shapes").await;
        for shape in shapes {
            let shape_list = self.all_shapes.entry(shape.shape_id).or_insert(Vec::new());
            shape_list.push(Shape {
                shape_lat: shape.shape_pt_lat,
                shape_lon: shape.shape_pt_lon,
            });
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

            let trip = self.all_route_trips
                .get(&id)
                .expect("Route not found");

            let current_stop_time = first_stop.departure_time;

            let times = all_times.entry(trip.route_id).or_insert_with(HashSet::new);

            match self.service_day_types.get(&trip.service_id) {
                Some(types) if !types.is_empty() => {
                    for date_id in types {
                        times.insert(format!("{}_{}", date_id, current_stop_time));
                    }
                }
                _ => {
                    let date_id = Self::get_date_id(first_stop.departure_date);
                    times.insert(format!("{}_{}", date_id, current_stop_time));
                }
            }
        }

        all_times
    }

    fn get_date_id(date: u128) -> &'static str {
        let datetime = DateTime::from_timestamp_millis(date as i64).unwrap();
        match datetime.weekday() {
            Weekday::Sat => "2",
            Weekday::Sun => "3",
            _ => "1",
        }
    }
}