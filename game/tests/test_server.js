/* 網路整合測試：真實伺服器 + WebSocket 客戶端
   驗證：建房/加入、開局（AI 補位）、視圖推送、聊天路由、斷線 AI 代管、token 重連、整局完賽 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8799;
const URL = 'ws://127.0.0.1:' + PORT;
const deadline = Date.now() + 170000;

function assert(cond, msg) { if (!cond) throw new Error('斷言失敗：' + msg); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class Client {
  constructor(label) {
    this.label = label;
    this.ws = null;
    this.views = [];
    this.chats = [];
    this.joined = null;
    this.errors = [];
    this.autoRespond = true;
    this.lastActedStage = null;
    this.pressedNight = null;
    this.chatDelivered = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error('連線失敗'));
      this.ws.onmessage = (ev) => this.onMsg(JSON.parse(ev.data));
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  action(type, data) { this.send({ t: 'action', type, data: data || {} }); }
  get view() { return this.views[this.views.length - 1] || null; }

  onMsg(m) {
    if (m.t === 'joined') this.joined = m;
    else if (m.t === 'lobbyState') this.lobby = m;
    else if (m.t === 'view') { this.views.push(m.view); if (this.autoRespond) this.respond(m.view); }
    else if (m.t === 'chat') this.chats.push(m.msg);
    else if (m.t === 'chatHistory') this.chats.push(...m.msgs);
    else if (m.t === 'error') this.errors.push(m.message);
    else if (m.t === 'actionOk') this.chatDelivered = true;
  }

  respond(v) {
    // 夜間工作：整段按住
    if (v.stage && v.stage.id === 'night.action' && v.scene && v.scene.work && v.scene.work.canWork) {
      const key = 'work:' + v.day;
      if (this.pressedNight !== key) { this.pressedNight = key; this.action('workPress'); }
    }
    // 嘗試在任何可說話時機發一句（驗證聊天路由）
    if (!this.chatDelivered && !v.isNight && v.you && v.you.alive) {
      this.send({ t: 'action', type: 'chat', data: { text: '測試訊息：' + this.label }, reqId: 'chat1' });
    }
    const a = v.youAwait;
    if (!a) return;
    const stageKey = v.stage ? v.stage.id + ':' + v.stage.startedAt : null;
    if (this.lastActedStage === stageKey) return;
    this.lastActedStage = stageKey;
    const first = (arr) => arr && arr.length ? arr[0].seat : null;
    switch (a.id) {
      case 'guess': return this.action('guess', { target: first(a.candidates) });
      case 'lastwords': return this.action('done');
      case 'hunter.decide': return this.action('skip');
      case 'badge.transfer': return a.targets.length ? this.action('give', { target: first(a.targets) }) : this.action('tear');
      case 'exile.vote': return this.action('abstain');
      case 'famine.vote': return this.action('vote', { target: first(a.targets) });
      case 'election.signup': return this.action('run', { run: false });
      case 'election.speech': return this.action('done');
      case 'election.vote': return this.action('vote', { target: first(a.candidates) });
      case 'sheriff.direction': return this.action('direction', { dir: 'forward' });
      case 'day.speech': case 'day.speech.pk': return this.action('done');
      case 'build.vote': return this.action('abstain');
      case 'exile.idiot': return this.action('flip');
      case 'day.admirer': return this.action('choose', { target: first(a.targets) });
      case 'day.finaldest': return this.action('confirmKeep');
      case 'night.butterfly': return this.action('skip');
      case 'night.guardredo': return this.action('move', { loc: a.openLocs[0] });
      case 'night.wolfsave': case 'night.godsave': return this.action('skip');
      case 'night.postinfo':
        if (a.checkTargets) return this.action('check', { target: first(a.checkTargets) });
        return this.action('skip');
      case 'night.godattack': return this.action('skip');
      case 'night.warlock': return this.action('skip');
      default: return this.action('done');
    }
  }
}

async function main() {
  const serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js'), String(PORT)], {
    env: Object.assign({}, process.env, { WV_SPEED: '0.05' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOut = '';
  serverProc.stdout.on('data', (d) => { serverOut += d; });
  serverProc.stderr.on('data', (d) => { serverOut += d; });
  try {
    await sleep(1200);
    const A = new Client('A');
    const B = new Client('B');
    await A.connect();
    await B.connect();

    // 建房與加入
    A.send({ t: 'createRoom', name: '阿明' });
    await waitFor(() => A.joined, 'A 建房');
    const code = A.joined.code;
    B.send({ t: 'joinRoom', code, name: '小華' });
    await waitFor(() => B.joined, 'B 加入');

    // 房主設定：6 槽位、AI 補位、快速發言
    A.send({
      t: 'lobby.setSettings',
      settings: { totalSlots: 6, fillWithAI: true, speechMode: 'free', meetingSeconds: 20, speechSeconds: 10 },
    });
    await waitFor(() => A.lobby && A.lobby.settings.totalSlots === 6, '設定同步');
    A.send({ t: 'lobby.start' });
    await waitFor(() => A.view && B.view, '開局視圖');

    assert(A.view.you.role, 'A 有職業');
    assert(B.view.you.role, 'B 有職業');
    assert(A.view.players.length === 6, '六個角色槽位');
    assert(A.view.players.filter((p) => p.isAI).length === 4, 'AI 補足四席');
    assert(A.view.players.every((p) => !('role' in p)), '公開名單不含職業');

    // 聊天路由：兩人皆應收到彼此的會議訊息
    await waitFor(() => A.chats.some((c) => c.from && String(c.from).includes('小華')) ||
      B.chats.some((c) => c.from && String(c.from).includes('阿明')), '聊天送達', 40000);

    // 斷線 → AI 代管
    await waitFor(() => A.view && A.view.day >= 1, '遊戲推進');
    const bToken = B.joined.token;
    B.autoRespond = false;
    B.ws.close();
    await waitFor(() => {
      const v = A.view;
      if (!v) return false;
      const pb = v.players.find((p) => p.name === '小華');
      return pb && pb.aiTakeover === true;
    }, '斷線 AI 代管', 20000);

    // token 重連
    const B2 = new Client('B2');
    await B2.connect();
    B2.send({ t: 'joinRoom', code, token: bToken });
    await waitFor(() => B2.joined && B2.joined.resumed, '重連恢復');
    await waitFor(() => {
      const v = A.view;
      const pb = v.players.find((p) => p.name === '小華');
      return pb && pb.aiTakeover === false;
    }, '重連解除代管', 20000);
    await waitFor(() => B2.view, '重連後收到視圖');

    // 跑到終局
    await waitFor(() => (A.view && A.view.ended) || (B2.view && B2.view.ended), '整局完賽', 120000);
    const endView = A.view.ended ? A.view : B2.view;
    assert(endView.ending && endView.ending.winner, '有終局資料');
    assert(Array.isArray(endView.ending.results) && endView.ending.results.length === 6, '個人勝負表');

    console.log('server OK：建房/加入/開局/聊天/代管/重連/完賽（勝方 ' + endView.ending.winner.side + '）');
  } finally {
    serverProc.kill();
  }
}

function waitFor(cond, label, timeout) {
  const until = Math.min(Date.now() + (timeout || 30000), deadline);
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      try {
        if (cond()) { clearInterval(t); resolve(); }
        else if (Date.now() > until) { clearInterval(t); reject(new Error('等待逾時：' + label)); }
      } catch (e) { clearInterval(t); reject(e); }
    }, 100);
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
