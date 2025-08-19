const express = require("express");
const app = express();
const path = require("path");
const http = require("http");

const socketio = require("socket.io");

const server = http.createServer(app);
const io = socketio(server);

// Set view engine
app.set("view engine", "ejs");

// Set up static file serving - this was the issue
app.use(express.static(path.join(__dirname, "public")));

// Store all active users and their locations
const activeUsers = {};

// Socket.io connection
io.on("connection", function (socket) {
  console.log("New client connected:", socket.id);

  // Send all existing users' locations to the newly connected client
  socket.emit("all-users-locations", activeUsers);

  // Handle location updates from clients
  socket.on("send-location", (locationData) => {
    console.log("Received location from", socket.id, ":", locationData);

    // Store the user's location
    activeUsers[socket.id] = {
      id: socket.id,
      ...locationData,
      lastUpdated: Date.now(),
    };

    // Broadcast location to all clients (including sender)
    io.emit("receive-location", {
      id: socket.id,
      ...locationData,
    });
  });

  // Handle window/tab close event (beforeunload)
  socket.on("user-leaving", () => {
    console.log("User explicitly left:", socket.id);

    // Remove user from active users
    delete activeUsers[socket.id];

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

// Start server
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
