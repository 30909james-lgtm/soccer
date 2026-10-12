const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const FIELD_X = 44, FIELD_Z = 25, GOAL_Z = 5.2;
const MATCH_SECONDS = 180;

function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function freshRoom(roomCode, hostId) {
  return {
    code: roomCode, hostId, players: [], started: false, ended: false,
    blue: 0, red: 0, timeLeft: MATCH_SECONDS, lastTick: Date.now(),
    ball: { x: 0, z: 0, vx: 0, vz: 0 },
    scoreFlash: '', kickoff: 1.2
  };
}
function publicState(r) {
  return {
    code: r.code, started: r.started, ended: r.ended,
    blue: r.blue, red: r.red, timeLeft: Math.ceil(r.timeLeft),
    ball: { x: r.ball.x, z: r.ball.z, vx: r.ball.vx, vz: r.ball.vz },
    kickoff: r.kickoff,
    players: r.players.map(p => ({
      id: p.id, team: p.team, name: p.name, x: p.x, z: p.z,
      vx: p.vx, vz: p.vz, dirX: p.dirX, dirZ: p.dirZ,
      connected: p.connected
    })),
    scoreFlash: r.scoreFlash
  };
}
function resetKickoff(r) {
  r.ball = { x: 0, z: 0, vx: 0, vz: 0 };
  for (const p of r.players) {
    p.x = p.team === 'blue' ? -10 : 10;
    p.z = 0; p.vx = 0; p.vz = 0;
    p.dirX = p.team === 'blue' ? 1 : -1;
    p.dirZ = 0; p.cooldown = 0;
  }
  r.kickoff = 1.1;
}
function emitRoom(r) {
  io.to(r.code).emit('state', publicState(r));
}
function leaveRoom(socket) {
  const oldCode = socket.data.roomCode;
  if (!oldCode) return;
  const r = rooms.get(oldCode);
  socket.leave(oldCode);
  socket.data.roomCode = null;
  if (!r) return;
  r.players = r.players.filter(p => p.id !== socket.id);
  if (r.players.length === 0) {
    rooms.delete(oldCode);
  } else {
    // If the host leaves, close the room instead of leaving a broken match.
    if (r.hostId === socket.id) {
      io.to(oldCode).emit('roomClosed', '房主已離開，房間已關閉。');
      rooms.delete(oldCode);
    } else {
      r.started = false;
      r.ended = false;
      io.to(oldCode).emit('notice', '對手已離線，等待新玩家加入。');
      emitRoom(r);
    }
  }
}
function joinRoom(socket, r, name) {
  if (r.players.length >= 2) return { ok: false, error: '房間已滿，最多兩位玩家。' };
  const team = r.players.some(p => p.team === 'blue') ? 'red' : 'blue';
  const p = {
    id: socket.id, team, name: String(name || (team === 'blue' ? '藍隊玩家' : '紅隊玩家')).slice(0, 16),
    x: team === 'blue' ? -10 : 10, z: 0, vx: 0, vz: 0,
    dirX: team === 'blue' ? 1 : -1, dirZ: 0, cooldown: 0,
    input: { x: 0, z: 0, sprint: false }
  };
  r.players.push(p);
  socket.join(r.code);
  socket.data.roomCode = r.code;
  socket.emit('joined', { code: r.code, team, host: r.hostId === socket.id });
  if (r.players.length === 2) {
    r.started = true; r.ended = false; r.blue = 0; r.red = 0;
    r.timeLeft = MATCH_SECONDS; resetKickoff(r);
    io.to(r.code).emit('notice', '兩位玩家已到齊，比賽開始！');
  } else {
    socket.emit('notice', '房間已建立，請把房間代碼傳給朋友。');
  }
  emitRoom(r);
  return { ok: true };
}
io.on('connection', socket => {
  socket.on('createRoom', ({ name } = {}, cb = () => {}) => {
    leaveRoom(socket);
    let c = code();
    while (rooms.has(c)) c = code();
    const r = freshRoom(c, socket.id);
    rooms.set(c, r);
    const result = joinRoom(socket, r, name || '藍隊玩家');
    cb({ ...result, code: c });
  });
  socket.on('joinRoom', ({ code: raw, name } = {}, cb = () => {}) => {
    leaveRoom(socket);
    const c = String(raw || '').trim().toUpperCase();
    const r = rooms.get(c);
    if (!r) return cb({ ok: false, error: '找不到這個房間，請確認代碼或請朋友重新開房。' });
    const result = joinRoom(socket, r, name || '紅隊玩家');
    cb(result);
  });
  socket.on('input', input => {
    const r = rooms.get(socket.data.roomCode);
    if (!r || !r.started || r.ended) return;
    const p = r.players.find(p => p.id === socket.id);
    if (!p) return;
    const x = Number(input && input.x) || 0, z = Number(input && input.z) || 0;
    const n = Math.hypot(x, z) || 1;
    p.input = { x: Math.max(-1, Math.min(1, x / Math.max(1, n))), z: Math.max(-1, Math.min(1, z / Math.max(1, n))), sprint: !!(input && input.sprint) };
  });
  socket.on('action', action => {
    const r = rooms.get(socket.data.roomCode);
    if (!r || !r.started || r.ended || r.kickoff > 0) return;
    const p = r.players.find(p => p.id === socket.id);
    if (!p || p.cooldown > 0) return;
    const b = r.ball, d = Math.hypot(b.x - p.x, b.z - p.z);
    if (d > 2.3) return;
    let dx = p.dirX || (p.team === 'blue' ? 1 : -1), dz = p.dirZ || 0;
    if (action === 'shoot') {
      dx = (p.team === 'blue' ? FIELD_X : -FIELD_X) - b.x;
      dz = -b.z * 0.20 + p.dirZ * 5;
      const n = Math.hypot(dx, dz) || 1;
      dx /= n; dz /= n;
      b.vx = dx * 27 + p.vx * 0.3;
      b.vz = dz * 27 + p.vz * 0.3;
      p.cooldown = 0.45;
    } else if (action === 'pass') {
      const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
      b.vx = dx * 19; b.vz = dz * 19;
      p.cooldown = 0.25;
    }
    b.x = p.x + dx * 1.35; b.z = p.z + dz * 1.35;
  });
  socket.on('restart', () => {
    const r = rooms.get(socket.data.roomCode);
    if (!r || r.hostId !== socket.id || r.players.length < 2) return;
    r.blue = 0; r.red = 0; r.timeLeft = MATCH_SECONDS; r.ended = false; r.started = true;
    resetKickoff(r); io.to(r.code).emit('notice', '房主重新開始比賽。'); emitRoom(r);
  });
  socket.on('disconnect', () => leaveRoom(socket));
});

setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    const dt = Math.min(0.05, Math.max(0, (now - r.lastTick) / 1000));
    r.lastTick = now;
    if (r.started && !r.ended && r.players.length === 2) {
      r.timeLeft -= dt;
      r.kickoff = Math.max(0, r.kickoff - dt);
      for (const p of r.players) {
        p.cooldown = Math.max(0, p.cooldown - dt);
        const speed = p.input.sprint ? 13.2 : 9.3;
        const tx = p.input.x * speed, tz = p.input.z * speed;
        p.vx += (tx - p.vx) * Math.min(1, dt * 9);
        p.vz += (tz - p.vz) * Math.min(1, dt * 9);
        if (Math.hypot(p.input.x, p.input.z) < 0.05) {
          p.vx *= Math.max(0, 1 - dt * 4.5);
          p.vz *= Math.max(0, 1 - dt * 4.5);
        }
        p.x = Math.max(-FIELD_X + 1.3, Math.min(FIELD_X - 1.3, p.x + p.vx * dt));
        p.z = Math.max(-FIELD_Z + 1.3, Math.min(FIELD_Z - 1.3, p.z + p.vz * dt));
        if (Math.hypot(p.vx, p.vz) > 0.2) {
          const n = Math.hypot(p.vx, p.vz); p.dirX = p.vx / n; p.dirZ = p.vz / n;
        }
      }
      const b = r.ball;
      if (r.kickoff <= 0) {
        b.x += b.vx * dt; b.z += b.vz * dt;
        const drag = Math.pow(0.986, dt * 60);
        b.vx *= drag; b.vz *= drag;
        if (Math.abs(b.vx) < 0.08) b.vx = 0;
        if (Math.abs(b.vz) < 0.08) b.vz = 0;
        for (const p of r.players) {
          const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz);
          if (d < 1.35) {
            const n = d || 1;
            b.x = p.x + dx / n * 1.35; b.z = p.z + dz / n * 1.35;
            if (Math.hypot(b.vx, b.vz) < 8 && Math.hypot(p.vx, p.vz) > 1) {
              b.vx = p.vx * 0.95 + p.dirX * 2.2;
              b.vz = p.vz * 0.95 + p.dirZ * 2.2;
            }
          }
        }
        if (Math.abs(b.z) > FIELD_Z - 0.8) { b.z = Math.sign(b.z) * (FIELD_Z - 0.8); b.vz *= -0.65; }
        if (b.x > FIELD_X) {
          if (Math.abs(b.z) < GOAL_Z) { r.blue++; r.scoreFlash = '藍隊進球！'; resetKickoff(r); }
          else { b.x = FIELD_X; b.vx *= -0.65; }
        } else if (b.x < -FIELD_X) {
          if (Math.abs(b.z) < GOAL_Z) { r.red++; r.scoreFlash = '紅隊進球！'; resetKickoff(r); }
          else { b.x = -FIELD_X; b.vx *= -0.65; }
        }
      }
      if (r.timeLeft <= 0) { r.timeLeft = 0; r.ended = true; r.started = false; }
      emitRoom(r);
    }
  }
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Football Online listening on ${PORT}`));
