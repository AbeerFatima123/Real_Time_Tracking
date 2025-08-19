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

// Function to get and send location
function updateAndSendLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;

        // Emit location to server
        socket.emit("send-location", {
          latitude,
          longitude,
        });

        // Update map with our location
        if (locationMarker) {
          // Update existing marker
          locationMarker.setLatLng([latitude, longitude]);
        } else {
          // Create new marker
          locationMarker = L.marker([latitude, longitude])
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

// Start watching for location updates
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
      });

      // Update map with our location
      if (locationMarker) {
        // Update existing marker
        locationMarker.setLatLng([latitude, longitude]);
      } else {
        // Create new marker
        locationMarker = L.marker([latitude, longitude])
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

// Handle receiving all existing users' locations when connecting
socket.on("all-users-locations", (users) => {
  console.log("Received all users' locations:", users);

  // Add markers for all existing users
  Object.values(users).forEach((userData) => {
    const { id, latitude, longitude } = userData;

    // Skip our own marker (we handle it separately)
    if (id === socket.id) return;

    // Create a marker for this user
    markers[id] = L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup(`User ${id.substring(0, 5)}...`);
  });
});

// Listen for other users' locations
socket.on("receive-location", (data) => {
  const { id, latitude, longitude } = data;

  console.log("Received location update:", data);

  // If this is our own marker, skip (we already handle it above)
  if (id === socket.id) return;

  // If a marker for this id exists, update its position
  if (markers[id]) {
    markers[id].setLatLng([latitude, longitude]);
  } else {
    // Otherwise, create a new marker and add it to the map
    markers[id] = L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup(`User ${id.substring(0, 5)}...`)
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

// Handle page unload (user closing the tab/window)
window.addEventListener("beforeunload", () => {
  // Notify the server that we're leaving
  socket.emit("user-leaving");

  // Clear the location update interval
  clearInterval(locationUpdateInterval);
});
