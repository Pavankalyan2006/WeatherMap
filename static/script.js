let map;
let directionsService;
let directionsRenderer;
let userLocationMarker;
let weatherMarkers = [];
let routeData = null;
let navigationWatcherId = null;
let currentStepIndex = -1;

// DOM Elements
const getRouteBtn = document.getElementById('get-route-btn');
const startNavBtn = document.getElementById('start-nav-btn');
const weatherToggle = document.getElementById('weather-toggle');
const loaderOverlay = document.getElementById('loader-overlay');
// ---> NEW: Waypoint elements <---
const addWaypointBtn = document.getElementById('add-waypoint-btn');
const waypointsContainer = document.getElementById('waypoints-container');

async function initMap() {
    const { Map, TrafficLayer } = await google.maps.importLibrary("maps");
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    const { Autocomplete } = await google.maps.importLibrary("places");
    
    map = new Map(document.getElementById("map"), {
        center: { lat: 17.3850, lng: 78.4867 },
        zoom: 8,
        mapId: 'YOUR_MAP_ID',
        disableDefaultUI: true,
        zoomControl: true,
    });
    
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({ map: map, suppressMarkers: true });
    new TrafficLayer().setMap(map);

    new Autocomplete(document.getElementById("start"));
    new Autocomplete(document.getElementById("destination"));
    
    getRouteBtn.addEventListener('click', calculateAndDisplayRoute);
    weatherToggle.addEventListener('change', toggleWeatherMarkers);
    startNavBtn.addEventListener('click', toggleNavigation);
    // ---> NEW: Event listener for adding waypoints <---
    addWaypointBtn.addEventListener('click', addWaypointInput);
}

// ---> NEW: Function to add a waypoint input field <---
function addWaypointInput() {
    const waypointIndex = waypointsContainer.children.length;
    const newWaypointDiv = document.createElement('div');
    newWaypointDiv.className = 'input-group';
    newWaypointDiv.innerHTML = `
        <label for="waypoint-${waypointIndex}">Stop ${waypointIndex + 1}</label>
        <input type="text" id="waypoint-${waypointIndex}" class="waypoint-input" placeholder="Enter a stop">
        <button class="remove-waypoint-btn">&times;</button>
    `;
    waypointsContainer.appendChild(newWaypointDiv);
    
    // Attach autocomplete to the new input
    new google.maps.places.Autocomplete(newWaypointDiv.querySelector('input'));
    
    // Add event listener to the remove button
    newWaypointDiv.querySelector('.remove-waypoint-btn').addEventListener('click', () => {
        waypointsContainer.removeChild(newWaypointDiv);
    });
}

async function calculateAndDisplayRoute() {
    clearMap();
    showLoader(true);
    const start = document.getElementById("start").value;
    const destination = document.getElementById("destination").value;
    
    // ---> NEW: Collect waypoint values <---
    const waypointInputs = document.querySelectorAll('.waypoint-input');
    const waypoints = Array.from(waypointInputs).map(input => ({ location: input.value, stopover: true }));

    try {
        const response = await fetch('/route-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start, destination, waypoints }) // Send waypoints to backend
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch route data.');
        routeData = data;

        directionsRenderer.setDirections({ routes: [data.route], request: {} });
        placeWeatherMarkers(data.weather);
        updateSidebarSummary(data.route.legs[0]);
        displayNavigationSteps(data.route.legs[0].steps);
        document.getElementById('trip-controls').classList.remove('hidden');
    } catch (error) {
        alert(`Error: ${error.message}`);
    } finally {
        showLoader(false);
    }
}

// All other JS functions (displayNavigationSteps, toggleNavigation, etc.) remain unchanged.
// ... (paste the rest of the script.js code from the previous response here)

function displayNavigationSteps(steps) {
    const instructionsDiv = document.getElementById('navigation-instructions');
    instructionsDiv.innerHTML = '<h3>Directions</h3>';
    const list = document.createElement('ol');
    list.id = 'directions-list';
    list.style.paddingLeft = '20px';
    steps.forEach((step, index) => {
        const listItem = document.createElement('li');
        listItem.id = `step-${index}`;
        listItem.innerHTML = `${step.html_instructions} <span class="step-distance">(${step.distance.text})</span>`;
        list.appendChild(listItem);
    });
    instructionsDiv.appendChild(list);
}

function toggleNavigation() {
    if (navigationWatcherId) {
        navigator.geolocation.clearWatch(navigationWatcherId);
        navigationWatcherId = null;
        startNavBtn.textContent = "Start Navigation";
        document.getElementById('live-navigation-step').style.display = 'none';
        if (currentStepIndex !== -1) {
            document.getElementById(`step-${currentStepIndex}`)?.classList.remove('active-step');
            currentStepIndex = -1;
        }
    } else {
        startNavBtn.textContent = "Stop Navigation";
        document.getElementById('live-navigation-step').style.display = 'block';
        navigationWatcherId = navigator.geolocation.watchPosition(
            handlePositionUpdate,
            (error) => alert(`Geolocation error: ${error.message}`),
            { enableHighAccuracy: true }
        );
    }
}

function handlePositionUpdate(position) {
    const userPos = { lat: position.coords.latitude, lng: position.coords.longitude };
    updateUserLocationMarker(userPos);
    map.panTo(userPos);
    if (!routeData) return;
    const steps = routeData.route.legs[0].steps;
    let onRoute = false;
    for (let i = 0; i < steps.length; i++) {
        const stepPolyline = new google.maps.Polyline({
            path: google.maps.geometry.encoding.decodePath(steps[i].polyline.points)
        });
        if (google.maps.geometry.poly.isLocationOnEdge(userPos, stepPolyline, 1e-3)) {
            if (i !== currentStepIndex) {
                updateNavigationUI(i, steps);
            }
            onRoute = true;
            break;
        }
    }
    if (!onRoute) {
        document.getElementById('live-navigation-step').innerHTML = `<h3>⚠️ Off Route!</h3>`;
    }
}

function updateNavigationUI(newStepIndex, steps) {
    if (currentStepIndex !== -1) {
        document.getElementById(`step-${currentStepIndex}`)?.classList.remove('active-step');
    }
    const newStepElement = document.getElementById(`step-${newStepIndex}`);
    if (newStepElement) {
        newStepElement.classList.add('active-step');
        newStepElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    const liveStepDiv = document.getElementById('live-navigation-step');
    const nextStep = steps[newStepIndex + 1];
    if (nextStep) {
        liveStepDiv.innerHTML = `<h3>Next Maneuver</h3><p>${nextStep.html_instructions} in ${nextStep.distance.text}</p>`;
    } else {
        liveStepDiv.innerHTML = `<h3>You will arrive at your destination shortly.</h3>`;
    }
    currentStepIndex = newStepIndex;
}

function updateUserLocationMarker(position) {
    if (!userLocationMarker) {
        const markerDiv = document.createElement('div');
        markerDiv.className = 'gps-marker';
        userLocationMarker = new google.maps.marker.AdvancedMarkerElement({ map, content: markerDiv });
    }
    userLocationMarker.position = position;
}

function placeWeatherMarkers(weatherData) {
    clearWeatherMarkers();
    weatherData.forEach(weather => {
        const markerImg = document.createElement('img');
        markerImg.src = weather.icon;
        markerImg.className = 'weather-icon';
        const marker = new google.maps.marker.AdvancedMarkerElement({
            map, position: weather.coords, content: markerImg, title: `${weather.city}: ${weather.temp}°C`
        });
        marker.addListener('click', () => displayWeatherDetails(weather));
        weatherMarkers.push(marker);
    });
}

function toggleWeatherMarkers() {
    weatherMarkers.forEach(marker => { marker.map = weatherToggle.checked ? map : null; });
}

function updateSidebarSummary(leg) {
    document.getElementById('route-summary').innerHTML = `<h3>Route Summary</h3><p><strong>Distance:</strong> ${leg.distance.text}</p><p><strong>Duration:</strong> ${leg.duration.text}</p>`;
}

function displayWeatherDetails(weather) {
    document.getElementById('weather-details').innerHTML = `<h3>Weather in ${weather.city}</h3><p><strong>Temp:</strong> ${weather.temp.toFixed(1)}°C</p><p><strong>Humidity:</strong> ${weather.humidity}%</p><p><strong>Conditions:</strong> ${weather.description}</p>`;
}

function clearMap() {
    directionsRenderer.setDirections({ routes: [] });
    clearWeatherMarkers();
    if (userLocationMarker) userLocationMarker.map = null;
    // ---> NEW: Clear waypoint inputs <---
    waypointsContainer.innerHTML = '';
    document.getElementById('route-summary').innerHTML = "";
    document.getElementById('weather-details').innerHTML = "";
    document.getElementById('navigation-instructions').innerHTML = "";
    document.getElementById('trip-controls').classList.add('hidden');
    document.getElementById('live-navigation-step').style.display = 'none';
    if (navigationWatcherId) toggleNavigation();
    routeData = null;
    currentStepIndex = -1;
}

function clearWeatherMarkers() {
    weatherMarkers.forEach(marker => marker.map = null);
    weatherMarkers = [];
}

function showLoader(show) {
    loaderOverlay.classList.toggle('active', show);
}

window.initMap = initMap;