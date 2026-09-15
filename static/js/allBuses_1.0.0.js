const ROUTES_BASE_URL = 'https://raw.githubusercontent.com/Anready/BusRoutes/refs/heads/main/new/';
const BUSES_UPDATE_INTERVAL = 10000;
const BUS_ANIMATION_DURATION = 1000;
// Jumps longer than this (degrees, ~2 km) are not animated
const MAX_ANIMATED_JUMP = 0.02;
// Same Turnstile site key as the main page
const TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
const CYPRUS_BOUNDS = [[32.0, 34.3], [34.9, 36.0]];

const LIVE_BUS_COLOR = '#1976d2';
const ESTIMATED_BUS_COLOR = '#78909c';
const ROUTE_COLOR = '#1976d2';
const ROUTE_ARROW_COLOR = '#3b89d6';

const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };

// Material "directions_bus" glyph, 24x24
const BUS_GLYPH_PATH = 'M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z';

// 32x32: colored disc with a white bus, always drawn upright
function busIconSvg(color) {
    return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
    <circle cx="16" cy="16" r="13" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>
    <g transform="translate(8 8) scale(0.6667)"><path fill="#ffffff" d="${BUS_GLYPH_PATH}"/></g>
</svg>`.trim();
}

// 48x48, same center as the bus icon: a notch just outside the disc, rotated by bearing
function busHeadingSvg(color) {
    return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
    <path d="M24 3 L30.5 12 L17.5 12 Z" fill="${color}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`.trim();
}

// Same chevron as the route arrows on the main map
function routeArrowSvg() {
    return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="32" height="32">
    <path fill="${ROUTE_ARROW_COLOR}" d="M338.752 104.704a64 64 0 000 90.496l316.8 316.8-316.8 316.8a64 64 0 0090.496 90.496l362.048-362.048a64 64 0 000-90.496L429.248 104.704a64 64 0 00-90.496 0z"/>
</svg>`.trim();
}

// Rasterizes an SVG at 2x for crisp icons (use with pixelRatio: 2)
function rasterizeSvg(svg, size) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size * 2;
            canvas.height = size * 2;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
        };
        img.onerror = reject;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
}

// The mini map only needs land, water and roads: no buildings, no labels (and so no glyph requests)
function miniMapStyle() {
    const style = getMapStyle();
    delete style.glyphs;
    style.layers = style.layers.filter(layer => layer.type !== 'symbol' && layer.id !== 'building');
    return style;
}

function lerpBearing(from, to, t) {
    const delta = ((to - from + 540) % 360) - 180;
    return from + delta * t;
}

function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

class BusSheet {
    constructor(page) {
        this.page = page;
        this.el = document.getElementById('busSheet');
        this.badge = document.getElementById('busSheetBadge');
        this.name = document.getElementById('busSheetName');
        this.meta = document.getElementById('busSheetMeta');
        this.status = document.getElementById('miniMapStatus');
        this.button = document.getElementById('showOnMainMap');

        this.bus = null;
        this.route = null;
        // Ignores route shapes that arrive after another bus was selected
        this.requestId = 0;

        document.getElementById('busSheetClose').addEventListener('click', () => this.close());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });

        this.button.addEventListener('click', () => {
            if (this.route) {
                window.location.href = `/?bus=${encodeURIComponent(this.route.rawId)}`;
            }
        });

        this.initSwipe(document.getElementById('busSheetGrip'));
        // Created up front so style, PMTiles header and low-zoom tiles are ready by the first tap
        this.initMiniMap();
    }

    get isOpen() {
        return this.el.classList.contains('open');
    }

    initMiniMap() {
        this.miniMap = new maplibregl.Map({
            container: 'miniMap',
            style: miniMapStyle(),
            center: [33.2, 35.0],
            zoom: 8,
            interactive: false,
            attributionControl: false,
            fadeDuration: 0,
            renderWorldCopies: false
        });

        this.miniMapReady = new Promise(resolve => {
            this.miniMap.on('load', async () => {
                try {
                    this.miniMap.addImage('route-arrow', await rasterizeSvg(routeArrowSvg(), 20), { pixelRatio: 2 });
                } catch (error) {
                    console.error('Failed to load route arrow:', error);
                }

                this.miniMap.addSource('route', { type: 'geojson', data: EMPTY_COLLECTION });
                this.miniMap.addLayer({
                    id: 'route',
                    type: 'line',
                    source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': ROUTE_COLOR, 'line-width': 4 }
                });
                this.miniMap.addLayer({
                    id: 'route-arrows',
                    type: 'symbol',
                    source: 'route',
                    layout: {
                        'symbol-placement': 'line',
                        'symbol-spacing': 50,
                        'icon-image': 'route-arrow',
                        'icon-rotation-alignment': 'map',
                        'icon-allow-overlap': true,
                        'icon-ignore-placement': true
                    }
                });

                this.miniMap.addSource('bus', { type: 'geojson', data: EMPTY_COLLECTION });
                this.miniMap.addLayer({
                    id: 'bus',
                    type: 'circle',
                    source: 'bus',
                    paint: {
                        'circle-radius': 7,
                        'circle-color': ['case', ['get', 'emulated'], ESTIMATED_BUS_COLOR, LIVE_BUS_COLOR],
                        'circle-stroke-color': '#ffffff',
                        'circle-stroke-width': 3
                    }
                });

                resolve();
            });
        });
    }

    async show(bus, key) {
        const requestId = ++this.requestId;

        this.key = key;
        this.bus = bus;
        this.route = this.page.routeFor(bus);
        this.render();

        this.el.classList.add('open');
        this.el.setAttribute('aria-hidden', 'false');

        // Start the route download right away, in parallel with the map
        const shapeRequest = this.route ? this.page.loadRouteShape(this.route.apiId) : Promise.resolve(null);

        this.setStatus('Loading route…');
        if (this.miniMap.loaded()) {
            this.showBusOnly();
        }

        const [shape] = await Promise.all([shapeRequest, this.miniMapReady]);
        if (requestId !== this.requestId) return;

        this.showRouteShape(shape);
    }

    // Called on every buses refresh; bus is null when it stopped reporting
    update(bus) {
        if (!this.isOpen || !this.bus) return;

        this.bus = bus || { ...this.bus, missing: true };
        this.render();
    }

    close() {
        this.requestId++;
        this.el.classList.remove('open');
        this.el.setAttribute('aria-hidden', 'true');
        this.page.clearSelection();
    }

    render() {
        const { bus, route } = this;

        this.badge.textContent = route ? route.shortName : '?';
        this.name.textContent = route ? route.longName : `Route ${bus.RouteId || 'unknown'}`;
        this.button.disabled = !route;

        if (bus.missing) {
            this.meta.textContent = 'This bus is no longer reporting';
        } else if (bus.emulated) {
            this.meta.textContent = 'Estimated from timetable, no live GPS';
        } else {
            this.meta.textContent = `Bus ${bus.Label} · ${Math.round(bus.SpeedKmPerHour * 3.6)} km/h`;
        }
    }

    setStatus(text) {
        this.status.hidden = !text;
        this.status.textContent = text || '';
    }

    // Moves the mini map dot; called every animation frame with the displayed position
    setBusPosition(position) {
        const source = this.miniMap.getSource('bus');
        if (!source || !position) return;

        source.setData({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [position.lng, position.lat] },
            properties: { emulated: this.bus.emulated }
        });
    }

    // Until the route arrives: previous route cleared, map centered on the bus
    showBusOnly() {
        const position = this.page.displayedPosition(this.key);
        this.miniMap.getSource('route').setData(EMPTY_COLLECTION);
        this.setBusPosition(position);
        if (position) {
            this.miniMap.jumpTo({ center: [position.lng, position.lat], zoom: 13 });
        }
    }

    showRouteShape(points) {
        this.miniMap.resize();
        this.setBusPosition(this.page.displayedPosition(this.key));

        if (!points || points.length < 2) {
            this.showBusOnly();
            this.setStatus(this.route ? 'Route shape is not available' : 'This route is not in the routes list');
            return;
        }

        const coordinates = points.map(point => [point.lng, point.lat]);
        this.miniMap.getSource('route').setData({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates },
            properties: {}
        });

        const bounds = coordinates.reduce(
            (b, coord) => b.extend(coord),
            new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
        );
        this.miniMap.fitBounds(bounds, { padding: 24, animate: false });
        this.setStatus(null);
    }

    initSwipe(grip) {
        let startY = null;
        let deltaY = 0;

        grip.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;
            startY = e.clientY;
            deltaY = 0;
            this.el.classList.add('dragging');
            grip.setPointerCapture(e.pointerId);
        });

        grip.addEventListener('pointermove', (e) => {
            if (startY === null) return;
            deltaY = Math.max(0, e.clientY - startY);
            this.el.style.transform = `translateY(${deltaY}px)`;
        });

        const endDrag = () => {
            if (startY === null) return;
            startY = null;
            this.el.classList.remove('dragging');
            this.el.style.transform = '';
            if (deltaY > 80) {
                this.close();
            }
        };

        grip.addEventListener('pointerup', endDrag);
        grip.addEventListener('pointercancel', endDrag);
    }
}

class AllBusesPage {
    constructor() {
        this.counter = document.getElementById('busCounter');
        this.verifyChip = document.getElementById('verifyChip');
        this.verifyText = document.getElementById('verifyText');

        // API RouteId -> {apiId, rawId, shortName, longName}
        this.routesById = new Map();
        this.routesReady = this.loadRoutes();
        // API RouteId -> Promise of route points (null when missing)
        this.shapeCache = new Map();

        // "live:<label>" / "emulated:<tripId>" -> bus from the last response
        this.buses = new Map();
        // key -> {lng, lat, bearing} currently drawn, moves towards the buses during animation
        this.displayed = new Map();
        this.animationFrame = null;
        this.selectedKey = null;

        this.updateTimer = null;
        this.isUpdating = false;
        this.isVerifying = false;

        this.initMap();
        this.sheet = new BusSheet(this);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.update();
        });
        this.update();
    }

    initMap() {
        this.map = new maplibregl.Map({
            container: 'map',
            style: getMapStyle(),
            center: [33.2, 35.0],
            zoom: 8,
            maxZoom: 19,
            maxBounds: CYPRUS_BOUNDS,
            attributionControl: false
        });

        this.mapReady = new Promise(resolve => {
            this.map.on('load', async () => {
                await this.addBusLayers();
                resolve();
            });
        });

        this.map.on('click', (e) => this.handleMapClick(e));
        this.map.on('mouseenter', 'buses', () => {
            this.map.getCanvas().style.cursor = 'pointer';
        });
        this.map.on('mouseleave', 'buses', () => {
            this.map.getCanvas().style.cursor = '';
        });
    }

    async addBusLayers() {
        const isDark = getTheme() === 'dark';

        try {
            const [live, estimated, heading] = await Promise.all([
                rasterizeSvg(busIconSvg(LIVE_BUS_COLOR), 32),
                rasterizeSvg(busIconSvg(ESTIMATED_BUS_COLOR), 32),
                rasterizeSvg(busHeadingSvg(LIVE_BUS_COLOR), 48)
            ]);
            this.map.addImage('bus-live', live, { pixelRatio: 2 });
            this.map.addImage('bus-estimated', estimated, { pixelRatio: 2 });
            this.map.addImage('bus-heading', heading, { pixelRatio: 2 });
        } catch (error) {
            console.error('Failed to load bus icons:', error);
        }

        this.map.addSource('buses', { type: 'geojson', data: EMPTY_COLLECTION });

        // Heading notch under the disc; estimated buses have no real heading
        this.map.addLayer({
            id: 'bus-heading',
            type: 'symbol',
            source: 'buses',
            filter: ['!', ['get', 'emulated']],
            layout: {
                'icon-image': 'bus-heading',
                'icon-size': this.busIconSize(),
                'icon-rotate': ['get', 'bearing'],
                'icon-rotation-alignment': 'map',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        });

        this.map.addLayer({
            id: 'buses',
            type: 'symbol',
            source: 'buses',
            layout: {
                'icon-image': ['case', ['get', 'emulated'], 'bus-estimated', 'bus-live'],
                'icon-size': this.busIconSize(),
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                // Live buses and the selected one are drawn on top
                'symbol-sort-key': ['case', ['get', 'selected'], 2, ['get', 'emulated'], 0, 1],
                'text-field': ['get', 'route'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 12,
                'text-anchor': 'top',
                'text-offset': [0, 1.3],
                'text-optional': true
            },
            paint: {
                'text-color': isDark ? '#ffffff' : '#111111',
                'text-halo-color': isDark ? '#000000' : '#ffffff',
                'text-halo-width': 1.5,
                'text-opacity': ['step', ['zoom'], 0, 12, 1]
            }
        });
    }

    busIconSize() {
        const isSelected = ['get', 'selected'];
        return ['interpolate', ['linear'], ['zoom'],
            8, ['case', isSelected, 0.9, 0.6],
            12, ['case', isSelected, 1.15, 0.85],
            15, ['case', isSelected, 1.35, 1]
        ];
    }

    handleMapClick(e) {
        if (!this.map.getLayer('buses')) return;

        // Generous hit area: bus icons are small at low zoom
        const { x, y } = e.point;
        const features = this.map.queryRenderedFeatures([[x - 16, y - 16], [x + 16, y + 16]], { layers: ['buses'] });

        if (features.length === 0) {
            if (this.sheet.isOpen) this.sheet.close();
            return;
        }

        const nearest = features.reduce((best, feature) => {
            const p = this.map.project(feature.geometry.coordinates);
            const distance = (p.x - x) ** 2 + (p.y - y) ** 2;
            return !best || distance < best.distance ? { feature, distance } : best;
        }, null);

        this.selectBus(nearest.feature.properties.key);
    }

    selectBus(key) {
        const bus = this.buses.get(key);
        if (!bus) return;

        this.selectedKey = key;
        this.renderBuses();
        this.sheet.show(bus, key);
    }

    clearSelection() {
        this.selectedKey = null;
        this.renderBuses();
    }

    displayedPosition(key) {
        return this.displayed.get(key) || null;
    }

    async loadRoutes() {
        try {
            const response = await fetch(`${ROUTES_BASE_URL}routes_list.json`);
            const routes = await response.json();

            routes.forEach(route => {
                const [name, ids] = route.split('###');
                const [shortName, ...rest] = name.split(': ');
                const longName = rest.length ? rest.join(': ').replace(' - ', ' → ') : name;

                ids.split(',').forEach(rawId => {
                    // The API reports Nicosia route ids without the leading "9"
                    const apiId = rawId.charAt(0) === '9' ? rawId.substring(1) : rawId;
                    if (!this.routesById.has(apiId)) {
                        this.routesById.set(apiId, { apiId, rawId, shortName, longName });
                    }
                });
            });
        } catch (error) {
            console.error('Error loading routes:', error);
        }
    }

    routeFor(bus) {
        return this.routesById.get(bus.RouteId) || null;
    }

    loadRouteShape(apiId) {
        if (!this.shapeCache.has(apiId)) {
            const request = fetch(`${ROUTES_BASE_URL}routes/${apiId}.json`)
                .then(response => response.ok ? response.json() : null)
                .catch(error => {
                    // Don't cache network failures
                    this.shapeCache.delete(apiId);
                    console.error('Error loading route shape:', error);
                    return null;
                });

            this.shapeCache.set(apiId, request);
        }

        return this.shapeCache.get(apiId);
    }

    async update() {
        if (this.isUpdating) return;
        clearTimeout(this.updateTimer);

        // Polling stops in background tabs and resumes on visibilitychange
        if (document.hidden) return;

        this.isUpdating = true;
        try {
            const data = await this.fetchBuses();
            if (data) {
                await this.applyBuses(data);
            }
        } catch (error) {
            console.error('Error loading buses:', error);
            this.counter.textContent = 'Connection problem, retrying…';
        } finally {
            this.isUpdating = false;
        }

        this.updateTimer = setTimeout(() => this.update(), BUSES_UPDATE_INTERVAL);
    }

    async fetchBuses() {
        if (this.isVerifying) return null;

        const response = await fetch('/api/buses', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        });

        if (response.status === 403) {
            this.verifyHuman();
            return null;
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
    }

    async applyBuses(data) {
        await this.routesReady;

        const realtime = Object.values(data.Realtime.Buses);
        // Like the main map: estimated buses only for routes without live ones
        const liveRoutes = new Set(realtime.map(bus => bus.RouteId));
        const emulated = Object.values(data.Emulated.Buses).filter(bus => !liveRoutes.has(bus.RouteId));

        this.buses = new Map();
        realtime.forEach(bus => this.buses.set(`live:${bus.Label || bus.TripId}`, { ...bus, emulated: false }));
        emulated.forEach(bus => this.buses.set(`emulated:${bus.TripId}`, { ...bus, emulated: true }));

        this.counter.textContent = emulated.length
            ? `${realtime.length} live · ${emulated.length} estimated`
            : `${realtime.length} live buses`;

        await this.mapReady;
        this.animateBuses();

        if (this.selectedKey) {
            this.sheet.update(this.buses.get(this.selectedKey) || null);
        }
    }

    // Interpolates every bus from where it is drawn now to its new position
    animateBuses() {
        cancelAnimationFrame(this.animationFrame);

        const tracks = new Map();
        this.buses.forEach((bus, key) => {
            const to = { lng: bus.Longitude, lat: bus.Latitude, bearing: bus.emulated ? 0 : bus.Bearing };
            const from = this.displayed.get(key);
            const isJump = !from ||
                Math.abs(from.lng - to.lng) > MAX_ANIMATED_JUMP ||
                Math.abs(from.lat - to.lat) > MAX_ANIMATED_JUMP;
            tracks.set(key, { from: isJump ? to : from, to });
        });

        const start = performance.now();
        const frame = (now) => {
            const t = easeInOut(Math.min((now - start) / BUS_ANIMATION_DURATION, 1));

            this.displayed = new Map();
            tracks.forEach(({ from, to }, key) => {
                this.displayed.set(key, {
                    lng: from.lng + (to.lng - from.lng) * t,
                    lat: from.lat + (to.lat - from.lat) * t,
                    bearing: lerpBearing(from.bearing, to.bearing, t)
                });
            });

            this.renderBuses();

            if (t < 1) {
                this.animationFrame = requestAnimationFrame(frame);
            }
        };

        this.animationFrame = requestAnimationFrame(frame);
    }

    renderBuses() {
        const source = this.map.getSource('buses');
        if (!source) return;

        const features = [];
        this.displayed.forEach((position, key) => {
            const bus = this.buses.get(key);
            if (!bus) return;

            const route = this.routeFor(bus);
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [position.lng, position.lat] },
                properties: {
                    key,
                    route: route ? route.shortName : '',
                    emulated: bus.emulated,
                    selected: key === this.selectedKey,
                    bearing: position.bearing
                }
            });
        });

        source.setData({ type: 'FeatureCollection', features });

        if (this.selectedKey && this.sheet.isOpen) {
            this.sheet.setBusPosition(this.displayed.get(this.selectedKey));
        }
    }

    verifyHuman() {
        if (this.isVerifying) return;
        this.isVerifying = true;

        this.counter.textContent = 'Verifying…';
        this.verifyText.textContent = "Checking you're not a robot…";
        this.verifyChip.hidden = false;

        const container = document.getElementById('turnstile-container');
        container.innerHTML = '';

        try {
            turnstile.render(container, {
                sitekey: TURNSTILE_SITE_KEY,
                callback: (token) => this.exchangeTurnstileToken(token),
                'error-callback': () => this.showVerificationFailed()
            });
        } catch (error) {
            console.error('Turnstile:', error);
            this.showVerificationFailed();
        }
    }

    async exchangeTurnstileToken(turnstileToken) {
        try {
            const response = await fetch('/api/verify-human', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ turnstileToken })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            localStorage.setItem('accessToken', data.access_token);

            this.verifyChip.hidden = true;
            this.isVerifying = false;
            this.update();
        } catch (error) {
            console.error('Verification failed:', error);
            this.showVerificationFailed();
        }
    }

    // Stays in the verifying state: retrying every poll would just loop the widget
    showVerificationFailed() {
        this.counter.textContent = 'Access denied';
        this.verifyText.textContent = 'Verification failed. Disable ad-blockers and reload the page.';
        this.verifyChip.hidden = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const protocol = new pmtiles.Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocol.tile);

    new AllBusesPage();
});
