use std::time::{SystemTime, UNIX_EPOCH};

pub fn get_time() -> u128 {
    let now = SystemTime::now();
    let duration = now
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards");

    duration.as_millis()
}