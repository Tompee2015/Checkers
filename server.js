const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

let quickMatchQueue = null;
const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms[code] ? generateRoomCode() : code;
}

io.on('connection', (socket) => {
  // Quick Match (Defaults to 10x10, Mandatory Capture ON)
  socket.on('quickMatch', () => {
    leaveCurrentRoom(socket);
    if (quickMatchQueue && quickMatchQueue.id !== socket.id && quickMatchQueue.connected) {
      const opponent = quickMatchQueue;
      quickMatchQueue = null;
      const roomCode = generateRoomCode();
      setupRoom(roomCode, opponent, socket, { size: 10, mandatory: true });
    } else {
      quickMatchQueue = socket;
      socket.emit('waiting', { message: 'Searching for an opponent...' });
    }
  });

  // Create Private Room with Custom Rules
  socket.on('createRoom', (settings = { size: 10, mandatory: true }) => {
    leaveCurrentRoom(socket);
    const roomCode = generateRoomCode();
    rooms[roomCode] = { white: socket, black: null, rematchVotes: new Set(), settings };
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.emit('roomCreated', { roomCode, settings });
  });

  // Join Private Room
  socket.on('joinRoom', (code) => {
    const roomCode = (code || '').trim().toUpperCase();
    const room = rooms[roomCode];
    if (!room) {
      return socket.emit('errorMsg', 'Room not found. Check the code and try again.');
    }
    if (room.black) {
      return socket.emit('errorMsg', 'Room is already full.');
    }
    leaveCurrentRoom(socket);
    setupRoom(roomCode, room.white, socket, room.settings);
  });

  // Relay Move
  socket.on('move', (data) => {
    if (socket.roomCode) {
      socket.to(socket.roomCode).emit('opponentMove', data);
    }
  });

  // Relay Chat
  socket.on('chat', (msg) => {
    if (socket.roomCode && typeof msg === 'string' && msg.trim()) {
      io.to(socket.roomCode).emit('chat', {
        sender: socket.color || 'Player',
        text: msg.trim().slice(0, 200)
      });
    }
  });

  // Rematch (Keeps room's custom rules and swaps colors)
  socket.on('rematch', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.white || !room.black) return;
    room.rematchVotes.add(socket.id);
    socket.to(socket.roomCode).emit('chat', {
      sender: 'System',
      text: `${socket.color.toUpperCase()} wants a rematch!`
    });
    if (room.rematchVotes.size >= 2) {
      room.rematchVotes.clear();
      const oldWhite = room.white;
      room.white = room.black;
      room.black = oldWhite;
      room.white.color = 'white';
      room.black.color = 'black';
      room.white.emit('gameStart', { roomCode: socket.roomCode, color: 'white', settings: room.settings });
      room.black.emit('gameStart', { roomCode: socket.roomCode, color: 'black', settings: room.settings });
    }
  });

  socket.on('disconnect', () => {
    if (quickMatchQueue && quickMatchQueue.id === socket.id) {
      quickMatchQueue = null;
    }
    leaveCurrentRoom(socket);
  });
});

function setupRoom(roomCode, whiteSocket, blackSocket, settings = { size: 10, mandatory: true }) {
  rooms[roomCode] = { white: whiteSocket, black: blackSocket, rematchVotes: new Set(), settings };
  whiteSocket.join(roomCode);
  blackSocket.join(roomCode);
  whiteSocket.roomCode = roomCode;
  blackSocket.roomCode = roomCode;
  whiteSocket.color = 'white';
  blackSocket.color = 'black';

  whiteSocket.emit('gameStart', { roomCode, color: 'white', settings });
  blackSocket.emit('gameStart', { roomCode, color: 'black', settings });
}

function leaveCurrentRoom(socket) {
  const code = socket.roomCode;
  if (code && rooms[code]) {
    socket.to(code).emit('opponentLeft');
    delete rooms[code];
  }
  socket.roomCode = null;
  socket.color = null;
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Draughts server running on port ${PORT}`);
});
