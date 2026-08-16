/* 遊戲主畫面：由伺服器個人化視圖驅動的渲染層 */
'use strict';
window.GameUI = (function () {
  const WV = window.WV;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const PHASE_LABELS = {
    'day.meeting.open': '村落會議', 'day.speech': '輪流發言', 'day.speech.pk': '平票補充發言',
    'dawn.reveal': '黎明', 'lastwords': '遺言', 'hunter.decide': '獵人的抉擇', 'badge.transfer': '警徽移交',
    'exile.vote': '放逐投票', 'famine.vote': '飢荒投票', 'election.signup': '警長競選報名',
    'election.speech': '競選發言', 'election.vote': '警長選舉', 'sheriff.direction': '警長決定發言順序',
    'build.propose': '建設提案', 'build.vote': '建設表決', 'exile.idiot': '白癡的抉擇', 'day.admirer': '暗戀者的心意',
    'day.finaldest': '目的地最終確認', 'night.butterfly': '花蝴蝶之夜', 'night.guardredo': '守衛改選',
    'night.wolfchat': '狼隊密談', 'night.action': '夜間行動', 'night.wolfsave': '藥草的抉擇',
    'night.postinfo': '星空下的凝視', 'night.godattack': '神職之夜', 'night.godsave': '藥草的抉擇',
    'night.warlock': '暗夜的低語', 'night.hidden': '夜色深沉', 'guess': '命運的凝視',
  };

  const st = {
    view: null,
    chats: { meeting: [], loc: [], wolf: [], dead: [], log: [] },
    unread: {},
    activeTab: 'meeting',
    clockOffset: 0,
    pressing: false,
    pressStart: 0,
    sel: {},           // 模態選擇狀態
    selStageKey: null,
    logCount: 0,
    lastStageKey: null,
    raf: null,
  };

  // ---------- 初始化骨架 ----------
  function init(container) {
    container.innerHTML =
      '<div id="game">' +
      '  <div id="topbar">' +
      '    <span class="brand">人狼村</span>' +
      '    <span class="daychip" id="daychip"></span>' +
      '    <span class="phase" id="phasename"></span>' +
      '    <span class="timer"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--line)" stroke-width="3"/><circle id="timerring" cx="18" cy="18" r="15.5" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-dasharray="97.4" stroke-dashoffset="0"/></svg><span class="num" id="timernum"></span></span>' +
      '    <span class="res" id="resbar"></span>' +
      '    <span class="btns">' +
      '      <button class="btn small" id="btn-guide">圖鑑</button>' +
      '      <button class="btn small" id="btn-quit">離開</button>' +
      '    </span>' +
      '  </div>' +
      '  <div id="gamebody">' +
      '    <div id="stagearea"></div>' +
      '    <div id="side">' +
      '      <div class="panel" id="rolecard"></div>' +
      '      <div class="panel" id="destpanel"></div>' +
      '      <div class="panel" id="chatbox">' +
      '        <div id="chattabs"></div>' +
      '        <div id="chatlog"></div>' +
      '        <div id="claimrow"></div>' +
      '        <div id="chatinput">' +
      '          <input id="chatfield" maxlength="200" placeholder="…" autocomplete="off">' +
      '          <button class="btn small primary" id="chatsend">送出</button>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    document.getElementById('btn-guide').onclick = () => window.Guide.show('roles');
    document.getElementById('btn-quit').onclick = () => {
      if (confirm('離開遊戲？（你的角色將由 AI 暫代，可重新整理回來）')) { window.Net.clearSession(); location.reload(); }
    };
    document.getElementById('chatsend').onclick = sendChat;
    document.getElementById('chatfield').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat();
      e.stopPropagation();
    });
    if (!st.raf) tickTimer();
  }

  function sendChat() {
    const f = document.getElementById('chatfield');
    const text = f.value.trim();
    if (!text) return;
    window.Net.action('chat', { text });
    f.value = '';
  }

  // ---------- 聊天 ----------
  function chanKey(channel) {
    if (channel.startsWith('loc:')) return 'loc';
    return channel;
  }
  function onChat(msg) {
    const key = chanKey(msg.channel);
    if (!st.chats[key]) st.chats[key] = [];
    st.chats[key].push(msg);
    if (st.chats[key].length > 300) st.chats[key].splice(0, 60);
    if (st.activeTab === key) renderChatLog();
    else { st.unread[key] = (st.unread[key] || 0) + 1; renderChatTabs(); }
  }
  function onChatHistory(msgs) {
    for (const m of msgs) {
      const key = chanKey(m.channel);
      if (!st.chats[key]) st.chats[key] = [];
      st.chats[key].push(m);
    }
    renderChatLog();
  }

  const TAB_DEFS = [
    ['meeting', '會議'], ['loc', '地點'], ['wolf', '狼隊'], ['dead', '亡者'], ['log', '紀錄'],
  ];
  function renderChatTabs() {
    const v = st.view;
    const el = document.getElementById('chattabs');
    if (!el || !v) return;
    const isWolf = v.you.wolfTeam != null;
    const show = {
      meeting: true,
      loc: st.chats.loc.length > 0 || (v.scene && v.scene.chatChannel),
      wolf: isWolf,
      dead: !v.you.alive || st.chats.dead.length > 0,
      log: true,
    };
    el.innerHTML = TAB_DEFS.filter(([k]) => show[k]).map(([k, label]) =>
      '<button class="tab ' + (st.activeTab === k ? 'on' : '') + '" data-tab="' + k + '">' + label +
      (st.unread[k] ? ' <span class="unread">●</span>' : '') + '</button>').join('');
    el.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => { st.activeTab = b.dataset.tab; st.unread[st.activeTab] = 0; renderChatTabs(); renderChatLog(); };
    });
  }
  function renderChatLog() {
    const el = document.getElementById('chatlog');
    if (!el) return;
    if (st.activeTab === 'log') {
      const v = st.view;
      const logs = (v && v.publicLog) || [];
      el.innerHTML = logs.map((e) =>
        '<div class="logentry ' + esc(e.kind) + '">' + esc(e.text) + '</div>').join('');
    } else {
      const msgs = st.chats[st.activeTab] || [];
      el.innerHTML = msgs.map((m) =>
        '<div class="m ' + (m.anon ? 'anon' : '') + '"><span class="fr">' + esc(m.from) + '</span>：' + esc(m.text) + '</div>').join('');
    }
    el.scrollTop = el.scrollHeight;
  }

  // ---------- 計時 ----------
  function tickTimer() {
    st.raf = requestAnimationFrame(tickTimer);
    const v = st.view;
    if (!v || !v.stage) { setTimer(null); updateWorkVisual(); return; }
    const now = Date.now() + st.clockOffset;
    const total = Math.max(1, v.stage.endsAt - v.stage.startedAt);
    const left = Math.max(0, v.stage.endsAt - now);
    setTimer(left, left / total);
    updateWorkVisual();
  }
  function setTimer(leftMs, frac) {
    const num = document.getElementById('timernum');
    const ring = document.getElementById('timerring');
    if (!num || !ring) return;
    if (leftMs == null) { num.textContent = '—'; ring.style.strokeDashoffset = 97.4; return; }
    num.textContent = Math.ceil(leftMs / 1000);
    ring.style.strokeDashoffset = String(97.4 * (1 - Math.max(0, Math.min(1, frac))));
  }

  // ---------- 視圖更新 ----------
  function update(v) {
    st.view = v;
    st.clockOffset = v.serverNow - Date.now();
    document.body.className = v.isNight ? 'theme-night' : 'theme-day';
    const stageKey = v.stage ? v.stage.id + ':' + v.stage.startedAt : 'none';
    if (stageKey !== st.selStageKey) { st.sel = {}; st.selStageKey = stageKey; }
    renderTop(v);
    renderStage(v);
    renderRoleCard(v);
    renderDestPanel(v);
    renderChatTabs(v);
    renderClaims(v);
    if (v.publicLog && v.publicLog.length !== st.logCount) {
      st.logCount = v.publicLog.length;
      if (st.activeTab === 'log') renderChatLog();
      else { st.unread.log = (st.unread.log || 0) + 1; renderChatTabs(); }
    }
    // 自動切換頻道分頁
    if (stageKey !== st.lastStageKey) {
      st.lastStageKey = stageKey;
      if (v.isNight && v.scene && v.scene.chatChannel && ['meeting'].includes(st.activeTab)) {
        st.activeTab = 'loc'; st.unread.loc = 0; renderChatTabs(); renderChatLog();
      } else if (!v.isNight && st.activeTab === 'loc') {
        st.activeTab = 'meeting'; st.unread.meeting = 0; renderChatTabs(); renderChatLog();
      }
    }
  }

  function renderTop(v) {
    document.getElementById('daychip').innerHTML =
      (v.isNight ? window.icon('ui_moon') + ' 第 ' + v.day + ' 夜' : window.icon('ui_sun') + ' 第 ' + v.day + ' 天') +
      (v.day === 1 && !v.isNight ? '（準備日）' : '');
    const label = v.ended ? '遊戲結束' : (v.stage ? (PHASE_LABELS[v.stage.id] || v.stage.id) : '');
    document.getElementById('phasename').textContent = label;
    document.getElementById('resbar').innerHTML =
      '<span title="食物">' + window.icon('res_food') + ' ' + v.resources.food + '</span>' +
      '<span title="材料">' + window.icon('res_material') + ' ' + v.resources.material + '</span>' +
      '<span title="藥草">' + window.icon('res_herb') + ' ' + v.resources.herb + '</span>';
  }

  // ---------- 主舞台 ----------
  function renderStage(v) {
    const area = document.getElementById('stagearea');
    if (v.ended && v.ending) { area.innerHTML = victoryHTML(v); bindVictory(area); return; }
    if (v.isNight && v.scene) {
      area.innerHTML = sceneHTML(v) + noticeBandHTML(v) + overlayHTML(v);
      bindScene(area, v);
      bindOverlay(area, v);
      return;
    }
    // 白天：座位環 + 中央資訊 + 覆蓋層
    area.innerHTML = '<div id="seatring">' + seatsHTML(v) + '</div>' + centerHTML(v) + noticeBandHTML(v) + overlayHTML(v);
    bindOverlay(area, v);
    bindCenter(area, v);
  }

  function seatsHTML(v) {
    const n = v.players.length;
    const speaker = v.stage && (v.stage.speaker || (v.stage.id === 'lastwords' ? v.stage.speaker : null));
    return v.players.map((p, i) => {
      const ang = (Math.PI * 2 * i / n) - Math.PI / 2;
      const x = 50 + 41 * Math.cos(ang);
      const y = 47 + 39 * Math.sin(ang);
      const badges = [];
      if (p.isSheriff) badges.push('<span class="badge sheriff">' + window.icon('ui_badge') + '警長</span>');
      if (p.isAI) badges.push('<span class="badge ai">AI</span>');
      if (p.aiTakeover) badges.push('<span class="badge ai">AI代管</span>');
      if (p.absent) badges.push('<span class="badge">缺席</span>');
      if (p.voteBanned) badges.push('<span class="badge">' + window.icon('ui_ban') + '禁票</span>');
      if (p.revealedRole) badges.push('<span class="badge roletag">' + esc(WV.ROLES[p.revealedRole].name) + '</span>');
      if (p.revealedWolfSide) badges.push('<span class="badge wolfside">狼人陣營</span>');
      if (v.spectate && v.spectate.roles && v.spectate.roles[p.seat]) {
        badges.push('<span class="badge roletag">' + esc(v.spectate.roles[p.seat].roleName) + '</span>');
      }
      const dead = !p.alive;
      const cls = ['seat'];
      if (dead) cls.push('dead');
      if (p.seat === v.you.seat) cls.push('me');
      if (speaker === p.seat) cls.push('speaking');
      return (
        '<div class="' + cls.join(' ') + '" style="left:' + x + '%;top:' + y + '%">' +
        '<div class="avatar">' + p.seat +
        (dead ? '<span class="deathmark">' + window.icon('ui_skull') + '</span>' : '') +
        '</div>' +
        '<div class="nm">' + esc(p.name) + '</div>' +
        '<div class="badges">' + badges.join('') + '</div>' +
        '</div>');
    }).join('');
  }

  function centerHTML(v) {
    const s = v.stage;
    if (!s) return '';
    const box = (title, body, sub) =>
      '<div id="centerpiece"><div class="panel"><h2>' + title + '</h2>' +
      (body ? '<div class="big">' + body + '</div>' : '') +
      (sub ? '<div class="sub">' + sub + '</div>' : '') +
      '<div class="actions" id="centeractions"></div></div></div>';
    const nameOf = (seat) => {
      const p = v.players.find((x) => x.seat === seat);
      return p ? p.seat + '號 ' + esc(p.name) : '?';
    };
    switch (s.id) {
      case 'dawn.reveal':
        return box('黎明', '鐘聲響起，村民聚回廣場。', '死亡名單見「紀錄」。');
      case 'day.meeting.open':
        return box('村落會議', v.day === 1 ? '認識彼此、閱讀板子、討論今晚的工作分配。' : '自由討論進行中。',
          '可隨時在右側暫選今晚目的地。');
      case 'day.speech':
        return box('輪流發言', nameOf(s.speaker) + ' 發言中', s.mine ? '輪到你了——在聊天欄輸入發言。' : '');
      case 'day.speech.pk':
        return box('平票補充發言', nameOf(s.speaker) + ' 發言中', '');
      case 'election.speech':
        return box('競選發言', nameOf(s.speaker) + ' 發表競選演說', '');
      case 'lastwords':
        return box('遺言', nameOf(s.speaker) + ' 留下最後的話語', s.mine ? '這是你的遺言時間。' : '');
      case 'exile.vote':
        return box('放逐投票', '投票匿名進行，結算後公開去向。', '等待 ' + s.awaitingCount + ' 人投票');
      case 'famine.vote':
        return box('飢荒投票', '糧食不足，必須有人犧牲。', '投票永久匿名．等待 ' + s.awaitingCount + ' 人');
      case 'election.signup':
        return box('警長競選', '願意參選者上前一步。', '等待 ' + s.awaitingCount + ' 人決定');
      case 'election.vote':
        return box('警長選舉', (s.candidates || []).map(nameOf).join('、') + ' 競逐警徽', '每票固定 1 票');
      case 'build.propose':
        return box('建設提案', '材料足以動工，任何人皆可提案。', '');
      case 'build.vote':
        return box('建設表決', (s.proposals || []).map((p) => '【' + esc(p.name) + '】').join('　'), '需超過存活人數一半票值');
      case 'exile.idiot':
        return box('意外的轉折', nameOf(s.seat) + ' 面對處刑……', '');
      case 'hunter.decide':
        return box('獵人的抉擇', nameOf(s.hunter) + ' 翻開了獵人的身分！', '他將決定是否帶走一人');
      case 'badge.transfer':
        return box('警徽移交', nameOf(s.from) + ' 的警徽將易主或撕毀', '');
      case 'guess':
        return box('命運的凝視', nameOf(s.target) + ' 在生死邊緣停留……', '有人正被給予最後一次回頭的機會');
      case 'sheriff.direction':
        return box('警長決定發言順序', '', '');
      case 'day.admirer':
        return box('暗戀者的心意', '某個人正悄悄把命運繫在另一人身上……', '');
      case 'day.finaldest':
        return box('目的地最終確認', '夜幕將至。', '在右側面板確認你今晚的去向．等待 ' + s.awaitingCount + ' 人');
      default:
        return box(PHASE_LABELS[s.id] || s.id, '', '');
    }
  }
  function bindCenter(area, v) {
    const actions = area.querySelector('#centeractions');
    if (!actions) return;
    const s = v.stage;
    if (s && s.id === 'day.meeting.open' && v.you.alive && !v.you.absent) {
      actions.innerHTML = '<button class="btn" id="btn-ready">結束討論（全員同意提前）</button>';
      actions.querySelector('#btn-ready').onclick = () => window.Net.action('ready');
    }
  }

  // ---------- 夜間場景 ----------
  function cloakSVG(color) {
    return '<svg class="cloak" viewBox="0 0 44 52">' +
      '<path d="M22 2 C13 2 8 10 8 18 L5 50 L39 50 L36 18 C36 10 31 2 22 2 Z" fill="' + color + '" stroke="rgba(0,0,0,.35)"/>' +
      '<ellipse cx="22" cy="16" rx="7" ry="8" fill="#0a0d14"/>' +
      '</svg>';
  }
  function sceneHTML(v) {
    const sc = v.scene;
    const figures = sc.others.map((o) =>
      '<div class="figure">' + cloakSVG(o.color) + '<div class="fname">' + esc(o.appearance) + '</div></div>').join('');
    const dyingBand = sc.dying ? '<div style="color:var(--danger);font-weight:700;letter-spacing:.25em;margin:6px 0">你已瀕死——但今晚仍能行動與說話</div>' : '';
    const patrol = sc.patrol ? '<div class="sub" style="color:var(--accent)">巡邏中：' + sc.patrol.map((p) => esc(p.name)).join(' ↔ ') + '（巡邏之夜不能工作）</div>' : '';
    const buildNote = (sc.actions && sc.actions.building) ?
      '<div class="sub" style="color:var(--civ)">已通過【' + esc(sc.actions.pendingConstruction.name) + '】提案——長按按鈕即是建設</div>' : '';
    return (
      '<div id="scene"><div class="scenecard">' +
      '<div class="sky"><span class="locicon">' + window.icon('loc_' + sc.loc) + '</span><span class="moon">' + window.icon('ui_moon') + '</span></div>' +
      '<div class="body">' +
      '<h2>' + esc(sc.locName) + '</h2>' +
      '<div class="flavor">' + esc(sc.text) + '</div>' +
      dyingBand + patrol + buildNote +
      (sc.isCottage
        ? '<div class="selfnote">你獨自躲在自己家中，門外的世界與你無關。</div>'
        : '<div class="selfnote">此地共 ' + sc.totalHere + ' 人（含你）．你看不到自己的匿名外觀．語音經過變聲（文字匿名）</div>' +
          '<div class="figures">' + (figures || '<span class="selfnote">四下無人。</span>') + '</div>') +
      workHTML(v) +
      nightActionsHTML(v) +
      '</div></div></div>');
  }
  function workHTML(v) {
    const w = v.scene.work;
    const label = (v.scene.actions && v.scene.actions.building) ? '建設' : '工作';
    const disabled = !w.canWork && !w.done;
    return (
      '<div class="workwrap">' +
      '<button id="workbtn" class="' + (w.done ? 'done' : '') + '" ' + (disabled ? 'disabled' : '') + '>' +
      '<svg class="ringsvg" viewBox="0 0 124 124"><circle id="workring" cx="62" cy="62" r="59" fill="none" stroke="var(--accent)" stroke-width="5" stroke-dasharray="370.7" stroke-dashoffset="370.7" stroke-linecap="round"/></svg>' +
      '<span id="worklabel">' + (w.done ? '已完成' : '長按' + label) + '</span>' +
      '</button>' +
      '<div class="selfnote">累計按滿 ' + Math.round(w.requiredMs / 1000) + ' 秒即完成．放開不會清除進度</div>' +
      '</div>');
  }
  function nightActionsHTML(v) {
    const a = v.scene.actions;
    if (!a) return '';
    const btns = [];
    if (a.canKill) btns.push('<button class="btn danger" data-na="kill">' + window.icon('role_wolf') + ' 刀人</button>');
    if (a.sabotageKind) {
      const label = { poisonWell: '在井中下毒', burnFarm: '放火燒田', ruinHerbs: '破壞藥草園' }[a.sabotageKind];
      btns.push('<button class="btn danger" data-na="sabotage">' + esc(label) + '</button>');
    }
    if (a.canLaze) btns.push('<button class="btn ghost" data-na="laze">偷懶（假裝工作）</button>');
    if (a.canSuicide) btns.push('<button class="btn ghost" data-na="suicide">自我了斷</button>');
    if (!btns.length) return '';
    return '<div class="nightactions">' + btns.join('') + '</div>';
  }
  function bindScene(area, v) {
    const btn = area.querySelector('#workbtn');
    if (btn && !btn.disabled) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (st.pressing) return;
        st.pressing = true; st.pressStart = Date.now();
        btn.setPointerCapture(e.pointerId);
        window.Net.action('workPress');
      });
      const release = () => {
        if (!st.pressing) return;
        st.pressing = false;
        window.Net.action('workRelease');
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
    }
    area.querySelectorAll('[data-na]').forEach((b) => {
      b.onclick = () => {
        const kind = b.dataset.na;
        const confirmText = {
          kill: '對此地唯一的外人出刀？（出刀後今晚不能工作）',
          sabotage: '執行破壞？（破壞後今晚不能工作）',
          laze: '刻意偷懶？（不產出，外觀與工作無異）',
          suicide: '確定要自我了斷？',
        }[kind];
        if (confirm(confirmText)) window.Net.action(kind);
      };
    });
  }
  function updateWorkVisual() {
    const v = st.view;
    if (!v || !v.scene) return;
    const ring = document.getElementById('workring');
    const label = document.getElementById('worklabel');
    const btn = document.getElementById('workbtn');
    if (!ring || !v.scene.work) return;
    const w = v.scene.work;
    let ms = w.workMs + (st.pressing ? (Date.now() - st.pressStart) : 0);
    const frac = Math.max(0, Math.min(1, ms / Math.max(1, w.requiredMs)));
    ring.style.strokeDashoffset = String(370.7 * (1 - frac));
    if (label && !w.done) {
      if (frac >= 1) { label.textContent = '已完成'; if (btn) btn.classList.add('done'); }
      else label.textContent = st.pressing ? Math.ceil((w.requiredMs - ms) / 1000) + ' 秒' : label.textContent;
    }
  }

  // ---------- 提示帶 ----------
  function noticeBandHTML(v) {
    const s = v.stage;
    if (!s) return '';
    if (s.id === 'day.speech' && s.mine) {
      return '<div id="noticeband"><b>輪到你發言</b>　在聊天欄輸入．<button class="btn small" onclick="Net.action(\'done\')">結束發言</button></div>';
    }
    if (s.id === 'lastwords' && s.mine) {
      return '<div id="noticeband"><b>你的遺言時間</b>　可在聊天欄留言．<button class="btn small" onclick="Net.action(\'done\')">結束遺言</button></div>';
    }
    if (s.id === 'election.speech' && s.mine) {
      return '<div id="noticeband"><b>你的競選演說</b>　<button class="btn small" onclick="Net.action(\'done\')">結束</button>　<button class="btn small danger" onclick="Net.action(\'withdraw\')">退選</button></div>';
    }
    if (s.id === 'night.wolfchat' && v.you.wolfTeam) {
      return '<div id="noticeband"><b>狼隊密談中</b>　隊友目的地見右側．<button class="btn small" onclick="Net.action(\'ready\')">準備完畢</button></div>';
    }
    return '';
  }

  // ---------- 等待輸入覆蓋層 ----------
  function overlayHTML(v) {
    const a = v.youAwait;
    if (!a) return '';
    const grid = (targets, key, extra) =>
      '<div class="targetgrid">' + targets.map((t) =>
        '<button class="targetbtn ' + (st.sel[key] === t.seat ? 'sel' : '') + '" data-pick="' + t.seat + '" data-key="' + key + '">' +
        t.seat + '號<br>' + esc(t.name) + (extra ? '<br><span style="font-size:11px;color:var(--ink-soft)">' + esc(extra(t)) + '</span>' : '') + '</button>').join('') + '</div>';
    const boxWrap = (title, desc, inner, dim) =>
      '<div class="overlay ' + (dim ? 'dim' : '') + '" id="awaitoverlay"><div class="box panel">' +
      '<h2>' + title + '</h2>' + (desc ? '<div class="desc">' + desc + '</div>' : '') + inner + '</div></div>';
    const confirmBtn = (label, act) => '<div class="foot"><button class="btn primary" data-act="' + act + '">' + (label || '確認') + '</button></div>';

    switch (a.id) {
      case 'exile.vote':
        return boxWrap('放逐投票', '投給你認為該被放逐的人．匿名進行、結算後公開去向',
          grid(a.targets, 'vote') + '<div class="foot">' +
          '<button class="btn primary" data-act="vote">投票</button>' +
          '<button class="btn" data-act="abstain">棄票</button></div>');
      case 'famine.vote':
        return boxWrap('飢荒投票', '糧食不足．必須選出犧牲者（不能棄票、永久匿名）',
          grid(a.targets, 'vote') + confirmBtn('投下這一票', 'vote'));
      case 'election.vote':
        return boxWrap('警長選舉', '每張選票固定 1 票',
          grid(a.candidates, 'vote') + confirmBtn('投票', 'evote'));
      case 'election.signup':
        return boxWrap('警長競選', '警長擁有 1.5 票與發言順序決定權．是否參選？',
          '<div class="foot"><button class="btn primary" data-act="run">參選</button><button class="btn" data-act="norun">不參選</button></div>');
      case 'sheriff.direction':
        return boxWrap('發言順序', '由你的下一號或上一號開始（你永遠最後發言）',
          '<div class="foot"><button class="btn primary" data-act="dirf">向後（下一號開始）</button><button class="btn primary" data-act="dirb">向前（上一號開始）</button></div>');
      case 'build.vote': {
        const inner = '<div class="targetgrid" style="grid-template-columns:1fr">' + a.proposals.map((p, i) =>
          '<button class="targetbtn ' + (st.sel.proposal === i ? 'sel' : '') + '" data-pickprop="' + i + '">【' + esc(p.name) + '】 ' + p.cost + ' 材料' +
          (p.fenceLoc ? '　保護：' + esc(WV.LOCATIONS[p.fenceLoc].name) : '') + '</button>').join('') + '</div>';
        return boxWrap('建設表決', '需超過存活玩家人數一半的票值．每天最多通過一案',
          inner + '<div class="foot"><button class="btn primary" data-act="bvote">支持所選提案</button><button class="btn" data-act="abstain">棄權</button></div>');
      }
      case 'exile.idiot':
        return boxWrap('生死一線', '你成為放逐結果．可翻開白癡身分免死（永久失去放逐投票權）',
          '<div class="foot"><button class="btn primary" data-act="flip">翻牌免死</button><button class="btn danger" data-act="accept">接受處刑</button></div>');
      case 'hunter.decide':
        return boxWrap('獵人的最後一發', '選擇一名玩家一同離去，或收起你的槍',
          grid(a.targets, 'shoot') + '<div class="foot"><button class="btn danger" data-act="shoot">開槍</button><button class="btn" data-act="skip">放棄</button></div>');
      case 'badge.transfer':
        return boxWrap('警徽移交', '將警徽交給一名存活玩家，或當眾撕毀',
          grid(a.targets, 'give') + '<div class="foot"><button class="btn primary" data-act="give">移交</button><button class="btn danger" data-act="tear">撕毀警徽</button></div>');
      case 'guess':
        return boxWrap('命運的凝視', '死亡即將降臨——若能認出那個暗戀你的人，他將代替你赴死．猜錯則一同殞落（15 秒，期間不能與他人溝通）',
          grid(a.candidates, 'guess') + confirmBtn('就是他', 'guess'), true);
      case 'day.admirer':
        return boxWrap('暗戀者的心意', '選擇你暗戀的人．你的最終勝負將跟隨他',
          grid(a.targets, 'choose') + confirmBtn('心意已決', 'choose'), true);
      case 'day.finaldest':
        return destOverlayHTML(a);
      case 'night.butterfly':
        return boxWrap('花蝴蝶之夜', '擁抱一名玩家，封鎖他今晚的職業能力（剩餘 ' + a.usesLeft + ' 次）',
          grid(a.targets, 'hug') + '<div class="foot"><button class="btn primary" data-act="hug">擁抱</button><button class="btn" data-act="skip">今晚不出手</button></div>', true);
      case 'night.guardredo':
        return boxWrap('巡邏被封鎖', '你的能力被封鎖，改為選擇一個地點正常工作',
          '<div class="targetgrid">' + a.openLocs.map((l) =>
            '<button class="targetbtn ' + (st.sel.loc === l ? 'sel' : '') + '" data-pickloc="' + l + '">' + window.icon('loc_' + l) + '<br>' + esc(WV.LOCATIONS[l].name) + '</button>').join('') + '</div>' +
          confirmBtn('前往', 'move'), true);
      case 'night.wolfsave':
      case 'night.godsave':
        return boxWrap('藥草的抉擇', '你目睹了瀕死者（庫存藥草 ' + a.herb + '）．一份解藥取消該玩家本批次全部攻擊',
          grid(a.list, 'save', (t) => t.locName) +
          '<div class="foot"><button class="btn primary" data-act="save">使用解藥</button><button class="btn" data-act="skip">不出手</button></div>', true);
      case 'night.postinfo': {
        let inner = '';
        if (a.checkTargets) inner += '<div class="paneltitle">查驗一名玩家</div>' + grid(a.checkTargets, 'check');
        if (a.banTargets) inner += '<div class="paneltitle">禁止一人明日投票</div>' + grid(a.banTargets, 'ban');
        const btns = [];
        if (a.checkTargets) btns.push('<button class="btn primary" data-act="check">查驗</button>');
        if (a.banTargets) btns.push('<button class="btn primary" data-act="ban">禁票</button>');
        btns.push('<button class="btn" data-act="skip">跳過</button>');
        return boxWrap('星空下的凝視', '', inner + '<div class="foot">' + btns.join('') + '</div>', true);
      }
      case 'night.godattack': {
        let inner = '';
        const btns = [];
        if (a.assassinTarget) {
          inner += '<div class="desc">白天你投給 <b>' + a.assassinTarget.seat + '號 ' + esc(a.assassinTarget.name) + '</b>，而他沒有被放逐．是否暗殺？（穿透柵欄與守衛，不穿透村舍）</div>';
          btns.push('<button class="btn danger" data-act="assassinate">暗殺</button>');
        }
        if (a.poisonTargets) {
          inner += '<div class="paneltitle">毒殺同地點一人（庫存藥草 ' + a.herb + '）</div>' + grid(a.poisonTargets, 'poison');
          btns.push('<button class="btn danger" data-act="poison">用毒</button>');
        }
        btns.push('<button class="btn" data-act="skip">不出手</button>');
        return boxWrap('神職之夜', '', inner + '<div class="foot">' + btns.join('') + '</div>', true);
      }
      case 'night.warlock':
        return boxWrap('暗夜的低語', '黑夜送來仍因神術瀕死者的名字．你可以奪回一個靈魂（每局一次）',
          grid(a.list, 'rescue') +
          '<div class="foot"><button class="btn primary" data-act="rescue">挽救</button><button class="btn" data-act="skip">保留法術</button></div>', true);
      default:
        return '';
    }
  }

  function destOverlayHTML(a) {
    if (a.isGuard) {
      const edges = WV.MAP_EDGES.filter(([x, y]) =>
        a.openLocs.includes(x) && a.openLocs.includes(y) &&
        !WV.LOCATIONS[x].isCottage && !WV.LOCATIONS[y].isCottage);
      const key = (e) => e[0] + '|' + e[1];
      const selEdge = st.sel.patrol;
      return (
        '<div class="overlay" id="awaitoverlay"><div class="box panel">' +
        '<h2>守衛巡邏</h2>' +
        '<div class="desc">選擇兩個相連地點巡邏（不能連續兩晚重覆前晚地點' +
        (a.lastPatrol && a.lastPatrol.length ? '；前晚：' + a.lastPatrol.map((l) => esc(WV.LOCATIONS[l].name)).join('、') : '') +
        '），或改為前往手上的地點牌正常工作</div>' +
        '<div class="targetgrid" style="grid-template-columns:1fr 1fr">' + edges.map((e) =>
          '<button class="targetbtn ' + (selEdge === key(e) ? 'sel' : '') + '" data-pickedge="' + key(e) + '">' +
          esc(WV.LOCATIONS[e[0]].name) + ' ↔ ' + esc(WV.LOCATIONS[e[1]].name) + '</button>').join('') + '</div>' +
        (selEdge ? '<div class="desc">親自前往：' + selEdge.split('|').map((l) =>
          '<button class="btn small ' + (st.sel.goto === l ? 'primary' : '') + '" data-pickgoto="' + l + '">' + esc(WV.LOCATIONS[l].name) + '</button>').join(' ') + '</div>' : '') +
        '<div class="paneltitle">或使用地點牌工作</div>' +
        '<div class="targetgrid">' + a.cards.map((c) =>
          '<button class="targetbtn ' + (st.sel.loc === c.loc ? 'sel' : '') + '" data-pickloc="' + c.loc + '">' + window.icon('loc_' + c.loc) + '<br>' + esc(c.name) + '</button>').join('') + '</div>' +
        '<div class="foot"><button class="btn primary" data-act="confirmdest">確認目的地</button></div>' +
        '</div></div>');
    }
    const passNote = a.passAvailable
      ? '你還有一張「夜行令」——可改去任何開放地點（改回牌內地點則退還）'
      : '夜行令已用過';
    return (
      '<div class="overlay" id="awaitoverlay"><div class="box panel">' +
      '<h2>目的地最終確認</h2>' +
      '<div class="desc">從三張地點牌中選擇今晚去向．' + passNote + '</div>' +
      '<div class="targetgrid">' + a.cards.map((c) =>
        '<button class="targetbtn ' + (st.sel.loc === c.loc ? 'sel' : '') + '" data-pickloc="' + c.loc + '">' + window.icon('loc_' + c.loc) + '<br>' + esc(c.name) + '</button>').join('') + '</div>' +
      (a.passAvailable
        ? '<div class="paneltitle">' + window.icon('ui_pass') + ' 夜行令（任選地點）</div>' +
          '<div class="targetgrid">' + a.openLocs.filter((l) => !a.cards.some((c) => c.loc === l)).map((l) =>
            '<button class="targetbtn ' + (st.sel.loc === l ? 'sel' : '') + '" data-pickloc="' + l + '">' + window.icon('loc_' + l) + '<br>' + esc(WV.LOCATIONS[l].name) + '</button>').join('') + '</div>'
        : '') +
      '<div class="foot"><button class="btn primary" data-act="confirmdest">確認目的地</button></div>' +
      '</div></div>');
  }

  function bindOverlay(area, v) {
    const ov = area.querySelector('#awaitoverlay');
    if (!ov) return;
    ov.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => { st.sel[b.dataset.key] = Number(b.dataset.pick); renderStage(v); };
    });
    ov.querySelectorAll('[data-pickprop]').forEach((b) => {
      b.onclick = () => { st.sel.proposal = Number(b.dataset.pickprop); renderStage(v); };
    });
    ov.querySelectorAll('[data-pickloc]').forEach((b) => {
      b.onclick = () => { st.sel.loc = b.dataset.pickloc; st.sel.patrol = null; renderStage(v); };
    });
    ov.querySelectorAll('[data-pickedge]').forEach((b) => {
      b.onclick = () => { st.sel.patrol = b.dataset.pickedge; st.sel.loc = null; st.sel.goto = null; renderStage(v); };
    });
    ov.querySelectorAll('[data-pickgoto]').forEach((b) => {
      b.onclick = () => { st.sel.goto = b.dataset.pickgoto; renderStage(v); };
    });
    ov.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => act(b.dataset.act, v);
    });
  }

  function act(action, v) {
    const N = window.Net;
    const need = (key, msg) => {
      if (st.sel[key] == null) { window.App.toast(msg || '請先選擇目標', true); return null; }
      return st.sel[key];
    };
    switch (action) {
      case 'vote': { const t = need('vote'); if (t != null) N.action('vote', { target: t }); break; }
      case 'evote': { const t = need('vote'); if (t != null) N.action('vote', { target: t }); break; }
      case 'abstain': N.action('abstain'); break;
      case 'run': N.action('run', { run: true }); break;
      case 'norun': N.action('run', { run: false }); break;
      case 'dirf': N.action('direction', { dir: 'forward' }); break;
      case 'dirb': N.action('direction', { dir: 'back' }); break;
      case 'bvote': {
        if (st.sel.proposal == null) { window.App.toast('請先選擇提案', true); break; }
        N.action('vote', { proposal: st.sel.proposal }); break;
      }
      case 'flip': N.action('flip'); break;
      case 'accept': N.action('accept'); break;
      case 'shoot': { const t = need('shoot'); if (t != null) N.action('shoot', { target: t }); break; }
      case 'skip': N.action('skip'); break;
      case 'give': { const t = need('give'); if (t != null) N.action('give', { target: t }); break; }
      case 'tear': N.action('tear'); break;
      case 'guess': { const t = need('guess'); if (t != null) N.action('guess', { target: t }); break; }
      case 'choose': { const t = need('choose'); if (t != null) N.action('choose', { target: t }); break; }
      case 'hug': { const t = need('hug'); if (t != null) N.action('hug', { target: t }); break; }
      case 'move': { if (!st.sel.loc) { window.App.toast('請選擇地點', true); break; } N.action('move', { loc: st.sel.loc }); break; }
      case 'save': { const t = need('save'); if (t != null) N.action('save', { target: t }); break; }
      case 'check': { const t = need('check'); if (t != null) N.action('check', { target: t }); break; }
      case 'ban': { const t = need('ban'); if (t != null) N.action('ban', { target: t }); break; }
      case 'assassinate': N.action('assassinate', { confirm: true }); break;
      case 'poison': { const t = need('poison'); if (t != null && confirm('確定毒殺 ' + t + ' 號？')) N.action('poison', { target: t }); break; }
      case 'rescue': { const t = need('rescue'); if (t != null) N.action('rescue', { target: t }); break; }
      case 'confirmdest': {
        if (st.sel.patrol) {
          const pair = st.sel.patrol.split('|');
          N.action('confirmPatrol', { patrol: pair, goto: st.sel.goto || pair[0] });
        } else if (st.sel.loc) {
          N.action('confirmDest', { loc: st.sel.loc });
        } else {
          N.action('confirmKeep');
        }
        break;
      }
      default: break;
    }
  }

  // ---------- 側欄 ----------
  function renderRoleCard(v) {
    const el = document.getElementById('rolecard');
    const you = v.you;
    const status = [];
    if (!you.alive) status.push('<span class="badge">已死亡' + (v.spectate ? '（觀戰中）' : '') + '</span>');
    if (you.absent) status.push('<span class="badge">缺席（獵人小屋返程）</span>');
    if (you.voteBanned) status.push('<span class="badge">今日禁票</span>');
    if (you.hugged) status.push('<span class="badge">能力被封鎖</span>');
    if (you.idiotFlipped) status.push('<span class="badge">已翻牌</span>');
    if (you.foxTails != null) status.push('<span class="badge roletag">尾巴 ×' + you.foxTails + '</span>');
    if (you.butterflyUses != null) status.push('<span class="badge roletag">擁抱 ×' + you.butterflyUses + '</span>');
    if (you.knightUsed === false) status.push('<span class="badge roletag">決鬥可用</span>');
    if (you.warlockUsed === false) status.push('<span class="badge roletag">挽救可用</span>');
    if (you.hunterShotUsed === false) status.push('<span class="badge roletag">槍膛已上膛</span>');
    if (you.admirerTarget != null) status.push('<span class="badge roletag">暗戀 ' + you.admirerTarget + ' 號</span>');
    if (!you.nightPassUsed) status.push('<span class="badge">' + window.icon('ui_pass') + ' 夜行令</span>');
    const team = you.wolfTeam
      ? '<div class="wolfteam">' + window.icon('role_wolf') + ' 狼隊：' + you.wolfTeam.map((w) =>
        w.seat + '號' + (w.role !== 'wolf' ? '（' + esc(w.roleName) + '）' : '') +
        (w.alive ? '' : '†') + (w.dest ? '→' + esc(w.dest.name) : '')).join('　') + '</div>'
      : '';
    const interrupts = [];
    if (you.canDuel) interrupts.push('<button class="btn small danger" id="btn-duel">' + window.icon('role_knight') + ' 決鬥</button>');
    if (you.canExplode) interrupts.push('<button class="btn small danger" id="btn-explode">自爆</button>');
    if (you.canPropose && you.affordable && you.affordable.length) {
      interrupts.push('<button class="btn small primary" id="btn-propose">提案建設</button>');
    }
    el.innerHTML =
      '<div class="rc-top">' +
      '<span class="rc-icon">' + window.icon('role_' + you.role) + '</span>' +
      '<div><div class="rc-name">' + esc(you.roleName) + '</div>' +
      '<div class="rc-fac ' + you.faction + '">' + esc(you.factionName) + '</div></div>' +
      '<button class="btn small ghost" style="margin-left:auto" id="btn-mylegend">詳情</button>' +
      '</div>' +
      (you.dying ? '<div class="dyingband">瀕　死</div>' : '') +
      '<div class="rc-status">' + status.join('') + '</div>' + team +
      (interrupts.length ? '<div class="rc-status" style="margin-top:8px">' + interrupts.join('') + '</div>' : '');
    const legendBtn = el.querySelector('#btn-mylegend');
    if (legendBtn) legendBtn.onclick = () => window.Guide.show('roles');
    const duelBtn = el.querySelector('#btn-duel');
    if (duelBtn) duelBtn.onclick = () => pickTarget('選擇決鬥對象（若為狼人他死；否則你死）', (t) => window.Net.action('duel', { target: t }));
    const explodeBtn = el.querySelector('#btn-explode');
    if (explodeBtn) explodeBtn.onclick = () => {
      if (confirm('自爆將公開你屬狼人陣營並立即死亡，會議中止、跳過放逐．確定？')) window.Net.action('explode');
    };
    const proposeBtn = el.querySelector('#btn-propose');
    if (proposeBtn) proposeBtn.onclick = () => proposeDialog(v);
  }

  function pickTarget(title, cb, filter) {
    const v = st.view;
    const targets = v.players.filter((p) => p.alive && p.seat !== v.you.seat && (!filter || filter(p)));
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = '<div class="box panel"><h2>' + esc(title) + '</h2><div class="targetgrid">' +
      targets.map((t) => '<button class="targetbtn" data-t="' + t.seat + '">' + t.seat + '號<br>' + esc(t.name) + '</button>').join('') +
      '</div><div class="foot"><button class="btn" data-close>取消</button></div></div>';
    document.getElementById('stagearea').appendChild(ov);
    ov.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-t]');
      if (tb) { ov.remove(); cb(Number(tb.dataset.t)); }
      if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
    });
  }

  function proposeDialog(v) {
    const opts = v.you.affordable || [];
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = '<div class="box panel"><h2>建設提案</h2><div class="targetgrid" style="grid-template-columns:1fr">' +
      opts.map((c) => '<button class="targetbtn" data-c="' + c + '">【' + esc(WV.CONSTRUCTIONS[c].name) + '】 ' +
        WV.constructionCost(c, v.config.totalRoles) + ' 材料</button>').join('') +
      '</div><div class="foot"><button class="btn" data-close>取消</button></div></div>';
    document.getElementById('stagearea').appendChild(ov);
    ov.addEventListener('click', (e) => {
      const cb = e.target.closest('[data-c]');
      if (cb) {
        const c = cb.dataset.c;
        ov.remove();
        if (c === 'fence') {
          pickFenceLoc(v, (loc) => window.Net.action('propose', { construction: 'fence', fenceLoc: loc }));
        } else window.Net.action('propose', { construction: c });
      }
      if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
    });
  }
  function pickFenceLoc(v, cb) {
    const locs = v.openLocs.filter((l) => !WV.LOCATIONS[l].isCottage);
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = '<div class="box panel"><h2>柵欄保護地點</h2><div class="targetgrid">' +
      locs.map((l) => '<button class="targetbtn" data-l="' + l + '">' + window.icon('loc_' + l) + '<br>' + esc(WV.LOCATIONS[l].name) + '</button>').join('') +
      '</div><div class="foot"><button class="btn" data-close>取消</button></div></div>';
    document.getElementById('stagearea').appendChild(ov);
    ov.addEventListener('click', (e) => {
      const lb = e.target.closest('[data-l]');
      if (lb) { ov.remove(); cb(lb.dataset.l); }
      if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
    });
  }

  function renderDestPanel(v) {
    const el = document.getElementById('destpanel');
    const dp = v.you.destPanel;
    if (!dp || !v.you.alive || v.isNight) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (dp.isGuard) {
      el.innerHTML = '<div class="paneltitle">' + window.icon('role_guard') + ' 今晚巡邏</div>' +
        '<div style="padding:0 12px 10px;font-size:13px;color:var(--ink-soft)">' +
        (dp.prefPatrol ? '已暫選：' + dp.prefPatrol.map((l) => esc(WV.LOCATIONS[l].name)).join(' ↔ ') : '尚未選擇（可於最終確認時選）') +
        '</div>';
      return;
    }
    el.innerHTML =
      '<div class="paneltitle">今晚目的地（暫選）</div>' +
      '<div class="cards" style="padding:0 10px 10px">' + dp.cards.map((c) =>
        '<button class="destcard ' + (dp.prefDest === c.loc ? 'sel' : '') + '" data-d="' + c.loc + '">' +
        window.icon('loc_' + c.loc) + '<span class="cn">' + esc(c.name) + '</span></button>').join('') + '</div>' +
      '<div class="passrow" style="padding:0 12px 10px">' +
      (dp.passAvailable ? window.icon('ui_pass') + '<button class="btn small ghost" id="btn-pass">使用夜行令（任選地點）</button>' : '') +
      '</div>';
    el.querySelectorAll('[data-d]').forEach((b) => {
      b.onclick = () => window.Net.action('destPref', { loc: b.dataset.d });
    });
    const passBtn = el.querySelector('#btn-pass');
    if (passBtn) passBtn.onclick = () => {
      const others = v.openLocs.filter((l) => !dp.cards.some((c) => c.loc === l));
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = '<div class="box panel"><h2>夜行令</h2><div class="desc">選擇任何開放地點（改回牌內地點會退還夜行令）</div><div class="targetgrid">' +
        others.map((l) => '<button class="targetbtn" data-l="' + l + '">' + window.icon('loc_' + l) + '<br>' + esc(WV.LOCATIONS[l].name) + '</button>').join('') +
        '</div><div class="foot"><button class="btn" data-close>取消</button></div></div>';
      document.getElementById('stagearea').appendChild(ov);
      ov.addEventListener('click', (e) => {
        const lb = e.target.closest('[data-l]');
        if (lb) { ov.remove(); window.Net.action('destPref', { loc: lb.dataset.l }); }
        if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
      });
    };
  }

  function renderClaims(v) {
    const el = document.getElementById('claimrow');
    if (v.isNight || !v.you.alive || v.you.absent || v.ended) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<button class="btn small ghost" data-claim="role">聲稱職業</button>' +
      '<button class="btn small ghost" data-claim="check">報查驗</button>' +
      '<button class="btn small ghost" data-claim="accuse">指控</button>' +
      '<button class="btn small ghost" data-claim="defend">力保</button>';
    el.querySelectorAll('[data-claim]').forEach((b) => {
      b.onclick = () => claimDialog(b.dataset.claim, v);
    });
  }
  function claimDialog(kind, v) {
    if (kind === 'role') {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      const roles = Object.keys(WV.ROLES);
      ov.innerHTML = '<div class="box panel"><h2>聲稱職業</h2><div class="targetgrid">' +
        roles.map((r) => '<button class="targetbtn" data-r="' + r + '">' + esc(WV.ROLES[r].name) + '</button>').join('') +
        '</div><div class="foot"><button class="btn" data-close>取消</button></div></div>';
      document.getElementById('stagearea').appendChild(ov);
      ov.addEventListener('click', (e) => {
        const rb = e.target.closest('[data-r]');
        if (rb) { ov.remove(); window.Net.action('claim', { kind: 'role', role: rb.dataset.r }); }
        if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
      });
      return;
    }
    if (kind === 'check') {
      pickTarget('報查驗：對象', (t) => {
        const ov = document.createElement('div');
        ov.className = 'overlay';
        ov.innerHTML = '<div class="box panel"><h2>查驗結果</h2><div class="foot">' +
          '<button class="btn danger" data-res="wolf">壞人</button>' +
          '<button class="btn primary" data-res="good">好人</button></div></div>';
        document.getElementById('stagearea').appendChild(ov);
        ov.addEventListener('click', (e) => {
          const rb = e.target.closest('[data-res]');
          if (rb) { ov.remove(); window.Net.action('claim', { kind: 'check', target: t, result: rb.dataset.res }); }
          if (e.target === ov) ov.remove();
        });
      });
      return;
    }
    pickTarget(kind === 'accuse' ? '指控誰是狼人？' : '力保誰是好人？',
      (t) => window.Net.action('claim', { kind, target: t }));
  }

  // ---------- 勝利畫面 ----------
  function victoryHTML(v) {
    const e = v.ending;
    const good = e.winner.side === 'good';
    const rows = e.results.map((r) =>
      '<tr><td>' + r.seat + '號</td><td>' + esc(r.name) + '</td><td>' + esc(WV.ROLES[r.role].name) + '</td>' +
      '<td>' + (r.alive ? '存活' : '死亡') + '</td>' +
      '<td class="' + (r.won ? 'win' : 'lose') + '">' + (r.won ? '勝利' : '敗北') + '</td></tr>').join('');
    return (
      '<div id="victory"><div class="inner">' +
      '<div style="font-size:52px;margin-bottom:8px;color:' + (good ? '#e8a13c' : '#c65550') + '">' +
      window.icon(good ? 'ui_fire' : 'role_wolf') + '</div>' +
      '<h1 class="' + (good ? 'good' : 'wolf') + '">' + (good ? '好人方勝利' : '狼人陣營勝利') + '</h1>' +
      '<div class="sub" style="color:#8b93a8;margin-bottom:14px">' + esc(e.winner.reason) + '</div>' +
      '<div class="story">' + esc(e.text) + '</div>' +
      '<table><tr><th>座位</th><th>玩家</th><th>職業</th><th>結局</th><th>勝負</th></tr>' + rows + '</table>' +
      '<button class="btn primary" id="btn-home">返回首頁</button>' +
      '</div></div>');
  }
  function bindVictory(area) {
    const b = area.querySelector('#btn-home');
    if (b) b.onclick = () => { window.Net.clearSession(); location.reload(); };
  }

  return { init, update, onChat, onChatHistory };
})();
