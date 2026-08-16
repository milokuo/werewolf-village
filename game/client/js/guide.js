/* 圖鑑（角色指南）與地點簡介覆蓋層 */
'use strict';
window.Guide = (function () {
  const WV = window.WV;
  const ROLE_ORDER = ['villager', 'seer', 'witch', 'hunter', 'idiot', 'fox', 'elder', 'knight',
    'stalker', 'butterfly', 'guard', 'wolf', 'warlock', 'admirer'];

  let currentRole = 'villager';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function roleDetailHTML(roleId) {
    const meta = WV.ROLES[roleId];
    const g = WV.GUIDE[roleId];
    const legend = WV.TEXT.roles[roleId];
    const qas = g.qa.map(([q, a]) =>
      '<details><summary>' + esc(q) + '</summary><p>' + esc(a) + '</p></details>').join('');
    return (
      '<div class="roledetail">' +
      '<h3>' + window.icon('role_' + roleId) + ' ' + esc(meta.name) + '</h3>' +
      '<div class="fac">' + esc(g.camp) + '　·　' + esc(g.position) + '</div>' +
      '<div class="flavor">' + esc(legend) + '</div>' +
      '<div class="paneltitle">能力說明</div>' +
      '<ul>' + g.abilities.map((a) => '<li>' + esc(a) + '</li>').join('') + '</ul>' +
      '<div class="paneltitle">機制問答</div>' +
      '<div class="qa">' + qas + '</div>' +
      '</div>'
    );
  }

  function locListHTML() {
    return Object.values(WV.LOCATIONS).map((l) =>
      '<div style="margin-bottom:14px">' +
      '<h3 style="font-family:var(--font-serif);letter-spacing:.1em">' + window.icon('loc_' + l.id) + ' ' + esc(l.name) +
      ' <span style="font-size:12px;color:var(--ink-soft)">（' + l.tier + ' 人以上開放）</span></h3>' +
      '<div class="flavor">' + esc(WV.TEXT.locations[l.id]) + '</div>' +
      '</div>').join('');
  }

  function show(tab) {
    close();
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.id = 'guide';
    ov.innerHTML =
      '<div class="box panel">' +
      '<h2>村落圖鑑</h2>' +
      '<div style="display:flex;gap:8px;justify-content:center;margin-bottom:10px">' +
      '<button class="btn small" data-tab="roles">角色</button>' +
      '<button class="btn small" data-tab="locs">地點</button>' +
      '<button class="btn small" data-tab="intro">背景</button>' +
      '<button class="btn small danger" data-close>關閉</button>' +
      '</div>' +
      '<div id="guidebody"></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('[data-close]')) { close(); return; }
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) renderTab(tabBtn.dataset.tab);
      const roleBtn = e.target.closest('[data-role]');
      if (roleBtn) { currentRole = roleBtn.dataset.role; renderTab('roles'); }
    });
    renderTab(tab || 'roles');
  }

  function renderTab(tab) {
    const body = document.getElementById('guidebody');
    if (!body) return;
    if (tab === 'roles') {
      body.innerHTML =
        '<div class="rolelist">' + ROLE_ORDER.map((r) =>
          '<button class="btn small ' + (r === currentRole ? 'primary' : '') + '" data-role="' + r + '">' +
          esc(WV.ROLES[r].name) + '</button>').join('') + '</div>' +
        roleDetailHTML(currentRole);
    } else if (tab === 'locs') {
      body.innerHTML = locListHTML();
    } else {
      body.innerHTML = '<div class="flavor" style="white-space:pre-wrap">' + esc(WV.TEXT.intro) + '</div>';
    }
  }

  function close() {
    const el = document.getElementById('guide');
    if (el) el.remove();
  }

  return { show, close, esc };
})();
