/* 應用外殼：首頁 → 大廳 → 遊戲 */
'use strict';
window.App = (function () {
  const WV = window.WV;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const st = {
    mode: 'home',        // home | lobby | game
    name: '',
    code: null,
    token: null,
    isHost: false,
    lobby: null,
    gameInited: false,
  };

  function toast(msg, isErr) {
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  const app = () => document.getElementById('app');

  // ---------- 首頁 ----------
  function renderHome() {
    st.mode = 'home';
    document.body.className = 'theme-night';
    const last = window.Net.loadSession();
    app().innerHTML =
      '<div id="home">' +
      '<div class="title">' +
      '<div class="flame">' + window.icon('ui_fire') + '</div>' +
      '<h1>人狼村</h1>' +
      '<div class="sub">狼人殺 × 生存資源 × 匿名長夜</div>' +
      '</div>' +
      '<div class="cards">' +
      '<div class="panel">' +
      '<h3>建立房間</h3>' +
      '<div class="field"><label>你的名字</label><input id="name-create" maxlength="12" placeholder="村民甲"></div>' +
      '<button class="btn primary" id="btn-create">建立房間</button>' +
      '</div>' +
      '<div class="panel">' +
      '<h3>加入房間</h3>' +
      '<div class="field"><label>你的名字</label><input id="name-join" maxlength="12" placeholder="村民乙"></div>' +
      '<div class="field"><label>房間代碼</label><input id="code-join" maxlength="4" placeholder="ABCD" style="text-transform:uppercase"></div>' +
      '<button class="btn primary" id="btn-join">加入房間</button>' +
      '</div>' +
      '</div>' +
      (last && last.code ? '<button class="btn" id="btn-resume">回到上一場（房間 ' + esc(last.code) + '）</button>' : '') +
      '<div class="links">' +
      '<button class="btn ghost" id="btn-guide2">村落圖鑑</button>' +
      '</div>' +
      '<div class="intro flavor">' + esc(WV.TEXT.intro.split('\n\n')[0]) + '</div>' +
      '</div>';
    document.getElementById('btn-create').onclick = () => {
      const name = document.getElementById('name-create').value.trim();
      if (!name) return toast('請輸入名字', true);
      st.name = name;
      window.Net.send({ t: 'createRoom', name });
    };
    document.getElementById('btn-join').onclick = () => {
      const name = document.getElementById('name-join').value.trim();
      const code = document.getElementById('code-join').value.trim().toUpperCase();
      if (!name || !code) return toast('請輸入名字與房間代碼', true);
      st.name = name;
      window.Net.send({ t: 'joinRoom', code, name });
    };
    const resume = document.getElementById('btn-resume');
    if (resume) resume.onclick = () => {
      window.Net.send({ t: 'joinRoom', code: last.code, token: last.token });
    };
    document.getElementById('btn-guide2').onclick = () => window.Guide.show('roles');
  }

  // ---------- 大廳 ----------
  function renderLobby() {
    st.mode = 'lobby';
    st.gameInited = false;
    document.body.className = 'theme-night';
    const L = st.lobby;
    if (!L) return;
    const s = L.settings;
    const isHost = st.isHost;
    const boardOpts =
      '<option value="auto"' + (s.boardId === 'auto' || (s.boardId === 'custom') ? ' selected' : '') + '>自動配置（依人數）</option>' +
      L.boards.map((b) => '<option value="' + b.id + '"' + (s.boardId === b.id ? ' selected' : '') +
        (s.totalSlots !== 12 ? ' disabled' : '') + '>' + esc(b.name) + '（12人）</option>').join('');
    const dis = isHost ? '' : ' disabled';
    app().innerHTML =
      '<div id="lobby">' +
      '<div class="roomcode"><div style="color:var(--ink-soft);letter-spacing:.3em;font-size:13px">房間代碼</div>' +
      '<div class="code">' + esc(L.code) + '</div></div>' +
      '<div class="lan">朋友連線方式：同一網路開瀏覽器進入 ' +
      L.lan.map((u) => '<b style="color:var(--accent)">' + esc(u) + '</b>').join(' 或 ') +
      '，輸入名字與代碼加入．跨網路可用 Tailscale／ngrok 等通道（見 README）</div>' +
      '<div class="cols">' +
      '<div class="panel members"><div class="paneltitle">玩家（' + L.members.length + '／' + s.totalSlots + '，不足由 AI 補位）</div>' +
      L.members.map((m) =>
        '<div class="m"><span class="dot ' + (m.connected ? '' : 'off') + '"></span>' + esc(m.name) +
        (m.isHost ? ' <span class="tag host">房主</span>' : '') +
        (isHost && !m.isHost ? ' <button class="btn small ghost" data-kick="' + esc(m.name) + '">請離</button>' : '') +
        '</div>').join('') +
      '</div>' +
      '<div class="panel settings">' +
      '<div class="field"><label>角色槽位（6–15）</label><input type="number" min="6" max="15" id="s-slots" value="' + s.totalSlots + '"' + dis + '></div>' +
      '<div class="field"><label>板子</label><select id="s-board"' + dis + '>' + boardOpts + '</select></div>' +
      '<div class="field"><label>狼人勝利</label><select id="s-mode"' + dis + '><option value="side"' + (s.wolfWinMode === 'side' ? ' selected' : '') + '>屠邊</option><option value="city"' + (s.wolfWinMode === 'city' ? ' selected' : '') + '>屠城</option></select></div>' +
      '<div class="field"><label>發言方式</label><select id="s-speech"' + dis + '><option value="turns"' + (s.speechMode === 'turns' ? ' selected' : '') + '>輪流發言</option><option value="free"' + (s.speechMode === 'free' ? ' selected' : '') + '>自由發言</option></select></div>' +
      '<div class="field"><label>每人發言秒數</label><input type="number" min="15" max="180" id="s-speechsec" value="' + s.speechSeconds + '"' + dis + '></div>' +
      '<div class="field"><label>自由討論秒數</label><input type="number" min="30" max="600" id="s-meetingsec" value="' + s.meetingSeconds + '"' + dis + '></div>' +
      '<div class="field"><label>初始食物（空＝人數下限）</label><input type="number" min="0" id="s-food" value="' + (s.initialFood == null ? '' : s.initialFood) + '" placeholder="自動"' + dis + '></div>' +
      '<div class="field"><label>資源公開程度</label><select id="s-res"' + dis + '>' +
      '<option value="1"' + (s.resourceInfoMode === 1 ? ' selected' : '') + '>只顯示庫存</option>' +
      '<option value="2"' + (s.resourceInfoMode === 2 ? ' selected' : '') + '>庫存＋總變動（標準）</option>' +
      '<option value="3"' + (s.resourceInfoMode === 3 ? ' selected' : '') + '>庫存＋各地點變動</option></select></div>' +
      '<div class="field"><label>女巫自救</label><select id="s-selfsave"' + dis + '><option value="1"' + (s.witchSelfSave ? ' selected' : '') + '>允許</option><option value="0"' + (!s.witchSelfSave ? ' selected' : '') + '>禁止</option></select></div>' +
      '<div class="field"><label>匿名外觀</label><select id="s-reshuffle"' + dis + '><option value="0"' + (!s.reshuffleAppearance ? ' selected' : '') + '>整局固定</option><option value="1"' + (s.reshuffleAppearance ? ' selected' : '') + '>每晚重抽</option></select></div>' +
      '<div class="wide" style="font-size:12px;color:var(--ink-soft)">職業配置開局後全房公開；狼人互知隊友．完整規則見圖鑑</div>' +
      '</div>' +
      '</div>' +
      '<div class="actions">' +
      (isHost ? '<button class="btn primary" id="btn-start" style="font-size:18px;padding:12px 42px">開始遊戲</button>' : '<div class="mutehint">等待房主開始……</div>') +
      '<button class="btn ghost" id="btn-leave">離開</button>' +
      '</div>' +
      '</div>';
    if (isHost) {
      const push = () => {
        window.Net.send({
          t: 'lobby.setSettings', settings: {
            totalSlots: Number(document.getElementById('s-slots').value) || 12,
            boardId: document.getElementById('s-board').value,
            wolfWinMode: document.getElementById('s-mode').value,
            speechMode: document.getElementById('s-speech').value,
            speechSeconds: Number(document.getElementById('s-speechsec').value) || 60,
            meetingSeconds: Number(document.getElementById('s-meetingsec').value) || 180,
            initialFood: document.getElementById('s-food').value === '' ? null : Number(document.getElementById('s-food').value),
            resourceInfoMode: Number(document.getElementById('s-res').value),
            witchSelfSave: document.getElementById('s-selfsave').value === '1',
            reshuffleAppearance: document.getElementById('s-reshuffle').value === '1',
          },
        });
      };
      ['s-slots', 's-board', 's-mode', 's-speech', 's-speechsec', 's-meetingsec', 's-food', 's-res', 's-selfsave', 's-reshuffle']
        .forEach((id) => { document.getElementById(id).onchange = push; });
      document.getElementById('btn-start').onclick = () => window.Net.send({ t: 'lobby.start' });
      document.querySelectorAll('[data-kick]').forEach((b) => {
        b.onclick = () => window.Net.send({ t: 'lobby.kick', name: b.dataset.kick });
      });
    }
    document.getElementById('btn-leave').onclick = () => { window.Net.clearSession(); location.reload(); };
  }

  // ---------- 事件接線 ----------
  function wire() {
    const N = window.Net;
    N.on('joined', (m) => {
      st.code = m.code; st.token = m.token; st.isHost = m.isHost; st.name = m.name || st.name;
      N.saveSession({ code: m.code, token: m.token, name: st.name });
      if (!m.resumed) toast('已加入房間 ' + m.code);
    });
    N.on('lobbyState', (m) => {
      st.lobby = m;
      st.isHost = (m.members.find((x) => x.name === st.name) || {}).isHost || st.isHost;
      if (m.status === 'lobby') renderLobby();
    });
    N.on('view', (m) => {
      if (st.mode !== 'game') {
        st.mode = 'game';
        window.GameUI.init(app());
        st.gameInited = true;
      }
      window.GameUI.update(m.view);
    });
    N.on('chat', (m) => { if (st.mode === 'game') window.GameUI.onChat(m.msg); });
    N.on('chatHistory', (m) => { if (st.mode === 'game') window.GameUI.onChatHistory(m.msgs); });
    N.on('notify', (m) => {
      const k = m.entry.kind;
      const p = m.entry.payload || {};
      const texts = {
        role: null,
        hugged: '一雙溫柔的手臂環住了你——你今晚的職業能力失效了',
        dying: '你已瀕死……但今晚你仍能說話與行動',
        saved: '苦澀的藥香掠過唇邊——你被解藥救回了',
        savedByUnknown: '一股未知的力量將你從死亡邊緣拉回',
        checkResult: p.result ? ('查驗結果：' + p.target + ' 號是【' + (p.result === 'wolf' ? '壞人' : '好人') + '】') : null,
        foxTails: p.tails != null ? ('狐火搖曳——你剩下 ' + p.tails + ' 條尾巴') : null,
        nightPass: '夜行令已使用',
        banConfirmed: '禁票已生效',
        patrolBlocked: '你的巡邏失效了——請改選工作地點',
        assassinFailed: '目標躲進了村舍，暗殺失敗',
        assassinDone: '暗殺完成',
        poisonDone: '毒藥已倒入杯中',
        killDone: '利爪落下——目標已瀕死',
        buildDone: '你完成了建設工作！',
        sabotageDone: p.text || '破壞完成',
        guessResult: p.correct === true ? '有人代替你走入了黑暗……你活了下來' : (p.correct === false ? '你沒能認出那個人' : null),
        admirerSub: '你認出了他眼中的自己——你代替他赴死',
      };
      const t = texts[k];
      if (t) toast(t);
    });
    N.on('error', (m) => toast(m.message, true));
    N.on('actionError', (m) => { if (m.message !== '空訊息') toast(m.message, true); });
    N.on('_open', () => {
      // 重連：若有工作階段自動恢復
      const sess = N.loadSession();
      if (sess && sess.code && st.mode !== 'home') {
        N.send({ t: 'joinRoom', code: sess.code, token: sess.token });
      }
    });
    N.on('_close', () => { if (st.mode === 'game') toast('連線中斷，重連中……', true); });
  }

  function boot() {
    wire();
    window.Net.connect();
    const sess = window.Net.loadSession();
    renderHome();
    if (sess && sess.code && sessionStorage.getItem('wv_session')) {
      // 同分頁刷新：自動回到房間
      window.Net.send({ t: 'joinRoom', code: sess.code, token: sess.token });
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
  return { toast };
})();
