class BottomSheet {
    constructor(app) {
        this.app = app;
        this.currentStopName = null;
        this.currentRouteId = null;
        this.currentRouteName = null;
        this.activeTab = 'live';
        this.notificationTimer = null;

        this.startY = 0;
        this.currentY = 0;
        this.isDragging = false;
        this.isExpanded = false;

        this.createBottomSheetElement();
        this.initTouchGestures();
    }

    createBottomSheetElement() {
        this.bottomSheet = document.createElement('div');
        this.bottomSheet.className = 'bottom-sheet';
        this.bottomSheet.innerHTML = `
            <div class="bottom-sheet-header">
                <div class="stop-header">
                    <svg id="favoriteIcon" class="favorite-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26 12,2"></polygon>
                    </svg>
                    <h3 id="stopName">Stop Name</h3>
                </div>
                <div class="header-icons">
                    <img id="mapIcon" class="map-icon" src="/static/icons/stop.svg" alt="Open in Maps" width="36" height="36">
                    <svg id="closeIcon" className="close-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"
                         xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12Z" stroke="var(--black)" stroke-width="2"/>
                        <path d="M9 9L15 15M15 9L9 15" stroke="var(--white)" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>
            </div>
            <div class="tab-buttons">
                <button id="liveTab" class="tab-button active">Live</button>
                <button id="timetableTab" class="tab-button">Timetable</button>
            </div>
            <div class="bottom-sheet-content">
                <ul id="busList" class="bus-list"></ul>
            </div>
        `;

        const style = document.createElement('style');
        style.textContent = `
            .stop-header {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .header-icons {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            
            .favorite-icon {
                cursor: pointer;
                transition: fill 0.2s ease;
            }
            
            .favorite-icon.active {
                fill: #FFD700;
                stroke: #FFD700;
            }
            
            .favorite-icon:not(.active) {
                fill: none;
                stroke: #999;
            }
            
            .favorite-icon:hover {
                transform: scale(1.1);
            }

            .tab-buttons {
                display: flex;
                gap: 8px;
                padding: 12px 16px 0;
            }

            .tab-button {
                flex: 1;
                padding: 8px 16px;
                background: none;
                border: none;
                border-bottom: 2px solid transparent;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                color: #666;
                transition: all 0.2s ease;
            }

            .tab-button.active {
                color: #2196F3;
                border-bottom-color: #2196F3;
            }
            
            .bottom-sheet-content {
                flex: 1;
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: var(--black) var(--white);
            }
            
            .bus-item.loading {
                color: #666;
                font-style: italic;
                text-align: center;
                padding: 20px;
            }

            .bottom-sheet-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.3s ease, visibility 0.3s ease;
                z-index: 999;
            }

            .bottom-sheet-overlay.active {
                opacity: 1;
                visibility: visible;
            }
        `;
        document.head.appendChild(style);

        this.overlay = document.createElement('div');
        this.overlay.className = 'bottom-sheet-overlay';
        document.body.appendChild(this.overlay);

        document.body.appendChild(this.bottomSheet);

        this.stopNameElement = this.bottomSheet.querySelector('#stopName');
        this.mapIcon = this.bottomSheet.querySelector('#mapIcon');
        this.busList = this.bottomSheet.querySelector('#busList');
        this.favoriteIcon = this.bottomSheet.querySelector('#favoriteIcon');
        this.liveTab = this.bottomSheet.querySelector('#liveTab');
        this.timetableTab = this.bottomSheet.querySelector('#timetableTab');
        this.dragHandle = this.bottomSheet.querySelector('.bottom-sheet-header');

        this.bottomSheet.querySelector('#closeIcon').onclick = () => {
            this.close();
        };

        this.overlay.onclick = () => {
            this.close();
        };

        this.favoriteIcon.onclick = () => {
            this.toggleFavorite();
        };

        this.liveTab.onclick = () => {
            this.switchTab('live');
        };

        this.timetableTab.onclick = () => {
            this.switchTab('timetable');
        };
    }

    initTouchGestures() {
        const isInteractiveElement = (element) => {
            const interactive = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SVG', 'IMG'];

            let current = element;
            while (current && current !== this.dragHandle) {
                if (interactive.includes(current.tagName) ||
                    current.classList.contains('favorite-icon') ||
                    current.classList.contains('map-icon') ||
                    current.classList.contains('close-icon') ||
                    current.id === 'favoriteIcon' ||
                    current.id === 'mapIcon' ||
                    current.id === 'closeIcon') {
                    return true;
                }
                current = current.parentElement;
            }
            return false;
        };

        this.dragHandle.addEventListener('touchstart', (e) => {
            if (!isInteractiveElement(e.target)) {
                this.startDrag(e.touches[0].clientY);
            }
        }, { passive: true });

        this.dragHandle.addEventListener('touchmove', (e) => {
            if (this.isDragging) {
                e.preventDefault();
                this.onDrag(e.touches[0].clientY);
            }
        }, { passive: false });

        this.dragHandle.addEventListener('touchend', () => {
            if (this.isDragging) {
                this.endDrag();
            }
        }, { passive: true });

        this.dragHandle.addEventListener('mousedown', (e) => {
            if (!isInteractiveElement(e.target)) {
                this.startDrag(e.clientY);
                e.preventDefault();
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.onDrag(e.clientY);
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.endDrag();
            }
        });
    }

    startDrag(clientY) {
        this.isDragging = true;
        this.startY = clientY;
        this.bottomSheet.classList.add('dragging');
    }

    onDrag(clientY) {
        if (!this.isDragging) return;

        this.currentY = clientY;
        const deltaY = this.currentY - this.startY;

        if (deltaY < 0 && !this.isExpanded) {
            const expandProgress = Math.min(Math.abs(deltaY) / 200, 1);
            const minHeight = window.innerHeight * 0.45;
            const maxHeight = window.innerHeight * 0.9;
            const newHeight = minHeight + (maxHeight - minHeight) * expandProgress;
            this.bottomSheet.style.maxHeight = `${newHeight}px`;
            this.bottomSheet.style.transform = 'translateY(0)';
        } else if (deltaY > 0) {
            const translateY = Math.min(deltaY, window.innerHeight);
            this.bottomSheet.style.transform = `translateY(${translateY}px)`;
        }
    }

    open() {
        this.bottomSheet.classList.add('open');
        this.bottomSheet.classList.add('collapsed');
        this.overlay.classList.add('active');
        this.isExpanded = false;

        document.body.style.overflow = 'hidden';
    }

    endDrag() {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.bottomSheet.classList.remove('dragging');

        const deltaY = this.currentY - this.startY;
        const threshold = 80;

        if (deltaY > threshold) {
            this.bottomSheet.style.transform = `translateY(100%)`;

            setTimeout(() => {
                this.close();
            }, 300);
        } else if (deltaY < -threshold && !this.isExpanded) {
            this.isExpanded = true;
            this.bottomSheet.classList.remove('collapsed');
            this.bottomSheet.classList.add('expanded');
            this.bottomSheet.style.maxHeight = '';
            this.bottomSheet.style.transform = 'translateY(0)';
        } else {
            this.bottomSheet.style.maxHeight = '';
            this.bottomSheet.style.transform = 'translateY(0)';
        }

        this.startY = 0;
        this.currentY = 0;
    }

    close() {
        this.bottomSheet.classList.remove('open');
        this.overlay.classList.remove('active');

        setTimeout(() => {
            this.bottomSheet.classList.remove('expanded', 'collapsed');
            this.bottomSheet.style.transform = '';
            this.bottomSheet.style.maxHeight = '';
            document.body.style.overflow = '';
            this.isExpanded = false;
        }, 300);
    }

    switchTab(tab) {
        this.activeTab = tab;

        if (tab === 'live') {
            this.liveTab.classList.add('active');
            this.timetableTab.classList.remove('active');
        } else {
            this.liveTab.classList.remove('active');
            this.timetableTab.classList.add('active');
        }

        this.updateTabContent(false);
    }

    async updateTabContent(fromUpdates) {
        if (this.activeTab === 'timetable') {
            if (!fromUpdates) {
                this.busList.innerHTML = '<li class="bus-item loading">Loading timetable...</li>';
            }

            const times = await this.app.getTimeStopData(this.stop);

            if (this.activeTab !== 'timetable') {
                return;
            }

            const sortedTimes = times.sort((a, b) => {
                const [ha, ma] = a.split(':').map(Number);
                const [hb, mb] = b.split(':').map(Number);
                return ha !== hb ? ha - hb : ma - mb;
            });

            const sorted = sortedTimes.map(t => {
                return t.replace(/:00$/, '');
            });

            this.busList.innerHTML = '';
            if (sorted.length === 0) {
                const listItem = document.createElement('li');
                listItem.classList.add('bus-item');
                listItem.textContent = "No buses in the next 2 hours";
                this.busList.appendChild(listItem);
            } else {
                sorted.forEach((bus) => {
                    const listItem = document.createElement('li');
                    listItem.classList.add('bus-item');

                    const container = document.createElement('div');
                    container.style.display = 'flex';
                    container.style.alignItems = 'center';
                    container.style.gap = '8px';

                    const splitBus = bus.split("_");

                    const textSpan = document.createElement('span');
                    textSpan.textContent = "Bus " + splitBus[0] + " arriving at: " + splitBus[1];
                    container.appendChild(textSpan);

                    const infoIcon = document.createElement('span');
                    infoIcon.innerHTML = `
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="16" x2="12" y2="12"></line>
                            <circle cx="12" cy="8" r="0.5" fill="currentColor"></circle>
                        </svg>
                    `;
                    infoIcon.style.cursor = 'pointer';
                    infoIcon.style.userSelect = 'none';
                    infoIcon.style.color = 'var(--black)';
                    infoIcon.style.display = 'inline-flex';
                    infoIcon.style.alignItems = 'center';
                    infoIcon.title = 'This is timetable info and can be not accurate';

                    infoIcon.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.app.showWarning("warningTimetable");

                        if (this.notificationTimer != null) {
                            clearTimeout(this.notificationTimer);
                        }

                        this.notificationTimer = setTimeout(() => {
                            this.app.hideWarning("warningTimetable");
                        }, 3000);
                    });

                    container.appendChild(infoIcon);
                    listItem.appendChild(container);
                    this.busList.appendChild(listItem);
                });
            }
        } else {
            if (this.cachedTimesInfo == null) {
                if (this.cachedBusInfo != null) {
                    this.busList.innerHTML = '';
                    this.cachedBusInfo.forEach((bus) => {
                        const listItem = document.createElement('li');
                        listItem.classList.add('bus-item');
                        listItem.textContent = bus.name;

                        listItem.addEventListener('click', () => {
                            this.app.map.flyTo({
                                center: [bus.bus._lngLat.lng, bus.bus._lngLat.lat],
                                zoom: 16,
                                duration: 1500
                            });
                        });

                        this.busList.appendChild(listItem);
                    });
                }
            } else {
                const now = new Date();
                const nowMinutes = now.getHours() * 60 + now.getMinutes();

                const sorted = this.cachedTimesInfo.sort().map(t => {
                    const [h, m] = t.split(':').map(Number);
                    const totalMinutes = h * 60 + m;
                    return {
                        time: t,
                        minutesLeft: totalMinutes - nowMinutes
                    };
                }).filter(t => t.minutesLeft >= 0 && t.minutesLeft <= 120);

                this.busList.innerHTML = '';
                if (sorted.length === 0) {
                    const listItem = document.createElement('li');
                    listItem.classList.add('bus-item');
                    listItem.textContent = "No buses in the next 2 hours";
                    this.busList.appendChild(listItem);
                } else {
                    sorted.forEach((bus) => {
                        const listItem = document.createElement('li');
                        listItem.classList.add('bus-item');
                        listItem.textContent = "TT Bus: " + bus.minutesLeft + "min";
                        this.busList.appendChild(listItem);
                    });
                }
            }
        }
    }

    updateView(busInfo, stop, geoUri, s, times) {
        this.stop = stop;
        this.currentStopName = stop.stopName || 'Stop';
        this.currentRouteId = this.app.getRouteLink(this.app.currentRouteName);
        this.currentRouteName = this.app.currentRouteName;
        this.cachedBusInfo = busInfo;
        this.cachedTimesInfo = times;

        this.stopNameElement.textContent = this.currentStopName;

        this.updateFavoriteIcon();
        this.updateTabContent(true);

        this.mapIcon.onclick = () => {
            const [lat, lon] = geoUri.replace('geo:', '').split('?q=')[1].split(',');
            const encodedName = encodeURIComponent(this.currentStopName);

            if (this.isDesktop()) {
                window.open(
                    `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
                    '_blank'
                );
            } else if (this.isIOSDevice()) {
                const modal = document.createElement("div");
                modal.id = "mapDialog";
                modal.className = "modal";
                modal.innerHTML = `
                    <div class="modal-content">
                        <span class="modal-close">&times;</span>
                        <p>Open location in:</p>
                        <div class="modal-buttons">
                            <button id="openGoogle">Google Maps</button>
                            <button id="openApple">Apple Maps</button>
                        </div>
                    </div>`;

                document.body.appendChild(modal);

                const cleanup = () => modal.remove();

                modal.querySelector(".modal-close").onclick = cleanup;

                modal.querySelector("#openGoogle").onclick = () => {
                    window.location.href = `comgooglemaps://?q=${lat},${lon}(${encodedName})`;
                    cleanup();
                };
                modal.querySelector("#openApple").onclick = () => {
                    window.location.href = `http://maps.apple.com/?q=${lat},${lon}`;
                    cleanup();
                };

                modal.onclick = (e) => {
                    if (e.target === modal) cleanup();
                };
            } else {
                window.open(`geo:${lat},${lon}?q=${lat},${lon}(${encodedName})`, '_blank');
            }
        };

        if (s) {
            const params = new URLSearchParams(window.location.search);
            params.set('stop', this.currentStopName);
            history.replaceState({}, '', `${location.pathname}?${params}`);

            this.open();
        }
    }

    isIOSDevice() {
        return [
                'iPad Simulator',
                'iPhone Simulator',
                'iPod Simulator',
                'iPad',
                'iPhone',
                'iPod'
            ].includes(navigator.platform) ||
            (navigator.userAgent.includes("Mac") && "ontouchend" in document);
    }

    toggleFavorite() {
        if (!this.currentStopName || !this.currentRouteId || !this.currentRouteName) {
            return;
        }

        const favoriteKey = `${this.currentStopName}###${this.currentRouteId}###${this.currentRouteName}`;
        let favorites = this.getFavorites();

        if (this.isFavorite()) {
            favorites = favorites.filter(fav => fav !== favoriteKey);
        } else {
            favorites.push(favoriteKey);
        }

        localStorage.setItem('favoriteStops', JSON.stringify(favorites));
        this.updateFavoriteIcon();
    }

    isFavorite() {
        if (!this.currentStopName || !this.currentRouteId || !this.currentRouteName) {
            return false;
        }

        const favoriteKey = `${this.currentStopName}###${this.currentRouteId}###${this.currentRouteName}`;
        const favorites = this.getFavorites();
        return favorites.includes(favoriteKey);
    }

    updateFavoriteIcon() {
        if (this.isFavorite()) {
            this.favoriteIcon.classList.add('active');
        } else {
            this.favoriteIcon.classList.remove('active');
        }
    }

    getFavorites() {
        const stored = localStorage.getItem('favoriteStops');
        return stored ? JSON.parse(stored) : [];
    }

    isDesktop() {
        return !/Mobi|Android/i.test(navigator.userAgent);
    }
}

class BusRoutesApp {
    constructor() {
        this.map = null;
        this.routes = [];
        this.routeSelect = null;
        this.currentRouteCoordinates = [];
        this.stopMarkers = [];
        this.busMarkers = [];
        this.bottomSheet = new BottomSheet(this);
        this.busUpdateInterval = null;
        this.currentRouteName = null;
        this.selectedItems = new Set();

        this.isVerifificationInProgress = false;
        this.functionToRun = null;

        this.userLocationMarker = null;

        this.allStops = [];
        this.clusterRadius = 1000;

        this.sizeOfStopMarker = 32;
        this.stopMarkerTemplate = this.createStopSVGTemplate(32);
        this.selectedStopMarkerTemplate = this.createSelectedStopSVGTemplate();
        this.clusterMarkerTemplate = this.createClusterSVGTemplate();

        this.isSelection = true;

        this.initMap();
        this.createGpsPermissionModal();
        this.loadRoutes();

        this.createCityFirstBusSelection();
    }

    createCityFirstBusSelection() {
        const modal = document.createElement('div');
        modal.className = 'city-first-modal';
        modal.style.cssText = `
        position:fixed; top:0; left:0; width:100%; height:100%;
        background:rgba(0,0,0,0.5); z-index:10000; display:none;
        align-items:center; justify-content:center; font-family:-apple-system,system-ui,sans-serif;
    `;

        modal.innerHTML = `
        <div class="city-first-card" id="selectionModal">
            <div id="cityScreen">
                <div class="cf-header">
                    <h2>Select city</h2>
                    <button id="closeCityBtn">×</button>
                </div>
                <div class="cf-city-list" id="cityList"></div>
            </div>

            <div id="routesScreen" style="display:none">
                <div class="cf-header">
                    <button id="backToCities">←</button>
                    <h2 id="selectedCityName"></h2>
                    <button id="closeRoutesBtn">×</button>
                </div>
                <div class="cf-search">
                    <input type="text" id="routesSearch" placeholder="Search route..." autocomplete="off">
                </div>
                <div class="cf-routes-list" id="routesList"></div>
                <div class="cf-actions">
                    <button id="cancelRoutes">Cancel</button>
                    <button id="okRoutes" class="primary">Done</button>
                </div>
            </div>
        </div>
    `;

        document.body.appendChild(modal);

        this.cityFirstModal = {
            overlay: modal,
            cityScreen: modal.querySelector('#cityScreen'),
            routesScreen: modal.querySelector('#routesScreen'),
            cityList: modal.querySelector('#cityList'),
            routesList: modal.querySelector('#routesList'),
            selectedCityName: modal.querySelector('#selectedCityName'),
            searchInput: modal.querySelector('#routesSearch'),
            backBtn: modal.querySelector('#backToCities'),
            closeCityBtn: modal.querySelector('#closeCityBtn'),
            closeRoutesBtn: modal.querySelector('#closeRoutesBtn'),
            cancelBtn: modal.querySelector('#cancelRoutes'),
            okBtn: modal.querySelector('#okRoutes')
        };

        this.currentCityRoutes = [];
        this.selectedItems = new Set();

        const closeAll = () => this.hideCityFirstSelection();
        this.cityFirstModal.closeCityBtn.onclick = closeAll;
        this.cityFirstModal.closeRoutesBtn.onclick = closeAll;
        this.cityFirstModal.cancelBtn.onclick = closeAll;
        this.cityFirstModal.overlay.onclick = (event) => {
            const el =  modal.querySelector('#selectionModal');
            if (!el.contains(event.target)) {
                closeAll();
            }
        }
        this.cityFirstModal.backBtn.onclick = () => {
            this.cityFirstModal.routesScreen.style.display = 'none';
            this.cityFirstModal.cityScreen.style.display = 'block';
        };

        this.cityFirstModal.okBtn.onclick = () => {
            this.saveDataToLocalStorage();
            closeAll();
        };

        this.cityFirstModal.searchInput.addEventListener('input', (e) => {
            this.renderRoutesOfCurrentCity(e.target.value.toLowerCase());
        });
    }

    saveDataToLocalStorage() {
        if (this.selectedItems.size > 0) {
            const selected = Array.from(this.selectedItems).join('####');
            localStorage.setItem('selectedRoutes', selected);
            this.populateRouteSelector(selected.split('####'));
        } else {
            localStorage.removeItem('selectedRoutes');
            this.populateRouteSelector(this.routes);
        }
    }

    showCityFirstSelection() {
        this.selectedItems.clear();
        this.renderCityList();
        this.cityFirstModal.overlay.style.display = 'flex';
        this.cityFirstModal.cityScreen.style.display = 'block';
        this.cityFirstModal.routesScreen.style.display = 'none';
    }

    hideCityFirstSelection() {
        this.cityFirstModal.overlay.style.display = 'none';
    }

    renderCityList() {
        const groups = this.groupBusesByCity();
        const container = this.cityFirstModal.cityList;
        container.innerHTML = '';

        const cityOrder = ['Limassol', 'Nicosia', 'Larnaca', 'Pafos', 'Intercity', 'Others'];
        const sortedCities = cityOrder.filter(c => groups[c]);

        sortedCities.forEach(city => {
            const count = groups[city].length;
            const item = document.createElement('div');
            item.className = 'cf-city-item';
            item.innerHTML = `
            <span>${city}</span>
            <span style="color:var(--check-text); font-size:15px;">${count} routes</span>
        `;
            item.onclick = () => {
                this.currentCityRoutes = groups[city];
                this.cityFirstModal.selectedCityName.textContent = city;
                this.cityFirstModal.cityScreen.style.display = 'none';
                this.cityFirstModal.routesScreen.style.display = 'block';
                this.cityFirstModal.searchInput.value = '';
                this.renderRoutesOfCurrentCity();
            };
            container.appendChild(item);
        });
    }

    renderRoutesOfCurrentCity(filter = '') {
        const container = this.cityFirstModal.routesList;
        container.innerHTML = '';

        let routes = this.currentCityRoutes;
        if (filter) {
            routes = routes.filter(r => r.split("###")[0].toLowerCase().includes(filter));
        }

        if (routes.length === 0) {
            container.innerHTML = '<div class="no-results">Nothing found</div>';
            return;
        }

        const active = this.getSelectedBuses();
        active.forEach((route) => {
            this.selectedItems.add(route);
        })

        routes.forEach(route => {
            const name = route.split("###")[0].replace(" - ", ` →\n`);
            const item = document.createElement('div');
            item.className = 'cf-route-item';
            item.innerHTML = `
            <div style="max-width: 80%; white-space: pre-line;">${name}</div>
            <div class="checkmark"></div>
        `;

            if (this.isSelection !== true) {
                item.onclick = () => {
                    event.stopPropagation();
                    window.location.href = location.origin + '/?bus=' + route.split('###')[1].split(',')[0]
                }

                item.innerHTML = `
                <div style="max-width: 80%; white-space: pre-line;">${name}</div>
                <button style="border: none;background: var(--white);color: var(--black);">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2" stroke-linecap="round"
                        stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                </button>`
            }

            if ((active.includes(route) || this.selectedItems.has(route)) && this.isSelection === true) {
                item.classList.add('selected');
                this.selectedItems.add(route);
            }

            if (this.isSelection === true) {
                item.onclick = () => {
                    if (this.selectedItems.has(route)) {
                        this.selectedItems.delete(route);
                        item.classList.remove('selected');
                    } else {
                        this.selectedItems.add(route);
                        item.classList.add('selected');
                    }

                    this.saveDataToLocalStorage();
                };
            }

            container.appendChild(item);
        });
    }

    groupBusesByCity() {
        const groups = {};
        this.routes.forEach(route => {
            const city = this.getCityName(route);
            if (!groups[city]) groups[city] = [];
            groups[city].push(route);
        });
        return groups;
    }

    getSelectedBuses(){
        const selectedRoutes = localStorage.getItem('selectedRoutes');
        if (selectedRoutes === null) {
            return []
        }
        return selectedRoutes.split("####")
    }

    getCityName(route) {
        const a = route.split("###")[1].split(",")[0];
        const b = a.charAt(0);
        return b === "1" ? "Limassol" : b === "2" ? "Larnaca" : b === "3" ? "Pafos" : b === "5" ? "Intercity" : b === "9" ? "Nicosia" : "Others";
    }

    createGpsPermissionModal() {
        this.requestGpsPermission();
    }

    requestGpsPermission() {
        function isWebView() {
            const ua = navigator.userAgent;
            const isChrome = /CriOS\//.test(ua);
            const isFirefox = /FxiOS\//.test(ua);

            const isIOS = /iPad|iPhone|iPod|Macintosh/.test(ua) && !window.MSStream;

            if (!isIOS) {
                return false;
            }

            if (!isChrome && !isFirefox) {
                return true;
            }
        }

        if (window.Android || window.TelegramWebview || (navigator.userAgent.indexOf("Android") !== -1 && window.navigator.userAgent.indexOf("Version/") !== -1)) {
            this.showWarning("webView");
            return;
        }

        if (isWebView()) {
            this.showWarning("webView");
            return;
        }

        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.initUserLocation();
                },
                (error) => {
                    this.handleGeolocationError(error);
                },
                {
                    enableHighAccuracy: false,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        } else {
            alert('GPS is not supported');
        }
    }

    handleGeolocationError(error) {
        let errorMessage;
        switch (error.code) {
            case error.PERMISSION_DENIED:
                errorMessage = "GPS was rejected";
                break;
            case error.POSITION_UNAVAILABLE:
                errorMessage = "No information about location";
                break;
            case error.TIMEOUT:
                errorMessage = "Out of time";
                break;
            default:
                errorMessage = "Unknown error";
        }

        document.getElementById("warningGps").textContent = errorMessage;
        this.showWarning("warningGps")

        setTimeout(() => {
            this.hideWarning("warningGps")
        }, 3000);
    }

    initUserLocation() {
        if ('geolocation' in navigator) {
            this.updateUserLocation();

            setInterval(() => {
                this.updateUserLocation();
                console.log("1")
            }, 5000);
        } else {
            console.log('GPS is not supported.');
        }
    }

    updateUserLocation() {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const {latitude, longitude} = position.coords;

                if (!this.userLocationMarker) {

                    const userEl = document.createElement('div');
                    userEl.className = 'user-location-marker';
                    userEl.innerHTML = `
                    <div style="position: relative;">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="#3498db">
                            <circle cx="12" cy="12" r="10" fill="#3498db" opacity="0.4"/>
                            <circle cx="12" cy="12" r="5" fill="#2980b9"/>
                        </svg>
                    </div>
                `;

                    this.userLocationMarker = new maplibregl.Marker({
                        element: userEl,
                        anchor: 'center'
                    })
                        .setLngLat([longitude, latitude])
                        .addTo(this.map);

                    this.map.addSource('user-location-accuracy', {
                        'type': 'geojson',
                        'data': {
                            'type': 'Feature',
                            'geometry': {
                                'type': 'Point',
                                'coordinates': [longitude, latitude]
                            },
                            'properties': {
                                'accuracy': position.coords.accuracy
                            }
                        }
                    });

                    this.map.addLayer({
                        'id': 'user-location-accuracy-circle',
                        'type': 'circle',
                        'source': 'user-location-accuracy',
                        'paint': {
                            'circle-radius': {
                                'type': 'exponential',
                                'property': 'accuracy',
                                'stops': [
                                    [0, 0],
                                    [100, 20],
                                    [1000, 50]
                                ]
                            },
                            'circle-color': '#3498db',
                            'circle-opacity': 0.1,
                            'circle-stroke-color': '#3498db',
                            'circle-stroke-width': 2,
                            'circle-stroke-opacity': 0.3
                        }
                    });

                } else {

                    this.userLocationMarker.setLngLat([longitude, latitude]);

                    if (this.map.getSource('user-location-accuracy')) {
                        this.map.getSource('user-location-accuracy').setData({
                            'type': 'Feature',
                            'geometry': {
                                'type': 'Point',
                                'coordinates': [longitude, latitude]
                            },
                            'properties': {
                                'accuracy': position.coords.accuracy
                            }
                        });
                    }
                }
            },
            (error) => {
                console.error('Error updating location:', error.message);
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
            }
        );
    }

    showGpsPermissionModal() {
        if (this.userLocationMarker) {
            const latLng = this.userLocationMarker._lngLat;
            this.map.flyTo({center: [latLng.lng, latLng.lat], zoom: 16, duration: 500});
        } else {
            alert('No GPS');
        }
    }

    hideWarning(id) {
        const el = document.getElementById(id);

        el.removeEventListener("transitionend", el._hideHandler);

        el.classList.remove("show");

        const handler = () => {
            el.style.display = "none";
            el.removeEventListener("transitionend", handler);
            el._hideHandler = null;
        };

        el._hideHandler = handler;
        el.addEventListener("transitionend", handler);
    }

    showWarning(id) {
        const el = document.getElementById(id);

        if (el._hideHandler) {
            el.removeEventListener("transitionend", el._hideHandler);
            el._hideHandler = null;
        }

        el.style.display = "block";
        void el.offsetWidth;
        el.classList.add("show");
    }

    async initMap() {
        if (getTheme() === 'light') {
            const protocol = new pmtiles.Protocol({metadata: true});
            maplibregl.addProtocol("pmtiles", protocol.tile);

            this.map = new maplibregl.Map({
                container: "map",
                center: [33.0413, 34.6786],
                zoom: 10,
                maxZoom: 19,
                maxBounds: [
                    [32.0, 34.3],
                    [34.9, 36.0]
                ],
                style: this.getMapStyle(),
                attributionControl: false
            });
        } else {
            const protocol = new pmtiles.Protocol({metadata: true});
            maplibregl.addProtocol("pmtiles", protocol.tile);

            this.map = new maplibregl.Map({
                container: "map",
                center: [33.0413, 34.6786],
                zoom: 10,
                maxZoom: 19,
                maxBounds: [
                    [32.0, 34.3],
                    [34.9, 36.0]
                ],
                style: this.getMapStyle(),
                attributionControl: false
            });
        }

        this.map.on('load', async () => {
            try {
                const arrowImage = await this.createArrowImage();
                this.map.addImage('route-arrow', arrowImage);
                console.log('Стрелка успешно добавлена');
            } catch (err) {
                console.error('Не удалось загрузить стрелку:', err);
            }
        });

        const self = this;
        this.map.on('zoomend', function() {
            const zoom = self.map.getZoom();
            if (self.allStops.length > 0) {
                self.updateStopDisplay(zoom);
            }
        });

        const focusButton = document.createElement('button');
        focusButton.className = 'focus-stop-button hiddenInfo';
        focusButton.id = 'focusStopButton';

        const focusIcon = document.createElement('img');
        focusIcon.src = '/static/icons/stop-center.svg';
        focusIcon.alt = 'Focus';

        focusButton.appendChild(focusIcon);
        focusButton.title = 'Center map on selected stop';
        focusButton.onclick = () => this.focusOnSelectedStop();

        this.map.addControl({
            onAdd: () => focusButton,
            onRemove: () => focusButton.remove()
        }, 'bottom-left');

        const locationButton = document.createElement('button');
        locationButton.className = 'location-button';

        const locationIcon = document.createElement('img');
        locationIcon.src = '/static/icons/my-location.svg';
        locationIcon.alt = 'Focus';

        locationButton.appendChild(locationIcon);
        locationButton.title = 'Center map on location';
        locationButton.onclick = () => this.showGpsPermissionModal();

        this.map.addControl({
            onAdd: () => locationButton,
            onRemove: () => locationButton.remove()
        }, 'bottom-right');

        await this.verifyToken();
    }

    getMapStyle() {
        const isDark = getTheme() === 'dark';
        if (isDark){
            return {
                version: 8,
                glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
                sources: {
                    example_source: {
                        type: "vector",
                        url: "pmtiles://https://tixan.netlify.app/cyprus.pmtiles"
                    }
                },
                layers: [
                    {
                        id: "background",
                        type: "background",
                        paint: {"background-color": "#1b2a3f"}
                    },
                    {
                        id: "water",
                        source: "example_source",
                        "source-layer": "water",
                        type: "fill",
                        paint: {"fill-color": "#01102f"}
                    },
                    {
                        id: "landcover",
                        source: "example_source",
                        "source-layer": "landcover",
                        type: "fill",
                        paint: {"fill-color": "#155463"}
                    },
                    {
                        id: "landuse",
                        source: "example_source",
                        "source-layer": "landuse",
                        type: "fill",
                        paint: {"fill-color": "#1b2a3f"}
                    },
                    {
                        id: "park",
                        source: "example_source",
                        "source-layer": "park",
                        type: "fill",
                        paint: {"fill-color": "#155463"}
                    },
                    {
                        id: "major-roads",
                        source: "example_source",
                        "source-layer": "transportation",
                        type: "line",
                        filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "primary_link", "secondary_link"],
                        paint: {
                            "line-color": "#466788",
                            "line-width": [
                                "interpolate", ["linear"], ["zoom"],
                                8, 1.5, 14, 4, 17, 10
                            ]
                        }
                    },
                    {
                        id: "minor-roads",
                        source: "example_source",
                        "source-layer": "transportation",
                        type: "line",
                        minzoom: 11,
                        filter: ["in", "class", "tertiary", "residential", "living_street", "service", "unclassified", "track", "path", "pedestrian", "road"],
                        paint: {
                            "line-color": "#3d4f67",
                            "line-width": [
                                "interpolate", ["linear"], ["zoom"],
                                8, 0.3, 14, 1.5, 17, 3
                            ]
                        }
                    },
                    {
                        id: "building",
                        source: "example_source",
                        "source-layer": "building",
                        type: "fill",
                        paint: {
                            "fill-color": "#263646",
                            "fill-outline-color": "#32475c"
                        }
                    },
                    {
                        id: "place-labels",
                        source: "example_source",
                        "source-layer": "place",
                        type: "symbol",
                        minzoom: 11,
                        layout: {
                            "text-field": ["get", "name"],
                            "text-font": ["Noto Sans Regular"],
                            "text-size": ["interpolate", ["linear"], ["zoom"], 8, 12, 14, 18],
                            "text-anchor": "center"
                        },
                        paint: {
                            "text-color": "#cfdfee",
                            "text-halo-color": "#000",
                            "text-halo-width": 1.5,
                            "text-opacity": [
                                "interpolate",
                                ["linear"],
                                ["zoom"],
                                12, 1,
                                12.8, 0
                            ]
                        }
                    },
                    {
                        id: "ocean",
                        source: "example_source",
                        "source-layer": "water",
                        type: "fill",
                        filter: ["==", "class", "ocean"],
                        paint: {
                            "fill-color": "#003366"
                        }
                    },
                    {
                        id: "sand",
                        source: "example_source",
                        "source-layer": "landcover",
                        type: "fill",
                        filter: ["==", "class", "beach"],
                        paint: {
                            "fill-color": "#e4d8a7"
                        }
                    },
                    {
                        id: "parks",
                        source: "example_source",
                        "source-layer": "landuse",
                        type: "fill",
                        filter: ["in", "class", "park", "recreation_ground", "garden", "grass"],
                        paint: {
                            "fill-color": "#155463",
                            "fill-opacity": 0.6
                        }
                    },
                    {
                        id: "natural-areas",
                        source: "example_source",
                        "source-layer": "landcover",
                        type: "fill",
                        filter: ["in", "class", "forest", "grassland", "scrub"],
                        paint: {
                            "fill-color": "#155463",
                            "fill-opacity": 0.5
                        }
                    },
                    {
                        id: "street-labels",
                        source: "example_source",
                        "source-layer": "transportation_name",
                        type: "symbol",
                        minzoom: 12.6,
                        layout: {
                            "text-field": ["get", "name"],
                            "text-font": ["Noto Sans Regular"],
                            "text-size": ["interpolate", ["linear"], ["zoom"], 12, 16, 17, 16],
                            "symbol-placement": "line",
                            "text-rotation-alignment": "map"
                        },
                        paint: {
                            "text-color": "#bbbbbb",
                            "text-halo-color": "#000000",
                            "text-halo-width": 1
                        }
                    },
                    {
                        id: "town-labels",
                        source: "example_source",
                        "source-layer": "place",
                        type: "symbol",
                        filter: ["in", "class", "city"],
                        layout: {
                            "text-field": ["get", "name"],
                            "text-font": ["Noto Sans Regular"],
                            "text-size": ["interpolate", ["linear"], ["zoom"], 8, 16, 14, 40],
                            "text-anchor": "center",
                            "text-offset": [0, 0]
                        },
                        paint: {
                            "text-color": "#ffffff",
                            "text-halo-color": "#000000",
                            "text-halo-width": 2,
                            "text-opacity": [
                                "interpolate",
                                ["linear"],
                                ["zoom"],
                                12, 1,
                                12.6, 0
                            ]
                        }
                    }

                ]
            };
        } else {
            return {
                version: 8,
                glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
                sources: {
                    example_source: {
                        type: "vector",
                        url: "pmtiles://https://tixan.netlify.app/cyprus.pmtiles"
                    }
                },
                layers: [
                    {
                        id: "background",
                        type: "background",
                        paint: {"background-color": "#f7f7f7"}
                    },
                    {
                        id: "water",
                        source: "example_source",
                        "source-layer": "water",
                        type: "fill",
                        paint: {"fill-color": "#8fdaed"}
                    },
                    {
                        id: "landcover",
                        source: "example_source",
                        "source-layer": "landcover",
                        type: "fill",
                        paint: {"fill-color": "#a9eac2"}
                    },
                    {
                        id: "landuse",
                        source: "example_source",
                        "source-layer": "landuse",
                        type: "fill",
                        paint: {"fill-color": "#f7f7f7"}
                    },
                    {
                        id: "park",
                        source: "example_source",
                        "source-layer": "park",
                        type: "fill",
                        paint: {"fill-color": "#a9eac2"}
                    },
                    {
                        id: "major-roads",
                        source: "example_source",
                        "source-layer": "transportation",
                        type: "line",
                        filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "primary_link", "secondary_link"],
                        paint: {
                            "line-color": "#ABBCD6",
                            "line-width": [
                                "interpolate", ["linear"], ["zoom"],
                                8, 1.5, 14, 4, 17, 10
                            ]
                        }
                    },
                    {
                        id: "minor-roads",
                        source: "example_source",
                        "source-layer": "transportation",
                        type: "line",
                        minzoom: 11,
                        filter: ["in", "class", "tertiary", "residential", "living_street", "service", "unclassified", "track", "path", "pedestrian", "road"],
                        paint: {
                            "line-color": "#CDD7E0",
                            "line-width": [
                                "interpolate", ["linear"], ["zoom"],
                                8, 0.3, 14, 1.5, 17, 3
                            ]
                        }
                    },
                    {
                        id: "building",
                        source: "example_source",
                        "source-layer": "building",
                        type: "fill",
                        paint: {
                            "fill-color": "#E8E9Ed",
                            "fill-outline-color": "#dcdde1"
                        }
                    },
                    {
                        id: "place-labels",
                        source: "example_source",
                        "source-layer": "place",
                        type: "symbol",
                        minzoom: 11,
                        layout: {
                            "text-field": ["get", "name"],
                            "text-font": ["Noto Sans Regular"],
                            "text-size": ["interpolate", ["linear"], ["zoom"], 8, 12, 14, 18],
                            "text-anchor": "center"
                        },
                        paint: {
                            "text-color": "#2f3034",
                            "text-halo-color": "#ffffff",
                            "text-halo-width": 1.5,
                            "text-opacity": [
                                "interpolate",
                                ["linear"],
                                ["zoom"],
                                12, 1,
                                12.8, 0
                            ]
                        }
                    },
                    {
                        id: "ocean",
                        source: "example_source",
                        "source-layer": "water",
                        type: "fill",
                        filter: ["==", "class", "ocean"],
                        paint: {
                            "fill-color": "#8fdaed"
                        }
                    },
                    {
                        id: "sand",
                        source: "example_source",
                        "source-layer": "landcover",
                        type: "fill",
                        filter: ["==", "class", "beach"],
                        paint: {
                            "fill-color": "#e4d8a7"
                        }
                    },
                    {
                        id: "parks",
                        source: "example_source",
                        "source-layer": "landuse",
                        type: "fill",
                        filter: ["in", "class", "park", "recreation_ground", "garden", "grass"],
                        paint: {
                            "fill-color": "#a9eac2",
                            "fill-opacity": 0.6
                        }
                    },
                    {
                        id: "natural-areas",
                        source: "example_source",
                        "source-layer": "landcover",
                        type: "fill",
                        filter: ["in", "class", "forest", "grassland", "scrub"],
                        paint: {
                            "fill-color": "#a9eac2",
                            "fill-opacity": 0.5
                        }
                    },
                    {
                        id: "street-labels",
                        source: "example_source",
                        "source-layer": "transportation_name",
                        type: "symbol",
                        minzoom: 12.6,
                        layout: {
                            "text-field": ["get", "name"],
                            "text-font": ["Noto Sans Regular"],
                            "text-size": ["interpolate", ["linear"], ["zoom"], 12, 16, 17, 16],
                            "symbol-placement": "line",
                            "text-rotation-alignment": "map"
                        },
                        paint: {
                            "text-color": "#505E6B",
                            "text-halo-color": "#ffffff",
                            "text-halo-width": 1
                        }
                    },
                    {
                        id: "town-labels",
                        source: "example_source",
                        "source-layer": "place",
                        type: "symbol",
                        filter: ["in", "class", "city"],
                        layout: {
                            "text-field": ["get", "name"],
                            "text-font": ["Noto Sans Regular"],
                            "text-size": ["interpolate", ["linear"], ["zoom"], 8, 16, 14, 40],
                            "text-anchor": "center",
                            "text-offset": [0, 0]
                        },
                        paint: {
                            "text-color": "#2f3034",
                            "text-halo-color": "#ffffff",
                            "text-halo-width": 2,
                            "text-opacity": [
                                "interpolate",
                                ["linear"],
                                ["zoom"],
                                12, 1,
                                12.6, 0
                            ]
                        }
                    }

                ]
            };
        }
    }

    focusOnSelectedStop() {
        if (this.selectedStopMarker) {
            const latLng = this.selectedStopMarker._lngLat;
            this.map.flyTo({center: [latLng.lng, latLng.lat], zoom: 16, duration: 1500});
            this.bottomSheet.open();
        } else {
            alert('No stop selected.');
        }
    }

    populateRouteSelector(routes) {
        this.routeSelect = document.querySelector('.select-items-scroll');
        const selectSelected = document.querySelector('.select-selected');

        routes.sort((a, b) => {
            const routeA = a.split(":")[0].trim();
            const routeB = b.split(":")[0].trim();

            const [, letterA = "", numberA = ""] = routeA.match(/([^\d]*)(\d+)/) || [];
            const [, letterB = "", numberB = ""] = routeB.match(/([^\d]*)(\d+)/) || [];
            if (letterA !== letterB) {
                return letterA.localeCompare(letterB);
            }

            return parseInt(numberA, 10) - parseInt(numberB, 10);
        });

        this.routeSelect.innerHTML = '';

        routes.forEach(route => {
            const l = route.split("###");
            const routeItem = document.createElement('div');
            routeItem.className = 'select-item';
            routeItem.setAttribute('data-value', route);
            routeItem.textContent = l[0].replace(" - ", ` → `);
            this.routeSelect.appendChild(routeItem);

            routeItem.addEventListener('click', () => {
                selectSelected.firstChild.textContent = l[0].replace(" - ", ` → `);

                selectSelected.classList.remove('active');
                document.querySelector('.select-items').classList.remove('show');

                this.handleRouteChange(l[0]);
            });
        });
    }

    async handleRouteChange(routeName) {
        this.clearMap();

        if (!routeName) return;

        if(this.selectedStopMarker) {
            this.bottomSheet.close();
            this.selectedStopMarker = null;
        }

        this.allStops = [];
        this.updateStopDisplay(this.map.getZoom())

        const infoButton = document.getElementById('infoButton');
        infoButton.classList.remove('hiddenInfo');

        const focusStopButton = document.getElementById('focusStopButton');
        focusStopButton.classList.add('hiddenInfo');

        await Promise.all([
            this.loadStops(routeName),
            this.loadRoute(routeName),
            this.showBuses(routeName)
        ]);
    }

    clearMap() {
        this.stopMarkers.forEach(marker => marker.remove());
        this.busMarkers.forEach(marker => marker.remove());
        this.stopMarkers = [];
        this.busMarkers = [];

        if (this.map.getLayer('route')) {
            this.map.removeLayer('route');
        }
        if (this.map.getSource('route')) {
            if (this.map.getLayer('route-arrows')) {
                this.map.removeLayer('route-arrows');
            }
            this.map.removeSource('route');
        }

        if (this.busUpdateInterval) {
            clearInterval(this.busUpdateInterval);
            this.busUpdateInterval = null;
        }
    }

    createArrowImage() {
        const svg = `
<svg width="800px" height="800px" viewBox="0 0 1024 1024" class="icon" xmlns="http://www.w3.org/2000/svg">
<path fill="#3b89d6" d="M338.752 104.704a64 64 0 000 90.496l316.8 316.8-316.8 316.8a64 64 0 0090.496 90.496l362.048-362.048a64 64 0 000-90.496L429.248 104.704a64 64 0 00-90.496 0z"/></svg>`.trim();

        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));

        return new Promise((resolve) => {
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 32, 32);

                const imageData = ctx.getImageData(0, 0, 32, 32);
                resolve({
                    width: 32,
                    height: 32,
                    data: imageData.data
                });
            };
        });
    }

    async loadRoute(routeName) {
        try {
            const routePoints = await this.getPoints(routeName, true);

            this.currentRouteCoordinates = routePoints.map(point => [point.lat, point.lng]);

            this.map.addSource('route', {
                'type': 'geojson',
                'data': {
                    'type': 'Feature',
                    'properties': {},
                    'geometry': {
                        'type': 'LineString',
                        'coordinates': this.currentRouteCoordinates.map(coord => [coord[1], coord[0]])
                    }
                }
            });

            this.map.addLayer({
                'id': 'route',
                'type': 'line',
                'source': 'route',
                'layout': {'line-join': 'round', 'line-cap': 'round'},
                'paint': {
                    'line-color': '#1976d2',
                    'line-width': 6
                }
            });

            this.map.addLayer({
                'id': 'route-arrows',
                'type': 'symbol',
                'source': 'route',
                'layout': {
                    'symbol-placement': 'line',
                    'symbol-spacing': 80,
                    'icon-image': 'route-arrow',
                    'icon-size': 1.0,
                    'icon-rotate': 0,
                    'icon-rotation-alignment': 'map',
                    'icon-offset': [0, -2],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': false,
                    'visibility': 'visible'
                }
            });

            const bounds = this.currentRouteCoordinates.reduce(
                (b, coord) => b.extend([coord[1], coord[0]]),
                new maplibregl.LngLatBounds([this.currentRouteCoordinates[0][1], this.currentRouteCoordinates[0][0]], [this.currentRouteCoordinates[0][1], this.currentRouteCoordinates[0][0]])
            );

            this.map.fitBounds(bounds, { padding: 40 });

        } catch (error) {
            console.error('Error loading route:', error);
        }
    }

    async showBuses(routeName) {
        this.hideWarning('warningEmulated');
        if (this.busUpdateInterval) {
            clearInterval(this.busUpdateInterval);
        }

        this.currentRouteName = routeName;
        await this.fetchAndDisplayBuses(routeName);

        this.busUpdateInterval = setInterval(async () => {
            if (this.currentRouteName) {
                await this.fetchAndDisplayBuses(this.currentRouteName);
            }
        }, 10000);
    }


    async fetchAndDisplayBuses(routeName) {
        try {
            const token = localStorage.getItem('accessToken');

            const response = await fetch('/api/buses', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                }
            });

            if (response.status === 403 && this.isVerifificationInProgress === false) {
                this.functionToRun = () => this.fetchAndDisplayBuses(routeName);
                await this.verifyToken();
                return;
            }

            let data = await response.json();

            const routeId = this.getLongName(routeName);
            let filteredBuses = Object.values(data.Realtime.Buses)
                .filter(bus => this.isExist(bus.RouteId, routeId));

            if (filteredBuses.length === 0) {
                filteredBuses = Object.values(data.Emulated.Buses)
                    .filter(bus => this.isExist(bus.RouteId, routeId));

                if (filteredBuses.length === 0) {
                    this.showWarning('warning');
                    this.busMarkers.forEach(marker => marker.remove());
                    this.busMarkers = [];
                    this.updateStopInfo();
                    return;
                } else {
                    this.showWarning('warningEmulated');
                }
            } else {
                this.hideWarning('warningEmulated');
            }

            this.hideWarning('warning');

            const existingMarkers = new Map();
            this.busMarkers.forEach(marker => {
                if (marker.busId) {
                    existingMarkers.set(marker.busId, marker);
                }
            });

            const processedBusIds = new Set();

            filteredBuses.forEach(bus => {
                processedBusIds.add(bus.Label);
                const existingMarker = existingMarkers.get(bus.Label);

                if (existingMarker) {
                    const currentLatLng = existingMarker.getLngLat();
                    const newLat = bus.Latitude;
                    const newLng = bus.Longitude;

                    const hasPositionChanged =
                        Math.abs(currentLatLng.lat - newLat) > 0.0001 ||
                        Math.abs(currentLatLng.lng - newLng) > 0.0001;

                    const rotationChanged = existingMarker._lastBearing !== bus.Bearing;

                    if (hasPositionChanged) {
                        this.animateMarkerTo(existingMarker, [newLat, newLng]);
                    }

                    if (rotationChanged) {
                        this.updateMarkerBearing(existingMarker, bus.Bearing);
                        existingMarker._lastBearing = bus.Bearing;
                    }

                    const popup = existingMarker.getPopup();
                    if (popup) {
                        popup.setHTML(`Bus ${bus.Label}, Speed: ${Math.round(bus.SpeedKmPerHour * 3.6)} km/h`);
                    }

                } else {
                    const busEl = document.createElement('div');
                    busEl.className = 'bus-marker';
                    busEl.style = `z-index: 1000;`;

                    const mapBearing = this.map.getBearing();

                    busEl.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="42" height="42">
                        <g transform="translate(50,50) rotate(${bus.Bearing - mapBearing}) translate(-50,-50)">
                            <path d="M35 30 L65 30 L65 42 L35 42 Z" fill="var(--black)" stroke="var(--black)" stroke-width="3"/>
                            <line x1="42" y1="36" x2="58" y2="36" stroke="var(--white)" stroke-width="3"/>
                            <line x1="28" y1="36" x2="32" y2="36" stroke="var(--white)" stroke-width="3"/>
                            <line x1="68" y1="36" x2="72" y2="36" stroke="var(--white)" stroke-width="3"/>
                            <rect x="35" y="42" width="30" height="48" fill="var(--black)" stroke="var(--black)" stroke-width="3"/>
                        </g>
                    </svg>
                `;

                    const busMarker = new maplibregl.Marker({ element: busEl, rotationAlignment: 'map' })
                        .setLngLat([bus.Longitude, bus.Latitude])
                        .addTo(this.map);

                    const popup = new maplibregl.Popup()
                        .setHTML(`Bus ${bus.Label}, Speed: ${Math.round(bus.SpeedKmPerHour * 3.6)} km/h`);
                    busMarker.setPopup(popup);

                    busMarker.busId = bus.Label;
                    busMarker._lastBearing = bus.Bearing;
                    this.busMarkers.push(busMarker);
                }
            });

            this.busMarkers = this.busMarkers.filter(marker => {
                if (!processedBusIds.has(marker.busId)) {
                    marker.remove();
                    return false;
                }
                return true;
            });

            this.updateStopInfo();
        } catch (error) {
            console.error('Error loading buses:', error);
        }
    }

    animateMarkerTo(marker, newLatLng, duration = 1000) {

        const startLatLng = marker.getLngLat();
        const startTime = performance.now();

        if (marker._animationId) {
            cancelAnimationFrame(marker._animationId);
        }

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);


            const lat = startLatLng.lat + (newLatLng[0] - startLatLng.lat) * progress;
            const lng = startLatLng.lng + (newLatLng[1] - startLatLng.lng) * progress;

            marker.setLngLat([lng, lat]);

            if (progress < 1) {
                marker._animationId = requestAnimationFrame(animate);
            } else {
                marker._animationId = null;
            }
        };

        marker._animationId = requestAnimationFrame(animate);
    }

    updateMarkerBearing(marker, newBearing) {
        const element = marker.getElement();
        const svgGroup = element.querySelector('g');

        if (svgGroup) {
            svgGroup.setAttribute('transform', `translate(50,50) rotate(${newBearing}) translate(-50,-50)`);
        }
    }

    updateStopInfo() {
        if (this.selectedStopMarker) {
            this.calculateDistancesToStop(this.selectedStopMarker, false);
        }
    }

    isExist(id, listIds) {
        for (const cId in listIds) {
            if (id === listIds[cId]) {
                return true;
            }
        }

        return false;
    }

    selectStop(marker, stop) {
        if (this.selectedStopMarker) {
            const defaultEl = this.createStopElement();
            this.selectedStopMarker.getElement().innerHTML = defaultEl.innerHTML;
        }

        this.selectedStopMarker = marker;
        const selectedEl = this.createSelectedStopElement();
        marker.getElement().innerHTML = selectedEl.innerHTML;
        marker.stopName = stop.stopName;

        const focusStopButton = document.getElementById('focusStopButton');
        focusStopButton.classList.remove('hiddenInfo');

        this.calculateDistancesToStop(stop, true);
        this.updateStopDisplay(this.map.getZoom());
    }

    async calculateDistancesToStop(stop, s) {
        if (!this.busMarkers.length) {
            const times = await this.getTimeStopData(stop);
            this.showBusDistances(null, stop, s, times);
        } else {
            const stopLatLng = this.selectedStopMarker._lngLat;
            const busDistances = this.busMarkers.map(busMarker => {
                const busLatLng = busMarker._lngLat;
                const routeDistance = this.calculateRouteDistance(stopLatLng, busLatLng);

                if (routeDistance === -1) return null;

                const averageSpeed = 20;
                const timeInMinutes = Math.round((routeDistance / averageSpeed) * 60);

                const busLabel = busMarker.busId || `Bus ${busMarker.busId}`;
                return {
                    name: `${busLabel}: ${timeInMinutes} min\n(${routeDistance.toFixed(3)} km)`,
                    distance: timeInMinutes,
                    bus: busMarker
                };
            }).filter(bus => bus !== null);

            if (busDistances.length === 0) {
                const times = await this.getTimeStopData(stop);
                this.showBusDistances(null, stop, s, times);
            } else {
                const sortedBuses = busDistances.sort((a, b) => a.distance - b.distance);
                this.showBusDistances(sortedBuses, stop, s, null);
            }
        }
    }

    async getTimeStopData(stop) {
        try {
            const token = localStorage.getItem('accessToken');
            const url = `/api/departureTimeStop?bus=${this.getLongName(this.currentRouteName)[0]}&stop=${encodeURIComponent(stop.stopName)}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                }
            });

            if (response.status === 403 && this.isVerifificationInProgress === false) {
                this.functionToRun = () => this.getTimeStopData(stop);
                await this.verifyToken();
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Error fetching departure times:', error);
            return [];
        }
    }

    showBusDistances(buses, stop, s, times) {
        const stopName = stop.stopName || 'Stop';
        const geoUri = `geo:${this.selectedStopMarker._lngLat.lat},${this.selectedStopMarker._lngLat.lng}?q=${this.selectedStopMarker._lngLat.lat},${this.selectedStopMarker._lngLat.lng}(${stopName})`;

        this.bottomSheet.updateView(buses, stop, geoUri, s, times);
    }

    calculateRouteDistance(startPoint, endPoint) {
        if (!this.currentRouteCoordinates.length) return -1;

        const nearestStartIndex = this.findNearestPointIndex(startPoint);
        const nearestEndIndex = this.findNearestPointIndex(endPoint);

        if (nearestStartIndex < nearestEndIndex) {
            return -1;
        }

        const startIndex = Math.min(nearestStartIndex, nearestEndIndex);
        const endIndex = Math.max(nearestStartIndex, nearestEndIndex);

        let totalDistance = 0;
        for (let i = startIndex; i < endIndex; i++) {
            totalDistance += this.calculateDistance(
                this.currentRouteCoordinates[i][0], this.currentRouteCoordinates[i][1],
                this.currentRouteCoordinates[i + 1][0], this.currentRouteCoordinates[i + 1][1]
            );
        }

        return totalDistance;
    }

    findNearestPointIndex(point) {
        return this.currentRouteCoordinates.reduce((nearestIndex, coord, index) => {
            const distance = this.calculateDistance(
                point.lat, point.lng,
                coord[0], coord[1]
            );

            return distance < this.calculateDistance(
                point.lat, point.lng,
                this.currentRouteCoordinates[nearestIndex][0],
                this.currentRouteCoordinates[nearestIndex][1]
            ) ? index : nearestIndex;
        }, 0);
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371.0;
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    getRouteLink(routeName) {
        const route = this.routes.find(r => r.split("###")[0] === routeName);
        return route ? route.split("###")[1].split(",")[0] : '';
    }

    getLongName(routeName) {
        const route = this.routes.find(r => r.split("###")[0] === routeName);
        if (!route) return '';

        const updated = route.split("###")[1].split(",").map(el => {
            if (el.charAt(0) === "9") {
                return el.substring(1);
            }
            return el;
        });

        return updated;
    }

    async getPoints(routeName, isRoute) {
        const route = this.routes.find(r => r.split("###")[0] === routeName);
        for (let id of route.split("###")[1].split(",")){
            if (id.charAt(0) === "9") {
                id = id.substring(1);
            }

            const routeLink = "https://raw.githubusercontent.com/Anready/BusRoutes/refs/heads/main/buses/" + id;

            const response = await fetch(isRoute ? `${routeLink}.json` : `${routeLink}stops.json`);
            if (response.ok) {
                const newParams = new URLSearchParams();
                newParams.set('bus', id);

                const newUrl = `${location.pathname}?${newParams}`;
                history.replaceState({}, '', newUrl);

                return await response.json();
            }
        }
    }

    parseUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const busId = urlParams.get('bus');
        const stopName = urlParams.get('stop');

        if (busId || stopName) {
            return { busId, stopName: stopName ? decodeURIComponent(stopName) : null };
        }

        return null;
    }

    findRouteByBusId(busId) {
        for (const route of this.routes) {
            const routeIds = route.split("###")[1].split(",");
            if (routeIds.includes(busId)) {
                return route.split("###")[0];
            }
        }
        return null;
    }

    async findStopByName(stopName, routeName) {
        try {
            const stops = await this.getPoints(routeName, false);
            return stops.find(stop => stop.name === stopName);
        } catch (error) {
            console.error('Error finding stop by name:', error);
            return null;
        }
    }

    async openFromUrlParameters() {
        const params = this.parseUrlParameters();
        if (!params) return;

        const routeName = this.findRouteByBusId(params.busId);
        if (!routeName) return;

        const selectSelected = document.querySelector('.select-selected');
        selectSelected.firstChild.textContent = routeName.replace(" - ", ` → `);

        await this.handleRouteChange(routeName);

        const infoButton = document.getElementById('infoButton');
        infoButton.classList.remove('hiddenInfo');

        if (params.stopName) {
            const stop = await this.findStopByName(params.stopName, routeName);
            if (stop) {

                setTimeout(() => {
                    const marker = this.allStops.find(m =>
                        m && m.stopName === params.stopName
                    );
                    if (marker) {
                        this.selectStop(marker, marker);
                        this.map.flyTo({center: [marker._lngLat.lng, marker._lngLat.lat], zoom: 16, duration: 1500});
                    }
                }, 1000);
            }
        }
    }

    async loadRoutes() {
        try {
            const response = await fetch('https://raw.githubusercontent.com/Anready/BusRoutes/refs/heads/main/buses/routesTEST.json');
            this.routes = await response.json();

            const urlParams = this.parseUrlParameters();
            if (urlParams && urlParams.busId) {
                if (this.getSelectedBuses().length === 0) {
                    this.populateRouteSelector(this.routes);
                } else {
                    this.populateRouteSelector(this.getSelectedBuses());
                }
                await this.openFromUrlParameters();
            } else {
                if (this.getSelectedBuses().length === 0) {
                    this.isSelection = false;
                    this.showCityFirstSelection();
                    this.populateRouteSelector(this.routes);
                    document.querySelector('.select-items').classList.toggle('show');
                } else {
                    this.populateRouteSelector(this.getSelectedBuses());
                    document.querySelector('.select-items').classList.toggle('show');
                    document.querySelector('.select-selected').classList.toggle('active');
                }
            }
        } catch (error) {
            console.error('Error loading routes:', error);
        }
    }

    async loadStops(routeName) {
        try {
            const stops = await this.getPoints(routeName, false);

            stops.forEach(stop => {
                const el = document.createElement('div');
                el.className = 'marker-class';
                el.innerHTML = `
<svg width="32" height="32" viewBox="0 0 2048.000000 2047.000000" preserveAspectRatio="xMidYMid meet">
    <circle cx="1024" cy="1023.5" r="900" fill="white" stroke="none"/>
    <g transform="translate(0.000000,2047.000000) scale(0.100000,-0.100000)" fill="#497824" stroke="none">
        <path d="M9855 20459 c-1717 -63 -3394 -559 -4860 -1437 -577 -345 -1055 -697 -1585 -1166 -185 -164 -676 -658 -841 -846 -994 -1135 -1698 -2394 -2126 -3800 -550 -1812 -583 -3793 -93 -5622 387 -1445 1104 -2816 2064 -3948 264 -311 721 -782 996 -1026 1265 -1124 2736 -1904 4341 -2305 1566 -390 3228 -406 4792 -44 1543 356 2957 1052 4193 2062 334 274 854 771 1130 1083 769 866 1360 1795 1802 2835 930 2188 1062 4677 368 6968 -396 1306 -1060 2530 -1945 3587 -353 421 -827 897 -1251 1256 -1449 1226 -3242 2034 -5115 2303 -632 91 -1238 123 -1870 100z m2685 -2269 c428 -18 740 -51 1045 -111 981 -194 1636 -671 2042 -1487 291 -582 439 -1224 515 -2227 9 -121 13 -1290 15 -4762 l3 -4603 -685 0 -685 0 0 -419 c0 -985 -58 -1263 -282 -1367 l-63 -29 -330 0 c-380 0 -397 3 -485 82 -83 74 -126 177 -159 375 -30 182 -41 381 -48 895 l-6 463 -3177 0 -3177 0 -6 -463 c-4 -254 -11 -532 -17 -617 -25 -368 -79 -554 -190 -653 -88 -79 -105 -82 -485 -82 l-330 0 -63 29 c-102 47 -163 130 -206 278 -56 195 -76 472 -76 1081 l0 427 -685 0 -685 0 3 4607 c2 3518 6 4645 16 4763 47 596 105 988 203 1375 81 320 174 573 311 847 222 446 509 780 887 1033 526 351 1193 525 2165 564 288 12 4348 13 4635 1z"/>
        <path d="M7835 17261 c-85 -25 -141 -56 -201 -112 -94 -90 -138 -241 -115 -396 26 -174 114 -279 287 -345 l59 -23 2375 0 2375 0 59 23 c86 32 136 64 185 117 56 60 88 132 102 228 30 200 -51 381 -209 465 -125 67 63 62 -2518 61 -2196 0 -2343 -1 -2399 -18z"/>
        <path d="M6493 14999 c-307 -52 -519 -368 -636 -949 -113 -561 -151 -1190 -164 -2751 l-6 -829 4551 0 4552 0 0 423 c0 536 -17 1534 -30 1827 -36 790 -104 1299 -224 1662 -109 331 -261 523 -476 600 l-65 23 -3725 1 c-2061 1 -3748 -2 -3777 -7z"/>
        <path d="M6443 8626 c-404 -77 -695 -387 -744 -792 -50 -420 216 -832 621 -962 248 -80 523 -48 752 88 84 51 204 162 264 247 219 306 224 723 13 1034 -122 180 -313 315 -524 370 -103 26 -284 34 -382 15z"/>
        <path d="M13723 8626 c-340 -65 -604 -298 -706 -622 -85 -268 -36 -569 127 -798 59 -83 182 -197 267 -247 226 -135 502 -167 749 -87 271 87 488 302 579 573 169 505 -130 1043 -650 1170 -90 22 -278 28 -366 11z"/>
    </g>
</svg>`;
                el.dataset.stopId = stop.id;

                const marker = new maplibregl.Marker({ element: el })
                    .setLngLat([stop.lng, stop.lat]);
                marker.stopName = stop.name;

                el.addEventListener('click', () => this.selectStop(marker, stop));

                this.allStops.push(marker);
            });

            this.updateStopDisplay(this.map.getZoom());
        } catch (error) {
            console.error('Error loading stops:', error);
        }
    }

    updateStopDisplay(zoom) {
        this.stopMarkers.forEach(marker => marker.remove());
        this.stopMarkers = [];

        if (zoom >= 13.6) {

            this.displayAllStops();
        } else {

            this.displayClusteredStops();
        }
    }

    createStopSVGTemplate(size = 32) {
        const template = document.createElement('div');
        template.innerHTML = `
<svg width="${size}" height="${size}" viewBox="0 0 2048.000000 2047.000000" preserveAspectRatio="xMidYMid meet">
    <circle cx="1024" cy="1023.5" r="900" fill="white" stroke="none"/>
    <g transform="translate(0.000000,2047.000000) scale(0.100000,-0.100000)" fill="#497824" stroke="none">
        <path d="M9855 20459 c-1717 -63 -3394 -559 -4860 -1437 -577 -345 -1055 -697 -1585 -1166 -185 -164 -676 -658 -841 -846 -994 -1135 -1698 -2394 -2126 -3800 -550 -1812 -583 -3793 -93 -5622 387 -1445 1104 -2816 2064 -3948 264 -311 721 -782 996 -1026 1265 -1124 2736 -1904 4341 -2305 1566 -390 3228 -406 4792 -44 1543 356 2957 1052 4193 2062 334 274 854 771 1130 1083 769 866 1360 1795 1802 2835 930 2188 1062 4677 368 6968 -396 1306 -1060 2530 -1945 3587 -353 421 -827 897 -1251 1256 -1449 1226 -3242 2034 -5115 2303 -632 91 -1238 123 -1870 100z m2685 -2269 c428 -18 740 -51 1045 -111 981 -194 1636 -671 2042 -1487 291 -582 439 -1224 515 -2227 9 -121 13 -1290 15 -4762 l3 -4603 -685 0 -685 0 0 -419 c0 -985 -58 -1263 -282 -1367 l-63 -29 -330 0 c-380 0 -397 3 -485 82 -83 74 -126 177 -159 375 -30 182 -41 381 -48 895 l-6 463 -3177 0 -3177 0 -6 -463 c-4 -254 -11 -532 -17 -617 -25 -368 -79 -554 -190 -653 -88 -79 -105 -82 -485 -82 l-330 0 -63 29 c-102 47 -163 130 -206 278 -56 195 -76 472 -76 1081 l0 427 -685 0 -685 0 3 4607 c2 3518 6 4645 16 4763 47 596 105 988 203 1375 81 320 174 573 311 847 222 446 509 780 887 1033 526 351 1193 525 2165 564 288 12 4348 13 4635 1z"/>
        <path d="M7835 17261 c-85 -25 -141 -56 -201 -112 -94 -90 -138 -241 -115 -396 26 -174 114 -279 287 -345 l59 -23 2375 0 2375 0 59 23 c86 32 136 64 185 117 56 60 88 132 102 228 30 200 -51 381 -209 465 -125 67 63 62 -2518 61 -2196 0 -2343 -1 -2399 -18z"/>
        <path d="M6493 14999 c-307 -52 -519 -368 -636 -949 -113 -561 -151 -1190 -164 -2751 l-6 -829 4551 0 4552 0 0 423 c0 536 -17 1534 -30 1827 -36 790 -104 1299 -224 1662 -109 331 -261 523 -476 600 l-65 23 -3725 1 c-2061 1 -3748 -2 -3777 -7z"/>
        <path d="M6443 8626 c-404 -77 -695 -387 -744 -792 -50 -420 216 -832 621 -962 248 -80 523 -48 752 88 84 51 204 162 264 247 219 306 224 723 13 1034 -122 180 -313 315 -524 370 -103 26 -284 34 -382 15z"/>
        <path d="M13723 8626 c-340 -65 -604 -298 -706 -622 -85 -268 -36 -569 127 -798 59 -83 182 -197 267 -247 226 -135 502 -167 749 -87 271 87 488 302 579 573 169 505 -130 1043 -650 1170 -90 22 -278 28 -366 11z"/>
    </g>
</svg>`;
        return template.firstElementChild;
    }

    createSelectedStopSVGTemplate() {
        const template = document.createElement('img');
        template.src = '/static/icons/stop-selected.svg';
        template.width = 28;
        template.height = 28;
        template.loading = 'lazy';
        return template;
    }

    createClusterSVGTemplate() {
        const template = document.createElement('div');
        template.innerHTML = `
<svg width="32" height="32" viewBox="0 0 2048.000000 2047.000000" preserveAspectRatio="xMidYMid meet">
    <circle cx="1024" cy="1023.5" r="900" fill="white" stroke="none"/>
    <g transform="translate(0.000000,2047.000000) scale(0.100000,-0.100000)" fill="#497824" stroke="none">
        <path d="M9855 20459 c-1717 -63 -3394 -559 -4860 -1437 -577 -345 -1055 -697 -1585 -1166 -185 -164 -676 -658 -841 -846 -994 -1135 -1698 -2394 -2126 -3800 -550 -1812 -583 -3793 -93 -5622 387 -1445 1104 -2816 2064 -3948 264 -311 721 -782 996 -1026 1265 -1124 2736 -1904 4341 -2305 1566 -390 3228 -406 4792 -44 1543 356 2957 1052 4193 2062 334 274 854 771 1130 1083 769 866 1360 1795 1802 2835 930 2188 1062 4677 368 6968 -396 1306 -1060 2530 -1945 3587 -353 421 -827 897 -1251 1256 -1449 1226 -3242 2034 -5115 2303 -632 91 -1238 123 -1870 100z m2685 -2269 c428 -18 740 -51 1045 -111 981 -194 1636 -671 2042 -1487 291 -582 439 -1224 515 -2227 9 -121 13 -1290 15 -4762 l3 -4603 -685 0 -685 0 0 -419 c0 -985 -58 -1263 -282 -1367 l-63 -29 -330 0 c-380 0 -397 3 -485 82 -83 74 -126 177 -159 375 -30 182 -41 381 -48 895 l-6 463 -3177 0 -3177 0 -6 -463 c-4 -254 -11 -532 -17 -617 -25 -368 -79 -554 -190 -653 -88 -79 -105 -82 -485 -82 l-330 0 -63 29 c-102 47 -163 130 -206 278 -56 195 -76 472 -76 1081 l0 427 -685 0 -685 0 3 4607 c2 3518 6 4645 16 4763 47 596 105 988 203 1375 81 320 174 573 311 847 222 446 509 780 887 1033 526 351 1193 525 2165 564 288 12 4348 13 4635 1z"/>
        <path d="M7835 17261 c-85 -25 -141 -56 -201 -112 -94 -90 -138 -241 -115 -396 26 -174 114 -279 287 -345 l59 -23 2375 0 2375 0 59 23 c86 32 136 64 185 117 56 60 88 132 102 228 30 200 -51 381 -209 465 -125 67 63 62 -2518 61 -2196 0 -2343 -1 -2399 -18z"/>
        <path d="M6493 14999 c-307 -52 -519 -368 -636 -949 -113 -561 -151 -1190 -164 -2751 l-6 -829 4551 0 4552 0 0 423 c0 536 -17 1534 -30 1827 -36 790 -104 1299 -224 1662 -109 331 -261 523 -476 600 l-65 23 -3725 1 c-2061 1 -3748 -2 -3777 -7z"/>
        <path d="M6443 8626 c-404 -77 -695 -387 -744 -792 -50 -420 216 -832 621 -962 248 -80 523 -48 752 88 84 51 204 162 264 247 219 306 224 723 13 1034 -122 180 -313 315 -524 370 -103 26 -284 34 -382 15z"/>
        <path d="M13723 8626 c-340 -65 -604 -298 -706 -622 -85 -268 -36 -569 127 -798 59 -83 182 -197 267 -247 226 -135 502 -167 749 -87 271 87 488 302 579 573 169 505 -130 1043 -650 1170 -90 22 -278 28 -366 11z"/>
    </g>
</svg>`;
        return template.firstElementChild;
    }

    createStopElement() {
        const el = document.createElement('div');
        el.className = 'marker-class';
        el.appendChild(this.stopMarkerTemplate.cloneNode(true));
        return el;
    }

    createSelectedStopElement() {
        const el = document.createElement('div');
        el.style.width = '28px';
        el.style.height = '28px';
        el.appendChild(this.selectedStopMarkerTemplate.cloneNode(true));
        return el;
    }

    displayAllStops() {
        this.stopMarkers.forEach(marker => marker.remove());
        this.stopMarkers = [];

        const addAllMarkers = (stops) => {
            stops.forEach(stop => {
                const isSelected = this.selectedStopMarker &&
                    Math.abs(this.selectedStopMarker._lngLat.lat - stop._lngLat.lat) < 0.00001 &&
                    Math.abs(this.selectedStopMarker._lngLat.lng - stop._lngLat.lng) < 0.00001;

                const el = document.createElement('div');
                el.className = 'marker-class';

                if (isSelected) {
                    el.appendChild(this.selectedStopMarkerTemplate.cloneNode(true));
                } else {
                    el.appendChild(this.stopMarkerTemplate.cloneNode(true));
                }

                const marker = new maplibregl.Marker({
                    element: el,
                    anchor: 'center'
                })
                    .setLngLat([stop._lngLat.lng, stop._lngLat.lat])
                    .addTo(this.map);

                marker.stopName = stop.stopName;
                el.addEventListener('click', () => this.selectStop(marker, stop), { passive: true });
                this.stopMarkers.push(marker);
            });
        };

        addAllMarkers(this.allStops);
    }

    displayClusteredStops() {
        const clusters = this.createClusters(this.allStops);
        const smaller = 32 - (16 - this.map.getZoom())

        if (smaller !== this.sizeOfStopMarker) {
            this.clusterMarkerTemplate = this.createStopSVGTemplate(smaller);
        }

        clusters.forEach(cluster => {
            const el = document.createElement('div');
            el.className = 'cluster-marker';

            const clusterIcon = document.createElement('div');
            clusterIcon.className = 'cluster-icon';
            clusterIcon.appendChild(this.clusterMarkerTemplate.cloneNode(true));

            el.appendChild(clusterIcon);
            el.style.width = '40px';
            el.style.height = '40px';
            el.style.cursor = 'pointer';

            const marker = new maplibregl.Marker({ element: el })
                .setLngLat([cluster.centerLng, cluster.centerLat])
                .addTo(this.map);

            marker.getElement().clusterStops = cluster.stops;
            el.addEventListener('click', () => this.handleClusterClick(marker, cluster), { passive: true });

            this.stopMarkers.push(marker);
        });
    }

    createClusters(stops) {
        const clusters = [];
        const processedStops = new Set();

        stops.forEach((stop, index) => {
            if (processedStops.has(index)) return;

            const cluster = {
                stops: [stop],
                centerLat: stop._lngLat.lat,
                centerLng: stop._lngLat.lng
            };

            stops.forEach((otherStop, otherIndex) => {
                if (index === otherIndex || processedStops.has(otherIndex)) return;

                const distance = this.calculateDistance(
                    stop._lngLat.lat, stop._lngLat.lng,
                    otherStop._lngLat.lat, otherStop._lngLat.lng
                );

                if (distance * 1000 <= (this.clusterRadius) * (13.7 - this.map.getZoom())) {
                    cluster.stops.push(otherStop);
                    processedStops.add(otherIndex);
                }
            });

            processedStops.add(index);

            if (cluster.stops.length > 1) {
                const latSum = cluster.stops.reduce((sum, s) => sum + s._lngLat.lat, 0);
                const lngSum = cluster.stops.reduce((sum, s) => sum + s._lngLat.lng, 0);
                cluster.centerLat = latSum / cluster.stops.length;
                cluster.centerLng = lngSum / cluster.stops.length;
            }

            clusters.push(cluster);
        });

        return clusters;
    }

    handleClusterClick(marker, cluster) {
        this.map.flyTo({center: [cluster.centerLng, cluster.centerLat], zoom: 15, duration: 1500});
    }

    async loadInfoContent() {
        const infoWindow = document.getElementById('infoWindow');
        const overlay = document.getElementById('overlay1');

        let times = "";
        const o = "";

        l: try {
            const busId = this.currentRouteName;
            if (busId === null) {
                times = "<h3 style='text-align: center;'>Select bus please</h3>";
                break l;
            }

            const token = localStorage.getItem('accessToken');
            const response = await fetch('/api/departureTime', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                }
            });

            if (response.status === 403 && this.isVerifificationInProgress === false) {
                this.functionToRun = () => this.loadInfoContent();
                await this.verifyToken();
                return;
            }

            const data = await response.json();
            const routeId = this.getLongName(busId);

            const now = new Date();
            const currentDay = now.getDay();

            let currentDayType;
            if (currentDay === 0) {
                currentDayType = 3;
            } else if (currentDay === 6) {
                currentDayType = 2;
            } else {
                currentDayType = 1;
            }

            let allTimes = [];
            for (let bus in routeId) {
                if (data[routeId[bus]]) {
                    data[routeId[bus]].forEach(time => {
                        allTimes.push(time);
                    });
                }
            }

            const timesByDay = {
                1: [],
                2: [],
                3: []
            };

            allTimes.forEach(time => {
                const dayType = parseInt(time.split('_')[0]);
                const timeOnly = time.split('_')[1];
                timesByDay[dayType].push(timeOnly);
            });

            if (timesByDay[3].length === 0){
                timesByDay[3] = timesByDay[2];
            }

            Object.keys(timesByDay).forEach(dayType => {
                timesByDay[dayType].sort((a, b) => {
                    const [hoursA, minutesA] = a.split(":").map(Number);
                    const [hoursB, minutesB] = b.split(":").map(Number);
                    return (hoursA * 60 + minutesA) - (hoursB * 60 + minutesB);
                });
            });

            const dayLabels = {
                1: 'Weekdays',
                2: 'Saturday',
                3: 'Sunday'
            };

            Object.keys(timesByDay).forEach(dayType => {
                const isCurrentDay = parseInt(dayType) === currentDayType;
                const dayTimes = timesByDay[dayType];

                times += `<div class="day-schedule" id="schedule-${dayType}" style="display: ${isCurrentDay ? 'block' : 'none'};">`;
                times += `<h3 style='text-align: center;'>Next buses will start a route:</h3>`;

                if (dayTimes.length === 0) {
                    times += `<p style='text-align: center;'>No buses scheduled for this day</p>`;
                } else {
                    dayTimes.forEach(time => {
                        let displayTime = time.substring(0, 5);

                        if (isCurrentDay) {
                            const [hours, minutes] = time.substring(0, 5).split(":").map(Number);
                            const departureTime = new Date();
                            departureTime.setHours(hours, minutes, 0, 0);

                            if (departureTime < now) {
                                displayTime += ` (departed)`;
                            }
                        }

                        if (isCurrentDay) {
                            times += `<p style='text-align: center; font-size: 18px; margin-bottom: 0;'>Today at ${displayTime}</p>`;
                        } else {
                            times += `<p style='text-align: center; font-size: 18px; margin-bottom: 0;'>On ${dayLabels[dayType]} at ${displayTime}</p>`;
                        }
                    });
                }

                times += `</div>`;
            });

            if (times === o) {
                times = "<h3 style='text-align: center;'>No bus will start this route at selected day!</h3>";
            }

            let daySelector = document.getElementById('day-selector-buttons');
            if (!daySelector) {
                daySelector = document.createElement('div');
                daySelector.id = 'day-selector-buttons';
                daySelector.className = 'days-select-container';
                document.body.appendChild(daySelector);
            }

            daySelector.innerHTML = `
            <button onclick="window.showDaySchedule(1)" class="day-tab ${currentDayType === 1 ? 'active' : ''}" id="day-tab-1">Weekdays</button>
            <button onclick="window.showDaySchedule(2)" class="day-tab ${currentDayType === 2 ? 'active' : ''}" id="day-tab-2">Saturday</button>
            <button onclick="window.showDaySchedule(3)" class="day-tab ${currentDayType === 3 ? 'active' : ''}" id="day-tab-3">Sunday</button>
        `;

        } catch (error) {
            console.error('Error fetching bus times:', error);
            times = "<h3 style='text-align: center;'>Error loading schedule</h3>";
        }

        infoWindow.innerHTML = `
    <button class="info-close">×</button>
    ` + times;

        window.showDaySchedule = function(dayType) {
            document.querySelectorAll('.day-schedule').forEach(schedule => {
                schedule.style.display = 'none';
            });

            document.querySelectorAll('.day-tab').forEach(tab => {
                tab.classList.remove('active');
            });

            const scheduleEl = document.getElementById(`schedule-${dayType}`);
            if (scheduleEl) {
                scheduleEl.style.display = 'block';
            }
            document.getElementById(`day-tab-${dayType}`).classList.add('active');
        };

        function closeInfoWindow() {
            infoWindow.style.display = 'none';
            overlay.style.display = 'none';

            const daySelector = document.getElementById('day-selector-buttons');
            if (daySelector) {
                daySelector.remove();
            }
        }

        overlay.addEventListener('click', closeInfoWindow);

        const closeButton = infoWindow.querySelector('.info-close');
        if (closeButton) {
            closeButton.addEventListener('click', closeInfoWindow);
        }
    }

    async validateToken(token) {
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

    async verifyAndGetAccess(turnstileToken) {
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

            if (data.access_token) {
                localStorage.setItem('accessToken', data.access_token);

                const bar = document.getElementById('cf-check');

                await new Promise(resolve => setTimeout(resolve, 2000));

                bar.classList.remove('show');
                bar.classList.add('shrink');

                this.isVerifificationInProgress = false;
                const a = this.functionToRun;
                if (a) {
                    a()
                }
                return true;
            } else {
                console.error(data.message);
                this.showBlocked();
                this.isVerifificationInProgress = false;
                return false;
            }
        } catch (error) {
            console.error(error);
            this.showBlocked();
            this.isVerifificationInProgress = false;
            return false;
        }
    }

    showBlocked() {
        document.getElementById('blocked-screen').style.display = 'flex';
        document.getElementById('container').style.display = 'none';
    }

    async verifyToken() {
        const bar = document.getElementById('cf-check');

        document.getElementById("turnstile-hidden").innerHTML = "";
        this.isVerifificationInProgress = true;

        const token = localStorage.getItem('accessToken');
        if (token) {
            if (await this.validateToken(token) === true) {
                this.isVerifificationInProgress = false;
                await new Promise(resolve => setTimeout(resolve, 2000));

                bar.classList.remove('show');
                bar.classList.add('shrink');
            } else {
                bar.classList.remove('shrink');
                requestAnimationFrame(() => {
                    bar.classList.add('show');
                });
                this.getNewToken();
            }
        } else {
            bar.classList.remove('shrink');
            requestAnimationFrame(() => {
                bar.classList.add('show');
            });
            this.getNewToken();
        }
    }

    getNewToken() {
        const self = this;
        turnstile.render("#turnstile-hidden", {
            sitekey: "1x00000000000000000000AA",
            callback: async function (token) {
                await self.verifyAndGetAccess(token);
            }
        })
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const app = new BusRoutesApp();

    const addButton = document.getElementById("addBusesButton");
    const searchButton = document.getElementById("addButton");


    addButton.addEventListener('click', () => {
        app.isSelection = true;
        app.showCityFirstSelection();
    });

    searchButton.addEventListener('click', () => {
        app.isSelection = false;
        app.showCityFirstSelection();
    });

    const selectSelected = document.querySelector('.select-selected');
    const selectItems = document.querySelector('.select-items');

    selectSelected.addEventListener('click', () => {
        selectSelected.classList.toggle('active');
        selectItems.classList.toggle('show');
    });

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.custom-select')) {
            selectSelected.classList.remove('active');
            selectItems.classList.remove('show');
        }
    });

    const infoButton = document.getElementById('infoButton');
    const infoWindow = document.getElementById('infoWindow');
    const overlay = document.getElementById('overlay1');

    infoButton.addEventListener('click', function () {
        infoWindow.style.display = 'block';
        overlay.style.display = 'block';
        infoWindow.innerHTML = `
            <div class="loading">
                <div class="loader"></div>
                <p>Loading...</p>
            </div>
        `;

        app.loadInfoContent();
    });
});
