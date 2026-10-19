// Self-hosted analytics beacon, runs alongside Google Analytics. Data is browsed at /analytics.
// Custom events: window.bvTrack('event_name', { any: 'props' })
(function () {
    'use strict';

    const ENDPOINT = '/api/pulse';
    const SESSION_TIMEOUT = 30 * 60 * 1000;
    const HEARTBEAT = 30 * 1000;

    function get(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function set(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
    }

    window.bvTrack = function () {};
    // Opt-out switch, toggled from the analytics dashboard
    if (get('bv_noTrack') === '1' || navigator.webdriver) return;

    function randomId() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }

    function send(data) {
        const body = JSON.stringify(data);
        try {
            if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return;
        } catch (e) { /* fall through to fetch */ }
        try {
            fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, credentials: 'omit' });
        } catch (e) { /* ignore */ }
    }

    let isNewVisitor = false;
    let visitorId = get('bv_vid');
    if (!visitorId) {
        visitorId = randomId();
        isNewVisitor = true;
        set('bv_vid', visitorId);
    }

    function lastActivity() {
        return Number(get('bv_sts')) || 0;
    }

    function touchSession() {
        let sessionId = get('bv_sid');
        if (!sessionId || Date.now() - lastActivity() > SESSION_TIMEOUT) {
            sessionId = randomId();
            set('bv_sid', sessionId);
        }
        set('bv_sts', String(Date.now()));
        return sessionId;
    }

    function externalReferrer() {
        const ref = document.referrer;
        if (!ref) return null;
        try {
            return new URL(ref).host === location.host ? null : ref;
        } catch (e) {
            return null;
        }
    }

    let sessionId;
    let pageviewId;
    let engagedMs;
    let visibleSince;
    let lastSentMs;

    function startPageview(referrer) {
        sessionId = touchSession();
        pageviewId = randomId();
        engagedMs = 0;
        lastSentMs = -1;
        visibleSince = document.visibilityState === 'visible' ? performance.now() : null;

        const params = new URLSearchParams(location.search);
        const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
        let timezone = null;
        try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { /* old browser */ }

        send({
            t: 'pv',
            id: pageviewId,
            vid: visitorId,
            sid: sessionId,
            path: location.pathname,
            ref: referrer,
            us: params.get('utm_source'),
            um: params.get('utm_medium'),
            uc: params.get('utm_campaign'),
            sw: screen.width,
            sh: screen.height,
            lang: navigator.language || null,
            theme: document.documentElement.getAttribute('data-theme'),
            tz: timezone,
            mode: standalone ? 'app' : 'browser',
            new: isNewVisitor,
            tp: navigator.maxTouchPoints || 0,
        });
        isNewVisitor = false;
    }

    function currentEngagedMs() {
        return Math.round(engagedMs + (visibleSince !== null ? performance.now() - visibleSince : 0));
    }

    // Doubles as a heartbeat for the "online now" counter
    function flushEngagement() {
        const ms = currentEngagedMs();
        if (ms === lastSentMs) return;
        lastSentMs = ms;
        send({ t: 'eng', id: pageviewId, vid: visitorId, ms: ms });
    }

    startPageview(externalReferrer());

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            if (visibleSince !== null) {
                engagedMs += performance.now() - visibleSince;
                visibleSince = null;
            }
            flushEngagement();
        } else if (Date.now() - lastActivity() > SESSION_TIMEOUT) {
            // The tab sat in the background long enough that coming back is a new visit
            startPageview(null);
        } else {
            visibleSince = performance.now();
            set('bv_sts', String(Date.now()));
        }
    });

    window.addEventListener('pagehide', flushEngagement);

    setInterval(function () {
        if (document.visibilityState !== 'visible') return;
        set('bv_sts', String(Date.now()));
        flushEngagement();
    }, HEARTBEAT);

    window.bvTrack = function (name, props) {
        if (!name) return;
        set('bv_sts', String(Date.now()));
        send({ t: 'ev', vid: visitorId, sid: sessionId, path: location.pathname, name: String(name), props: props || null });
    };

    let reportedErrors = 0;
    window.addEventListener('error', function (e) {
        if (!e.message || e.message === 'Script error.' || reportedErrors++ >= 5) return;
        window.bvTrack('js_error', {
            msg: String(e.message).slice(0, 300),
            src: String(e.filename || '').split('?')[0].slice(-120),
            line: e.lineno || 0,
        });
    });
    window.addEventListener('unhandledrejection', function (e) {
        if (reportedErrors++ >= 5) return;
        const reason = e.reason && e.reason.message ? e.reason.message : e.reason;
        window.bvTrack('js_error', { msg: String(reason).slice(0, 300), src: 'promise' });
    });
})();
