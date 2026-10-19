use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;
use rusqlite::{params, Connection};

pub const DB_PATH: &str = "./server_data/analytics.sqlite";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS pageviews (
    id           TEXT PRIMARY KEY,
    ts           INTEGER NOT NULL,
    visitor_id   TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    path         TEXT NOT NULL,
    referrer     TEXT,
    utm_source   TEXT,
    utm_medium   TEXT,
    utm_campaign TEXT,
    country      TEXT,
    timezone     TEXT,
    browser      TEXT,
    os           TEXT,
    device       TEXT,
    screen       TEXT,
    lang         TEXT,
    theme        TEXT,
    app_mode     TEXT,
    is_new       INTEGER NOT NULL DEFAULT 0,
    -- Hash of IP + User-Agent with a salt that is replaced every UTC day, so it only links visits within one day
    daily_id     TEXT,
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    last_seen    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pageviews_ts ON pageviews(ts);
CREATE INDEX IF NOT EXISTS pageviews_last_seen ON pageviews(last_seen);
CREATE INDEX IF NOT EXISTS pageviews_session ON pageviews(session_id);

-- Only today's salt is kept; once it is gone, older daily_id values can't be recomputed from an IP
CREATE TABLE IF NOT EXISTS daily_salts (
    day  INTEGER PRIMARY KEY,
    salt BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY,
    ts         INTEGER NOT NULL,
    visitor_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    path       TEXT NOT NULL,
    name       TEXT NOT NULL,
    props      TEXT
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_name_ts ON events(name, ts);

-- Server-side API usage, aggregated per hour
CREATE TABLE IF NOT EXISTS api_stats (
    bucket   INTEGER NOT NULL,
    route    TEXT NOT NULL,
    status   INTEGER NOT NULL,
    count    INTEGER NOT NULL,
    total_ms INTEGER NOT NULL,
    max_ms   INTEGER NOT NULL,
    PRIMARY KEY (bucket, route, status)
) WITHOUT ROWID;
";

pub struct PageView {
    pub id: String,
    pub ts: i64,
    pub visitor_id: String,
    pub session_id: String,
    pub path: String,
    pub referrer: Option<String>,
    pub utm_source: Option<String>,
    pub utm_medium: Option<String>,
    pub utm_campaign: Option<String>,
    pub country: Option<String>,
    pub timezone: Option<String>,
    pub browser: &'static str,
    pub os: &'static str,
    pub device: &'static str,
    pub screen: Option<String>,
    pub lang: Option<String>,
    pub theme: Option<String>,
    pub app_mode: Option<String>,
    pub is_new: bool,
    pub daily_id: Option<String>,
}

pub struct Engagement {
    pub ts: i64,
    pub id: String,
    pub visitor_id: String,
    pub duration_ms: i64,
}

pub struct Event {
    pub ts: i64,
    pub visitor_id: String,
    pub session_id: String,
    pub path: String,
    pub name: String,
    pub props: Option<String>,
}

pub struct ApiHit {
    pub ts: i64,
    pub route: String,
    pub status: u16,
    pub ms: i64,
}

pub enum Record {
    Salt { day: i64, salt: Vec<u8> },
    PageView(PageView),
    Engagement(Engagement),
    Event(Event),
    ApiHit(ApiHit),
}

pub fn open() -> rusqlite::Result<Connection> {
    let conn = Connection::open(DB_PATH)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(conn)
}

pub fn init() -> rusqlite::Result<Connection> {
    if let Some(dir) = std::path::Path::new(DB_PATH).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = open()?;
    conn.execute_batch(SCHEMA)?;

    // Databases created before daily_id existed
    let has_daily_id = conn
        .prepare("SELECT 1 FROM pragma_table_info('pageviews') WHERE name = 'daily_id'")?
        .exists([])?;
    if !has_daily_id {
        conn.execute_batch("ALTER TABLE pageviews ADD COLUMN daily_id TEXT")?;
    }
    Ok(conn)
}

/// All writes go through one thread that owns the connection, so request handlers never block on SQLite.
pub fn load_salt(conn: &Connection, day: i64) -> rusqlite::Result<Option<Vec<u8>>> {
    conn.query_row("SELECT salt FROM daily_salts WHERE day = ?1", params![day], |r| r.get(0))
        .map(Some)
        .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })
}

pub fn spawn_writer(mut conn: Connection) -> mpsc::SyncSender<Record> {
    let (tx, rx) = mpsc::sync_channel::<Record>(20_000);

    std::thread::Builder::new()
        .name("analytics-writer".into())
        .spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut batch = vec![first];
                while batch.len() < 2_000 {
                    match rx.try_recv() {
                        Ok(record) => batch.push(record),
                        Err(_) => break,
                    }
                }
                if let Err(e) = write_batch(&mut conn, batch) {
                    eprintln!("analytics: failed to write batch: {e}");
                }
            }
        })
        .expect("failed to spawn analytics writer");

    tx
}

fn write_batch(conn: &mut Connection, batch: Vec<Record>) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let mut api: HashMap<(i64, String, u16), (i64, i64, i64)> = HashMap::new();

    {
        let mut insert_pv = tx.prepare_cached(
            "INSERT OR IGNORE INTO pageviews (id, ts, visitor_id, session_id, path, referrer, utm_source, utm_medium,
                utm_campaign, country, timezone, browser, os, device, screen, lang, theme, app_mode, is_new, last_seen, daily_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?2, ?20)",
        )?;
        let mut update_eng = tx.prepare_cached(
            "UPDATE pageviews SET duration_ms = MAX(duration_ms, ?1), last_seen = MAX(last_seen, ?2)
             WHERE id = ?3 AND visitor_id = ?4",
        )?;
        let mut insert_ev = tx.prepare_cached(
            "INSERT INTO events (ts, visitor_id, session_id, path, name, props) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;

        for record in batch {
            match record {
                Record::PageView(p) => {
                    insert_pv.execute(params![
                        p.id, p.ts, p.visitor_id, p.session_id, p.path, p.referrer, p.utm_source, p.utm_medium,
                        p.utm_campaign, p.country, p.timezone, p.browser, p.os, p.device, p.screen, p.lang,
                        p.theme, p.app_mode, p.is_new, p.daily_id
                    ])?;
                }
                Record::Engagement(e) => {
                    update_eng.execute(params![e.duration_ms, e.ts, e.id, e.visitor_id])?;
                }
                Record::Event(e) => {
                    insert_ev.execute(params![e.ts, e.visitor_id, e.session_id, e.path, e.name, e.props])?;
                }
                Record::Salt { day, salt } => {
                    tx.execute("INSERT OR REPLACE INTO daily_salts (day, salt) VALUES (?1, ?2)", params![day, salt])?;
                    tx.execute("DELETE FROM daily_salts WHERE day < ?1", params![day])?;
                }
                Record::ApiHit(h) => {
                    let bucket = h.ts - h.ts.rem_euclid(3_600_000);
                    let entry = api.entry((bucket, h.route, h.status)).or_insert((0, 0, 0));
                    entry.0 += 1;
                    entry.1 += h.ms;
                    entry.2 = entry.2.max(h.ms);
                }
            }
        }

        let mut upsert_api = tx.prepare_cached(
            "INSERT INTO api_stats (bucket, route, status, count, total_ms, max_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (bucket, route, status) DO UPDATE SET
                count = count + excluded.count,
                total_ms = total_ms + excluded.total_ms,
                max_ms = MAX(max_ms, excluded.max_ms)",
        )?;
        for ((bucket, route, status), (count, total, max)) in api {
            upsert_api.execute(params![bucket, route, status, count, total, max])?;
        }
    }

    tx.commit()
}
