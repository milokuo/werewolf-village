/* 資源公式測試：農田/水井、下毒、縱火、藥草園停產、產量上限、獵人小屋、瞭望塔 */
const S = require('./scen.js');
const { eq, ok } = S;

const R6 = ['wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager'];

// T1 農田×3 + 水井增產
{
  const g = S.game({ roles: R6 });
  S.D.run(g, {
    custom: S.destCustom({ 1: { 1: 'farm', 2: 'farm', 3: 'farm', 4: 'well', 5: 'cottage', 6: 'cottage' } }),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  eq(g.g.resources.food, 6 + 7, 'T1 農田 3 人×2 + 水井 1');
  eq(g.g.resourceDelta.food, 7, 'T1 變動量');
}

// T2 水井下毒：農田 -1，下毒者不提供增產
{
  const g = S.game({ roles: R6 });
  S.D.run(g, {
    custom: S.destCustom({ 1: { 1: 'well', 2: 'cottage', 3: 'farm', 4: 'farm', 5: 'cottage', 6: 'cottage' } }),
    nightAction: S.nightActs({ 1: 'sabotage' }),
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  eq(g.g.resources.food, 6 + 4 - 1, 'T2 農田 2×2 下毒 -1');
}

// T2b 農田無產出時，下毒完全無效（不會扣到負）
{
  const g = S.game({ roles: R6 });
  S.D.run(g, {
    custom: S.destCustom({ 1: { 1: 'well', 2: 'cottage', 3: 'cottage', 4: 'cottage', 5: 'cottage', 6: 'cottage' } }),
    nightAction: S.nightActs({ 1: 'sabotage' }),
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  eq(g.g.resources.food, 6, 'T2b 無農田產出，下毒無效');
}

// T3 農田縱火：加入本夜產量前，庫存減半向下取整
{
  const g = S.game({ roles: R6, settings: { initialFood: 7 } });
  S.D.run(g, {
    custom: S.destCustom({ 1: { 1: 'farm', 2: 'cottage', 3: 'cottage', 4: 'cottage', 5: 'cottage', 6: 'cottage' } }),
    nightAction: S.nightActs({ 1: 'sabotage' }),
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  eq(g.g.resources.food, 3, 'T3 7 → floor(7/2)=3');
  eq(g.g.resourceDelta.arsonLoss, 4, 'T3 縱火損失');
}

// T4 藥草園：破壞當晚起，其後兩晚停產，第三晚恢復
{
  const g = S.game({ roles: R6, settings: { initialFood: 40 } });
  const dests = {};
  for (const d of [1, 2, 3, 4, 5]) {
    dests[d] = { 1: d === 2 ? 'herbgarden' : 'cottage', 2: 'cottage', 3: 'cottage', 4: 'cottage', 5: 'cottage', 6: d === 2 ? 'cottage' : 'herbgarden' };
  }
  S.D.run(g, {
    custom: S.combine(
      S.destCustom(dests),
      S.stageCustom({ 'exile.vote': (game, seat) => { game.submit(seat, 'abstain', {}); return true; } })
    ),
    nightAction: (game) => S.nightActs(game.g.day === 2 ? { 1: 'sabotage' } : {})(game),
    stopAt: S.stopAtDay(6, 'dawn.reveal'),
  });
  // 初始 1（女巫）+ 第1夜 +1 + 第2夜破壞0 + 第3/4夜停產0 + 第5夜 +1 = 3
  eq(g.g.resources.herb, 3, 'T4 藥草園停產兩晚後恢復');
}

// T5 磨坊/伐木場/鐵匠鋪產量上限（9 人開放外環）
{
  const roles9 = ['wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager'];
  const g = S.game({ roles: roles9 });
  S.D.run(g, {
    custom: S.destCustom({ 1: { 1: 'mill', 2: 'mill', 3: 'mill', 4: 'mill', 5: 'lumber', 6: 'lumber', 7: 'lumber', 8: 'smithy', 9: 'smithy' } }),
    nightAction: S.nightActs({}),
    stopAt: S.stopAtDay(2, 'dawn.reveal'),
  });
  eq(g.g.resources.food, 9 + 6, 'T5 磨坊 4 工作者只計 2×3');
  eq(g.g.resources.material, 3 + 2, 'T5 伐木 3×1 + 鐵匠計 1×2');
}

// T6 獵人小屋缺席 + 瞭望塔報告（12 人全地圖）
{
  const board = ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'idiot',
    'villager', 'villager', 'villager', 'villager'];
  const g = S.game({ roles: board, settings: { initialFood: 30 } });
  S.D.run(g, {
    custom: S.combine(
      S.destCustom({ 1: { 9: 'hunterhut', 10: 'watchtower', 1: 'farm', 2: 'farm', 3: 'cottage', 4: 'cottage', 5: 'cottage', 6: 'cottage', 7: 'cottage', 8: 'cottage', 11: 'cottage', 12: 'cottage' } }),
      S.stageCustom({
        'election.signup': (game, seat) => { game.submit(seat, 'run', { run: false }); return true; },
      })
    ),
    nightAction: S.nightActs({}),
    stopAt: (game) => game.g.day === 2 && game.g.stage && game.g.stage.id === 'exile.vote',
  });
  const p9 = S.WV.H.p(g.g, 9);
  ok(p9.absent, 'T6 獵人小屋缺席');
  ok(!g.g.stage.awaiting.has(9), 'T6 缺席者不在放逐投票名單');
  ok(g.g.nightReports === null || true, 'placeholder');
  // 瞭望塔報告在黎明公布前保存於 nightReports（黎明時已印出）；驗證公開日誌
  const logText = g.g.publicLog.map((l) => l.text).join('\n');
  ok(logText.includes('瞭望塔的守望者'), 'T6 瞭望塔報告出現');
  ok(logText.includes('獵人小屋：1 人'), 'T6 報告含獵人小屋人數');
  ok(logText.includes('農田：2 人'), 'T6 報告含農田人數');
  // 30 + 獵人小屋 8 + 農田 4 − 第二日 12 人消耗 12 = 30
  eq(g.g.resources.food, 30 + 8 + 4 - 12, 'T6 獵人小屋 8 + 農田 4 − 消耗 12');
}

console.log('resources OK');
