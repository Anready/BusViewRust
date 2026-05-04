let routeMap;
let userLocationMarker = null;
let userLocation = null;
let busStops = new Map();

// Reuse the same routeColors from your main script
const routeColors = ['#0078d4', '#ff5733', '#ff33ff', '#ffcc00', '#28a745'];

function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (navigator.geolocation) {
            const options = {
                enableHighAccuracy: true,
                timeout: 10000, // 10 seconds timeout
                maximumAge: 300000 // Accept location up to 5 minutes old
            };

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    userLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    console.log('Location obtained:', userLocation);
                    resolve(userLocation);
                },
                (error) => {
                    let errorMessage = 'Unknown geolocation error';
                    switch(error.code) {
                        case error.PERMISSION_DENIED:
                            errorMessage = 'Location access denied by user';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMessage = 'Location information unavailable';
                            break;
                        case error.TIMEOUT:
                            errorMessage = 'Location request timed out';
                            break;
                    }
                    console.warn('Geolocation error:', errorMessage, error);
                    resolve(null); // Don't reject, just resolve with null
                },
                options
            );
        } else {
            console.warn('Geolocation is not supported by this browser');
            resolve(null);
        }
    });
}

function addUserLocationMarker() {
    if (userLocation && routeMap) {
        // Remove existing user location marker if it exists
        if (userLocationMarker) {
            routeMap.removeLayer(userLocationMarker);
        }

        userLocationMarker = L.marker([userLocation.lat, userLocation.lng], {
            icon: L.divIcon({
                className: 'user-location-marker',
                html: `
                    <div class="user-location-pulse"></div>
                    <div class="user-location-dot"></div>
                `,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            })
        })
            .addTo(routeMap)
            .bindPopup("Your Current Location");

        console.log('User location marker added at:', userLocation);
    }
}

async function loadBusStops() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/Anready/BusRoutes/refs/heads/main/buses/GetAllStops.json');
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

async function displaySavedTrips() {
    const container = document.getElementById('savedTripsContainer');
    const savedTrips = JSON.parse(localStorage.getItem('savedTrips') || '[]');

    container.innerHTML = '';

    if (savedTrips.length === 0) {
        container.innerHTML = '<p>No saved trips yet.</p>';
        return;
    }

    savedTrips.reverse().forEach((option, index) => {
        const departureTime = new Date(option.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const arrivalTime = new Date(option.arivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const duration = Math.round(option.durationInMinutes);
        const ticketCost = option.ticketCost ? `€${option.ticketCost}` : 'N/A';
        const savedDate = new Date(option.savedAt).toLocaleString();

        let y = 0;
        const section = document.createElement('section');
        section.className = 'trip-option';
        section.innerHTML = `
                    <h2>${option.originName} -- ${option.destinationName}</h2>
                    <p>Saved on: ${savedDate}</p>
                    <div class="trip-details">
                        <p><strong>${duration} min</strong> | ${departureTime} - ${arrivalTime} | Cost: ${ticketCost}</p>
                        <ul>
                            ${option.connectionChanges.map(change => `
                                <li class="${change.isWalking ? 'walk' : `bus route-${y += 1 || 'unknown'}`}">
                                    <span>${change.isWalking ? 'Walk' : `Bus Route ${change.routeName || 'Unknown'}`} (${Math.round(change.durationInMinutes)} min)</span>
                                    <p>${new Date(change.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(change.arivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                    <p>${change.originName} to ${change.destinationName}</p>
                                </li>
                            `).join('')}
                        </ul>
                        <button class="show-route-btn" onclick='showRouteMap(${JSON.stringify(option)})'>Show Route</button>
                        <button class="delete-trip-btn" onclick='deleteTrip(${index})'>Delete Trip</button>
                    </div>
                `;
        container.appendChild(section);
    });

    await loadBusStops();
}

setInterval(() => {
    getUserLocation();
    addUserLocationMarker();
}, 5000);

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

        // Add locate control button
        const locateButton = L.control({position: 'topleft'});
        locateButton.onAdd = function() {
            const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
            div.style.backgroundColor = 'white';
            div.style.width = '34px';
            div.style.height = '34px';
            div.style.cursor = 'pointer';
            div.innerHTML = '<span style="font-size: 18px; line-height: 34px; text-align: center; display: block;">📍</span>';
            div.title = 'Find My Location';

            div.onclick = async function() {
                div.innerHTML = '<span style="font-size: 12px; line-height: 34px; text-align: center; display: block;">...</span>';
                try {
                    await getUserLocation();
                    if (userLocation) {
                        addUserLocationMarker();
                        routeMap.setView([userLocation.lat, userLocation.lng], 15);
                        div.innerHTML = '<span style="font-size: 18px; line-height: 34px; text-align: center; display: block;">📍</span>';
                    } else {
                        alert('Could not get your location. Please check if location services are enabled.');
                        div.innerHTML = '<span style="font-size: 18px; line-height: 34px; text-align: center; display: block;">❌</span>';
                        setTimeout(() => {
                            div.innerHTML = '<span style="font-size: 18px; line-height: 34px; text-align: center; display: block;">📍</span>';
                        }, 2000);
                    }
                } catch (error) {
                    console.error('Location error:', error);
                    alert('Location access failed. Please enable location services and try again.');
                    div.innerHTML = '<span style="font-size: 18px; line-height: 34px; text-align: center; display: block;">📍</span>';
                }
            };

            return div;
        };
        locateButton.addTo(routeMap);
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

    // Get user location and add marker when map is opened
    if (!userLocation) {
        getUserLocation().then(() => {
            if (userLocation) {
                addUserLocationMarker();
                allBounds.push([userLocation.lat, userLocation.lng]);
                console.log('User location added to route map');
            }
        }).catch(err => console.warn('Could not get user location:', err));
    } else {
        // Add user location marker if available
        addUserLocationMarker();
        allBounds.push([userLocation.lat, userLocation.lng]);
    }

    // Process all route segments in parallel using Promise.all
    try {
        // Prepare initial walking paths promises (from start point to first bus stop)
        const initialWalkPromises = prepareInitialWalkingPromises(solutionPath.startPoint, solutionPath.origin, solutionPath.endPoint, solutionPath.destination);

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
                        html: result.marker.html,
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

function prepareInitialWalkingPromises(start, startStopId, end, endStopId) {
    const promises = [];

    // Add walking path from start selected point to start bus stop
    if (start.lat && start.lng) {
        const startStop = busStops.get(startStopId.toString());
        if (startStop) {
            const startLat = parseFloat(start.lat);
            const startLng = parseFloat(start.lng);

            promises.push(getWalkingRouteOptimized(
                startLat, startLng,
                startStop.latitude, startStop.longitude
            ).then(coords => ({
                coords,
                color: '#ff6b6b',
                marker: {
                    lat: startLat,
                    lng: startLng,
                    className: 'start-point-marker',
                    html: `
                        <div class="start-point-pin">
                            <div class="pin-icon">🚩</div>
                        </div>
                    `,
                    popup: 'Starting Point'
                }
            })));
        }
    }

    // Add walking path from end bus stop to end selected point
    if (end.lat && end.lng) {
        const endStop = busStops.get(endStopId.toString());
        if (endStop) {
            const endLat = parseFloat(end.lat);
            const endLng = parseFloat(end.lng);

            promises.push(getWalkingRouteOptimized(
                endStop.latitude, endStop.longitude,
                endLat, endLng
            ).then(coords => ({
                coords,
                color: '#28a745',
                marker: {
                    lat: endLat,
                    lng: endLng,
                    className: 'end-point-marker',
                    html: `
                        <div class="end-point-pin">
                            <div class="pin-icon">🎯</div>
                        </div>
                    `,
                    popup: 'Destination Point'
                }
            })));
        }
    }

    return promises;
}

function deleteTrip(index) {
    let savedTrips = JSON.parse(localStorage.getItem('savedTrips') || '[]');
    savedTrips.splice(index, 1);
    localStorage.setItem('savedTrips', JSON.stringify(savedTrips));
    displaySavedTrips();
}

// Add event listener for close map button
document.getElementById('closeRouteMapBtn').addEventListener('click', () => {
    document.getElementById('route-map-container').style.display = 'none';
});

// Load saved trips when page loads
window.addEventListener('load', displaySavedTrips);

const loadingStyles = document.createElement('style');
loadingStyles.textContent = `
    .route-loading {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 255, 255, 0.9);
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
        background: rgba(255, 51, 51, 0.9);
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        z-index: 1000;
    }

    /* User Location Marker Styles */
    .user-location-marker {
        position: relative;
        width: 24px;
        height: 24px;
    }
    
    .user-location-dot {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 12px;
        height: 12px;
        background-color: #4285F4;
        border: 2px solid white;
        border-radius: 50%;
        z-index: 1002;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    
    .user-location-pulse {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 24px;
        height: 24px;
        background-color: rgba(66, 133, 244, 0.3);
        border-radius: 50%;
        z-index: 1001;
        animation: pulse 2s infinite;
    }

    @keyframes pulse {
        0% {
            transform: translate(-50%, -50%) scale(0.5);
            opacity: 1;
        }
        100% {
            transform: translate(-50%, -50%) scale(2);
            opacity: 0;
        }
    }

    /* Start Point Marker */
    .start-point-marker {
        position: relative;
        width: 24px;
        height: 24px;
    }

    .start-point-pin {
        position: relative;
        width: 24px;
        height: 30px;
        background-color: #ff6b6b;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        animation: bounce 0.6s ease-out;
    }

    .start-point-pin .pin-icon {
        transform: rotate(45deg);
        font-size: 12px;
    }

    /* End Point Marker */
    .end-point-marker {
        position: relative;
        width: 24px;
        height: 24px;
    }

    .end-point-pin {
        position: relative;
        width: 24px;
        height: 30px;
        background-color: #28a745;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        animation: bounce 0.6s ease-out;
    }

    .end-point-pin .pin-icon {
        transform: rotate(45deg);
        font-size: 12px;
    }

    @keyframes bounce {
        0% { 
            transform: translateY(-20px) rotate(-45deg); 
            opacity: 0; 
        }
        60% { 
            transform: translateY(3px) rotate(-45deg); 
            opacity: 1; 
        }
        100% { 
            transform: translateY(0) rotate(-45deg); 
            opacity: 1; 
        }
    }
`;
document.head.appendChild(loadingStyles);