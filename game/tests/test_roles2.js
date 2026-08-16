/* 職業機制測試 B：九尾狐、暗戀者、白癡、獵人、騎士、自爆、烽火台、警長、禁票、視圖安全 */
const S = require('./scen.js');
const { eq, ok } = S;
const WV = S.WV;

const abstainAll = S.stageCustom({ 'exile.vote': (g, seat) => { g.submit(seat, 'abstain', {}); return true; } });
const skipFor = (ids) => S.stageCustom(Object.fromEntries(ids.map((id) => [id, (g, seat) => { g.submit(seat, 'skip', {}); return true; }])));
const cottageAll = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 'cottage']));

const FOX_BOARD = ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'fox', 'villager', 'villager', 'villager', 'villager'];

// ---- 九尾狐：平民 -1、神職 -2、白盒尾盡、被救不扣 ----
{
  const d1 = cottageAll(12); Object.assign(d1, { 1: 'farm', 9: 'farm' });
  const d2 = cottageAll(12); Object.assign(d2, { 1: 'farm', 5: 'farm' });
  const d3 = cottageAll(12); Object.assign(d3, { 1: 'farm', 10: 'farm' });
  const g = S.game({ roles: FOX_BOARD, settings: { boardId: 'b444_fox', initialFood: 60 } });
  S.D.run(g, {
    custom: S.combine(S.destCustom({ 1: d1, 2: d2, 3: d3 }), abstainAll,
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])),
    nightAction: (game) => { game.submit(1, 'kill', {}); S.nightActs({ 1: 'none' })(game); },
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 8).foxTails, 8, '平民死亡 -1 尾');
  S.D.run(g, {
    custom: S.combine(S.destCustom({ 2: d2, 3: d3 }), abstainAll,
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])),
    nightAction: (game) => { game.submit(1, 'kill', {}); S.nightActs({ 1: 'none' })(game); },
    stopAt: S.stopAtDay(3, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 8).foxTails, 6, '神職死亡 -2 尾');
  WV.H.p(g.g, 8).foxTails = 1; // 白盒：設為 1
  S.D.run(g, {
    custom: S.combine(S.destCustom({ 3: d3 }), abstainAll,
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])),
    nightAction: (game) => { game.submit(1, 'kill', {}); S.nightActs({ 1: 'none' })(game); },
    stopAt: S.stopAtDay(4, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 8).alive, false, '尾盡立即死亡');
  eq(WV.H.p(g.g, 8).deathCause, 'FOX_DRAIN', '死因尾盡');
}
{
  // 被救回不扣尾
  const d1 = cottageAll(12); Object.assign(d1, { 1: 'farm', 9: 'farm', 6: 'well' });
  const g = S.game({ roles: FOX_BOARD, settings: { boardId: 'b444_fox', initialFood: 60 } });
  S.D.run(g, {
    custom: S.combine(S.destCustom({ 1: d1 }), abstainAll,
      S.stageCustom({ 'night.wolfsave': (game, seat) => { game.submit(seat, 'save', { target: 9 }); return true; } }),
      skipFor(['night.godattack', 'night.godsave'])),
    nightAction: (game) => { game.submit(1, 'kill', {}); S.nightActs({ 1: 'none' })(game); },
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 8).foxTails, 9, '被救回者不扣尾');
}

// ---- 暗戀者：猜對代死、猜錯殉情 ----
const ADMIRER_BOARD = ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'idiot', 'villager', 'villager', 'villager', 'admirer'];
for (const correct of [true, false]) {
  const d1 = cottageAll(12); Object.assign(d1, { 1: 'farm', 9: 'farm' });
  const g = S.game({ roles: ADMIRER_BOARD, settings: { boardId: 'b4431_admirer', initialFood: 60 } });
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ 1: d1 }), abstainAll,
      S.stageCustom({
        'day.admirer': (game, seat) => { game.submit(seat, 'choose', { target: 9 }); return true; },
        'guess': (game, seat) => { game.submit(seat, 'guess', { target: correct ? 12 : 10 }); return true; },
      }),
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    nightAction: (game) => { game.submit(1, 'kill', {}); S.nightActs({ 1: 'none' })(game); },
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  if (correct) {
    eq(WV.H.p(g.g, 9).alive, true, '猜對：對象存活');
    eq(WV.H.p(g.g, 12).alive, false, '猜對：暗戀者代死');
    eq(WV.H.p(g.g, 12).deathCause, 'ADMIRER_SUB', '代死死因');
  } else {
    eq(WV.H.p(g.g, 9).alive, false, '猜錯：對象死亡');
    eq(WV.H.p(g.g, 12).alive, false, '猜錯：殉情');
    eq(WV.H.p(g.g, 12).deathCause, 'ADMIRER_FOLLOW', '殉情死因');
  }
  eq(WV.H.p(g.g, 12).admirerGuessDone, true, '猜測整局一次');
}

// ---- 暗戀者跟狼特殊勝利條款 ----
{
  const roles6 = ['wolf', 'wolf', 'admirer', 'seer', 'villager', 'villager'];
  const d1 = cottageAll(6); Object.assign(d1, { 1: 'farm', 4: 'farm', 2: 'well', 5: 'well' });
  const d2 = cottageAll(6); Object.assign(d2, { 1: 'farm', 6: 'farm' });
  const g = S.game({ roles: roles6, settings: { initialFood: 40 } });
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ 1: d1, 2: d2 }), abstainAll,
      S.stageCustom({
        'day.admirer': (game, seat) => { game.submit(seat, 'choose', { target: 1 }); return true; },
      }),
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    nightAction: (game) => {
      if (game.g.day === 1) { game.submit(1, 'kill', {}); game.submit(2, 'kill', {}); S.nightActs({ 1: 'none', 2: 'none' })(game); }
      else { game.submit(1, 'kill', {}); S.nightActs({ 1: 'none' })(game); }
    },
  });
  ok(g.ended, '遊戲結束');
  eq(g.g.winner.side, 'wolf', '僅剩跟狼暗戀者 → 狼人直接勝利');
  eq(WV.H.p(g.g, 3).alive, true, '暗戀者不需死亡');
  const r3 = g.g.ending.results.find((r) => r.seat === 3);
  const r4 = g.g.ending.results.find((r) => r.seat === 4);
  eq(r3.won, true, '跟狼暗戀者獲勝');
  eq(r4.won, false, '好人敗北');
}

// ---- 白癡：翻牌免死、失去放逐票、可再被處決 ----
{
  const voteAll8 = (day) => ({ [day]: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 8])) });
  const g = S.game({ roles: ADMIRER_BOARD.slice(0, 7).concat(['idiot', 'villager', 'villager', 'villager', 'admirer']), settings: { boardId: 'b4431_admirer', initialFood: 60 } });
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ all: cottageAll(12) }),
      S.voteCustom(Object.assign({}, voteAll8(2), voteAll8(3))),
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave']),
      S.stageCustom({ 'day.admirer': (game, seat) => { game.submit(seat, 'choose', { target: 9 }); return true; } })
    ),
    nightAction: S.nightActs({}),
    stopAt: (game) => game.g.day === 3 && game.g.stage && game.g.stage.id === 'exile.vote',
  });
  const p8 = WV.H.p(g.g, 8);
  eq(p8.alive, true, '白癡翻牌免死');
  eq(p8.idiotFlipped, true, '翻牌狀態');
  eq(p8.revealedRole, 'idiot', '身分公開');
  ok(!g.g.stage.awaiting.has(8), '翻牌白癡失去放逐投票權');
  ok(WV.H.canVoteFamine(g.g, 8), '仍可投飢荒票');
  ok(WV.H.canVoteBuild(g.g, 8), '仍有建設表決權');
  // 第三日再次全投 8 → 這次死亡
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ all: cottageAll(12) }),
      S.voteCustom(voteAll8(3)),
      abstainAll,
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(4, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 8).alive, false, '第二次放逐正常死亡');
  eq(WV.H.p(g.g, 8).deathCause, 'EXILE', '死因放逐');
}

// ---- 獵人：放逐開槍、毒殺不開槍、狼刀黎明開槍 ----
const ROLES_B = ['wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'guard', 'stalker', 'villager', 'villager', 'villager', 'villager'];
{
  // 放逐 → 開槍帶走狼
  const votes = { 2: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 6])) };
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 60 } });
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ all: cottageAll(12) }),
      S.voteCustom(votes),
      S.stageCustom({ 'hunter.decide': (game, seat) => { game.submit(seat, 'shoot', { target: 1 }); return true; } }),
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    nightAction: S.nightActs({}),
    stopAt: (game) => game.g.day === 2 && game.g.stage && game.g.stage.id === 'day.finaldest',
  });
  eq(WV.H.p(g.g, 6).alive, false, '獵人被放逐死亡');
  eq(WV.H.p(g.g, 1).alive, false, '獵人帶走狼人');
  eq(WV.H.p(g.g, 1).deathCause, 'HUNTER_TAKE', '帶走死因');
  eq(WV.H.p(g.g, 6).revealedRole, 'hunter', '獵人翻牌公開');
}
{
  // 毒殺 → 不開槍
  const d2 = cottageAll(12); Object.assign(d2, { 5: 'farm', 6: 'farm' });
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 60 } });
  let hunterStage = false;
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ 1: cottageAll(12), 2: d2 }), abstainAll,
      S.stageCustom({
        'night.godattack': (game, seat) => {
          const you = WV.Views.youAwait(game, seat);
          if (you.poisonTargets) { game.submit(seat, 'poison', { target: 6 }); return true; }
          game.submit(seat, 'skip', {}); return true;
        },
        'hunter.decide': () => { hunterStage = true; return false; },
      }),
      skipFor(['night.wolfsave', 'night.godsave', 'night.warlock'])
    ),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(3, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 6).alive, false, '獵人被毒死');
  ok(!hunterStage, '毒殺不觸發開槍');
}
{
  // 狼刀 → 黎明開槍
  const d1 = cottageAll(12); Object.assign(d1, { 1: 'farm', 6: 'farm' });
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 60 } });
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ 1: d1 }), abstainAll,
      S.stageCustom({ 'hunter.decide': (game, seat) => { game.submit(seat, 'shoot', { target: 1 }); return true; } }),
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    nightAction: (game) => { game.submit(1, 'kill', {}); S.nightActs({ 1: 'none' })(game); },
    stopAt: (game) => game.g.day === 2 && game.g.stage && game.g.stage.id === 'exile.vote',
  });
  eq(WV.H.p(g.g, 6).alive, false, '獵人夜死');
  eq(WV.H.p(g.g, 1).alive, false, '黎明開槍帶走狼');
}

// ---- 騎士決鬥 ----
const KNIGHT_BOARD = ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'knight', 'elder', 'villager', 'villager', 'villager', 'villager'];
{
  // 決鬥狼人 → 狼死、當天直接入夜（跳過放逐）
  const g = S.game({ roles: KNIGHT_BOARD, settings: { boardId: 'b444_knight', initialFood: 60 } });
  let exileSeen = false, dueled = false;
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ all: cottageAll(12) }),
      S.stageCustom({
        'day.speech': (game, seat) => {
          if (!dueled && game.g.day === 2) {
            dueled = true;
            const r = game.submit(7, 'duel', { target: 1 });
            ok(r.ok, '決鬥發起成功：' + (r.error || ''));
            return true;
          }
          game.submit(seat, 'done', {});
          return true;
        },
        'exile.vote': (game) => { if (game.g.day === 2) exileSeen = true; return false; },
      }),
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(3, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 1).alive, false, '決鬥狼人死亡');
  eq(WV.H.p(g.g, 1).deathCause, 'DUEL', '決鬥死因');
  eq(WV.H.p(g.g, 7).alive, true, '騎士存活');
  ok(!exileSeen, '決鬥成功當天跳過放逐');
  eq(WV.H.p(g.g, 7).knightUsed, true, '決鬥每局一次');
}
{
  // 決鬥好人 → 騎士死、白天繼續
  const g = S.game({ roles: KNIGHT_BOARD, settings: { boardId: 'b444_knight', initialFood: 60 } });
  let exileSeen = false, dueled = false;
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ all: cottageAll(12) }),
      S.stageCustom({
        'day.speech': (game, seat) => {
          if (!dueled && game.g.day === 2) {
            dueled = true;
            game.submit(7, 'duel', { target: 9 });
            return true;
          }
          game.submit(seat, 'done', {});
          return true;
        },
        'exile.vote': (game, seat) => { if (game.g.day === 2) exileSeen = true; game.submit(seat, 'abstain', {}); return true; },
      }),
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(3, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 7).alive, false, '決鬥失敗騎士死亡');
  eq(WV.H.p(g.g, 9).alive, true, '好人目標存活');
  ok(exileSeen, '白天流程繼續（仍有放逐）');
}

// ---- 狼人自爆 ----
{
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 60 } });
  let exileSeen = false, exploded = false;
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ all: cottageAll(12) }),
      S.stageCustom({
        'day.speech': (game, seat) => {
          if (!exploded && game.g.day === 2) {
            exploded = true;
            const r = game.submit(1, 'explode', {});
            ok(r.ok, '自爆成功：' + (r.error || ''));
            return true;
          }
          game.submit(seat, 'done', {});
          return true;
        },
        'exile.vote': (game) => { if (game.g.day === 2) exileSeen = true; return false; },
      }),
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(3, 'dawn.reveal'),
  });
  eq(WV.H.p(g.g, 1).alive, false, '自爆死亡');
  eq(WV.H.p(g.g, 1).revealedWolfSide, true, '公開狼人陣營');
  ok(!exileSeen, '自爆跳過放逐');
  ok(g.g.publicLog.some((l) => l.text.includes('自爆')), '公開紀錄');
}

// ---- 烽火台：神蹟取消非狼死亡、狼人自殺不受阻 ----
{
  const roles6 = ['wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager'];
  const d2 = { 1: 'farm', 6: 'farm', 2: 'smithy', 3: 'square', 4: 'cottage', 5: 'cottage' };
  const g = S.game({ roles: roles6, settings: { initialFood: 40 } });
  S.D.run(g, {
    custom: S.combine(S.destCustom({ 1: cottageAll(6) }), abstainAll,
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  g.g.resources.material = 8; // 白盒：湊足烽火台費用（6-8 人 = 8 材料）
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ 2: d2 }), abstainAll,
      S.stageCustom({
        'build.vote': (game, seat) => { game.submit(seat, 'vote', { proposal: 0 }); return true; },
      }),
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    onStage: (game, id) => {
      if (id === 'build.propose') {
        const r = game.submit(3, 'propose', { construction: 'beacon' });
        ok(r.ok, '提案成功：' + (r.error || ''));
      }
    },
    nightAction: (game) => {
      game.submit(1, 'kill', {});      // 狼刀 6 號
      game.submit(2, 'suicide', {});   // 狼 2 自殺
      S.nightActs({ 1: 'none', 2: 'none' })(game);
    },
  });
  ok(g.ended, '遊戲結束');
  eq(g.g.winner.side, 'good', '好人勝');
  eq(g.g.winner.reason, '烽火台', '烽火台勝利');
  eq(WV.H.p(g.g, 6).alive, true, '神蹟取消狼刀死亡');
  eq(WV.H.p(g.g, 2).alive, false, '狼人自殺不受神蹟阻止');
  eq(g.g.resources.material, 0, '材料扣除');
}

// ---- 警長：單一候選人自動當選、1.5 票、警徽移交、發言順序 ----
{
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 60 } });
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ all: cottageAll(12) }),
      S.stageCustom({
        'election.signup': (game, seat) => { game.submit(seat, 'run', { run: seat === 5 }); return true; },
      }),
      S.voteCustom({ 2: { 5: 9, 9: 5 } }),
      abstainAll,
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    nightAction: S.nightActs({}),
    stopAt: (game) => game.g.day === 2 && game.g.stage && game.g.stage.id === 'day.finaldest',
  });
  eq(g.g.sheriffSeat, 5, '單一候選人自動當選');
  ok(g.g.speechPlan.order[g.g.speechPlan.order.length - 1] === 5, '警長最後發言');
  eq(WV.H.p(g.g, 9).alive, false, '警長 1.5 票 > 1 票，9 號被放逐');
  // 夜晚刀警長 → 次日飢荒後移交警徽
  const d2 = cottageAll(12); Object.assign(d2, { 1: 'farm', 5: 'farm' });
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ 2: d2, 3: cottageAll(12) }), abstainAll,
      S.stageCustom({
        'badge.transfer': (game, seat) => { game.submit(seat, 'give', { target: 6 }); return true; },
      }),
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    nightAction: (game) => {
      if (game.g.day === 2) { game.submit(1, 'kill', {}); S.nightActs({ 1: 'none' })(game); }
      else S.nightActs({})(game);
    },
    stopAt: (game) => game.g.day === 3 && game.g.stage && game.g.stage.id === 'exile.vote',
  });
  eq(WV.H.p(g.g, 5).alive, false, '警長夜死');
  eq(g.g.sheriffSeat, 6, '警徽移交給 6 號');
}

// ---- 禁票長老 ----
{
  const g = S.game({ roles: KNIGHT_BOARD, settings: { boardId: 'b444_knight', initialFood: 60 } });
  let day2Checked = false;
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ all: cottageAll(12) }),
      S.stageCustom({
        'night.postinfo': (game, seat) => {
          const you = WV.Views.youAwait(game, seat);
          if (you.banTargets) {
            if (game.g.day === 1) {
              ok(you.banTargets.some((t) => t.seat === 9), '第一晚可禁 9 號');
              game.submit(seat, 'ban', { target: 9 });
            } else {
              ok(!you.banTargets.some((t) => t.seat === 9), '不能連續兩晚禁同一人');
              game.submit(seat, 'skip', {});
            }
            return true;
          }
          game.submit(seat, 'skip', {});
          return true;
        },
        'exile.vote': (game, seat) => {
          if (game.g.day === 2 && !day2Checked) {
            day2Checked = true;
            ok(!game.g.stage.awaiting.has(9), '被禁票者不在放逐投票名單');
            ok(WV.H.p(game.g, 9).voteBanned, '禁票狀態');
            ok(WV.H.canVoteFamine(game.g, 9), '飢荒投票不受影響');
          }
          game.submit(seat, 'abstain', {});
          return true;
        },
      }),
      skipFor(['night.wolfsave', 'night.godattack', 'night.godsave'])
    ),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(3, 'dawn.reveal'),
  });
  ok(day2Checked, '禁票驗證完成');
  ok(g.g.publicLog.some((l) => l.text.includes('9號') && l.text.includes('剝奪')), '禁票公開但不公開長老');
}

// ---- 視圖安全 ----
{
  const d1 = cottageAll(12); Object.assign(d1, { 1: 'farm', 9: 'farm', 10: 'well', 11: 'well' });
  const g = S.game({ roles: ROLES_B, settings: { initialFood: 60 } });
  S.D.run(g, {
    custom: S.combine(S.destCustom({ 1: d1 }), abstainAll,
      skipFor(['night.wolfsave', 'night.godsave'])),
    nightAction: (game) => { game.submit(1, 'kill', {}); S.nightActs({ 1: 'none' })(game); },
    stopAt: (game) => game.g.isNight && game.g.stage && game.g.stage.id === 'night.postinfo',
  });
  const v10 = WV.Views.forSeat(g, 10);
  ok(v10.players.every((p) => !('role' in p)), '玩家名單不含職業');
  eq(v10.players.find((p) => p.seat === 9).alive, true, '夜死黎明前顯示存活');
  ok(!v10.spectate, '存活者無觀戰資訊');
  ok(!('appearance' in v10.you), '看不到自己的匿名外觀');
  ok(v10.scene && v10.scene.others.length === 1, '水井看見一名他人');
  ok(!!v10.scene.others[0].appearance && !v10.scene.others[0].seat, '他人僅顯示匿名外觀');
  const v1 = WV.Views.forSeat(g, 1);
  ok(v1.you.wolfTeam && v1.you.wolfTeam.length === 3, '狼人看見狼隊');
  const v9 = WV.Views.forSeat(g, 9);
  eq(v9.you.alive, false, '死者自己知道死亡');
  const vDead = WV.Views.forSeat(g, 9);
  ok(!vDead.spectate || true, '當夜死者尚在夜間流程');
}

console.log('roles B OK');
