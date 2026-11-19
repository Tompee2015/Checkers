const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

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
  // Quick Match
  socket.on('quickMatch', () => {
    leaveCurrentRoom(socket);
    if (quickMatchQueue && quickMatchQueue.id !== socket.id && quickMatchQueue.connected) {
      const opponent = quickMatchQueue;
      quickMatchQueue = null;
      const roomCode = generateRoomCode();
      setupRoom(roomCode, opponent, socket);
    } else {
      quickMatchQueue = socket;
      socket.emit('waiting', { message: 'Searching for an opponent...' });
    }
  });

  // Create Private Room
  socket.on('createRoom', () => {
    leaveCurrentRoom(socket);
    const roomCode = generateRoomCode();
    rooms[roomCode] = { white: socket, black: null, rematchVotes: new Set() };
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.emit('roomCreated', { roomCode });
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
    setupRoom(roomCode, room.white, socket);
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

  // Rematch
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
      // Swap colors on rematch
      const oldWhite = room.white;
      room.white = room.black;
      room.black = oldWhite;
      room.white.color = 'white';
      room.black.color = 'black';
      room.white.emit('gameStart', { roomCode: socket.roomCode, color: 'white' });
      room.black.emit('gameStart', { roomCode: socket.roomCode, color: 'black' });
    }
  });

  socket.on('disconnect', () => {
    if (quickMatchQueue && quickMatchQueue.id === socket.id) {
      quickMatchQueue = null;
    }
    leaveCurrentRoom(socket);
  });
});

function setupRoom(roomCode, whiteSocket, blackSocket) {
  rooms[roomCode] = { white: whiteSocket, black: blackSocket, rematchVotes: new Set() };
  whiteSocket.join(roomCode);
  blackSocket.join(roomCode);
  whiteSocket.roomCode = roomCode;
  blackSocket.roomCode = roomCode;
  whiteSocket.color = 'white';
  blackSocket.color = 'black';

  whiteSocket.emit('gameStart', { roomCode, color: 'white' });
  blackSocket.emit('gameStart', { roomCode, color: 'black' });
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
  console.log(`10x10 Draughts server running on port ${PORT}`);
});
