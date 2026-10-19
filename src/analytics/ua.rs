pub struct Agent {
    pub browser: &'static str,
    pub os: &'static str,
    pub device: &'static str,
}

pub fn is_bot(ua: &str) -> bool {
    const MARKERS: &[&str] = &[
        "bot", "crawl", "spider", "slurp", "headless", "lighthouse", "pagespeed", "preview",
        "python", "curl", "wget", "okhttp", "go-http", "java/", "phantomjs", "selenium", "puppeteer",
    ];
    let ua = ua.to_ascii_lowercase();
    ua.is_empty() || MARKERS.iter().any(|m| ua.contains(m))
}

pub fn parse(ua: &str) -> Agent {
    // Order matters: most browsers also claim to be Chrome and/or Safari
    let browser = if ua.contains("Edg/") || ua.contains("EdgA/") || ua.contains("EdgiOS/") {
        "Edge"
    } else if ua.contains("OPR/") || ua.contains("Opera") {
        "Opera"
    } else if ua.contains("SamsungBrowser/") {
        "Samsung Internet"
    } else if ua.contains("YaBrowser/") {
        "Yandex"
    } else if ua.contains("Firefox/") || ua.contains("FxiOS/") {
        "Firefox"
    } else if ua.contains("CriOS/") || ua.contains("Chrome/") {
        "Chrome"
    } else if ua.contains("Safari/") {
        "Safari"
    } else {
        "Other"
    };

    let os = if ua.contains("Windows") {
        "Windows"
    } else if ua.contains("Android") {
        "Android"
    } else if ua.contains("iPhone") || ua.contains("iPad") || ua.contains("iPod") {
        "iOS"
    } else if ua.contains("CrOS") {
        "ChromeOS"
    } else if ua.contains("Mac OS X") || ua.contains("Macintosh") {
        "macOS"
    } else if ua.contains("Linux") {
        "Linux"
    } else {
        "Other"
    };

    let device = if ua.contains("iPad") || ua.contains("Tablet") || (ua.contains("Android") && !ua.contains("Mobile")) {
        "tablet"
    } else if ua.contains("Mobi") || ua.contains("iPhone") || ua.contains("Android") {
        "mobile"
    } else {
        "desktop"
    };

    Agent { browser, os, device }
}
