// sidebar-component.js
class SidebarComponent extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
            <div id="mySidebar" class="sidebar">
                <span class="sidebar-label">BusView</span>
                <a href="javascript:void(0)" class="closebtn" onclick="closeNav()">×</a>
                <a class="normal-btn" href="/">Home</a>
                <a class="normal-btn" href="/favoriteStops">Favorite Stops</a>
                <a class="normal-btn" href="/planTrip">Plan Trip</a>
                <a class="normal-btn" href="/savedTrips">Saved Trips</a>
                <a class="normal-btn" href="/stopsMap">Stops Map</a>
                <a class="normal-btn" href="/tutorials">Tutorials</a>
                <a class="normal-btn" href="/settings">Settings</a>
            </div>
        `;

        this.highlightCurrentPage();
        this.setupEventListeners();
    }

    highlightCurrentPage() {
        const currentPath = window.location.pathname;
        const links = this.querySelectorAll('.normal-btn');

        links.forEach(link => {
            if (link.getAttribute('href') === currentPath) {
                link.classList.add('active');
            }
        });
    }

    setupEventListeners() {
        // Обработчик клика вне сайдбара
        document.addEventListener('click', function(event) {
            const sidebar = document.getElementById("mySidebar");
            const openbtn = document.querySelector(".openbtn");

            if (!sidebar || !openbtn) return;

            const isClickInsideSidebar = sidebar.contains(event.target);
            const isClickOnOpenButton = openbtn.contains(event.target);

            if (sidebar.style.width === "250px" && !isClickInsideSidebar && !isClickOnOpenButton) {
                closeNav();
            }
        });

        // Предотвращаем закрытие при клике внутри сайдбара
        const sidebar = this.querySelector("#mySidebar");
        if (sidebar) {
            sidebar.addEventListener('click', function(event) {
                event.stopPropagation();
            });
        }
    }
}

// Глобальные функции для управления сайдбаром
window.openNav = function() {
    const sidebar = document.getElementById("mySidebar");
    const container = document.querySelector(".container");

    if (sidebar) {
        sidebar.style.width = "250px";
    }
    if (container) {
        container.style.marginLeft = "250px";
    }
}

window.closeNav = function() {
    const sidebar = document.getElementById("mySidebar");
    const container = document.querySelector(".container");

    if (sidebar) {
        sidebar.style.width = "0";
    }
    if (container) {
        container.style.marginLeft = "0";
    }
}

customElements.define('app-sidebar', SidebarComponent);