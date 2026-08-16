/* 情境測試工具：固定職業、指定目的地、指定投票、組合回應器 */
const D = require('./driver.js');
const WV = D.WV;

function game(opts) {
  const roles = opts.roles;
  const players = roles.map((r, i) => ({ name: '玩家' + (i + 1), isAI: true }));
  const settings = Object.assign({
    boardId: 'custom', customRoles: roles.slice(),
  }, opts.settings || {});
  const g = new WV.Game({
    players, settings, seed: opts.seed == null ? 7 : opts.seed, speed: 0,
    forceRoles: roles.slice(),
  });
  g.start(0);
  return g;
}

/** 目的地指定：plan[day][seat] = locId 或 plan.all[seat]（每天相同）
    守衛巡邏：值可為 {patrol:[a,b], goto:'a'} */
function destCustom(plan) {
  return (g, seat) => {
    const st = g.g.stage;
    if (!st || st.id !== 'day.finaldest') return false;
    const dayPlan = (plan[g.g.day] || plan.all || {});
    const want = dayPlan[seat];
    if (want == null) return false;
    const p = WV.H.p(g.g, seat);
    if (typeof want === 'object' && want.patrol) {
      p.night.prefPatrol = want.patrol.slice();
      p.night.prefGoto = want.goto || want.patrol[0];
      p.night.prefDest = null;
    } else {
      p.night.cards[0] = want;
      p.night.prefDest = want;
      p.night.prefPatrol = null;
    }
    const r = g.submit(seat, 'confirmKeep', {});
    if (!r.ok) throw new Error('confirmKeep 失敗：' + r.error);
    return true;
  };
}

/** 放逐投票指定：plan[day][voter] = target|'abstain' */
function voteCustom(plan) {
  return (g, seat) => {
    const st = g.g.stage;
    if (!st || st.id !== 'exile.vote') return false;
    const dayPlan = (plan[g.g.day] || plan.all || {});
    const want = dayPlan[seat];
    if (want == null) return false;
    const r = want === 'abstain'
      ? g.submit(seat, 'abstain', {})
      : g.submit(seat, 'vote', { target: want });
    if (!r.ok) throw new Error('投票失敗 seat=' + seat + '：' + r.error);
    return true;
  };
}

/** 依階段 id 指定回應：map[stageId] = (game, seat) => boolean */
function stageCustom(map) {
  return (g, seat) => {
    const st = g.g.stage;
    if (!st || !map[st.id]) return false;
    return !!map[st.id](g, seat);
  };
}

function combine(...fns) {
  return (g, seat) => fns.some((f) => f(g, seat));
}

/** 夜間全員工作（狼不主動刀）；acts[seat] = 'kill'|'suicide'|'sabotage'|'laze'|'none' 覆蓋 */
function nightActs(acts) {
  acts = acts || {};
  return (g) => {
    for (const p of WV.H.alive(g.g)) {
      const seat = p.seat;
      const want = acts[seat];
      if (want === 'none') continue;
      if (want && want !== 'work') {
        const r = g.submit(seat, want, {});
        if (!r.ok) throw new Error('夜間行動失敗 seat=' + seat + ' ' + want + '：' + r.error);
        continue;
      }
      const scene = WV.Views.nightScene(g, seat);
      if (scene && scene.work.canWork) g.submit(seat, 'workFull', {});
    }
  };
}

/** 斷言 */
function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error('斷言失敗：' + msg + '（期望 ' + expected + '，實得 ' + actual + '）');
}
function ok(cond, msg) { if (!cond) throw new Error('斷言失敗：' + msg); }

const stopAtDay = (day, stageId) => (g) =>
  g.g.day === day && !g.g.isNight && g.g.stage && (stageId ? g.g.stage.id === stageId : true);

module.exports = { game, destCustom, voteCustom, stageCustom, combine, nightActs, eq, ok, stopAtDay, D, WV };
