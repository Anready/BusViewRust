use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection};
use serde::Serialize;

/// Pageview columns the dashboard may filter by. Only these names are ever interpolated into SQL.
pub const FILTER_COLUMNS: &[&str] = &[
    "path", "referrer", "utm_source", "utm_medium", "utm_campaign", "country", "timezone",
    "browser", "os", "device", "screen", "lang", "theme", "app_mode",
];

const HOUR: i64 = 3_600_000;
const DAY: i64 = 86_400_000;

pub struct Scope {
    pub from: i64,
    pub to: i64,
    /// Viewer's UTC offset in ms, so days and hours are bucketed in their local time
    pub tz_offset: i64,
    pub filters: Vec<(&'static str, String)>,
}

impl Scope {
    fn pageview_where(&self, from: i64, to: i64) -> (String, Vec<Value>) {
        let mut sql = String::from("ts >= ? AND ts < ?");
        let mut values = vec![Value::Integer(from), Value::Integer(to)];
        for (column, value) in &self.filters {
            sql.push_str(&format!(" AND IFNULL({column}, '') = ?"));
            values.push(Value::Text(value.clone()));
        }
        (sql, values)
    }

    fn path_filter(&self) -> Option<&str> {
        self.filters.iter().find(|(c, _)| *c == "path").map(|(_, v)| v.as_str())
    }
}

#[derive(Serialize, Default)]
pub struct Kpi {
    pub pageviews: i64,
    pub visitors: i64,
    pub sessions: i64,
    pub bounces: i64,
    pub new_visitors: i64,
    pub avg_session_ms: f64,
    pub avg_page_ms: f64,
    /// Sum of per-UTC-day unique IP + User-Agent hashes
    pub ip_visitors: i64,
    /// Sum of per-UTC-day unique visitor ids over the same pageviews, to compare with ip_visitors
    pub id_visitors_daily: i64,
}

#[derive(Serialize)]
pub struct Point {
    pub t: i64,
    pub pageviews: i64,
    pub visitors: i64,
    pub sessions: i64,
    pub ip_visitors: i64,
}

#[derive(Serialize)]
pub struct Row {
    pub key: String,
    pub pageviews: i64,
    pub visitors: i64,
    pub avg_ms: f64,
}

#[derive(Serialize)]
pub struct EntryRow {
    pub key: String,
    pub sessions: i64,
    pub bounces: i64,
}

#[derive(Serialize)]
pub struct EventRow {
    pub name: String,
    pub count: i64,
    pub visitors: i64,
}

#[derive(Serialize)]
pub struct EventPropsRow {
    pub props: String,
    pub count: i64,
    pub visitors: i64,
    pub last_ts: i64,
}

#[derive(Serialize)]
pub struct ApiRoute {
    pub route: String,
    pub count: i64,
    pub avg_ms: f64,
    pub max_ms: i64,
    pub client_errors: i64,
    pub server_errors: i64,
}

#[derive(Serialize)]
pub struct ApiPoint {
    pub t: i64,
    pub count: i64,
    pub errors: i64,
}

#[derive(Serialize)]
pub struct ApiStats {
    pub routes: Vec<ApiRoute>,
    pub series: Vec<ApiPoint>,
    pub statuses: Vec<(i64, i64)>,
}

#[derive(Serialize)]
pub struct Stats {
    pub from: i64,
    pub to: i64,
    pub bucket: i64,
    pub kpi: Kpi,
    pub prev: Kpi,
    pub series: Vec<Point>,
    pub pages: Vec<Row>,
    pub entry_pages: Vec<EntryRow>,
    pub referrers: Vec<Row>,
    pub utm_source: Vec<Row>,
    pub utm_campaign: Vec<Row>,
    pub country: Vec<Row>,
    pub timezone: Vec<Row>,
    pub browser: Vec<Row>,
    pub os: Vec<Row>,
    pub device: Vec<Row>,
    pub screen: Vec<Row>,
    pub lang: Vec<Row>,
    pub theme: Vec<Row>,
    pub app_mode: Vec<Row>,
    /// [day of week (0 = Sunday), hour, pageviews]
    pub heatmap: Vec<[i64; 3]>,
    pub events: Vec<EventRow>,
    pub api: ApiStats,
}

pub fn stats(conn: &Connection, scope: &Scope) -> rusqlite::Result<Stats> {
    let span = scope.to - scope.from;
    let bucket = if span <= 3 * DAY { HOUR } else { DAY };

    Ok(Stats {
        from: scope.from,
        to: scope.to,
        bucket,
        kpi: kpi(conn, scope, scope.from, scope.to)?,
        prev: kpi(conn, scope, scope.from - span, scope.from)?,
        series: series(conn, scope, bucket)?,
        pages: breakdown(conn, scope, "path", 100)?,
        entry_pages: entry_pages(conn, scope)?,
        referrers: breakdown(conn, scope, "referrer", 50)?,
        utm_source: breakdown(conn, scope, "utm_source", 30)?,
        utm_campaign: breakdown(conn, scope, "utm_campaign", 30)?,
        country: breakdown(conn, scope, "country", 50)?,
        timezone: breakdown(conn, scope, "timezone", 50)?,
        browser: breakdown(conn, scope, "browser", 20)?,
        os: breakdown(conn, scope, "os", 20)?,
        device: breakdown(conn, scope, "device", 10)?,
        screen: breakdown(conn, scope, "screen", 30)?,
        lang: breakdown(conn, scope, "lang", 30)?,
        theme: breakdown(conn, scope, "theme", 10)?,
        app_mode: breakdown(conn, scope, "app_mode", 10)?,
        heatmap: heatmap(conn, scope)?,
        events: events(conn, scope)?,
        api: api_stats(conn, scope, bucket)?,
    })
}

fn kpi(conn: &Connection, scope: &Scope, from: i64, to: i64) -> rusqlite::Result<Kpi> {
    let (w, values) = scope.pageview_where(from, to);
    let sql = format!(
        "WITH pv AS (SELECT ts, visitor_id, session_id, duration_ms, is_new, daily_id FROM pageviews WHERE {w}),
              s AS (SELECT COUNT(*) AS c, SUM(duration_ms) AS d FROM pv GROUP BY session_id)
         SELECT (SELECT COUNT(*) FROM pv),
                (SELECT COUNT(DISTINCT visitor_id) FROM pv),
                (SELECT COUNT(*) FROM s),
                (SELECT COUNT(*) FROM s WHERE c = 1),
                (SELECT COUNT(DISTINCT visitor_id) FROM pv WHERE is_new = 1),
                (SELECT IFNULL(AVG(d), 0) FROM s),
                (SELECT IFNULL(AVG(duration_ms), 0) FROM pv WHERE duration_ms > 0),
                (SELECT COUNT(DISTINCT daily_id) FROM pv),
                (SELECT IFNULL(SUM(c), 0) FROM (
                    SELECT COUNT(DISTINCT visitor_id) AS c FROM pv WHERE daily_id IS NOT NULL GROUP BY ts / {DAY}))"
    );
    conn.query_row(&sql, params_from_iter(values), |r| {
        Ok(Kpi {
            pageviews: r.get(0)?,
            visitors: r.get(1)?,
            sessions: r.get(2)?,
            bounces: r.get(3)?,
            new_visitors: r.get(4)?,
            avg_session_ms: r.get(5)?,
            avg_page_ms: r.get(6)?,
            ip_visitors: r.get(7)?,
            id_visitors_daily: r.get(8)?,
        })
    })
}

fn series(conn: &Connection, scope: &Scope, bucket: i64) -> rusqlite::Result<Vec<Point>> {
    let (w, values) = scope.pageview_where(scope.from, scope.to);
    let off = scope.tz_offset;
    let sql = format!(
        "SELECT ((ts + {off}) / {bucket}) * {bucket} - {off} AS t,
                COUNT(*), COUNT(DISTINCT visitor_id), COUNT(DISTINCT session_id), COUNT(DISTINCT daily_id)
         FROM pageviews WHERE {w} GROUP BY t ORDER BY t"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(values), |r| {
        Ok(Point { t: r.get(0)?, pageviews: r.get(1)?, visitors: r.get(2)?, sessions: r.get(3)?, ip_visitors: r.get(4)? })
    })?;
    rows.collect()
}

fn breakdown(conn: &Connection, scope: &Scope, column: &'static str, limit: u32) -> rusqlite::Result<Vec<Row>> {
    let (w, values) = scope.pageview_where(scope.from, scope.to);
    let order = if column == "path" { "2 DESC, 3 DESC" } else { "3 DESC, 2 DESC" };
    let sql = format!(
        "SELECT IFNULL({column}, '') AS k, COUNT(*), COUNT(DISTINCT visitor_id), IFNULL(AVG(NULLIF(duration_ms, 0)), 0)
         FROM pageviews WHERE {w} GROUP BY k ORDER BY {order} LIMIT {limit}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(values), |r| {
        Ok(Row { key: r.get(0)?, pageviews: r.get(1)?, visitors: r.get(2)?, avg_ms: r.get(3)? })
    })?;
    rows.collect()
}

fn entry_pages(conn: &Connection, scope: &Scope) -> rusqlite::Result<Vec<EntryRow>> {
    let (w, values) = scope.pageview_where(scope.from, scope.to);
    // SQLite returns the bare `path` column from the row holding MIN(ts), i.e. the session's first page
    let sql = format!(
        "SELECT path, COUNT(*), SUM(c = 1) FROM (
            SELECT path, MIN(ts), COUNT(*) AS c FROM pageviews WHERE {w} GROUP BY session_id
         ) GROUP BY path ORDER BY 2 DESC LIMIT 50"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(values), |r| {
        Ok(EntryRow { key: r.get(0)?, sessions: r.get(1)?, bounces: r.get(2)? })
    })?;
    rows.collect()
}

fn heatmap(conn: &Connection, scope: &Scope) -> rusqlite::Result<Vec<[i64; 3]>> {
    let (w, values) = scope.pageview_where(scope.from, scope.to);
    let off = scope.tz_offset;
    // 1970-01-01 was a Thursday, hence the +4 to make 0 = Sunday
    let sql = format!(
        "SELECT (((ts + {off}) / {DAY}) + 4) % 7 AS dow, ((ts + {off}) / {HOUR}) % 24 AS h, COUNT(*)
         FROM pageviews WHERE {w} GROUP BY dow, h"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(values), |r| Ok([r.get(0)?, r.get(1)?, r.get(2)?]))?;
    rows.collect()
}

fn events(conn: &Connection, scope: &Scope) -> rusqlite::Result<Vec<EventRow>> {
    let mut sql = String::from("SELECT name, COUNT(*), COUNT(DISTINCT visitor_id) FROM events WHERE ts >= ? AND ts < ?");
    let mut values = vec![Value::Integer(scope.from), Value::Integer(scope.to)];
    if let Some(path) = scope.path_filter() {
        sql.push_str(" AND path = ?");
        values.push(Value::Text(path.to_string()));
    }
    sql.push_str(" GROUP BY name ORDER BY 2 DESC LIMIT 100");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(values), |r| {
        Ok(EventRow { name: r.get(0)?, count: r.get(1)?, visitors: r.get(2)? })
    })?;
    rows.collect()
}

pub fn event_props(conn: &Connection, scope: &Scope, name: &str) -> rusqlite::Result<Vec<EventPropsRow>> {
    let mut sql = String::from(
        "SELECT IFNULL(props, ''), COUNT(*), COUNT(DISTINCT visitor_id), MAX(ts) FROM events
         WHERE name = ? AND ts >= ? AND ts < ?",
    );
    let mut values = vec![Value::Text(name.to_string()), Value::Integer(scope.from), Value::Integer(scope.to)];
    if let Some(path) = scope.path_filter() {
        sql.push_str(" AND path = ?");
        values.push(Value::Text(path.to_string()));
    }
    sql.push_str(" GROUP BY 1 ORDER BY 2 DESC LIMIT 100");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(values), |r| {
        Ok(EventPropsRow { props: r.get(0)?, count: r.get(1)?, visitors: r.get(2)?, last_ts: r.get(3)? })
    })?;
    rows.collect()
}

fn api_stats(conn: &Connection, scope: &Scope, bucket: i64) -> rusqlite::Result<ApiStats> {
    let from = scope.from - scope.from.rem_euclid(HOUR);
    let to = scope.to;

    let mut stmt = conn.prepare(
        "SELECT route, SUM(count), SUM(total_ms), MAX(max_ms),
                SUM(CASE WHEN status >= 400 AND status < 500 THEN count ELSE 0 END),
                SUM(CASE WHEN status >= 500 THEN count ELSE 0 END)
         FROM api_stats WHERE bucket >= ?1 AND bucket < ?2 GROUP BY route ORDER BY 2 DESC",
    )?;
    let routes = stmt
        .query_map(params![from, to], |r| {
            let count: i64 = r.get(1)?;
            let total: i64 = r.get(2)?;
            Ok(ApiRoute {
                route: r.get(0)?,
                count,
                avg_ms: if count > 0 { total as f64 / count as f64 } else { 0.0 },
                max_ms: r.get(3)?,
                client_errors: r.get(4)?,
                server_errors: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let off = scope.tz_offset;
    let mut stmt = conn.prepare(&format!(
        "SELECT ((bucket + {off}) / {bucket}) * {bucket} - {off} AS t, SUM(count),
                SUM(CASE WHEN status >= 500 THEN count ELSE 0 END)
         FROM api_stats WHERE bucket >= ?1 AND bucket < ?2 GROUP BY t ORDER BY t"
    ))?;
    let series = stmt
        .query_map(params![from, to], |r| Ok(ApiPoint { t: r.get(0)?, count: r.get(1)?, errors: r.get(2)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut stmt = conn.prepare(
        "SELECT status, SUM(count) FROM api_stats WHERE bucket >= ?1 AND bucket < ?2 GROUP BY status ORDER BY 2 DESC",
    )?;
    let statuses = stmt
        .query_map(params![from, to], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(ApiStats { routes, series, statuses })
}

#[derive(Serialize)]
pub struct RecentView {
    pub ts: i64,
    pub path: String,
    pub referrer: Option<String>,
    pub country: Option<String>,
    pub timezone: Option<String>,
    pub browser: Option<String>,
    pub os: Option<String>,
    pub device: Option<String>,
    pub duration_ms: i64,
    pub is_new: bool,
}

#[derive(Serialize)]
pub struct ActivePage {
    pub path: String,
    pub visitors: i64,
}

#[derive(Serialize)]
pub struct Realtime {
    pub active: i64,
    pub pages: Vec<ActivePage>,
    /// Pageviews per minute for the last 30 minutes, oldest first
    pub minutes: Vec<i64>,
    pub recent: Vec<RecentView>,
}

pub const ACTIVE_WINDOW_MS: i64 = 5 * 60_000;

pub fn realtime(conn: &Connection, now: i64) -> rusqlite::Result<Realtime> {
    let since = now - ACTIVE_WINDOW_MS;

    let active = conn.query_row(
        "SELECT COUNT(DISTINCT visitor_id) FROM pageviews WHERE last_seen >= ?1",
        params![since],
        |r| r.get(0),
    )?;

    // A visitor counts on the page they looked at most recently
    let mut stmt = conn.prepare(
        "SELECT path, COUNT(*) FROM (
            SELECT path, MAX(last_seen) FROM pageviews WHERE last_seen >= ?1 GROUP BY visitor_id
         ) GROUP BY path ORDER BY 2 DESC LIMIT 20",
    )?;
    let pages = stmt
        .query_map(params![since], |r| Ok(ActivePage { path: r.get(0)?, visitors: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let start = now - 30 * 60_000;
    let mut minutes = vec![0i64; 30];
    let mut stmt = conn.prepare("SELECT (ts - ?1) / 60000 AS m, COUNT(*) FROM pageviews WHERE ts >= ?1 GROUP BY m")?;
    for row in stmt.query_map(params![start], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (m, c) = row?;
        if (0..30).contains(&m) {
            minutes[m as usize] = c;
        }
    }

    let mut stmt = conn.prepare(
        "SELECT ts, path, referrer, country, timezone, browser, os, device, duration_ms, is_new
         FROM pageviews ORDER BY ts DESC LIMIT 40",
    )?;
    let recent = stmt
        .query_map([], |r| {
            Ok(RecentView {
                ts: r.get(0)?,
                path: r.get(1)?,
                referrer: r.get(2)?,
                country: r.get(3)?,
                timezone: r.get(4)?,
                browser: r.get(5)?,
                os: r.get(6)?,
                device: r.get(7)?,
                duration_ms: r.get(8)?,
                is_new: r.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Realtime { active, pages, minutes, recent })
}
