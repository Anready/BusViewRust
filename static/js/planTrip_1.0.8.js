let busStops = new Map();
let map;
let geocoder;
let markers;
let activeField = null;
let selectedPoint = null;
let nearestStopId = null;
let mapInitialized = false;
let routeMap;
let userLocation = null;
let userLocationMarker = null; // For stop selection map
let routeUserLocationMarker = null; // For route map
let walkingPathToStop = null; // For storing walking path to nearest stop

// DOM elements
const mapContainer = document.getElementById('map-container');
const startInput = document.getElementById('start');
const endInput = document.getElementById('end');
const startIdInput = document.getElementById('startId');
const endIdInput = document.getElementById('endId');
const confirmBtn = document.getElementById('confirmLocationBtn');
const closeMapBtn = document.getElementById('closeMapBtn');
const startLocationInfo = document.getElementById('startLocationInfo');
const endLocationInfo = document.getElementById('endLocationInfo');

// Function to get user's geolocation
function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    userLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    resolve(userLocation);
                },
                (error) => {
                    console.warn('Geolocation error:', error.message);
                    resolve(null);
                }
            );
        } else {
            console.warn('Geolocation is not supported by this browser');
            resolve(null);
        }
    });
}

function addUserLocationMarker() {
    if (userLocation && !userLocationMarker) {
        userLocationMarker = L.marker([userLocation.lat, userLocation.lng], {
            icon: L.divIcon({
                className: 'user-location',
                html: '<div class="user-location-dot" style="background-color: #4285F4; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            })
        })
            .addTo(map)
            .bindPopup("Your Location");
    }
}

// Show map for selection with user location
async function showMap(fieldId) {
    // If map is not initialized yet, initialize it synchronously
    if (!mapInitialized) {
        initializeMapWithoutGeolocation();
    }

    activeField = fieldId;
    selectedPoint = null;
    nearestStopId = null;
    confirmBtn.style.display = 'none';
    mapContainer.style.display = 'block';

    // Reset search box
    setTimeout(() => {
        if (document.getElementById('street-search')) {
            document.getElementById('street-search').value = '';
        }
    }, 100);

    // Remove any previous walking paths
    if (walkingPathToStop) {
        map.removeLayer(walkingPathToStop);
        walkingPathToStop = null;
    }

    setTimeout(() => map.invalidateSize(), 300);

    // Center map: if user location exists, use it, otherwise use default coordinates
    if (userLocation) {
        map.setView([userLocation.lat, userLocation.lng], 13);
    } else {
        map.setView([34.6786, 33.0413], 13); // Default coordinates (Cyprus)
    }

    // Asynchronously get user location if not available yet
    if (!userLocation) {
        getUserLocation().then(() => {
            if (userLocation && !userLocationMarker) {
                addUserLocationMarker();
                // If this is first run and active field is still open, center map on user
                if (mapContainer.style.display === 'block') {
                    map.setView([userLocation.lat, userLocation.lng], 13);
                }
            }
        });
    }
}

function initializeMapWithoutGeolocation() {
    if (mapInitialized) return;

    if (map) map.remove();

    map = L.map('map', { preferCanvas: true }).setView([34.6786, 33.0413], 13);

    if (getTheme() === 'light') {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    } else {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(map);
    }

    const CenteredSearchControl = L.Control.extend({
        options: {
            position: 'topleft'
        },
        onAdd: function() {
            const container = L.DomUtil.create('div', 'search-control centered-search');
            container.innerHTML = `
                <div class="search-container">
                    <input type="text" id="street-search" placeholder="Search street or area">
                    <button id="search-btn">Search</button>
                </div>
            `;

            L.DomEvent.disableClickPropagation(container);
            return container;
        }
    });

    map.addControl(new CenteredSearchControl());

    setTimeout(() => {
        document.getElementById('search-btn').addEventListener('click', searchStreet);

        document.getElementById('street-search').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchStreet();
            }
        });
    }, 100);

    markers = L.markerClusterGroup({ maxClusterRadius: 50, chunkedLoading: true });

    // Create a temporary marker for user selection
    let tempMarker = null;

    // Add click event to map to allow users to select arbitrary points
    map.on('click', function(e) {
        // Remove previous temporary marker if exists
        if (tempMarker) {
            map.removeLayer(tempMarker);
        }

        // Remove previous walking path if exists
        if (walkingPathToStop) {
            map.removeLayer(walkingPathToStop);
            walkingPathToStop = null;
        }

        // Create new marker at clicked position
        tempMarker = L.marker(e.latlng, {
            icon: L.divIcon({
                className: 'selected-point',
                html: '<div style="background-color: #ff6b6b; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            })
        }).addTo(map);

        // Store selected point
        selectedPoint = {
            lat: e.latlng.lat,
            lng: e.latlng.lng
        };

        // Find nearest bus stop to the selected point
        const nearestStop = findNearestBusStop(selectedPoint.lat, selectedPoint.lng);
        if (nearestStop) {
            // Set nearest stop ID
            nearestStopId = nearestStop.id;

            // Show confirm button
            confirmBtn.style.display = 'block';

            // Open popup showing information about nearest stop
            tempMarker.bindPopup(`
                <div>
                    <p><strong>Selected Point</strong></p>
                </div>
            `).openPopup();
        }
    });

    loadBusStops()

    mapInitialized = true;
}

// Function to find the nearest bus stop to a given point
function findNearestBusStop(lat, lng) {
    if (busStops.size === 0) return null;

    let nearestStop = null;
    let minDistance = Infinity;

    busStops.forEach((stop, id) => {
        const distance = calculateDistance(lat, lng, stop.latitude, stop.longitude);
        if (distance < minDistance) {
            minDistance = distance;
            nearestStop = {
                id: id,
                latitude: stop.latitude,
                longitude: stop.longitude,
                description: stop.description,
                distance: distance
            };
        }
    });

    return nearestStop;
}

// Calculate distance between two coordinates in kilometers using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in km
    return distance;
}

function deg2rad(deg) {
    return deg * (Math.PI/180);
}

// Close map view
closeMapBtn.addEventListener('click', function() {
    mapContainer.style.display = 'none';
    activeField = null;
    clearSearchResults();

    // Remove walking path
    if (walkingPathToStop) {
        map.removeLayer(walkingPathToStop);
        walkingPathToStop = null;
    }
});

// Handle input field clicks to show map
startInput.addEventListener('click', function() {
    showMap('start');
});

endInput.addEventListener('click', function() {
    showMap('end');
});

// Confirm selected location
confirmBtn.addEventListener('click', function() {
    if (!nearestStopId || !selectedPoint) return;

    const selectedStop = busStops.get(nearestStopId);
    if (!selectedStop) return;

    if (activeField === 'start') {
        startIdInput.value = nearestStopId;
        startInput.value = selectedStop.description || `Stop #${nearestStopId}`;
        startLocationInfo.textContent = `Selected Point → Bus Stop: ${selectedStop.description || `#${nearestStopId}`}`;

        // Store selected point for later use in route display
        startInput.dataset.selectedLat = selectedPoint.lat;
        startInput.dataset.selectedLng = selectedPoint.lng;
    } else if (activeField === 'end') {
        endIdInput.value = nearestStopId;
        endInput.value = selectedStop.description || `Stop #${nearestStopId}`;
        endLocationInfo.textContent = `Selected Point → Bus Stop: ${selectedStop.description || `#${nearestStopId}`}`;

        // Store selected point for later use in route display
        endInput.dataset.selectedLat = selectedPoint.lat;
        endInput.dataset.selectedLng = selectedPoint.lng;
    }

    // Сохранить состояние
    saveFieldState();

    mapContainer.style.display = 'none';
    activeField = null;

    // Remove walking path
    if (walkingPathToStop) {
        map.removeLayer(walkingPathToStop);
        walkingPathToStop = null;
    }
});

// Load bus stops from server
async function loadBusStops() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/Anready/BusRoutes/refs/heads/main/buses/GetAllStops.json'); // Adjust the path as needed
        if (!response.ok) throw new Error('Failed to load bus stops');
        const stopsData = await response.json();
        stopsData.forEach(stop => {
            busStops.set(stop.id.toString(), {
                latitude: parseFloat(stop.latitude),
                longitude: parseFloat(stop.longitude),
                description: stop.title
            });
        });
        return busStops;
    } catch (error) {
        return busStops;
    }
}

function createMarkers() {
    busStops.forEach((stop, id) => {
        const marker = L.marker([stop.latitude, stop.longitude], {
            opacity: 0.7,  // Make bus stop markers slightly transparent
            icon: L.divIcon({
                className: 'bus-stop-marker',
                html: '<div style="background-color: #0078d4; width: 8px; height: 8px; border-radius: 50%; border: 2px solid white;"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            })
        });

        marker.bindPopup(`<div><strong>${stop.description}</strong><br>ID: ${id}</div>`);
        markers.addLayer(marker);
    });

    map.addLayer(markers);
}

async function findRoute() {
    const startId = startIdInput.value;
    const endId = endIdInput.value;
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = '';

    if (!startId || !endId) {
        resultDiv.innerHTML = '<div class="error">Please select both start and end points</div>';
        return;
    }

    resultDiv.innerHTML = '<div>Finding routes...</div>';
    loadTransitData(startId, endId);
}

const routeColors = [
    '#0078d4',
    '#ff5733',
    '#ff33ff',
    '#ffcc00',
    '#28a745'
];

async function showRouteMap(solutionPath) {
    const routeMapContainer = document.getElementById('route-map-container');

    if (!routeMap) {
        routeMap = L.map('route-map').setView([34.674, 33.037], 13);
        if (getTheme() === 'light') {
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(routeMap);
        } else {
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19
            }).addTo(routeMap);
        }
    }

    // Show the container immediately and display a loading indicator
    routeMapContainer.style.display = 'block';

    // Create or update loading indicator
    let loadingElement = document.getElementById('route-loading');
    if (!loadingElement) {
        loadingElement = document.createElement('div');
        loadingElement.id = 'route-loading';
        loadingElement.className = 'route-loading';
        loadingElement.innerHTML = '<div class="spinner"></div><p>Loading route...</p>';
        routeMapContainer.appendChild(loadingElement);
    } else {
        loadingElement.style.display = 'block';
    }

    // Trigger map resize immediately to ensure proper rendering
    setTimeout(() => routeMap.invalidateSize(), 10);

    // Clear previous layers while keeping the base tile layer
    routeMap.eachLayer(layer => {
        if (layer instanceof L.TileLayer) return;
        routeMap.removeLayer(layer);
    });

    // Prepare data structures for route display
    const allBounds = [];
    const allColors = ['#0078d4', '#ff5733', '#ff33ff', '#ffcc00'];
    let colorIndex = 0;

    // Get user location in background if needed
    if (!userLocation) {
        getUserLocation().catch(err => console.warn('Could not get user location:', err));
    }

    // Add user location marker if available
    if (userLocation) {
        L.marker([userLocation.lat, userLocation.lng], {
            icon: L.divIcon({
                className: 'user-location',
                html: '<div class="user-location-dot" style="background-color: #4285F4; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            })
        })
            .addTo(routeMap)
            .bindPopup('Your Location');
        allBounds.push([userLocation.lat, userLocation.lng]);
    }

    // Process all route segments in parallel using Promise.all
    try {
        // Prepare initial walking paths promises (from start point to first bus stop)
        const initialWalkPromises = prepareInitialWalkingPromises();

        // Prepare bus route segment promises
        const busSegmentPromises = solutionPath.connectionChanges.map(async (change) => {
            if (change.isWalking) {
                return {
                    type: 'walking',
                    coords: await getWalkingRouteOptimized(
                        change.originLatitude, change.originLongitude,
                        change.destinationLatitude, change.destinationLongitude
                    ),
                    color: routeColors[4]
                };
            } else if (change.mapPoints && change.mapPoints.length > 0) {
                const currentColor = allColors[colorIndex++ % allColors.length] || '#666';
                return {
                    type: 'bus',
                    coords: change.mapPoints.map(point => [point.longitude, point.latitude]),
                    color: currentColor
                };
            }
            return null;
        }).filter(p => p !== null);

        const [busSegmentResults] = await Promise.all([
            Promise.all(busSegmentPromises)
        ]);

        busSegmentResults.forEach(segment => {
            if (!segment || !segment.coords || segment.coords.length === 0) return;

            const options = {
                color: segment.color,
                weight: 4
            };

            if (segment.type === 'walking') {
                options.dashArray = '5, 10';
            }

            L.polyline(segment.coords, options).addTo(routeMap);
            allBounds.push(...segment.coords);
        });


        const [initialWalkResults] = await Promise.all([
            Promise.all(initialWalkPromises)
        ]);

        // Draw initial walking paths
        initialWalkResults.forEach(result => {
            if (!result) return;

            // Draw marker
            if (result.marker) {
                L.marker([result.marker.lat, result.marker.lng], {
                    icon: L.divIcon({
                        className: result.marker.className,
                        html: `<div style="background-color: ${result.marker.color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    })
                }).addTo(routeMap).bindPopup(result.marker.popup);
            }

            // Draw path
            if (result.coords && result.coords.length > 0) {
                L.polyline(result.coords, {
                    color: result.color,
                    weight: 4,
                    dashArray: '5, 10',
                    opacity: 0.8
                }).addTo(routeMap);

                allBounds.push(...result.coords);
            }
        });

        // Fit bounds to show all route elements
        if (allBounds.length > 0) {
            const bounds = L.latLngBounds(allBounds);
            routeMap.fitBounds(bounds, { padding: [20, 20] });
        }
    } catch (error) {
        console.error('Error loading route:', error);
        // Show error message on map
        const errorMsg = document.createElement('div');
        errorMsg.className = 'route-error';
        errorMsg.textContent = 'Error loading route. Please try again.';
        routeMapContainer.appendChild(errorMsg);
    } finally {
        // Hide loading indicator
        if (loadingElement) {
            loadingElement.style.display = 'none';
        }
    }
}

function prepareInitialWalkingPromises() {
    const promises = [];

    // Add walking path from start selected point to start bus stop
    if (startInput.dataset.selectedLat && startInput.dataset.selectedLng) {
        const startStop = busStops.get(startIdInput.value);
        if (startStop) {
            const startLat = parseFloat(startInput.dataset.selectedLat);
            const startLng = parseFloat(startInput.dataset.selectedLng);

            promises.push(getWalkingRouteOptimized(
                startLat, startLng,
                startStop.latitude, startStop.longitude
            ).then(coords => ({
                coords,
                color: '#ff6b6b',
                marker: {
                    lat: startLat,
                    lng: startLng,
                    className: 'selected-point-start',
                    color: '#ff6b6b',
                    popup: 'Starting Point'
                }
            })));
        }
    }

    // Add walking path from end bus stop to end selected point
    if (endInput.dataset.selectedLat && endInput.dataset.selectedLng) {
        const endStop = busStops.get(endIdInput.value);
        if (endStop) {
            const endLat = parseFloat(endInput.dataset.selectedLat);
            const endLng = parseFloat(endInput.dataset.selectedLng);

            promises.push(getWalkingRouteOptimized(
                endStop.latitude, endStop.longitude,
                endLat, endLng
            ).then(coords => ({
                coords,
                color: '#28a745',
                marker: {
                    lat: endLat,
                    lng: endLng,
                    className: 'selected-point-end',
                    color: '#28a745',
                    popup: 'Destination Point'
                }
            })));
        }
    }

    return promises;
}

document.getElementById('closeRouteMapBtn').addEventListener('click', () => {
    document.getElementById('route-map-container').style.display = 'none';
});

async function getWalkingRouteOptimized(startLat, startLng, endLat, endLng) {
    // Create a cache key based on coordinates
    const cacheKey = `walk_${startLat.toFixed(5)}_${startLng.toFixed(5)}_${endLat.toFixed(5)}_${endLng.toFixed(5)}`;

    // Check if we have this route cached
    const cachedRoute = sessionStorage.getItem(cacheKey);
    if (cachedRoute) {
        try {
            return JSON.parse(cachedRoute);
        } catch (e) {
            console.warn('Error parsing cached route:', e);
            // Continue to fetch if parsing failed
        }
    }

    // Create a promise with timeout
    try {
        const controller = new AbortController();
        const url = `https://router.project-osrm.org/route/v1/foot/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;

        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) throw new Error(`OSRM error: ${response.status}`);

        const data = await response.json();
        const coordinates = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);

        // Cache the result
        sessionStorage.setItem(cacheKey, JSON.stringify(coordinates));

        return coordinates;
    } catch (error) {
        console.warn('Walking route fetch failed, using direct line:', error);
        // Return direct line as fallback
        const directPath = [[startLat, startLng], [endLat, endLng]];
        return directPath;
    }
}

const loadingStyles = document.createElement('style');
loadingStyles.textContent = `
    .route-loading {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 255, 255, 0.8);
        padding: 20px;
        border-radius: 8px;
        text-align: center;
        z-index: 1005;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }
    
    .spinner {
        width: 40px;
        height: 40px;
        margin: 0 auto 10px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #0078d4;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    
    .route-error {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255, 51, 51, 0.8);
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        z-index: 1000;
    }
`;
document.head.appendChild(loadingStyles);

async function getWalkingRoute(startLat, startLng, endLat, endLng) {
    const url = `https://router.project-osrm.org/route/v1/foot/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`OSRM error: ${response.status}`);
        const data = await response.json();
        return data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]); // [lat, lng]
    } catch (error) {
        console.error('Failed to fetch walking route:', error);
        return [[startLat, startLng], [endLat, endLng]]; // Fallback to straight line
    }
}

async function loadTransitData(start, end) {
    const date = document.getElementById('tripDate').value;
    const time = document.getElementById('tripTime').value;

    if (!(date && time)) {
        document.getElementById('result').innerHTML =
            `<div class="error">Error: select date and time.</div>`;
        return;
    }

    const requestData = {
        origin: start,
        destinations: [end],
        journeyDateTime: `${date}T${time}:00`,
        languageId: 1
    };

    const token = localStorage.getItem('accessToken');

    try {
        const response = await fetch("/api/planJourney", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) throw new Error(`Failed to fetch JSON: ${response.status}`);

        const jsonData = await response.json();
        if (jsonData.errorCode !== 0 || !jsonData.data || !jsonData.data.solutionPaths) {
            throw new Error('Invalid transit data format');
        }

        document.getElementById('result').innerHTML = '';
        await displayTrips(jsonData.data.solutionPaths);
    } catch (error) {
        document.getElementById('result').innerHTML =
            `<div class="error">Error: ${error.message}. Please refresh page try again.</div>`;
    }
}

// Display trip results
async function displayTrips(solutionPaths) {
    const container = document.getElementById('tripContainer');
    container.innerHTML = '';

    for (const [index, option] of solutionPaths.entries()) {
        const departureTime = new Date(option.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const arrivalTime = new Date(option.arivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const duration = Math.round(option.durationInMinutes);
        const ticketCost = option.ticketCost ? `€${option.ticketCost}` : 'N/A';

        let y = 0;
        const section = document.createElement('section');
        section.className = 'trip-option';
        section.innerHTML = `
            <h2>Option ${index + 1}</h2>
            <div class="trip-details">
                <p><strong>${duration} min</strong> | ${departureTime} - ${arrivalTime} | Cost: ${ticketCost}</p>
                <ul>
                    <li class="walk special">
                        <span>Walk to bus stop</span>
                        <p>From your selected starting point to the nearest bus stop</p>
                    </li>
                    ${option.connectionChanges.map(change => `
                        <li class="${change.isWalking ? 'walk' : `bus route-${y += 1 || 'unknown'}`}">
                            <span>${change.isWalking ? 'Walk' : `Bus Route ${change.routeName || 'Unknown'}`} (${Math.round(change.durationInMinutes)} min)</span>
                            <p>${new Date(change.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(change.arivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            <p>${change.originName} to ${change.destinationName}</p>
                        </li>
                    `).join('')}
                    <li class="walk special">
                        <span>Walk to destination</span>
                        <p>From the final bus stop to your selected destination</p>
                    </li>
                </ul>
                <button class="show-route-btn" onclick='showRouteMap(${JSON.stringify(option)})'>Show Route</button>
                <button class="save-trip-btn" onclick='saveTrip(${JSON.stringify(option)})'>Save Trip</button>
            </div>
        `;
        container.appendChild(section);
    }
}

// Add this new function to save trips to localStorage
function saveTrip(tripData) {
    // Get existing saved trips or initialize empty array
    let savedTrips = JSON.parse(localStorage.getItem('savedTrips') || '[]');

    // Add new trip with a timestamp
    const tripWithTimestamp = {
        ...tripData,
        savedAt: new Date().toISOString(),
        // Add custom start and end points if they exist
        startPoint: startInput.dataset.selectedLat && startInput.dataset.selectedLng ? {
            lat: parseFloat(startInput.dataset.selectedLat),
            lng: parseFloat(startInput.dataset.selectedLng)
        } : null,
        endPoint: endInput.dataset.selectedLat && endInput.dataset.selectedLng ? {
            lat: parseFloat(endInput.dataset.selectedLat),
            lng: parseFloat(endInput.dataset.selectedLng)
        } : null
    };

    // Add to array and save back to localStorage
    savedTrips.push(tripWithTimestamp);
    localStorage.setItem('savedTrips', JSON.stringify(savedTrips));

    alert('Trip saved successfully!');
}

async function searchStreet() {
    const searchInput = document.getElementById('street-search');
    const query = searchInput.value.trim();

    if (!query) return;

    try {
        // Show loading indicator
        searchInput.classList.add('loading');

        // Use Nominatim API for geocoding with increased limit (10 results instead of 1)
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=cy&limit=10`);

        if (!response.ok) throw new Error('Geocoding request failed');

        const data = await response.json();

        // Clear any existing search result markers
        if (window.searchResultMarkers) {
            window.searchResultMarkers.forEach(marker => map.removeLayer(marker));
        }
        window.searchResultMarkers = [];

        if (data && data.length > 0) {
            const bounds = L.latLngBounds();

            // Add all results to the map
            data.forEach(result => {
                const lat = parseFloat(result.lat);
                const lng = parseFloat(result.lon);

                // Add point to bounds for auto-zooming
                bounds.extend([lat, lng]);

                // Create a marker for each location
                const searchMarker = L.marker([lat, lng], {
                    icon: L.divIcon({
                        className: 'search-result-marker',
                        html: '<div class="search-green-pin"></div>',
                        iconSize: [30, 30],
                        iconAnchor: [15, 30]
                    })
                });

                // Add a popup with location information
                searchMarker.bindPopup(`
                    <div class="search-result-popup">
                        <strong>${result.display_name.split(',')[0]}</strong>
                        <p>${result.display_name}</p>
                    </div>
                `);

                searchMarker.addTo(map);
                window.searchResultMarkers.push(searchMarker);
            });

            // If we have multiple markers, fit the map to show all of them
            if (data.length > 1) {
                map.fitBounds(bounds, {
                    padding: [50, 50], // Add some padding around the bounds
                    maxZoom: 16        // Don't zoom in too far
                });
            } else {
                // If just one result, center on it with appropriate zoom
                map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 16);
            }

            // Update status message
            const statusMsg = document.createElement('div');
            statusMsg.className = 'search-status';
            statusMsg.textContent = `Found ${data.length} location${data.length > 1 ? 's' : ''}`;

            // Remove existing status message if any
            const existingStatus = document.querySelector('.search-status');
            if (existingStatus) {
                existingStatus.remove();
            }

            // Add status message to the map
            document.querySelector('.search-control').appendChild(statusMsg);

            // Auto-remove status after 3 seconds
            setTimeout(() => {
                if (statusMsg.parentNode) {
                    statusMsg.remove();
                }
            }, 3000);

        } else {
            alert('No locations found matching your search.');
        }
    } catch (error) {
        console.error('Error during geocoding:', error);
        alert('Failed to search for location. Please try again.');
    } finally {
        // Remove loading indicator
        searchInput.classList.remove('loading');
    }
}

// Add this function to clear search results when the map is closed
function clearSearchResults() {
    if (window.searchResultMarkers) {
        window.searchResultMarkers.forEach(marker => {
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        });
        window.searchResultMarkers = [];
    }

    const existingStatus = document.querySelector('.search-status');
    if (existingStatus) {
        existingStatus.remove();
    }
}

window.addEventListener('resize', function() {
    if (map) map.invalidateSize();

    // Also update route maps if they exist
    document.querySelectorAll('.map-container').forEach(container => {
        const mapId = container.id;
        if (mapId && L.maps && L.maps[mapId.replace('map-', '')]) {
            L.maps[mapId.replace('map-', '')].invalidateSize();
        }
    });
});

// Функции для сохранения и восстановления состояния
function saveFieldState() {
    const state = {
        startId: startIdInput.value,
        startText: startInput.value,
        startLat: startInput.dataset.selectedLat,
        startLng: startInput.dataset.selectedLng,
        startLocationInfo: startLocationInfo.textContent,
        endId: endIdInput.value,
        endText: endInput.value,
        endLat: endInput.dataset.selectedLat,
        endLng: endInput.dataset.selectedLng,
        endLocationInfo: endLocationInfo.textContent,
        tripDate: document.getElementById('tripDate').value,
        tripTime: document.getElementById('tripTime').value
    };
    localStorage.setItem('tripPlannerState', JSON.stringify(state));
}

function restoreFieldState() {
    const savedState = localStorage.getItem('tripPlannerState');
    if (savedState) {
        try {
            const state = JSON.parse(savedState);

            // Восстановление полей начала
            if (state.startId) {
                startIdInput.value = state.startId;
                startInput.value = state.startText || '';
                if (state.startLat) startInput.dataset.selectedLat = state.startLat;
                if (state.startLng) startInput.dataset.selectedLng = state.startLng;
                startLocationInfo.textContent = state.startLocationInfo || '';
            }

            // Восстановление полей окончания
            if (state.endId) {
                endIdInput.value = state.endId;
                endInput.value = state.endText || '';
                if (state.endLat) endInput.dataset.selectedLat = state.endLat;
                if (state.endLng) endInput.dataset.selectedLng = state.endLng;
                endLocationInfo.textContent = state.endLocationInfo || '';
            }

            // Восстановление даты и времени
            if (state.tripDate) {
                document.getElementById('tripDate').value = state.tripDate;
            }
            if (state.tripTime) {
                document.getElementById('tripTime').value = state.tripTime;
            }
        } catch (error) {
            console.warn('Ошибка при восстановлении состояния:', error);
        }
    }
}

// Добавить слушатели событий для автосохранения
document.getElementById('tripDate').addEventListener('change', saveFieldState);
document.getElementById('tripTime').addEventListener('change', saveFieldState);

async function validateToken(token) {
    try {
        const response = await fetch('/api/validate-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        return response.ok;
    } catch (error) {
        console.error(error);
        return false;
    }
}

async function verifyAndGetAccess(turnstileToken) {
    try {
        const response = await fetch('/api/verify-human', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                turnstileToken: turnstileToken
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
            localStorage.setItem('accessToken', data.jwt);
            return true;
        } else {
            console.error(data.message);
            showBlocked();
            return false;
        }
    } catch (error) {
        console.error(error);
        showBlocked();
        return false;
    }
}

function showBlocked() {
    document.getElementById('blocked-screen').style.display = 'flex';
    document.getElementById('container').style.display = 'none';
}

window.addEventListener('load', function () {
    const token = localStorage.getItem('accessToken');
    if (token) {
        if (validateToken(token) === true) {
            return;
        }
    }

    turnstile.render("#turnstile-hidden", {
        sitekey: "0x4AAAAAABnMxVgaDy9FGODL",
        callback: async function (token) {
            await verifyAndGetAccess(token);
        },
        'error-callback': function (error) {
            console.error('Turnstile:', error);
            showBlocked();
        }
    })
});

// Update page with instruction text
document.addEventListener('DOMContentLoaded', function() {
    const instructionsDiv = document.createElement('div');
    instructionsDiv.className = 'instructions';
    instructionsDiv.innerHTML = `
        <p><strong>How to use:</strong> Click anywhere on the map to select your starting point or destination.
        We'll automatically find the nearest bus stop and show you how to get there.</p>
    `;

    // Insert at the top of the form
    const form = document.querySelector('form');
    if (form) {
        form.insertBefore(instructionsDiv, form.firstChild);
    }

    // Update placeholders
    if (startInput) startInput.placeholder = 'Click to select starting point';
    if (endInput) endInput.placeholder = 'Click to select destination';

    // Восстановить сохраненное состояние
    restoreFieldState();
});