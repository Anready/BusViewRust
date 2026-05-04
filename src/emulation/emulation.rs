use std::path::Path;
use std::sync::Arc;
use crate::AppState;

pub(crate) struct Emulation {
    emulation_id: u32,
    pub state: Arc<AppState>,
}

impl Emulation {
    pub(crate) async fn new(emulation_id: u32, state: Arc<AppState>) -> Self {
        let full_path_str = format!("{}{}/calendar_dates.txt", AppState::FILE_PATH, emulation_id);
        let path = Path::new(&full_path_str);

        if !path.exists() {
            Self::update(&state, emulation_id).await;
        } else {
            if Self::is_update_needed(&state) {
                Self::update(&state, emulation_id).await;
                println!("UPDATE");
            }
        }

        Self {
            emulation_id,
            state
        }
    }

    fn is_update_needed(state: &AppState) -> bool {
        let mut update_needed = true;

        let time_updated: u128 = {
            let lock = state.last_updated.lock().unwrap();
            *lock
        };

        if crate::helpers::utils::get_time() - time_updated > 172800000 {
            update_needed = true;
        }

        update_needed
    }

    async fn update(state: &AppState, emulation_id: u32) {
        {
            let mut last_updated = state.last_updated.lock().unwrap();
            *last_updated = crate::helpers::utils::get_time();
        }

        let a = crate::helpers::update_data::download_and_unzip(emulation_id);

        if a.await.is_ok() {
            println!("S");
        }
    }

    // fn deactivate(&mut self) {
    //     self.active = false;
    // }
}