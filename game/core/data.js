/* 《人狼村》機械數據：陣營、職業、地點、地圖、板子、建設、常數
   規則來源：GAME_RULES_FINAL_ZH_TW.md 與 INTERNAL_RULE_SPEC_ZH_TW.md */
(function () {
  const WV = (globalThis.WV = globalThis.WV || {});

  // ---- 陣營 ----
  WV.FACTION = { WOLF: 'WOLF', GOD: 'GOD', CIVILIAN: 'CIVILIAN' };

  // ---- 職業 ----
  // faction: 所屬陣營（內部分類）；wolfSide: 是否狼人陣營
  WV.ROLES = {
    villager:  { id: 'villager',  name: '平民',     faction: 'CIVILIAN' },
    seer:      { id: 'seer',      name: '預言家',   faction: 'GOD' },
    witch:     { id: 'witch',     name: '女巫',     faction: 'GOD' },
    hunter:    { id: 'hunter',    name: '獵人',     faction: 'GOD' },
    idiot:     { id: 'idiot',     name: '白癡',     faction: 'GOD' },
    fox:       { id: 'fox',       name: '九尾狐',   faction: 'GOD' },
    elder:     { id: 'elder',     name: '禁票長老', faction: 'GOD' },
    knight:    { id: 'knight',    name: '騎士',     faction: 'GOD' },
    stalker:   { id: 'stalker',   name: '潛行者',   faction: 'GOD' },
    butterfly: { id: 'butterfly', name: '花蝴蝶',   faction: 'GOD' },
    guard:     { id: 'guard',     name: '守衛',     faction: 'GOD' },
    wolf:      { id: 'wolf',      name: '狼人',     faction: 'WOLF' },
    warlock:   { id: 'warlock',   name: '暗夜術士', faction: 'WOLF' },
    admirer:   { id: 'admirer',   name: '暗戀者',   faction: 'CIVILIAN' },
  };
  WV.isWolfRole = (roleId) => WV.ROLES[roleId].faction === 'WOLF';

  // ---- 地點 ----
  // produce: 每名有效工作者產量; cap: 產量計入上限; resource: food/material/herb
  WV.LOCATIONS = {
    square:     { id: 'square',     name: '廣場',     tier: 6,  resource: null,       produce: 0, cap: Infinity },
    farm:       { id: 'farm',       name: '農田',     tier: 6,  resource: 'food',     produce: 2, cap: 3 },
    well:       { id: 'well',       name: '水井',     tier: 6,  resource: null,       produce: 0, cap: 1 },
    smithy:     { id: 'smithy',     name: '鐵匠鋪',   tier: 6,  resource: 'material', produce: 2, cap: 1 },
    cottage:    { id: 'cottage',    name: '村舍',     tier: 6,  resource: null,       produce: 0, cap: Infinity, isCottage: true },
    herbgarden: { id: 'herbgarden', name: '藥草園',   tier: 6,  resource: 'herb',     produce: 1, cap: 1 },
    mill:       { id: 'mill',       name: '磨坊',     tier: 9,  resource: 'food',     produce: 3, cap: 2 },
    lumber:     { id: 'lumber',     name: '伐木場',   tier: 9,  resource: 'material', produce: 1, cap: 3 },
    mine:       { id: 'mine',       name: '礦坑',     tier: 12, resource: 'material', produce: 3, cap: 1 },
    hunterhut:  { id: 'hunterhut',  name: '獵人小屋', tier: 12, resource: 'food',     produce: 8, cap: 1, causesAbsence: true },
    watchtower: { id: 'watchtower', name: '瞭望塔',   tier: 12, resource: null,       produce: 0, cap: 1 },
  };

  // 地圖連線（僅供女巫、守衛等相鄰能力判斷）
  WV.MAP_EDGES = [
    ['mill', 'cottage'],
    ['mill', 'square'],
    ['cottage', 'square'],
    ['square', 'well'],
    ['well', 'farm'],
    ['farm', 'herbgarden'],
    ['square', 'smithy'],
    ['smithy', 'lumber'],
    ['lumber', 'watchtower'],
    ['herbgarden', 'hunterhut'],
    ['watchtower', 'mine'],
  ];

  WV.adjacentOf = function (locId) {
    const out = [];
    for (const [a, b] of WV.MAP_EDGES) {
      if (a === locId) out.push(b);
      else if (b === locId) out.push(a);
    }
    return out;
  };
  WV.isAdjacent = function (a, b) {
    return WV.MAP_EDGES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  };

  // 依角色總數決定開放地點（開局判定後整局不變）
  WV.openLocations = function (totalRoles) {
    return Object.values(WV.LOCATIONS)
      .filter((l) => totalRoles >= l.tier)
      .map((l) => l.id);
  };

  // ---- 內建 12 人板子 ----
  WV.BOARDS = [
    { id: 'b444_idiot',   name: '444 預女獵白',   size: 12,
      roles: ['wolf','wolf','wolf','wolf','seer','witch','hunter','idiot','villager','villager','villager','villager'] },
    { id: 'b444_fox',     name: '444 預女獵九',   size: 12,
      roles: ['wolf','wolf','wolf','wolf','seer','witch','hunter','fox','villager','villager','villager','villager'] },
    { id: 'b4431_admirer',name: '4431 預女獵白戀', size: 12,
      roles: ['wolf','wolf','wolf','wolf','seer','witch','hunter','idiot','villager','villager','villager','admirer'] },
    { id: 'b444_knight',  name: '444 禁騎',       size: 12,
      roles: ['wolf','wolf','wolf','wolf','seer','witch','knight','elder','villager','villager','villager','villager'] },
    { id: 'b444_stalker', name: '444 禁潛',       size: 12,
      roles: ['wolf','wolf','wolf','wolf','seer','witch','stalker','elder','villager','villager','villager','villager'] },
    { id: 'b444_warlock', name: '444 暗禁',       size: 12,
      roles: ['wolf','wolf','wolf','warlock','seer','witch','stalker','elder','villager','villager','villager','villager'] },
    { id: 'b444_butterfly',name: '444 花蝴蝶',    size: 12,
      roles: ['wolf','wolf','wolf','wolf','seer','butterfly','stalker','hunter','villager','villager','villager','villager'] },
  ];

  // ---- 廣場建設 ----
  // 費用依角色總數級距：6–8 / 9–11 / 12–15
  WV.CONSTRUCTIONS = {
    lamp:   { id: 'lamp',   name: '大燈',   cost: { t6: 4, t9: 8,  t12: 12 } },
    fence:  { id: 'fence',  name: '柵欄',   cost: { t6: 4, t9: 8,  t12: 12 } },
    beacon: { id: 'beacon', name: '烽火台', cost: { t6: 8, t9: 15, t12: 25 } },
  };
  WV.constructionCost = function (constructionId, totalRoles) {
    const c = WV.CONSTRUCTIONS[constructionId].cost;
    if (totalRoles >= 12) return c.t12;
    if (totalRoles >= 9) return c.t9;
    return c.t6;
  };

  // ---- 匿名外觀池 ----
  WV.APPEARANCES = [
    { id: 'ap01', name: '靛藍兜帽', color: '#3b4a8c' },
    { id: 'ap02', name: '灰燼面具', color: '#6e6a66' },
    { id: 'ap03', name: '枯葉斗篷', color: '#8a6d3b' },
    { id: 'ap04', name: '烏羽兜帽', color: '#2f3038' },
    { id: 'ap05', name: '苔綠斗篷', color: '#4c6b3c' },
    { id: 'ap06', name: '暗紅面具', color: '#7c3434' },
    { id: 'ap07', name: '霧白披風', color: '#9aa0a6' },
    { id: 'ap08', name: '黑檀面具', color: '#241f1c' },
    { id: 'ap09', name: '麥稈斗篷', color: '#b3924f' },
    { id: 'ap10', name: '石灰兜帽', color: '#7d8471' },
    { id: 'ap11', name: '深紫披風', color: '#4d3a63' },
    { id: 'ap12', name: '鏽鐵面具', color: '#78503a' },
    { id: 'ap13', name: '月白兜帽', color: '#c8cfd8' },
    { id: 'ap14', name: '炭黑斗篷', color: '#33302e' },
    { id: 'ap15', name: '橡實面具', color: '#6d4f2f' },
    { id: 'ap16', name: '藤蔓披風', color: '#3f5d4c' },
    { id: 'ap17', name: '霜藍面具', color: '#5f7d99' },
    { id: 'ap18', name: '暮金兜帽', color: '#9c7a2f' },
  ];

  // ---- 死因 ----
  WV.CAUSE = {
    WOLF_KILL: 'WOLF_KILL',         // 狼刀
    WOLF_SUICIDE: 'WOLF_SUICIDE',   // 狼人夜間自殺
    POISON: 'POISON',               // 女巫毒殺
    ASSASSIN: 'ASSASSIN',           // 潛行者暗殺
    EXILE: 'EXILE',                 // 一般放逐
    FAMINE: 'FAMINE',               // 飢荒處決
    DUEL: 'DUEL',                   // 騎士決鬥（狼人目標死亡）
    DUEL_BACKFIRE: 'DUEL_BACKFIRE', // 騎士決鬥失敗（騎士死亡）
    HUNTER_TAKE: 'HUNTER_TAKE',     // 獵人帶走
    EXPLODE: 'EXPLODE',             // 狼人自爆
    ADMIRER_SUB: 'ADMIRER_SUB',     // 暗戀者代死
    ADMIRER_FOLLOW: 'ADMIRER_FOLLOW', // 猜錯殉情（兩人一同死亡中的暗戀者）
    FOX_DRAIN: 'FOX_DRAIN',         // 九尾狐尾盡
  };

  // 夜間直接殺害中，「一般夜間直接擊殺」的集合（受村舍/柵欄/守衛阻止，除非明確穿透）
  // 潛行者暗殺穿透柵欄與守衛，但不穿透村舍。
  WV.NIGHT_KILL_CAUSES = [WV.CAUSE.WOLF_KILL, WV.CAUSE.WOLF_SUICIDE, WV.CAUSE.POISON, WV.CAUSE.ASSASSIN];

  // ---- 房主設定預設 ----
  WV.DEFAULT_SETTINGS = {
    boardId: 'b444_idiot',      // 內建板子；'custom' 表示自訂
    customRoles: null,          // 自訂職業陣列
    wolfWinMode: 'side',        // 'side' 屠邊 | 'city' 屠城
    speechMode: 'turns',        // 'turns' 輪流發言 | 'free' 自由發言
    speechSeconds: 60,          // 輪流發言每人秒數
    meetingSeconds: 180,        // 自由發言總秒數 / 輪流發言後補充討論
    initialFood: null,          // null = 依角色總數（下限）
    witchSelfSave: true,        // 女巫能否自救
    resourceInfoMode: 2,        // 1 只庫存 / 2 庫存+總變動（標準）/ 3 各地點變動
    reshuffleAppearance: false, // 匿名外觀與音色每晚重抽
    fillWithAI: true,           // AI 補足空缺
    aiSpeechSeconds: 5,         // AI 發言展示秒數
  };

  // ---- 計時常數（秒）----
  WV.TIMING = {
    LAST_WORDS: 15,       // 遺言
    NIGHT_ACTION: 15,     // 夜間地點行動
    WORK_REQUIRED: 10,    // 有效工作累計秒數
    WOLF_CHAT: 30,        // 狼隊討論
    ADMIRER_GUESS: 15,    // 暗戀猜測
    VOTE: 25,             // 各類投票
    ABILITY: 20,          // 夜間能力選擇（查驗/用藥/禁票等）
    DESTINATION: 25,      // 目的地最終確認
    ELECTION_SPEECH: 45,  // 競選發言
    PK_SPEECH: 30,        // 平票補充發言
    BADGE_TRANSFER: 20,   // 警徽移交選擇
    DAWN_REVEAL: 8,       // 黎明公布展示
    INTERMISSION: 5,      // 階段間過場
  };

  WV.MIN_PLAYERS = 6;
  WV.MAX_PLAYERS = 15;
})();
