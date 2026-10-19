use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use crate::AppState;

/// Everything the emulation reads; a feed missing any of these is rejected
const REQUIRED_FILES: &[&str] = &["calendar_dates.txt", "trips.txt", "stops.txt", "stop_times.txt", "shapes.txt"];

pub async fn download_and_unzip(emulation_id: u32) -> Result<(), String> {
    let url = "https://www.motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C".to_string()
        + &emulation_id.to_string()
        + "_google_transit.zip&rel=True";

    let target_dir = PathBuf::from(format!("{}{}", AppState::FILE_PATH, emulation_id));

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("bad response: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("download interrupted: {e}"))?;

    tokio::task::spawn_blocking(move || extract_replacing(&response, &target_dir))
        .await
        .map_err(|e| format!("extract task failed: {e}"))?
}

/// Unpacks into a temporary folder and only then swaps it in,
/// so a broken download never leaves the previous feed half-overwritten
fn extract_replacing(bytes: &[u8], target_dir: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("not a valid zip ({} bytes): {e}", bytes.len()))?;

    let tmp_dir = target_dir.with_extension("tmp");
    let _ = fs::remove_dir_all(&tmp_dir);

    if let Err(e) = extract_into(&mut archive, &tmp_dir) {
        let _ = fs::remove_dir_all(&tmp_dir);
        return Err(e);
    }

    let old_dir = target_dir.with_extension("old");
    let _ = fs::remove_dir_all(&old_dir);
    if target_dir.exists() {
        fs::rename(target_dir, &old_dir).map_err(|e| format!("can't move old feed aside: {e}"))?;
    }
    if let Err(e) = fs::rename(&tmp_dir, target_dir) {
        let _ = fs::rename(&old_dir, target_dir);
        return Err(format!("can't move new feed in place: {e}"));
    }
    let _ = fs::remove_dir_all(&old_dir);

    Ok(())
}

fn extract_into(archive: &mut zip::ZipArchive<Cursor<&[u8]>>, dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("broken entry #{i}: {e}"))?;
        let Some(relative) = file.enclosed_name().map(Path::to_path_buf) else {
            continue;
        };
        let outpath = dir.join(relative);

        if file.is_dir() {
            fs::create_dir_all(&outpath).map_err(|e| format!("can't create {}: {e}", outpath.display()))?;
            continue;
        }
        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("can't create {}: {e}", parent.display()))?;
        }
        let mut outfile = fs::File::create(&outpath).map_err(|e| format!("can't write {}: {e}", outpath.display()))?;
        std::io::copy(&mut file, &mut outfile).map_err(|e| format!("can't unpack {}: {e}", file.name()))?;
    }

    for name in REQUIRED_FILES {
        if !dir.join(name).exists() {
            return Err(format!("archive has no {name}"));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_with(files: &[&str]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for name in files {
            writer.start_file(*name, zip::write::FileOptions::default()).unwrap();
            writer.write_all(b"header\n").unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn feed_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("busview-gtfs-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("trips.txt"), "old").unwrap();
        dir
    }

    #[test]
    fn garbage_download_keeps_old_feed() {
        let dir = feed_dir("garbage");
        let err = extract_replacing(b"<html>Service Unavailable</html>", &dir).unwrap_err();
        assert!(err.contains("not a valid zip"), "{err}");
        assert_eq!(fs::read_to_string(dir.join("trips.txt")).unwrap(), "old");
        assert!(!dir.with_extension("tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn incomplete_feed_keeps_old_feed() {
        let dir = feed_dir("incomplete");
        let err = extract_replacing(&zip_with(&["trips.txt", "stops.txt"]), &dir).unwrap_err();
        assert!(err.contains("calendar_dates.txt"), "{err}");
        assert_eq!(fs::read_to_string(dir.join("trips.txt")).unwrap(), "old");
        assert!(!dir.with_extension("tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn valid_feed_replaces_old_one() {
        let dir = feed_dir("valid");
        fs::write(dir.join("stale.txt"), "gone").unwrap();
        extract_replacing(&zip_with(REQUIRED_FILES), &dir).unwrap();
        assert_eq!(fs::read_to_string(dir.join("trips.txt")).unwrap(), "header\n");
        assert!(!dir.join("stale.txt").exists());
        assert!(!dir.with_extension("tmp").exists() && !dir.with_extension("old").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
