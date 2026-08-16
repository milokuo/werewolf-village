/* AI 整局測試：AIManager 驅動、虛擬時鐘快轉，遊戲必須完賽且不變量成立 */
const WV = require('./harness.js');
require('../ai/ai.js');
const { checkInvariants } = require('./driver.js');

function runAIGame(opts) {
  const n = opts.size || 12;
  const players = [];
  for (let i = 1; i <= n; i++) players.push({ name: 'AI' + i, isAI: true });
  const settings = Object.assign({}, opts.settings || {});
  if (!settings.boardId && n === 12) settings.boardId = 'b444_idiot';
  if (n !== 12 && !settings.customRoles) {
    settings.boardId = 'custom';
    const wolves = Math.max(1, Math.floor(n / 4));
    const roles = [];
    for (let i = 0; i < wolves; i++) roles.push('wolf');
    roles.push('seer', 'witch');
    if (n - roles.length > 2) roles.push('guard');
    while (roles.length < n) roles.push('villager');
    settings.customRoles = roles;
  }
  const engine = new WV.Game({ players, settings, seed: opts.seed, speed: 0.02 });
  const mgr = new WV.AIManager(engine);
  engine.start(0);
  let now = 0, iters = 0;
  while (!engine.ended) {
    if (++iters > 400000) throw new Error('AI 局未收斂：卡在 ' + (engine.g.stage && engine.g.stage.id) + ' day=' + engine.g.day);
    mgr.tick(now);
    engine.tick(now);
    now += 25;
  }
  checkInvariants(engine);
  return engine;
}

let wolf = 0, good = 0, totalDays = 0;
const boards = ['b444_idiot', 'b444_fox', 'b4431_admirer', 'b444_knight', 'b444_stalker', 'b444_warlock', 'b444_butterfly'];
let games = 0;
for (const boardId of boards) {
  for (let seed = 11; seed <= 13; seed++) {
    const e = runAIGame({ size: 12, seed, settings: { boardId } });
    games++;
    totalDays += e.g.day;
    if (e.g.winner.side === 'wolf') wolf++; else good++;
  }
}
for (const size of [6, 9, 15]) {
  for (let seed = 31; seed <= 32; seed++) {
    const e = runAIGame({ size, seed });
    games++;
    totalDays += e.g.day;
    if (e.g.winner.side === 'wolf') wolf++; else good++;
  }
}
// 自由發言模式 + 每晚重抽外觀 + 屠城
{
  const e = runAIGame({ size: 12, seed: 99, settings: { boardId: 'b444_warlock', speechMode: 'free', reshuffleAppearance: true, wolfWinMode: 'city' } });
  games++;
  if (e.g.winner.side === 'wolf') wolf++; else good++;
}
console.log(`ai OK：${games} 局（狼 ${wolf}／好 ${good}，平均 ${(totalDays / games).toFixed(1)} 天）`);
