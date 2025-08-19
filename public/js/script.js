// Initialize socket connection with better configuration
const socket = io({
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10,
  timeout: 20000,
  forceNew: true
});

// Initialize map with world view
const map = L.map("map").setView([0, 0], 2);

// Add tile layer with better styling
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
}).addTo(map);

// Variables for tracking
let currentUser = null;
let userMarkers = {}; // Store all user markers
let locationUpdateInterval = null;
let heartbeatInterval = null;
let isLocationTracking = false;
let usersList = {};

// DOM elements
const connectionStatus = document.getElementById('connection-status');
const usersCount = document.getElementById('users-count');
const locationStatus = document.getElementById('location-status');
const usersListElement = document.getElementById('users-list');

// Update status display
function updateConnectionStatus(status, isConnected = false) {
    connectionStatus.textContent = status;
    connectionStatus.className = isConnected ? 'status-connected' : 'status-disconnected';
}

function updateUsersCount(online, total) {
    usersCount.textContent = `Online: ${online} | Total: ${total}`;
}

function updateLocationStatus(status, isError = false) {
    locationStatus.textContent = status;
    locationStatus.className = isError ? 'status-location-error' : 'status-location-found';
}

function updateUsersList(users) {
    usersListElement.innerHTML = '';
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = `user-item ${user.isOnline ? 'online' : 'offline'}`;
        userItem.innerHTML = `
            <div class="user-color" style="background-color: ${user.color}"></div>
            <div class="user-info">
                <div class="user-name">${user.userName}</div>
                <div class="user-device">${user.deviceInfo} • ${user.colorName}</div>
            </div>
            <div class="user-status">${user.isOnline ? '🟢' : '🔴'}</div>
        `;
        usersListElement.appendChild(userItem);
    });
}

// Enhanced geolocation options for maximum accuracy
const geoOptions = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 1000 // Very fresh location data
};

// Function to get user's current location with high precision
function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: position.timestamp
                });
            },
            (error) => {
                let errorMessage = 'Location error';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage = 'Location access denied';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage = 'Location unavailable';
                        break;
                    case error.TIMEOUT:
                        errorMessage = 'Location timeout';
                        break;
                }
                reject(new Error(errorMessage));
            },
            geoOptions
        );
    });
}

// Function to send location update to server
async function sendLocationUpdate() {
    if (!currentUser) return;

    try {
        const location = await getCurrentLocation();
        
        // Send location to server
        socket.emit('location-update', {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            timestamp: location.timestamp
        });

        updateLocationStatus(`Location: ±${Math.round(location.accuracy)}m accuracy`);
        
    } catch (error) {
        console.error('Error getting location:', error);
        updateLocationStatus(error.message, true);
    }
}

// Function to start location tracking
function startLocationTracking() {
    if (isLocationTracking) return;

    isLocationTracking = true;
    updateLocationStatus('Starting location tracking...');

    // Initial location update
    sendLocationUpdate();

    // Set up interval for regular updates every 5 seconds
    locationUpdateInterval = setInterval(sendLocationUpdate, 5000);

    // Start heartbeat to keep connection alive
    heartbeatInterval = setInterval(() => {
        socket.emit('heartbeat');
    }, 30000); // Every 30 seconds

    // Use watchPosition for immediate updates when moving
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(
            (position) => {
                // Send immediate update for significant movement
                socket.emit('location-update', {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: position.timestamp
                });
            },
            (error) => {
                console.log('Watch position error:', error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 2000
            }
        );
    }
}

// Function to stop location tracking
function stopLocationTracking() {
    if (!isLocationTracking) return;

    isLocationTracking = false;
    if (locationUpdateInterval) {
        clearInterval(locationUpdateInterval);
        locationUpdateInterval = null;
    }
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    updateLocationStatus('Location tracking stopped');
}

// Function to create marker icon
function createMarkerIcon(colorIcon) {
    return L.icon({
        iconUrl: colorIcon,
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });
}

// Function to create or update a user marker
function createOrUpdateUserMarker(userData) {
    const { socketId, userId, userName, latitude, longitude, colorName, color, colorIcon, deviceInfo, lastUpdated, isOnline, accuracy } = userData;
    
    const isCurrentUser = socketId === socket.id;
    const markerIcon = createMarkerIcon(colorIcon);
    
    // Create popup content with more details
    const popupContent = `
        <div class="user-popup">
            <div class="user-header">
                <div class="user-color-indicator" style="background-color: ${color}"></div>
                <div class="user-name">${isCurrentUser ? 'You' : userName}</div>
                <div class="user-status-indicator">${isOnline ? '🟢' : '🔴'}</div>
            </div>
            <div class="user-details">
                <div class="detail-item">📱 ${deviceInfo}</div>
                <div class="detail-item">🎨 ${colorName}</div>
                ${accuracy ? `<div class="detail-item">📍 ±${Math.round(accuracy)}m</div>` : ''}
                <div class="detail-item">🕒 ${new Date(lastUpdated).toLocaleTimeString()}</div>
                <div class="detail-item">📊 ${isOnline ? 'Online' : 'Offline'}</div>
            </div>
        </div>
    `;

    if (userMarkers[socketId]) {
        // Update existing marker
        userMarkers[socketId].setLatLng([latitude, longitude]);
        userMarkers[socketId].setPopupContent(popupContent);
        
        // Update marker opacity based on online status
        userMarkers[socketId].setOpacity(isOnline ? 1.0 : 0.6);
    } else {
        // Create new marker
        userMarkers[socketId] = L.marker([latitude, longitude], { 
            icon: markerIcon,
            opacity: isOnline ? 1.0 : 0.6
        })
            .addTo(map)
            .bindPopup(popupContent);

        // If this is the current user and it's their first location, center the map
        if (isCurrentUser) {
            map.setView([latitude, longitude], 16);
            userMarkers[socketId].openPopup();
        }
    }

    console.log(`${isCurrentUser ? 'Updated own' : 'Updated user'} marker:`, userData);
}

// Function to remove a user marker
function removeUserMarker(socketId) {
    if (userMarkers[socketId]) {
        map.removeLayer(userMarkers[socketId]);
        delete userMarkers[socketId];
        console.log('Removed marker for:', socketId);
    }
}

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    updateConnectionStatus('Connected', true);
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected from server:', reason);
    updateConnectionStatus(`Disconnected: ${reason}`, false);
    stopLocationTracking();
});

socket.on('user-registered', (userData) => {
    console.log('User registered:', userData);
    currentUser = userData;
    startLocationTracking();
});

socket.on('all-users-locations', (users) => {
    console.log('Received all users locations:', users);
    
    users.forEach(userData => {
        createOrUpdateUserMarker(userData);
    });
});

socket.on('user-location-updated', (userData) => {
    console.log('User location updated:', userData);
    createOrUpdateUserMarker(userData);
});

socket.on('user-status-changed', (statusData) => {
    console.log('User status changed:', statusData);
    const { socketId, isOnline } = statusData;
    
    if (userMarkers[socketId]) {
        userMarkers[socketId].setOpacity(isOnline ? 1.0 : 0.6);
    }
});

socket.on('users-list-updated', (users) => {
    console.log('Users list updated:', users);
    usersList = users;
    updateUsersList(users);
    
    const onlineUsers = users.filter(u => u.isOnline).length;
    updateUsersCount(onlineUsers, users.length);
});

socket.on('user-disconnected', (socketId) => {
    console.log('User completely disconnected:', socketId);
    removeUserMarker(socketId);
});

socket.on('heartbeat-ack', () => {
    // Connection is alive
    console.log('Heartbeat acknowledged');
});

// Handle page events
window.addEventListener('beforeunload', () => {
    socket.emit('user-leaving');
    stopLocationTracking();
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('Tab hidden');
    } else {
        console.log('Tab visible');
        // Send immediate location update when tab becomes visible
        if (currentUser && isLocationTracking) {
            sendLocationUpdate();
        }
    }
});

// Handle connection errors and reconnection
socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    updateConnectionStatus('Connection Error', false);
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected to server after', attemptNumber, 'attempts');
    updateConnectionStatus('Reconnected', true);
    if (currentUser) {
        startLocationTracking();
    }
});

socket.on('reconnect_attempt', (attemptNumber) => {
    console.log('Attempting to reconnect...', attemptNumber);
    updateConnectionStatus(`Reconnecting... (${attemptNumber})`, false);
});

socket.on('reconnect_failed', () => {
    console.log('Failed to reconnect');
    updateConnectionStatus('Reconnection Failed', false);
});

// Initial status
updateConnectionStatus('Connecting...', false);
updateUsersCount(0, 0);
updateLocationStatus('Waiting for location...');