/* 測試驅動器：把遊戲一路推進；等待輸入的座位以「預設合法行為」回應。
   custom(game, seat) 可攔截特定座位的決策（回傳 true 表示已處理）。 */
const WV = require('./harness.js');

function makeGame(opts) {
  opts = opts || {};
  const n = opts.size || 12;
  const players = [];
  for (let i = 1; i <= n; i++) players.push({ name: '玩家' + i, isAI: true });
  const settings = Object.assign({}, opts.settings || {});
  if (!settings.boardId && n === 12) settings.boardId = 'b444_idiot';
  if (n !== 12 && !settings.customRoles && !settings.boardId) {
    settings.boardId = 'custom';
    settings.customRoles = defaultRoles(n);
  }
  const game = new WV.Game({ players, settings, seed: opts.seed == null ? 42 : opts.seed, speed: 0 });
  game.start(0);
  return game;
}

function defaultRoles(n) {
  const wolves = Math.max(1, Math.floor(n / 4));
  const roles = [];
  for (let i = 0; i < wolves; i++) roles.push('wolf');
  roles.push('seer', 'witch');
  if (n - roles.length > 2) roles.push('hunter');
  while (roles.length < n) roles.push('villager');
  return roles;
}

/** 對單一座位做出預設回應 */
function defaultRespond(game, seat) {
  const st = game.g.stage;
  if (!st) return;
  const id = st.id;
  const rng = game.rng;
  const you = WV.Views.youAwait(game, seat);
  const sub = (type, data) => {
    const r = game.submit(seat, type, data);
    if (!r.ok) throw new Error('預設回應失敗 [' + id + '/' + type + '] seat=' + seat + ': ' + r.error);
    return r;
  };
  switch (id) {
    case 'guess': return sub('guess', { target: rng.pick(you.candidates).seat });
    case 'lastwords': return sub('done');
    case 'hunter.decide': return sub('skip');
    case 'badge.transfer':
      return you.targets.length ? sub('give', { target: you.targets[0].seat }) : sub('tear');
    case 'exile.vote': {
      const targets = you.targets.filter((t) => t.seat !== seat);
      if (!targets.length) return sub('abstain');
      return sub('vote', { target: rng.pick(targets).seat });
    }
    case 'famine.vote': {
      const targets = you.targets.filter((t) => t.seat !== seat);
      return sub('vote', { target: rng.pick(targets.length ? targets : you.targets).seat });
    }
    case 'election.signup': return sub('run', { run: false });
    case 'election.speech': return sub('done');
    case 'election.vote': return sub('vote', { target: rng.pick(you.candidates).seat });
    case 'sheriff.direction': return sub('direction', { dir: 'forward' });
    case 'day.speech':
    case 'day.speech.pk': return sub('done');
    case 'build.vote': return sub('vote', { proposal: 0 });
    case 'exile.idiot': return sub('flip');
    case 'day.admirer': return sub('choose', { target: rng.pick(you.targets).seat });
    case 'day.finaldest': return sub('confirmKeep');
    case 'night.butterfly': return sub('hug', { target: rng.pick(you.targets).seat });
    case 'night.guardredo': return sub('move', { loc: rng.pick(you.openLocs) });
    case 'night.wolfsave':
    case 'night.godsave': {
      if (you.list.length && you.herb > 0) return sub('save', { target: you.list[0].seat });
      return sub('skip');
    }
    case 'night.postinfo': {
      if (you.checkTargets) return sub('check', { target: rng.pick(you.checkTargets).seat });
      if (you.banTargets && you.banTargets.length) return sub('ban', { target: rng.pick(you.banTargets).seat });
      return sub('skip');
    }
    case 'night.godattack': {
      if (you.assassinTarget) return sub('assassinate', { confirm: true });
      if (you.poisonTargets) {
        if (you.poisonTargets.length && you.herb > 0 && game.rng.chance(0.3)) {
          return sub('poison', { target: rng.pick(you.poisonTargets).seat });
        }
        return sub('skip');
      }
      return sub('skip');
    }
    case 'night.warlock':
      return you.list.length ? sub('rescue', { target: you.list[0].seat }) : sub('skip');
    default:
      // 嘗試通用結束
      if (game.submit(seat, 'done', {}).ok) return;
      if (game.submit(seat, 'skip', {}).ok) return;
      throw new Error('不知如何回應階段：' + id);
  }
}

/** 夜間行動階段：所有存活者的預設行為（狼人可刀就刀，否則工作） */
function defaultNightActions(game) {
  const g = game.g;
  for (const p of WV.H.alive(g)) {
    const scene = WV.Views.nightScene(game, p.seat);
    if (!scene || !scene.actions) continue;
    if (scene.actions.canKill) { game.submit(p.seat, 'kill', {}); continue; }
    if (scene.work.canWork) game.submit(p.seat, 'workFull', {});
  }
}

/** 推進遊戲直到結束或需要「custom 未處理的輸入」 */
function run(game, opts) {
  opts = opts || {};
  const custom = opts.custom || (() => false);
  const nightAction = opts.nightAction || defaultNightActions;
  const maxIters = opts.maxIters || 20000;
  let iters = 0;
  while (!game.ended) {
    if (opts.stopAt && opts.stopAt(game)) return game;
    if (++iters > maxIters) throw new Error('迭代上限：卡在 ' + (game.g.stage && game.g.stage.id));
    const st = game.g.stage;
    if (!st) {
      if (game.ended) break;
      throw new Error('沒有階段且遊戲未結束');
    }
    if (opts.onStage && !st.ctx._onStageDone) {
      st.ctx._onStageDone = true;
      opts.onStage(game, st.id);
      if (game.g.stage !== st) continue;
    }
    if (st.id === 'night.action' && !st.ctx._botsActed) {
      st.ctx._botsActed = true;
      nightAction(game);
      if (game.g.stage !== st) continue; // 行動可能直接結束遊戲
    }
    if (st.awaiting.size > 0) {
      const seats = Array.from(st.awaiting);
      for (const seat of seats) {
        if (!game.g.stage || game.g.stage !== st) break; // 階段已因提前解決而change
        if (!st.awaiting.has(seat)) continue;
        if (!custom(game, seat)) defaultRespond(game, seat);
      }
      continue;
    }
    // 無等待：時間快轉
    game.tick(st.endsAt);
  }
  return game;
}

/** 不變量檢查 */
function checkInvariants(game) {
  const g = game.g;
  const errs = [];
  if (g.resources.food < 0) errs.push('食物為負');
  if (g.resources.material < 0) errs.push('材料為負');
  if (g.resources.herb < 0) errs.push('藥草為負');
  for (const p of g.players) {
    if (!p.alive && p.deathDay == null) errs.push(p.seat + '號死亡但無死亡日');
    if (p.alive && p.deathCause) errs.push(p.seat + '號存活卻有死因');
    if (p.foxTails < 0) errs.push('尾數為負');
  }
  if (game.ended && !g.winner) errs.push('已結束但無勝方');
  if (errs.length) throw new Error('不變量違反：' + errs.join('；'));
}

module.exports = { makeGame, run, defaultRespond, defaultNightActions, checkInvariants, WV };
