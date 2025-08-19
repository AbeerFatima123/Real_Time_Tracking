// Initialize socket connection
const socket = io();

// Initialize map with default view (required for map to display)
const map = L.map("map").setView([0, 0], 10); // Default world view

// Add tile layer
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

// Create a marker for our location (will be updated)
let locationMarker = null;

// Create an empty object for markers (to track all users)
const markers = {};

// Set up interval for regular location updates (every 5 seconds)
let locationUpdateInterval;

// Session management
let sessionId = localStorage.getItem('trackingSessionId');
let isSessionRegistered = false;

// Generate or retrieve session ID
if (!sessionId) {
  sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('trackingSessionId', sessionId);
}

// Register session with server
socket.emit('register-session', { sessionId });

// Handle session registration confirmation
socket.on('session-registered', (data) => {
  console.log('Session registered:', data.sessionId);
  sessionId = data.sessionId;
  localStorage.setItem('trackingSessionId', sessionId);
  isSessionRegistered = true;
  
  // Start location tracking after session is registered
  startLocationTracking();
});

// Function to get and send location
function updateAndSendLocation() {
  if (!isSessionRegistered) {
    console.log('Session not registered yet, skipping location update');
    return;
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;

        // Emit location to server
        socket.emit("send-location", {
          latitude,
          longitude,
          sessionId
        });

        // Update map with our location (only if it's our own marker)
        if (locationMarker) {
          // Update existing marker
          locationMarker.setLatLng([latitude, longitude]);
        } else {
          // Create new marker for our location
          locationMarker = L.marker([latitude, longitude], {
            icon: L.icon({
              iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
              shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
              iconSize: [25, 41],
              iconAnchor: [12, 41],
              popupAnchor: [1, -34],
              shadowSize: [41, 41]
            })
          })
            .addTo(map)
            .bindPopup("You are here")
            .openPopup();

          // Center map on our location
          map.setView([latitude, longitude], 15);
        }
      },
      (error) => {
        console.error("Error getting location:", error);
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      }
    );
  }
}

// Function to start location tracking
function startLocationTracking() {
  if (navigator.geolocation) {
    // Initial location update
    updateAndSendLocation();

    // Set up interval for regular updates (every 5 seconds)
    locationUpdateInterval = setInterval(updateAndSendLocation, 5000);

    // Also use watchPosition for more responsive updates when moving
    navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;

        // Emit location to server
        socket.emit("send-location", {
          latitude,
          longitude,
          sessionId
        });

        // Update map with our location
        if (locationMarker) {
          // Update existing marker
          locationMarker.setLatLng([latitude, longitude]);
        } else {
          // Create new marker for our location
          locationMarker = L.marker([latitude, longitude], {
            icon: L.icon({
              iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
              shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
              iconSize: [25, 41],
              iconAnchor: [12, 41],
              popupAnchor: [1, -34],
              shadowSize: [41, 41]
            })
          })
            .addTo(map)
            .bindPopup("You are here")
            .openPopup();

          // Center map on our location
          map.setView([latitude, longitude], 15);
        }
      },
      (error) => {
        console.error("Error watching location:", error);
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      }
    );
  }
}

// Handle receiving all existing users' locations when connecting
socket.on("all-users-locations", (users) => {
  console.log("Received all users' locations:", users);

  // Add markers for all existing users
  Object.values(users).forEach((userData) => {
    const { id, latitude, longitude, sessionId: userSessionId, color } = userData;

    // Skip our own socket's marker (we handle it separately)
    if (id === socket.id) return;

    // Create a marker for this user
    const markerColor = getMarkerColor(color || 'blue');
    const isOwnSession = userSessionId === sessionId;
    
    markers[id] = L.marker([latitude, longitude], {
      icon: L.icon({
        iconUrl: markerColor.iconUrl,
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      })
    })
      .addTo(map)
      .bindPopup(isOwnSession ? `Your other tab (${id.substring(0, 5)}...)` : `User ${id.substring(0, 5)}...`);
  });
});

// Listen for other users' locations
socket.on("receive-location", (data) => {
  const { id, latitude, longitude, sessionId: userSessionId, color } = data;

  console.log("Received location update:", data);

  // If this is our own socket's marker, skip (we already handle it above)
  if (id === socket.id) return;

  const markerColor = getMarkerColor(color || 'blue');
  const isOwnSession = userSessionId === sessionId;

  // If a marker for this id exists, update its position
  if (markers[id]) {
    markers[id].setLatLng([latitude, longitude]);
    
    // Update popup text in case session status changed
    markers[id].setPopupContent(isOwnSession ? `Your other tab (${id.substring(0, 5)}...)` : `User ${id.substring(0, 5)}...`);
  } else {
    // Otherwise, create a new marker and add it to the map
    markers[id] = L.marker([latitude, longitude], {
      icon: L.icon({
        iconUrl: markerColor.iconUrl,
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      })
    })
      .addTo(map)
      .bindPopup(isOwnSession ? `Your other tab (${id.substring(0, 5)}...)` : `User ${id.substring(0, 5)}...`)
      .openPopup();
  }
});

// Handle user disconnection
socket.on("user-disconnected", (userId) => {
  console.log("User disconnected:", userId);

  // If we have a marker for this user
  if (markers[userId]) {
    // Remove the marker from the map
    map.removeLayer(markers[userId]);
    // Delete the marker from our markers object
    delete markers[userId];
  }
});

// Function to get marker color based on color name
function getMarkerColor(colorName) {
  const colorMap = {
    'red': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    'blue': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    'green': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    'purple': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png',
    'orange': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
    'darkred': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    'lightred': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    'beige': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png',
    'darkblue': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    'darkgreen': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    'cadetblue': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    'darkpurple': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png',
    'white': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
    'pink': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    'lightblue': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    'lightgreen': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    'gray': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
    'black': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-black.png',
    'lightgray': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png'
  };

  return {
    iconUrl: colorMap[colorName] || colorMap['blue']
  };
}

// Handle page unload (user closing the tab/window)
window.addEventListener("beforeunload", () => {
  // Notify the server that we're leaving
  socket.emit("user-leaving");

  // Clear the location update interval
  clearInterval(locationUpdateInterval);
});

// Handle page visibility change (tab switching)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('Tab is now hidden');
  } else {
    console.log('Tab is now visible');
    // Optionally trigger an immediate location update when tab becomes visible
    if (isSessionRegistered) {
      updateAndSendLocation();
    }
  }
});

