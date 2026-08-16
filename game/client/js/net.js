/* WebSocket 連線層：自動重連、訊息分發、工作階段保存 */
'use strict';
window.Net = (function () {
  let ws = null;
  let handlers = {};
  let queue = [];
  let reconnectDelay = 800;
  let wantReconnect = true;

  function url() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    return proto + location.host;
  }

  function connect() {
    ws = new WebSocket(url());
    ws.onopen = () => {
      reconnectDelay = 800;
      emit('_open', {});
      while (queue.length) ws.send(queue.shift());
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      emit(m.t, m);
    };
    ws.onclose = () => {
      emit('_close', {});
      if (wantReconnect) setTimeout(connect, reconnectDelay = Math.min(reconnectDelay * 1.6, 8000));
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  function emit(type, m) {
    for (const fn of handlers[type] || []) fn(m);
  }

  return {
    connect,
    on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    send(obj) {
      const s = JSON.stringify(obj);
      if (ws && ws.readyState === 1) ws.send(s);
      else queue.push(s);
    },
    action(type, data, reqId) { this.send({ t: 'action', type, data: data || {}, reqId }); },
    saveSession(sess) {
      try {
        sessionStorage.setItem('wv_session', JSON.stringify(sess));
        localStorage.setItem('wv_last_session', JSON.stringify(sess));
      } catch { /* ignore */ }
    },
    loadSession() {
      try {
        return JSON.parse(sessionStorage.getItem('wv_session') || 'null') ||
               JSON.parse(localStorage.getItem('wv_last_session') || 'null');
      } catch { return null; }
    },
    clearSession() {
      try { sessionStorage.removeItem('wv_session'); localStorage.removeItem('wv_last_session'); } catch { /* ignore */ }
    },
  };
})();
