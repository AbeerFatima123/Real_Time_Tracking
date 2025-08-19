const express = require("express");
const app = express();
const path = require("path");
const http = require("http");
const helmet = require("helmet"); // Add helmet for security
const { v4: uuidv4 } = require('uuid'); // For generating unique session IDs

const socketio = require("socket.io");

const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Use helmet for basic security headers with relaxed CSP for external scripts
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

// Store all active users and their locations
// Structure: { socketId: { sessionId, latitude, longitude, lastUpdated, color } }
const activeUsers = {};

// Store session to socket mapping for multi-tab support
// Structure: { sessionId: [socketId1, socketId2, ...] }
const sessionSockets = {};

// Generate random colors for users
const colors = ['red', 'blue', 'green', 'purple', 'orange', 'darkred', 'lightred', 'beige', 'darkblue', 'darkgreen', 'cadetblue', 'darkpurple', 'white', 'pink', 'lightblue', 'lightgreen', 'gray', 'black', 'lightgray'];

function getRandomColor() {
  return colors[Math.floor(Math.random() * colors.length)];
}

// Socket.io connection
io.on("connection", function (socket) {
  console.log("New client connected:", socket.id);

  // Handle session registration
  socket.on("register-session", (data) => {
    let sessionId = data.sessionId;
    
    // If no session ID provided, generate a new one
    if (!sessionId) {
      sessionId = uuidv4();
    }

    // Store session info for this socket
    socket.sessionId = sessionId;
    
    // Add socket to session mapping
    if (!sessionSockets[sessionId]) {
      sessionSockets[sessionId] = [];
    }
    sessionSockets[sessionId].push(socket.id);

    // Send session ID back to client
    socket.emit("session-registered", { sessionId });

    console.log(`Socket ${socket.id} registered with session ${sessionId}`);

    // Send all existing users' locations to the newly connected client
    socket.emit("all-users-locations", activeUsers);
  });

  // Handle location updates from clients
  socket.on("send-location", (locationData) => {
    console.log("Received location from", socket.id, ":", locationData);

    // Get or assign a color for this session
    let userColor = getRandomColor();
    if (socket.sessionId && activeUsers[socket.id]) {
      userColor = activeUsers[socket.id].color;
    }

    // Store the user's location
    activeUsers[socket.id] = {
      id: socket.id,
      sessionId: socket.sessionId,
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      lastUpdated: Date.now(),
      color: userColor
    };

    // Broadcast location to all clients (including sender)
    io.emit("receive-location", {
      id: socket.id,
      sessionId: socket.sessionId,
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      color: userColor
    });
  });

  // Handle window/tab close event (beforeunload)
  socket.on("user-leaving", () => {
    console.log("User explicitly left:", socket.id);

    // Remove user from active users
    delete activeUsers[socket.id];

    // Remove socket from session mapping
    if (socket.sessionId && sessionSockets[socket.sessionId]) {
      sessionSockets[socket.sessionId] = sessionSockets[socket.sessionId].filter(id => id !== socket.id);
      
      // If no more sockets for this session, clean up
      if (sessionSockets[socket.sessionId].length === 0) {
        delete sessionSockets[socket.sessionId];
      }
    }

    // Notify all clients that a user has left
    io.emit("user-disconnected", socket.id);
  });

  // Handle disconnection (might be temporary)
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    // We don't immediately remove the user or notify others
    // This allows the marker to persist during temporary disconnections

    // Set a timeout to remove the user if they don't reconnect within 30 seconds
    setTimeout(() => {
      // Check if the user is still in our active users list
      if (activeUsers[socket.id]) {
        // If it's been more than 30 seconds since their last update
        const timeSinceUpdate = Date.now() - activeUsers[socket.id].lastUpdated;
        if (timeSinceUpdate > 30000) {
          console.log("User considered gone after timeout:", socket.id);

          // Remove user from active users
          delete activeUsers[socket.id];

          // Remove socket from session mapping
          if (socket.sessionId && sessionSockets[socket.sessionId]) {
            sessionSockets[socket.sessionId] = sessionSockets[socket.sessionId].filter(id => id !== socket.id);
            
            // If no more sockets for this session, clean up
            if (sessionSockets[socket.sessionId].length === 0) {
              delete sessionSockets[socket.sessionId];
            }
          }

          // Notify all clients that a user has left
          io.emit("user-disconnected", socket.id);
        }
      }
    }, 30000);
  });
});

// Routes
app.get("/", function (req, res) {
  res.render("index");
});

// Basic error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something went wrong!");
});

// Start server on dynamic port for production
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

