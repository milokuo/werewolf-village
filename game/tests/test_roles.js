/* 職業機制測試 A：刀人、保護矩陣、女巫、潛行者、暗夜術士、守衛、花蝴蝶 */
const S = require('./scen.js');
const { eq, ok } = S;
const WV = S.WV;

const abstainAll = S.stageCustom({ 'exile.vote': (g, seat) => { g.submit(seat, 'abstain', {}); return true; } });
const skipFor = (ids) => S.stageCustom(Object.fromEntries(ids.map((id) => [id, (g, seat) => { g.submit(seat, 'skip', {}); return true; }])));

const ROLES_B = ['wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'guard', 'stalker', 'villager', 'villager', 'villager', 'villager'];
const cottageAll = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 'cottage']));

// ---- 刀人合法性與多地點出刀 ----
{
  const dests = cottageAll(12);
  Object.assign(dests, { 1: 'farm', 9: 'farm', 2: 'mill', 10: 'mill', 11: 'mill', 3: 'smithy' });
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 40 } });
  let farmKill = null, millKill = null;
  S.D.run(g, {
    custom: S.combine(S.destCustom({ 1: dests }), abstainAll, skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])),
    nightAction: (game) => {
      farmKill = WV.Views.nightScene(game, 1).actions.canKill;   // 狼+1好人 → 可
      millKill = WV.Views.nightScene(game, 2).actions.canKill;   // 狼+2好人 → 不可
      if (farmKill) game.submit(1, 'kill', {});
      const r2 = game.submit(2, 'kill', {});
      ok(!r2.ok, '兩名非狼時不可出刀');
      S.nightActs({ 1: 'none' })(game);
    },
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  eq(farmKill, true, '狼+唯一好人可出刀');
  eq(millKill, false, '兩名非狼不可出刀');
  eq(WV.H.p(g.g, 9).alive, false, '農田好人死亡');
  eq(WV.H.p(g.g, 9).deathCause, 'WOLF_KILL', '死因狼刀');
  eq(WV.H.p(g.g, 10).alive, true, '磨坊好人存活');
}

// ---- 同一晚多地點分別出刀 ----
{
  const dests = cottageAll(12);
  Object.assign(dests, { 1: 'farm', 9: 'farm', 2: 'mill', 10: 'mill' });
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 40 } });
  S.D.run(g, {
    custom: S.combine(S.destCustom({ 1: dests }), abstainAll, skipFor(['night.wolfsave'])),
    nightAction: (game) => {
      game.submit(1, 'kill', {});
      game.submit(2, 'kill', {});
      S.nightActs({ 1: 'none', 2: 'none' })(game);
    },
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 9).alive, false, '多地點出刀 A');
  eq(WV.H.p(g.g, 10).alive, false, '多地點出刀 B');
}

// ---- 村舍安全：不可刀、不可自殺 ----
{
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 40 } });
  S.D.run(g, {
    custom: S.combine(S.destCustom({ 1: cottageAll(12) }), abstainAll),
    nightAction: (game) => {
      const scene = WV.Views.nightScene(game, 1);
      eq(scene.actions.canKill, false, '村舍不可刀');
      eq(scene.actions.canSuicide, false, '村舍不可自殺');
      eq(scene.totalHere, 1, '村舍只看見自己');
      S.nightActs({})(game);
    },
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
}

// ---- 守衛巡邏保護 + 連守限制 + 潛行者穿透 ----
{
  const dests1 = cottageAll(12);
  Object.assign(dests1, { 1: 'farm', 9: 'farm', 7: { patrol: ['farm', 'well'], goto: 'well' } });
  const dests2 = cottageAll(12);
  Object.assign(dests2, { 9: 'farm', 5: 'mine', 7: { patrol: ['farm', 'well'], goto: 'well' } });
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 40 } });
  let killBlocked = null;
  // 第一夜：守衛巡邏農田+水井，狼在農田不可出刀
  S.D.run(g, {
    custom: S.combine(S.destCustom({ 1: dests1, 2: dests2 }), abstainAll,
      skipFor(['night.wolfsave', 'night.godsave'])),
    nightAction: (game) => {
      if (game.g.day === 1) {
        killBlocked = WV.Views.nightScene(game, 1).actions.canKill;
        const r = game.submit(1, 'kill', {});
        ok(!r.ok, '受守衛保護不可出刀');
      }
      S.nightActs({})(game);
    },
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  eq(killBlocked, false, '守衛保護使刀鍵禁用');
  eq(WV.H.p(g.g, 9).alive, true, '受保護好人存活');
  // 連守限制：巡邏偏好再選 farm/well 應被拒絕
  const r = g.submit(7, 'destPref', { patrol: ['farm', 'well'], goto: 'farm' });
  ok(!r.ok && r.error.includes('連續'), '連守限制生效：' + r.error);
  const r2 = g.submit(7, 'destPref', { patrol: ['smithy', 'lumber'], goto: 'smithy' });
  ok(r2.ok, '其他巡邏組合合法');
  // 第二日：放逐投票 8→9 但 10、11 投 12 → 12 放逐、9 存活 → 潛行者夜間暗殺 9（穿透守衛）
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ 2: dests2 }),
      S.voteCustom({ 2: { 8: 9, 10: 12, 11: 12 } }),
      abstainAll,
      skipFor(['night.wolfsave', 'night.godsave', 'night.warlock'])
    ),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(3, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 12).alive, false, '12 號被放逐');
  eq(WV.H.p(g.g, 9).alive, false, '潛行者穿透守衛完成暗殺');
  eq(WV.H.p(g.g, 9).deathCause, 'ASSASSIN', '死因暗殺');
}

// ---- 潛行者不能穿透村舍 ----
{
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 40 } });
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ all: cottageAll(12) }),
      S.voteCustom({ 2: { 8: 9, 10: 12, 11: 12 } }),
      abstainAll, skipFor(['night.wolfsave', 'night.godsave'])
    ),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(3, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 9).alive, true, '村舍阻止暗殺');
  const stalkerLog = (WV.H.p(g.g, 8).privateLog || []).find((e) => e.kind === 'assassinFailed');
  ok(stalkerLog, '潛行者收到暗殺失敗通知');
}

// ---- 女巫：批次一救援、瀕死用藥、自救設定 ----
{
  // 女巫在水井（相鄰農田）目睹狼刀並救援
  const dests = cottageAll(12);
  Object.assign(dests, { 1: 'farm', 9: 'farm', 5: 'well' });
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 40 } });
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ 1: dests }), abstainAll,
      S.stageCustom({
        'night.wolfsave': (game, seat) => {
          const you = WV.Views.youAwait(game, seat);
          eq(you.list.length, 1, '女巫看見一名瀕死者');
          eq(you.list[0].seat, 9, '瀕死者是 9 號');
          game.submit(seat, 'save', { target: 9 });
          return true;
        },
      }),
      skipFor(['night.godattack', 'night.godsave'])
    ),
    nightAction: (game) => { game.submit(1, 'kill', {}); S.nightActs({ 1: 'none' })(game); },
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 9).alive, true, '解藥救回狼刀目標');
  eq(g.g.resources.herb, 0, '藥草消耗 1（初始 1）');
  ok((WV.H.p(g.g, 9).privateLog || []).some((e) => e.kind === 'saved'), '被救者私下得知獲救');
}

// ---- 女巫自救設定 ----
for (const allow of [true, false]) {
  const dests = cottageAll(12);
  Object.assign(dests, { 1: 'farm', 5: 'farm' }); // 狼 + 女巫獨處 → 刀女巫
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 40, witchSelfSave: allow } });
  let sawStage = false;
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ 1: dests }), abstainAll,
      S.stageCustom({
        'night.wolfsave': (game, seat) => {
          sawStage = true;
          const you = WV.Views.youAwait(game, seat);
          eq(you.list.length, 1, '自救設定開啟時看得見自己');
          game.submit(seat, 'save', { target: seat });
          return true;
        },
      }),
      skipFor(['night.godattack', 'night.godsave'])
    ),
    nightAction: (game) => { game.submit(1, 'kill', {}); S.nightActs({ 1: 'none' })(game); },
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  if (allow) {
    ok(sawStage, '自救開啟：救援窗口出現');
    eq(WV.H.p(g.g, 5).alive, true, '女巫自救成功');
  } else {
    ok(!sawStage, '自救關閉：無可救目標，窗口不出現');
    eq(WV.H.p(g.g, 5).alive, false, '女巫死亡');
  }
}

// ---- 女巫毒藥與解藥互斥 + 一份解藥取消同批次全部攻擊（毒+暗殺同目標，術士挽救）----
{
  const rolesW = ['wolf', 'wolf', 'warlock', 'seer', 'witch', 'hunter', 'guard', 'stalker', 'villager', 'villager', 'villager', 'villager'];
  const dests2 = cottageAll(12);
  Object.assign(dests2, { 5: 'farm', 9: 'farm' }); // 女巫與 9 號同地 → 可毒
  const g = S.game({ roles: rolesW, settings: { initialFood: 40 } });
  let godsaveAppeared = false;
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ 1: cottageAll(12), 2: dests2 }),
      S.voteCustom({ 2: { 8: 9, 10: 12, 11: 12 } }), // 潛行者投 9，9 未被放逐
      abstainAll,
      S.stageCustom({
        'night.godattack': (game, seat) => {
          const you = WV.Views.youAwait(game, seat);
          if (you.assassinTarget) { game.submit(seat, 'assassinate', { confirm: true }); return true; }
          if (you.poisonTargets) {
            eq(you.poisonTargets.some((t) => t.seat === 9), true, '毒藥目標含同地點 9 號');
            game.submit(seat, 'poison', { target: 9 });
            return true;
          }
          game.submit(seat, 'skip', {});
          return true;
        },
        'night.godsave': () => { godsaveAppeared = true; return false; },
        'night.warlock': (game, seat) => {
          const you = WV.Views.youAwait(game, seat);
          eq(you.list.length, 1, '術士看見一名神職瀕死者');
          eq(you.list[0].seat, 9, '瀕死者是 9 號（毒+暗殺同批次）');
          game.submit(seat, 'rescue', { target: 9 });
          return true;
        },
      }),
      skipFor(['night.wolfsave'])
    ),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(3, 'dawn.reveal'),
  });
  ok(!godsaveAppeared, '用毒女巫不能再用解藥（窗口不出現）');
  eq(WV.H.p(g.g, 9).alive, true, '術士一次挽救取消毒+暗殺');
  eq(WV.H.p(g.g, 3).warlockUsed, true, '術士技能每局一次');
  ok((WV.H.p(g.g, 9).privateLog || []).some((e) => e.kind === 'savedByUnknown'), '被救者只知被未知力量救回');
  eq(g.g.resources.herb, 0, '毒藥消耗藥草');
}

// ---- 花蝴蝶：封鎖預言家、封鎖狼隊、封鎖守衛 ----
{
  const rolesBF = ['wolf', 'wolf', 'wolf', 'butterfly', 'seer', 'witch', 'guard', 'stalker', 'villager', 'villager', 'villager', 'villager'];
  // A) 擁抱預言家 → 查驗失效
  {
    const g = S.game({ roles: rolesBF, settings: { initialFood: 40 } });
    let seerAwaited = false;
    S.D.run(g, {
      custom: S.combine(
        S.destCustom({ all: cottageAll(12) }), abstainAll,
        S.stageCustom({
          'night.butterfly': (game, seat) => { game.submit(seat, 'hug', { target: 5 }); return true; },
          'night.postinfo': (game, seat) => {
            const you = WV.Views.youAwait(game, seat);
            if (you.checkTargets) seerAwaited = true;
            game.submit(seat, 'skip', {});
            return true;
          },
        }),
        skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
      ),
      nightAction: S.nightActs({}),
      stopAt: S.stopAtDay(2, 'dawn.reveal'),
    });
    ok(!seerAwaited, '被擁抱預言家不進入查驗階段');
    ok((WV.H.p(g.g, 5).privateLog || []).some((e) => e.kind === 'hugged'), '被擁抱者知道被封鎖');
    eq(WV.H.p(g.g, 4).butterflyUses, 1, '擁抱消耗次數');
  }
  // B) 擁抱狼人 → 全隊封刀
  {
    const dests = cottageAll(12);
    Object.assign(dests, { 2: 'farm', 9: 'farm' });
    const g = S.game({ roles: rolesBF, settings: { initialFood: 40 } });
    S.D.run(g, {
      custom: S.combine(
        S.destCustom({ 1: dests }), abstainAll,
        S.stageCustom({
          'night.butterfly': (game, seat) => { game.submit(seat, 'hug', { target: 1 }); return true; },
        }),
        skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
      ),
      nightAction: (game) => {
        eq(WV.Views.nightScene(game, 2).actions.canKill, false, '全隊封刀');
        const r = game.submit(2, 'kill', {});
        ok(!r.ok, '封刀後不可出刀');
        S.nightActs({})(game);
      },
      stopAt: S.stopAtDay(2, 'dawn.reveal'),
    });
    eq(WV.H.p(g.g, 9).alive, true, '好人平安');
  }
  // C) 擁抱守衛 → 巡邏失效並改為工作
  {
    const dests = cottageAll(12);
    Object.assign(dests, { 3: 'farm', 9: 'farm', 7: { patrol: ['farm', 'well'], goto: 'well' } });
    const g = S.game({ roles: rolesBF, settings: { initialFood: 40 } });
    S.D.run(g, {
      custom: S.combine(
        S.destCustom({ 1: dests }), abstainAll,
        S.stageCustom({
          'night.butterfly': (game, seat) => { game.submit(seat, 'hug', { target: 7 }); return true; },
          'night.guardredo': (game, seat) => { game.submit(seat, 'move', { loc: 'well' }); return true; },
        }),
        skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
      ),
      nightAction: (game) => {
        eq(WV.Views.nightScene(game, 3).actions.canKill, true, '守衛失效後可出刀');
        game.submit(3, 'kill', {});
        S.nightActs({ 3: 'none' })(game);
      },
      stopAt: S.stopAtDay(2, 'dawn.reveal'),
    });
    eq(WV.H.p(g.g, 9).alive, false, '巡邏失效，好人被刀');
    ok((WV.H.p(g.g, 7).privateLog || []).some((e) => e.kind === 'patrolBlocked'), '守衛收到巡邏失效通知');
  }
}

console.log('roles A OK');
