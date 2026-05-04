use std::{fs};
use std::io::Cursor;
use std::path::Path;
use crate::{AppState, Errors};

pub async fn download_and_unzip(emulation_id: u32) -> Result<String, Errors> {
    let url = "https://www.motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C".to_string()
        + &emulation_id.to_string()
        + "_google_transit.zip&rel=True";

    let target_dir = AppState::FILE_PATH.to_string() + &emulation_id.to_string() + "/";

    let response = reqwest::get(url)
        .await
        .map_err(|_| Errors::DbError)?
        .bytes()
        .await
        .map_err(|_| Errors::DbError)?;

    let target_dir_clone = target_dir.to_string();

    tokio::task::spawn_blocking(move || {
        let reader = Cursor::new(response);
        let mut archive = zip::ZipArchive::new(reader).expect("Failed to open zip");

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).unwrap();
            let outpath = match file.enclosed_name() {
                Some(path) => Path::new(&target_dir_clone).join(path),
                None => continue,
            };

            if (*file.name()).ends_with('/') {
                fs::create_dir_all(&outpath).unwrap();
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(&p).unwrap();
                    }
                }
                let mut outfile = fs::File::create(&outpath).unwrap();
                std::io::copy(&mut file, &mut outfile).unwrap();
            }
        }
    })
        .await
        .map_err(|_| Errors::DbError)?;

    Ok(format!("File extracted in {}", target_dir))
}

