const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});

const wss = new WebSocketServer({ server });
const rooms = {};
const queue = [];

function newBoard() {
  const b = Array(8).fill(null).map(() => Array(8).fill(null));
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 === 1) b[r][c] = 'w';
  for (let r = 5; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 === 1) b[r][c] = 'b';
  return b;
}

function getValidMoves(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const isKing = piece.length === 2 && piece[1] === 'k';
  const dirs = [];
  if (piece[0] === 'w') dirs.push(-1); else dirs.push(1);
  if (isKing) dirs.push(...(dirs.includes(-1) ? [1] : [-1]));
  const moves = [];
  for (const dr of [...new Set(dirs)])
    for (const dc of [-1, 1]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
      if (!board[nr][nc]) moves.push({ to: [nr, nc], capture: false });
      else if (board[nr][nc][0] !== piece[0]) {
        const jr = nr + dr, jc = nc + dc;
        if (jr >= 0 && jr <= 7 && jc >= 0 && jc <= 7 && !board[jr][jc])
          moves.push({ to: [jr, jc], capture: true, over: [nr, nc] });
      }
    }
  return moves;
}

function applyMove(state, r, c, move) {
  const [tr, tc] = move.to;
  const piece = state.board[r][c];
  state.board[r][c] = null;
  if (move.capture) state.board[move.over[0]][move.over[1]] = null;
  let p = piece[0];
  if (piece[0] === 'w' && tr === 0) p = 'wk';
  if (piece[0] === 'b' && tr === 7) p = 'bk';
  state.board[tr][tc] = p;
}

function canMove(state, color) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (state.board[r][c] && state.board[r][c][0] === color && getValidMoves(state.board, r, c).length)
        return true;
  return false;
}

function send(ws, data) { if (ws.readyState === 1) ws.send(JSON.stringify(data)); }

function makeRoom(p1, p2) {
  const code = Math.random().toString(36).slice(2, 6).toUpperCase();
  const state = { board: newBoard(), turn: 'w', over: false, winner: null, moveHistory: [] };
  rooms[code] = { state, p1, p2 };
  p1.roomCode = code; p1.side = 'w';
  p2.roomCode = code; p2.side = 'b';
  send(p1, { type: 'joined', room: code, side: 'w', board: state.board, turn: 'w' });
  send(p2, { type: 'joined', room: code, side: 'b', board: state.board, turn: 'w' });
}

function processQueue() {
  while (queue.length >= 2) {
    makeRoom(queue.shift(), queue.shift());
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);

    if (msg.type === 'quickmatch') {
      queue.push(ws);
      send(ws, { type: 'queued', position: queue.length });
      processQueue();
    }

    if (msg.type === 'leavequeue') {
      const i = queue.indexOf(ws);
      if (i !== -1) queue.splice(i, 1);
      send(ws, { type: 'leftqueue' });
    }

    if (msg.type === 'create') {
      const code = Math.random().toString(36).slice(2, 6).toUpperCase();
      const state = { board: newBoard(), turn: 'w', over: false, winner: null, moveHistory: [] };
      rooms[code] = { state, p1: ws, p2: null };
      ws.roomCode = code; ws.side = 'w';
      send(ws, { type: 'joined', room: code, side: 'w', board: state.board, turn: 'w' });
    }

    if (msg.type === 'join') {
      const room = rooms[msg.room.toUpperCase()];
      if (!room || room.p2) return send(ws, { type: 'error', msg: 'Room full or not found' });
      room.p2 = ws;
      ws.roomCode = msg.room.toUpperCase(); ws.side = 'b';
      send(ws, { type: 'joined', room: ws.roomCode, side: 'b', board: room.state.board, turn: room.state.turn });
      send(room.p1, { type: 'opponent_joined' });
      send(ws, { type: 'opponent_joined' });
    }

    if (msg.type === 'move') {
      const room = rooms[ws.roomCode];
      if (!room || room.state.over) return;
      const { r, c, to } = msg;
      const color = ws.side[0];
      if (room.state.turn !== color) return;
      const piece = room.state.board[r][c];
      if (!piece || piece[0] !== color) return;
      const moves = getValidMoves(room.state.board, r, c);
      const move = moves.find(m => m.to[0] === to[0] && m.to[1] === to[1]);
      if (!move) return;
      room.state.moveHistory.push({ r, c, to, capture: move.capture, over: move.over || null });
      applyMove(room.state, r, c, move);
      room.state.turn = room.state.turn === 'w' ? 'b' : 'w';
      if (!canMove(room.state, room.state.turn)) {
        room.state.over = true;
        room.state.winner = color;
      }
      const payload = { type: 'state', board: room.state.board, turn: room.state.turn, over: room.state.over, winner: room.state.winner };
      send(room.p1, payload);
      if (room.p2) send(room.p2, payload);
    }

    // --- TEXT CHAT ---
    if (msg.type === 'chat') {
      const room = rooms[ws.roomCode];
      if (!room) return;
      const other = ws.side === 'w' ? room.p2 : room.p1;
      if (other) send(other, { type: 'chat', from: ws.side === 'w' ? 'White' : 'Black', text: msg.text });
    }

    if (msg.type === 'rematch') {
      const room = rooms[ws.roomCode];
      if (!room) return;
      room.state = { board: newBoard(), turn: 'w', over: false, winner: null, moveHistory: [] };
      const payload = { type: 'state', board: room.state.board, turn: 'w', over: false, winner: null };
      send(room.p1, payload);
      if (room.p2) send(room.p2, payload);
    }
  });

  ws.on('close', () => {
    const qi = queue.indexOf(ws);
    if (qi !== -1) queue.splice(qi, 1);
    const room = rooms[ws.roomCode];
    if (room) {
      const other = ws.side === 'w' ? room.p2 : room.p1;
      if (other) send(other, { type: 'opponent_left' });
      delete rooms[ws.roomCode];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Draughts on port ${PORT}`));   
