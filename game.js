const socket = io();
const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

let SIZE = 10;
let mandatoryCapture = true;
let board = [];
let turn = 'white';
let myColor = 'white';
let mode = null; // 'ai' | 'online'
let gameActive = false;
let selected = null;
let validMoves = [];
let mustContinueFrom = null;

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const rematchBtn = document.getElementById('btn-rematch');
const sizeSelect = document.getElementById('opt-size');
const mandatoryCheckbox = document.getElementById('opt-mandatory');

function initBoard() {
  boardEl.style.gridTemplateColumns = `repeat(${SIZE}, 1fr)`;
  const pieceRows = SIZE === 10 ? 4 : 3;
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if ((r + c) % 2 === 1) {
        if (r < pieceRows) board[r][c] = { color: 'black', king: false };
        else if (r >= SIZE - pieceRows) board[r][c] = { color: 'white', king: false };
      }
    }
  }
  turn = 'white';
  selected = null;
  validMoves = [];
  mustContinueFrom = null;
  gameActive = true;
  rematchBtn.style.display = 'inline-block';
  render();
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

// Generate all legal moves for a piece (supports flying kings & backward captures)
function getPieceMoves(r, c, b = board) {
  const p = b[r][c];
  if (!p) return [];
  const captures = [];
  const steps = [];

  if (!p.king) {
    // Men move forward 1 square, capture forward & backward
    const forwardDirs = p.color === 'white' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
    for (const [dr, dc] of forwardDirs) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && !b[nr][nc]) {
        steps.push({ from: [r, c], to: [nr, nc], captured: null });
      }
    }
    for (const [dr, dc] of DIRS) {
      const mr = r + dr, mc = c + dc;
      const lr = r + dr * 2, lc = c + dc * 2;
      if (inBounds(lr, lc) && b[mr][mc] && b[mr][mc].color !== p.color && !b[lr][lc]) {
        captures.push({ from: [r, c], to: [lr, lc], captured: [mr, mc] });
      }
    }
  } else {
    // Flying King: slides any distance, captures at distance & lands anywhere beyond
    for (const [dr, dc] of DIRS) {
      let nr = r + dr, nc = c + dc;
      let enemy = null;
      while (inBounds(nr, nc)) {
        const cell = b[nr][nc];
        if (!cell) {
          if (!enemy) {
            steps.push({ from: [r, c], to: [nr, nc], captured: null });
          } else {
            captures.push({ from: [r, c], to: [nr, nc], captured: enemy });
          }
        } else if (cell.color === p.color) {
          break;
        } else {
          if (enemy) break; // Cannot jump two pieces in one line
          enemy = [nr, nc];
        }
        nr += dr;
        nc += dc;
      }
    }
  }
  return (mandatoryCapture && captures.length > 0) ? captures : [...captures, ...steps];
}

function getAllMoves(color, b = board) {
  let allCaptures = [];
  let allSteps = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (b[r][c]?.color === color) {
        const moves = getPieceMoves(r, c, b);
        for (const m of moves) {
          if (m.captured) allCaptures.push(m);
          else allSteps.push(m);
        }
      }
    }
  }
  return (mandatoryCapture && allCaptures.length > 0) ? allCaptures : [...allCaptures, ...allSteps];
}

function applyMove(move, isRemote = false) {
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = board[fr][fc];
  board[tr][tc] = piece;
  board[fr][fc] = null;

  if (move.captured) {
    const [cr, cc] = move.captured;
    board[cr][cc] = null;
  }

  // Check multi-jump before promoting
  let canJumpAgain = false;
  if (move.captured) {
    const nextMoves = getPieceMoves(tr, tc).filter(m => m.captured);
    if (nextMoves.length > 0) {
      canJumpAgain = true;
      mustContinueFrom = [tr, tc];
      selected = [tr, tc];
      validMoves = nextMoves;
    }
  }

  if (!canJumpAgain) {
    // Promote to King if landing on back rank at end of turn
    if (piece.color === 'white' && tr === 0) piece.king = true;
    if (piece.color === 'black' && tr === SIZE - 1) piece.king = true;

    mustContinueFrom = null;
    selected = null;
    validMoves = [];
    turn = turn === 'white' ? 'black' : 'white';
  }

  if (mode === 'online' && !isRemote) {
    socket.emit('move', move);
  }

  render();
  checkGameOver();

  if (gameActive && mode === 'ai' && turn === 'black') {
    setTimeout(makeAIMove, 400);
  }
}

function makeAIMove() {
  if (!gameActive || turn !== 'black') return;
  const moves = mustContinueFrom
    ? getPieceMoves(mustContinueFrom[0], mustContinueFrom[1]).filter(m => m.captured)
    : getAllMoves('black');
  if (moves.length === 0) return checkGameOver();
  const choice = moves[Math.floor(Math.random() * moves.length)];
  applyMove(choice);
}

function checkGameOver() {
  const legal = getAllMoves(turn);
  if (legal.length === 0) {
    gameActive = false;
    const winner = turn === 'white' ? 'Black' : 'White';
    statusEl.innerHTML = `🏆 <b>${winner} wins!</b> Click Rematch to play again.`;
  } else if (gameActive) {
    const turnLabel = turn === myColor ? 'Your turn' : "Opponent's turn";
    statusEl.innerHTML = `${turnLabel} (<b>${turn.toUpperCase()}</b>)${mustContinueFrom ? ' — Continue capturing!' : ''}`;
  }
}

function handleSquareClick(r, c) {
  if (!gameActive || turn !== myColor) return;

  // Check if clicked square is a valid destination
  const chosenMove = validMoves.find(m => m.to[0] === r && m.to[1] === c);
  if (chosenMove) {
    applyMove(chosenMove);
    return;
  }

  // Otherwise select piece if allowed
  if (mustContinueFrom && (mustContinueFrom[0] !== r || mustContinueFrom[1] !== c)) return;
  if (board[r][c]?.color === myColor) {
    const allLegal = getAllMoves(myColor);
    const pieceLegal = allLegal.filter(m => m.from[0] === r && m.from[1] === c);
    if (pieceLegal.length > 0) {
      selected = [r, c];
      validMoves = pieceLegal;
      render();
    } else if (mandatoryCapture) {
      statusEl.innerHTML = '⚠️ Mandatory capture! Select a piece that can capture.';
    }
  }
}

function render() {
  boardEl.innerHTML = '';
  const rows = myColor === 'black' ? [...Array(SIZE).keys()].reverse() : [...Array(SIZE).keys()];
  const cols = myColor === 'black' ? [...Array(SIZE).keys()].reverse() : [...Array(SIZE).keys()];

  for (const r of rows) {
    for (const c of cols) {
      const sq = document.createElement('div');
      sq.className = `sq ${(r + c) % 2 === 1 ? 'dark' : 'light'}`;
      if (validMoves.some(m => m.to[0] === r && m.to[1] === c)) {
        sq.classList.add('highlight');
      }
      sq.onclick = () => handleSquareClick(r, c);

      const p = board[r][c];
      if (p) {
        const pieceEl = document.createElement('div');
        pieceEl.className = `piece ${p.color} ${p.king ? 'king' : ''}`;
        if (selected && selected[0] === r && selected[1] === c) {
          pieceEl.classList.add('selected');
        }
        sq.appendChild(pieceEl);
      }
      boardEl.appendChild(sq);
    }
  }
}

function addChat(sender, text) {
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = `<b>${sender}:</b> ${text.replace(/</g, '&lt;')}`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function readSelectedSettings() {
  SIZE = parseInt(sizeSelect.value, 10);
  mandatoryCapture = mandatoryCheckbox.checked;
  return { size: SIZE, mandatory: mandatoryCapture };
}

// Live preview board when changing size before a game starts
sizeSelect.onchange = () => {
  if (!gameActive) {
    readSelectedSettings();
    initBoard();
    gameActive = false;
    rematchBtn.style.display = 'none';
    statusEl.innerHTML = `Previewing <b>${SIZE}×${SIZE}</b> board. Click a mode to start!`;
  }
};

// Button Listeners
document.getElementById('btn-ai').onclick = () => {
  readSelectedSettings();
  mode = 'ai';
  myColor = 'white';
  initBoard();
  checkGameOver();
  addChat('System', `Started ${SIZE}×${SIZE} game vs AI (Mandatory Capture: ${mandatoryCapture ? 'ON' : 'OFF'}).`);
};

document.getElementById('btn-quick').onclick = () => socket.emit('quickMatch');

document.getElementById('btn-create').onclick = () => {
  const settings = readSelectedSettings();
  socket.emit('createRoom', settings);
};

document.getElementById('btn-join').onclick = () => {
  socket.emit('joinRoom', document.getElementById('room-input').value);
};

rematchBtn.onclick = () => {
  if (mode === 'ai') {
    initBoard();
    checkGameOver();
  } else {
    socket.emit('rematch');
  }
};

document.getElementById('btn-send').onclick = sendChat;
document.getElementById('chat-msg').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };

function sendChat() {
  const input = document.getElementById('chat-msg');
  if (!input.value.trim()) return;
  if (mode === 'online') socket.emit('chat', input.value);
  else addChat('You', input.value);
  input.value = '';
}

// Socket Events
socket.on('waiting', (d) => { statusEl.textContent = d.message; });
socket.on('roomCreated', (d) => {
  const rulesText = `${d.settings.size}×${d.settings.size}, Mandatory Capture: ${d.settings.mandatory ? 'ON' : 'OFF'}`;
  statusEl.innerHTML = `Room Created (<b>${d.roomCode}</b>) [${rulesText}] — Share code with your friend!`;
});
socket.on('errorMsg', (msg) => { statusEl.textContent = `❌ ${msg}`; });
socket.on('gameStart', (d) => {
  if (d.settings) {
    SIZE = d.settings.size;
    mandatoryCapture = d.settings.mandatory;
    sizeSelect.value = String(SIZE);
    mandatoryCheckbox.checked = mandatoryCapture;
  }
  mode = 'online';
  myColor = d.color;
  initBoard();
  checkGameOver();
