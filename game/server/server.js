/* 《人狼村》權威伺服器
   - HTTP：提供 client/ 與 core/ 靜態檔案
   - WebSocket：房間、遊戲輸入、個人化視圖推送
   - 斷線 AI 代管與重連（規則 3.3）
   用法：node server/server.js [port]，預設 8787 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// ---- 載入規則引擎與 AI ----
globalThis.WV = globalThis.WV || {};
const ROOT = path.join(__dirname, '..');
for (const f of ['core/rng.js', 'core/data.js', 'core/data_text.js', 'core/data_guide.js',
  'core/model.js', 'core/engine.js', 'core/deaths.js', 'core/phases_day.js',
  'core/phases_night.js', 'core/views.js', 'ai/ai.js']) {
  require(path.join(ROOT, f));
}
const WV = globalThis.WV;

const PORT = Number(process.argv[2] || process.env.PORT || 8787);

// ================= 靜態檔案 =================
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg',
};
const STATIC_ROOTS = { '/client/': 'client', '/core/': 'core' };

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '/index.html') urlPath = '/client/index.html';
  let fileRel = null;
  for (const [prefix, dir] of Object.entries(STATIC_ROOTS)) {
    if (urlPath.startsWith(prefix)) { fileRel = path.join(dir, urlPath.slice(prefix.length)); break; }
  }
  if (!fileRel) { res.writeHead(404); res.end('not found'); return; }
  const abs = path.normalize(path.join(ROOT, fileRel));
  if (!abs.startsWith(path.normalize(ROOT + path.sep))) { res.writeHead(403); res.end(); return; }
  fs.readFile(abs, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(serveStatic);

// ================= 房間 =================
const rooms = new Map();
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const AI_NAMES = ['杉', '鐵', '麥', '燈', '井', '霧', '岩', '燕', '茅', '橡', '狐', '鈴', '芒', '柳', '樺'];

function newCode() {
  for (; ;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}
function newToken() { return crypto.randomBytes(12).toString('hex'); }

function lanAddresses() {
  const out = [];
  for (const [, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

class Room {
  constructor(code, hostName) {
    this.code = code;
    this.status = 'lobby';
    this.members = []; // {name, token, ws|null, connected, isHost, seat|null}
    this.settings = Object.assign({}, WV.DEFAULT_SETTINGS, { totalSlots: 12 });
    this.engine = null;
    this.ai = null;
    this.timer = null;
    this.lastRev = -1;
    this.inbox = new Map(); // seat -> [chat msgs]
    this.createdAt = Date.now();
    this.addMember(hostName, true);
  }

  addMember(name, isHost) {
    const m = { name, token: newToken(), ws: null, connected: false, isHost: !!isHost, seat: null };
    this.members.push(m);
    return m;
  }
  memberByToken(token) { return this.members.find((m) => m.token === token); }
  humans() { return this.members; }

  broadcastLobby() {
    const state = {
      t: 'lobbyState',
      code: this.code,
      status: this.status,
      settings: this.settings,
      lan: lanAddresses().map((ip) => 'http://' + ip + ':' + PORT),
      port: PORT,
      members: this.members.map((m) => ({ name: m.name, connected: m.connected, isHost: m.isHost })),
      boards: WV.BOARDS.map((b) => ({ id: b.id, name: b.name, size: b.size })),
    };
    for (const m of this.members) this.sendTo(m, state);
  }
  sendTo(member, obj) {
    if (member.ws && member.ws.readyState === 1) {
      try { member.ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
    }
  }
  sendToSeat(seat, obj) {
    const m = this.members.find((x) => x.seat === seat);
    if (m) this.sendTo(m, obj);
  }

  // ---- 開局 ----
  start() {
    const humans = this.members;
    const slots = Math.max(WV.MIN_PLAYERS, Math.min(WV.MAX_PLAYERS, this.settings.totalSlots || 12));
    if (humans.length > slots) throw new Error('真人數超過角色槽位');
    if (humans.length < slots && !this.settings.fillWithAI) throw new Error('人數不足且未開啟 AI 補位');
    const players = [];
    humans.forEach((m, i) => { m.seat = i + 1; players.push({ name: m.name, isAI: false }); });
    for (let i = humans.length; i < slots; i++) {
      players.push({ name: 'AI·' + (AI_NAMES[i % AI_NAMES.length]) + (i >= AI_NAMES.length ? i : ''), isAI: true });
    }
    const settings = Object.assign({}, this.settings);
    delete settings.totalSlots;
    if (settings.boardId === 'auto' || (settings.boardId !== 'custom' && slots !== 12)) {
      settings.boardId = 'custom';
      settings.customRoles = autoRoles(slots);
    }
    const seed = crypto.randomInt(2 ** 31);
    const speed = Number(process.env.WV_SPEED || 1); // 測試用時間倍率
    this.engine = new WV.Game({ players, settings, seed, speed });
    this.ai = new WV.AIManager(this.engine);
    this.status = 'playing';

    this.engine.onEvent((evt) => this.onEngineEvent(evt));
    this.engine.start(Date.now());
    for (const m of this.members) {
      const p = WV.H.p(this.engine.g, m.seat);
      if (p) p.connected = m.connected;
    }
    this.timer = setInterval(() => this.tick(), 250);
    this.pushViews(true);
  }

  onEngineEvent(evt) {
    if (evt.t === 'chat') {
      const seats = WV.Views.receiversFor(this.engine, evt.msg.channel);
      for (const seat of seats) {
        this.pushInbox(seat, evt.msg);
        this.sendToSeat(seat, { t: 'chat', msg: evt.msg });
      }
    } else if (evt.t === 'notify') {
      this.sendToSeat(evt.seat, { t: 'notify', entry: evt.entry });
    } else if (evt.t === 'end') {
      this.status = 'ended';
    }
  }
  pushInbox(seat, msg) {
    if (!this.inbox.has(seat)) this.inbox.set(seat, []);
    const list = this.inbox.get(seat);
    list.push(msg);
    if (list.length > 300) list.splice(0, 60);
  }

  tick() {
    if (!this.engine) return;
    const now = Date.now();
    try {
      this.engine.tick(now);
      this.ai.tick(now);
    } catch (e) {
      console.error('[room ' + this.code + '] tick 錯誤：', e);
    }
    this.pushViews(false);
    if (this.engine.ended && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.pushViews(true);
    }
  }

  pushViews(force) {
    if (!this.engine) return;
    if (!force && this.engine.rev === this.lastRev) return;
    this.lastRev = this.engine.rev;
    for (const m of this.members) {
      if (m.seat == null || !m.connected) continue;
      try {
        this.sendTo(m, { t: 'view', view: WV.Views.forSeat(this.engine, m.seat) });
      } catch (e) {
        console.error('view 錯誤 seat=' + m.seat, e);
      }
    }
  }

  handleAction(member, msg) {
    if (!this.engine || member.seat == null) return { ok: false, error: '不在遊戲中' };
    this.engine.tick(Date.now()); // 先同步時間再處理輸入（工作長按精度）
    const r = this.engine.submit(member.seat, msg.type, msg.data || {});
    this.pushViews(false);
    return r;
  }

  onDisconnect(member) {
    member.connected = false;
    member.ws = null;
    if (this.status === 'playing' && this.engine && member.seat != null) {
      const p = WV.H.p(this.engine.g, member.seat);
      if (p && !p.isAI) {
        p.connected = false;
        p.aiTakeover = true; // 斷線 AI 暫代
        this.engine.touch();
      }
    }
    if (this.status === 'lobby') {
      // 大廳斷線：保留席位 60 秒後移除
      setTimeout(() => {
        if (!member.connected && this.status === 'lobby') {
          this.members = this.members.filter((x) => x !== member);
          if (member.isHost && this.members.length) this.members[0].isHost = true;
          if (this.members.length === 0) rooms.delete(this.code);
          else this.broadcastLobby();
        }
      }, 60000);
      this.broadcastLobby();
    }
  }

  onReconnect(member, ws) {
    member.ws = ws;
    member.connected = true;
    if (this.status !== 'lobby' && this.engine && member.seat != null) {
      const p = WV.H.p(this.engine.g, member.seat);
      if (p) { p.connected = true; p.aiTakeover = false; this.engine.touch(); }
      // 回放聊天
      const msgs = this.inbox.get(member.seat) || [];
      this.sendTo(member, { t: 'chatHistory', msgs: msgs.slice(-150) });
      this.sendTo(member, { t: 'view', view: WV.Views.forSeat(this.engine, member.seat) });
    } else {
      this.broadcastLobby();
    }
  }
}

function autoRoles(n) {
  const wolves = Math.max(1, Math.floor(n / 3));
  const roles = [];
  for (let i = 0; i < wolves; i++) roles.push('wolf');
  roles.push('seer', 'witch');
  if (n >= 8) roles.push('hunter');
  if (n >= 10) roles.push('guard');
  if (n >= 12) roles.push('idiot');
  if (n >= 14) roles.push('stalker');
  while (roles.length < n) roles.push('villager');
  return roles;
}

// ================= WebSocket =================
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let room = null;
  let member = null;

  const send = (obj) => { try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ } };
  const fail = (message) => send({ t: 'error', message });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return fail('格式錯誤'); }
    try {
      switch (msg.t) {
        case 'createRoom': {
          const name = String(msg.name || '').trim().slice(0, 12);
          if (!name) return fail('請輸入名字');
          const code = newCode();
          room = new Room(code, name);
          rooms.set(code, room);
          member = room.members[0];
          room.onReconnect(member, ws);
          send({ t: 'joined', code, token: member.token, isHost: true, name });
          room.broadcastLobby();
          break;
        }
        case 'joinRoom': {
          const code = String(msg.code || '').trim().toUpperCase();
          const r = rooms.get(code);
          if (!r) return fail('找不到房間 ' + code);
          if (msg.token) {
            const m = r.memberByToken(msg.token);
            if (m) {
              room = r; member = m;
              room.onReconnect(member, ws);
              send({ t: 'joined', code, token: m.token, isHost: m.isHost, name: m.name, resumed: true });
              return;
            }
          }
          const name = String(msg.name || '').trim().slice(0, 12);
          if (!name) return fail('請輸入名字');
          if (r.status !== 'lobby') {
            // 途中加入：僅允許重連（用 token）
            return fail('遊戲已開始，若你是原玩家請用原本瀏覽器重連');
          }
          if (r.members.some((m) => m.name === name)) return fail('名字已被使用');
          const slots = r.settings.totalSlots || 12;
          if (r.members.length >= Math.min(slots, WV.MAX_PLAYERS)) return fail('房間已滿');
          room = r;
          member = r.addMember(name, false);
          room.onReconnect(member, ws);
          send({ t: 'joined', code, token: member.token, isHost: false, name });
          room.broadcastLobby();
          break;
        }
        case 'lobby.setSettings': {
          if (!room || !member || !member.isHost) return fail('只有房主能調整設定');
          if (room.status !== 'lobby') return fail('遊戲已開始');
          const s = msg.settings || {};
          const allow = ['totalSlots', 'boardId', 'wolfWinMode', 'speechMode', 'speechSeconds', 'meetingSeconds',
            'initialFood', 'witchSelfSave', 'resourceInfoMode', 'reshuffleAppearance', 'fillWithAI', 'aiSpeechSeconds'];
          for (const k of allow) if (k in s) room.settings[k] = s[k];
          room.settings.totalSlots = Math.max(WV.MIN_PLAYERS, Math.min(WV.MAX_PLAYERS, Number(room.settings.totalSlots) || 12));
          if (room.settings.initialFood != null && room.settings.initialFood !== '') {
            room.settings.initialFood = Math.max(room.settings.totalSlots, Number(room.settings.initialFood) || 0);
          } else room.settings.initialFood = null;
          room.broadcastLobby();
          break;
        }
        case 'lobby.kick': {
          if (!room || !member || !member.isHost || room.status !== 'lobby') return fail('無法踢人');
          const idx = room.members.findIndex((m) => m.name === msg.name && !m.isHost);
          if (idx >= 0) {
            const kicked = room.members[idx];
            room.members.splice(idx, 1);
            if (kicked.ws) { kicked.ws.close(); }
            room.broadcastLobby();
          }
          break;
        }
        case 'lobby.start': {
          if (!room || !member || !member.isHost) return fail('只有房主能開始');
          if (room.status !== 'lobby') return fail('已開始');
          try { room.start(); } catch (e) { return fail(e.message); }
          break;
        }
        case 'action': {
          if (!room || !member) return fail('未加入房間');
          const r = room.handleAction(member, msg);
          if (!r.ok) send({ t: 'actionError', message: r.error, reqId: msg.reqId });
          else if (msg.reqId) send({ t: 'actionOk', reqId: msg.reqId });
          break;
        }
        case 'ping': send({ t: 'pong' }); break;
        default: break;
      }
    } catch (e) {
      console.error('訊息處理錯誤：', e);
      fail('伺服器內部錯誤');
    }
  });

  ws.on('close', () => {
    if (room && member) room.onDisconnect(member);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  《人狼村》伺服器已啟動');
  console.log('  本機：  http://localhost:' + PORT);
  for (const ip of lanAddresses()) console.log('  區網：  http://' + ip + ':' + PORT + '  （給朋友用這個）');
  console.log('');
});
