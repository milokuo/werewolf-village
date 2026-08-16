/* 煙霧測試：多種子、多板子、多人數全自動整局，必須順利結束且不變量成立 */
const { makeGame, run, checkInvariants, WV } = require('./driver.js');

let games = 0, wolfWins = 0, goodWins = 0;
const boards = ['b444_idiot', 'b444_fox', 'b4431_admirer', 'b444_knight', 'b444_stalker', 'b444_warlock', 'b444_butterfly'];

for (const boardId of boards) {
  for (let seed = 1; seed <= 6; seed++) {
    const game = makeGame({ size: 12, seed, settings: { boardId } });
    run(game);
    checkInvariants(game);
    games++;
    if (game.g.winner.side === 'wolf') wolfWins++; else goodWins++;
  }
}

// 不同人數（自訂配置）
for (const size of [6, 8, 9, 11, 15]) {
  for (let seed = 100; seed < 104; seed++) {
    const game = makeGame({ size, seed });
    run(game);
    checkInvariants(game);
    games++;
    if (game.g.winner.side === 'wolf') wolfWins++; else goodWins++;
  }
}

// 屠城模式
for (let seed = 200; seed < 206; seed++) {
  const game = makeGame({ size: 12, seed, settings: { boardId: 'b444_warlock', wolfWinMode: 'city' } });
  run(game);
  checkInvariants(game);
  games++;
  if (game.g.winner.side === 'wolf') wolfWins++; else goodWins++;
}

console.log(`smoke OK：${games} 局完賽（狼勝 ${wolfWins}／好人勝 ${goodWins}）`);
