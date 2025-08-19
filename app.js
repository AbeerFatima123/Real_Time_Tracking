const express = require("express");
const app = express();
const path = require("path");
const http = require("http");
const helmet = require("helmet");
const { v4: uuidv4 } = require('uuid');
const socketio = require("socket.io");

const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 120000, // 2 minutes
  pingInterval: 25000   // 25 seconds
});

// Use helmet for security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.socket.io"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));

// Set view engine and views directory
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Store all connected users and their data
// Structure: { socketId: { socketId, userId, userName, latitude, longitude, lastUpdated, color, deviceInfo, isOnline } }
const connectedUsers = {};

// Available marker colors with names
const markerColors = [
  { name: 'Red', color: 'red', icon: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png' },
  { name: 'Blue', color: 'blue', icon: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png' },
  { name: 'Green', color: 'green', icon: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png' },
  { name: 'Purple', color: 'purple', icon: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png' },
  { name: 'Orange', color: 'orange', icon: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png' },
  { name: 'Yellow', color: 'yellow', icon: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png' },
  { name: 'Pink', color: 'pink', icon: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png' },
  { name: 'Gray', color: 'gray', icon: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png' },
  { name: 'Black', color: 'black', icon: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-black.png' }
];

let colorIndex = 0;

// Function to get next available color
function getNextColor() {
  const colorInfo = markerColors[colorIndex % markerColors.length];
  colorIndex++;
  return colorInfo;
}

// Function to get device info from user agent
function getDeviceInfo(userAgent) {
  if (/Mobile|Android|iPhone/.test(userAgent)) {
    return 'Mobile';
  } else if (/iPad|Tablet/.test(userAgent)) {
    return 'Tablet';
  } else {
    return 'Desktop';
  }
}

// Generate user name
function generateUserName() {
  const adjectives = ['Quick', 'Brave', 'Smart', 'Cool', 'Fast', 'Strong', 'Wise', 'Bold', 'Swift', 'Bright'];
  const nouns = ['Tiger', 'Eagle', 'Lion', 'Wolf', 'Bear', 'Fox', 'Hawk', 'Shark', 'Panther', 'Falcon'];
  
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const number = Math.floor(Math.random() * 100);
  
  return `${adjective}${noun}${number}`;
}

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // Generate unique user info for this connection
  const userId = uuidv4();
  const userName = generateUserName();
  const colorInfo = getNextColor();
  const deviceInfo = getDeviceInfo(socket.handshake.headers['user-agent'] || '');

  // Store user info
  connectedUsers[socket.id] = {
    socketId: socket.id,
    userId: userId,
    userName: userName,
    latitude: null,
    longitude: null,
    lastUpdated: Date.now(),
    colorName: colorInfo.name,
    color: colorInfo.color,
    colorIcon: colorInfo.icon,
    deviceInfo: deviceInfo,
    isOnline: true
  };

  console.log(`User ${userName} (${userId}) connected from ${deviceInfo} with color ${colorInfo.name}`);

  // Send current user their own info
  socket.emit("user-registered", {
    socketId: socket.id,
    userId: userId,
    userName: userName,
    colorName: colorInfo.name,
    color: colorInfo.color,
    colorIcon: colorInfo.icon,
    deviceInfo: deviceInfo
  });

  // Send all existing users to the new user (including offline users with last known location)
  const allUsers = Object.values(connectedUsers).filter(user => 
    user.latitude !== null && user.longitude !== null
  );
  
  if (allUsers.length > 0) {
    socket.emit("all-users-locations", allUsers);
  }

  // Send updated user list to all clients
  io.emit("users-list-updated", Object.values(connectedUsers).map(user => ({
    socketId: user.socketId,
    userName: user.userName,
    colorName: user.colorName,
    color: user.color,
    deviceInfo: user.deviceInfo,
    isOnline: user.isOnline,
    lastUpdated: user.lastUpdated
  })));

  // Handle location updates from client
  socket.on("location-update", (locationData) => {
    const { latitude, longitude, accuracy } = locationData;

    console.log(`Location update from ${socket.id} (${connectedUsers[socket.id]?.userName}): ${latitude}, ${longitude}, accuracy: ${accuracy}m`);

    // Update user's location
    if (connectedUsers[socket.id]) {
      connectedUsers[socket.id].latitude = latitude;
      connectedUsers[socket.id].longitude = longitude;
      connectedUsers[socket.id].accuracy = accuracy;
      connectedUsers[socket.id].lastUpdated = Date.now();
      connectedUsers[socket.id].isOnline = true;

      // Broadcast updated location to ALL clients
      const userData = connectedUsers[socket.id];
      io.emit("user-location-updated", {
        socketId: userData.socketId,
        userId: userData.userId,
        userName: userData.userName,
        latitude: userData.latitude,
        longitude: userData.longitude,
        accuracy: userData.accuracy,
        colorName: userData.colorName,
        color: userData.color,
        colorIcon: userData.colorIcon,
        deviceInfo: userData.deviceInfo,
        lastUpdated: userData.lastUpdated,
        isOnline: userData.isOnline
      });
    }
  });

  // Handle heartbeat to keep connection alive
  socket.on("heartbeat", () => {
    if (connectedUsers[socket.id]) {
      connectedUsers[socket.id].lastUpdated = Date.now();
      connectedUsers[socket.id].isOnline = true;
    }
    socket.emit("heartbeat-ack");
  });

  // Handle user explicitly leaving
  socket.on("user-leaving", () => {
    console.log(`User ${socket.id} explicitly leaving`);
    handleUserDisconnection(socket.id, true);
  });

  // Handle socket disconnection
  socket.on("disconnect", (reason) => {
    console.log(`Client ${socket.id} disconnected: ${reason}`);
    
    // Mark as offline but keep the marker visible
    if (connectedUsers[socket.id]) {
      connectedUsers[socket.id].isOnline = false;
      connectedUsers[socket.id].lastUpdated = Date.now();
      
      // Notify all clients that user went offline (but keep marker)
      io.emit("user-status-changed", {
        socketId: socket.id,
        isOnline: false,
        lastUpdated: Date.now()
      });
    }

    // Only remove after extended period of inactivity (5 minutes)
    setTimeout(() => {
      if (connectedUsers[socket.id] && !connectedUsers[socket.id].isOnline) {
        const timeSinceDisconnect = Date.now() - connectedUsers[socket.id].lastUpdated;
        if (timeSinceDisconnect >= 300000) { // 5 minutes
          handleUserDisconnection(socket.id, true);
        }
      }
    }, 300000);
  });

  // Function to handle user disconnection cleanup
  function handleUserDisconnection(socketId, removeCompletely = false) {
    if (connectedUsers[socketId]) {
      console.log(`${removeCompletely ? 'Removing' : 'Marking offline'} user ${connectedUsers[socketId].userName}`);
      
      if (removeCompletely) {
        delete connectedUsers[socketId];
        // Notify all remaining clients to remove marker
        io.emit("user-disconnected", socketId);
      } else {
        connectedUsers[socketId].isOnline = false;
        connectedUsers[socketId].lastUpdated = Date.now();
      }
      
      // Send updated user list
      io.emit("users-list-updated", Object.values(connectedUsers).map(user => ({
        socketId: user.socketId,
        userName: user.userName,
        colorName: user.colorName,
        color: user.color,
        deviceInfo: user.deviceInfo,
        isOnline: user.isOnline,
        lastUpdated: user.lastUpdated
      })));
    }
  }
});

// Cleanup completely inactive users every 10 minutes
setInterval(() => {
  const now = Date.now();
  const usersToRemove = [];

  Object.keys(connectedUsers).forEach(socketId => {
    const user = connectedUsers[socketId];
    const timeSinceUpdate = now - user.lastUpdated;

    // Remove users who haven't been active for 10 minutes
    if (!user.isOnline && timeSinceUpdate > 600000) { // 10 minutes
      usersToRemove.push(socketId);
    }
  });

  usersToRemove.forEach(socketId => {
    console.log(`Cleaning up completely inactive user: ${connectedUsers[socketId]?.userName}`);
    delete connectedUsers[socketId];
    io.emit("user-disconnected", socketId);
  });

  if (usersToRemove.length > 0) {
    console.log(`Cleaned up ${usersToRemove.length} completely inactive users`);
    // Send updated user list
    io.emit("users-list-updated", Object.values(connectedUsers).map(user => ({
      socketId: user.socketId,
      userName: user.userName,
      colorName: user.colorName,
      color: user.color,
      deviceInfo: user.deviceInfo,
      isOnline: user.isOnline,
      lastUpdated: user.lastUpdated
    })));
  }
}, 600000); // Every 10 minutes

// Routes
app.get("/", (req, res) => {
  res.render("index");
});

// API route to get current users
app.get("/api/users", (req, res) => {
  const users = Object.values(connectedUsers).map(user => ({
    userId: user.userId,
    userName: user.userName,
    deviceInfo: user.deviceInfo,
    colorName: user.colorName,
    color: user.color,
    isOnline: user.isOnline,
    lastUpdated: user.lastUpdated,
    hasLocation: user.latitude !== null && user.longitude !== null
  }));
  
  res.json({
    totalUsers: users.length,
    onlineUsers: users.filter(u => u.isOnline).length,
    users: users
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something went wrong!");
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📍 Real-time location tracking active`);
});