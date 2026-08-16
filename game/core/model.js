/* 《人狼村》狀態模型與規則判定輔助
   建立遊戲、玩家物件、存活/陣營/相鄰/保護等純函式。 */
(function () {
  const WV = (globalThis.WV = globalThis.WV || {});

  // ---- 建立玩家 ----
  function makePlayer(seat, name, isAI) {
    return {
      seat, name, isAI,
      connected: !isAI,       // 伺服器維護；AI 恆為「已連線」
      aiTakeover: false,      // 真人斷線由 AI 暫代
      role: null,
      alive: true,
      deathDay: null,
      deathCause: null,       // 不公開，只入私密紀錄
      // 公開狀態
      isSheriff: false,
      absent: false,          // 今日缺席（獵人小屋返程）
      voteBanned: false,      // 今日被禁一般放逐票
      idiotFlipped: false,    // 白癡已翻牌（公開，永久失去放逐票）
      revealedRole: null,     // 依技能主動公開的職業（白癡/獵人）
      revealedWolfSide: false,// 自爆公開「狼人陣營」
      // 祕密狀態
      appearanceId: null,
      nightPassUsed: false,   // 夜行令每局一張
      foxTails: 9,
      butterflyUses: 2,
      knightUsed: false,
      warlockUsed: false,
      hunterShotUsed: false,
      admirerTarget: null,    // 暗戀對象 seat
      admirerGuessDone: false,// 該暗戀者的猜測已觸發過
      elderLastTarget: null,  // 前一晚禁票對象（不能連選）
      guardLastPatrol: [],    // 前一晚巡邏兩地（不能連守）
      // 當晚暫態（每夜重置）
      night: null,
      // 明日狀態
      absentNext: false,
      voteBannedNext: false,
      lastExileVote: null,    // 今日最後一次有效放逐投票對象 seat（潛行者用）
    };
  }

  function freshNight(p) {
    p.night = {
      cards: [],            // 三張地點牌
      destination: null,    // 最終目的地 locId（守衛巡邏時 = 巡邏落點）
      usedPassTonight: false,
      patrol: null,         // 守衛：[locA, locB]
      hugged: false,        // 被花蝴蝶擁抱（本人知道）
      workMs: 0,
      workDone: false,
      action: null,         // 'kill'|'suicide'|'sabotage'|'build'|'laze'|null（null=可工作）
      sabotageKind: null,   // 'poisonWell'|'burnFarm'|'ruinHerbs'
      buildDone: false,
      dying: null,          // { batch: 1|2, causes: [CAUSE...] }
      savedBy: null,        // 'witch' | 'warlock'（私密得知獲救）
      killExecutor: false,  // 本人是否已執行刀人
    };
  }

  // ---- 建立遊戲狀態 ----
  // config: { settings, humanNames: [{name, isAI}...] 已排座 }
  function createGame(players, settings, rng) {
    const totalRoles = players.length;
    const roles = resolveRoleList(settings, totalRoles);
    const dealt = rng.shuffle(roles);
    players.forEach((p, i) => { p.role = dealt[i]; });

    const witchCount = roles.filter((r) => r === 'witch').length;
    const minFood = totalRoles;
    const food = Math.max(settings.initialFood == null ? minFood : settings.initialFood, minFood);

    return {
      settings,
      totalRoles,
      openLocs: WV.openLocations(totalRoles),
      players,
      day: 0,
      isNight: false,
      resources: { food, material: 0, herb: witchCount },
      herbGardenBlocked: 0,        // 剩餘停產夜數
      arsonUsedTonight: false,
      sheriffSeat: null,
      badgeDestroyed: false,
      electionHeld: false,
      constructions: { lamp: false, fence: null, beacon: false }, // fence: locId
      pendingConstruction: null,   // { id, fenceLoc, proposedDay }
      builtTonight: null,
      winner: null,                // { side: 'wolf'|'good', reason }
      stage: null,
      stageStack: [],              // 中斷（決鬥/自爆）時保存原階段
      publicLog: [],               // [{day, night?, text, kind}]
      dayEvents: [],               // 今日事件（黎明重置）
      nightReports: null,          // 昨晚大燈/瞭望塔資訊（黎明公布）
      resourceDelta: null,         // 昨晚資源變動（依公開模式顯示）
      speechPlan: null,
      exileState: null,
      famineState: null,
      electionState: null,
      buildState: null,
      guessState: null,
      deathQueue: [],              // 待處理死亡反應佇列
      appearanceDeck: null,        // 匿名外觀分配
      lastNightPresence: null,     // 昨晚各地點到場（供報告）
    };
  }

  function resolveRoleList(settings, totalRoles) {
    if (settings.boardId && settings.boardId !== 'custom') {
      const board = WV.BOARDS.find((b) => b.id === settings.boardId);
      if (!board) throw new Error('未知板子：' + settings.boardId);
      if (board.size !== totalRoles) throw new Error('板子人數不符');
      return board.roles.slice();
    }
    const roles = (settings.customRoles || []).slice();
    if (roles.length !== totalRoles) throw new Error('自訂配置角色數不符');
    validateCustomRoles(roles, settings);
    return roles;
  }

  // 自訂配置驗證：屠邊房必須至少一神職與一平民陣營；暗戀者存在時需有可選對象；
  // 至少一名狼人陣營；同一特殊職業預設一名（狼人/平民可複數）。
  function validateCustomRoles(roles, settings) {
    const count = {};
    for (const r of roles) {
      if (!WV.ROLES[r]) throw new Error('未知職業：' + r);
      count[r] = (count[r] || 0) + 1;
    }
    for (const [r, n] of Object.entries(count)) {
      if (n > 1 && r !== 'wolf' && r !== 'villager') {
        throw new Error(WV.ROLES[r].name + ' 預設只設一個名額');
      }
    }
    const wolves = roles.filter((r) => WV.ROLES[r].faction === 'WOLF').length;
    if (wolves < 1) throw new Error('至少需要一名狼人陣營角色');
    if (wolves >= roles.length) throw new Error('狼人不能佔滿所有角色槽位');
    if (settings.wolfWinMode === 'side') {
      const gods = roles.filter((r) => WV.ROLES[r].faction === 'GOD').length;
      const civs = roles.filter((r) => WV.ROLES[r].faction === 'CIVILIAN').length;
      if (gods < 1 || civs < 1) throw new Error('屠邊房必須至少有一名神職及一名平民陣營角色');
    }
    if (count.admirer && roles.length < 2) throw new Error('暗戀者需要可選對象');
  }

  // ---- 查詢輔助 ----
  const H = {
    p(g, seat) { return g.players.find((x) => x.seat === seat); },
    alive(g) { return g.players.filter((x) => x.alive); },
    aliveSeats(g) { return g.players.filter((x) => x.alive).map((x) => x.seat); },
    factionOf(g, seat) { return WV.ROLES[H.p(g, seat).role].faction; },
    isWolf(g, seat) { return H.factionOf(g, seat) === 'WOLF'; },
    wolves(g) { return g.players.filter((x) => x.alive && WV.ROLES[x.role].faction === 'WOLF'); },
    aliveByRole(g, role) { return g.players.filter((x) => x.alive && x.role === role); },
    sheriff(g) { return g.sheriffSeat == null ? null : H.p(g, g.sheriffSeat); },

    // 昨夜/今夜到場：destination 已鎖定後
    atLocation(g, locId) {
      return H.alive(g).filter((x) => x.night && x.night.destination === locId);
    },
    // 含瀕死（夜間地點內互動用：瀕死仍在場）
    presenceMap(g) {
      const m = {};
      for (const l of g.openLocs) m[l] = [];
      for (const x of g.players) {
        if (x.night && x.night.destination && (x.alive)) m[x.night.destination].push(x.seat);
      }
      return m;
    },

    // ---- 夜間保護判定 ----
    // 某地點是否受守衛巡邏保護（今晚）
    guardedLocs(g) {
      const out = new Set();
      for (const x of g.players) {
        // 已鎖定巡邏即生效；守衛當晚死亡仍持續（night.patrol 保留）
        if (x.role === 'guard' && x.night && x.night.patrol && !x.night.hugged) {
          for (const l of x.night.patrol) out.add(l);
        }
      }
      return out;
    },
    // 地點是否阻止「一般夜間直接殺害」（狼刀/自殺/毒殺；潛行者另計）
    isProtectedLoc(g, locId) {
      if (WV.LOCATIONS[locId].isCottage) return true;
      if (g.constructions.fence === locId) return true;
      if (H.guardedLocs(g).has(locId)) return true;
      return false;
    },
    // 狼隊今晚是否被花蝴蝶封刀（任一狼人陣營成員被擁抱）
    wolfTeamBlocked(g) {
      return g.players.some((x) => x.night && x.night.hugged && WV.ROLES[x.role].faction === 'WOLF');
    },

    // 刀人合法性：地點 WOLF>=1 且 NON_WOLF==1、未受保護、全隊未封刀
    canKillAt(g, locId) {
      if (H.wolfTeamBlocked(g)) return false;
      if (H.isProtectedLoc(g, locId)) return false;
      const here = H.atLocation(g, locId);
      const wolves = here.filter((x) => WV.ROLES[x.role].faction === 'WOLF');
      const nonWolves = here.filter((x) => WV.ROLES[x.role].faction !== 'WOLF');
      // 已有他人瀕死（本地已出刀）→ 每地點每晚最多一刀
      const alreadyKilled = here.some((x) => x.night.dying && x.night.dying.causes.includes(WV.CAUSE.WOLF_KILL));
      return wolves.length >= 1 && nonWolves.length === 1 && !alreadyKilled &&
        !nonWolves[0].night.dying; // 唯一非狼若已因他因瀕死，仍算在場；不重複出刀
    },
    canSuicideAt(g, locId) {
      if (H.wolfTeamBlocked(g)) return false;
      if (H.isProtectedLoc(g, locId)) return false;
      return true;
    },
    // 破壞：發動者必須獨處（整個地點只有此人）
    canSabotage(g, seat) {
      const p = H.p(g, seat);
      if (!p.night || !p.night.destination) return null;
      const loc = p.night.destination;
      if (p.night.hugged) return null; // 花蝴蝶封鎖破壞
      const here = H.atLocation(g, loc);
      if (here.length !== 1 || here[0].seat !== seat) return null;
      if (loc === 'well') return 'poisonWell';
      if (loc === 'farm') return g.arsonUsedTonight ? null : 'burnFarm';
      if (loc === 'herbgarden') return 'ruinHerbs';
      return null;
    },

    // 女巫可見瀕死者：自己所在地與所有相鄰地點
    witchVisibleDying(g, witchSeat, batch) {
      const w = H.p(g, witchSeat);
      if (!w.night || !w.night.destination) return [];
      const view = new Set([w.night.destination, ...WV.adjacentOf(w.night.destination).filter((l) => g.openLocs.includes(l))]);
      return H.alive(g).filter((x) =>
        x.night && x.night.dying && x.night.dying.batch === batch &&
        x.night.destination && view.has(x.night.destination));
    },

    // 有效工作者：workDone 且未選擇互斥行動、非巡邏守衛。
    // 當晚死亡者已完成的工作產出仍保留（規則 16）。
    effectiveWorkers(g, locId) {
      return g.players.filter((x) =>
        (x.alive || (x.night && x.night.diedTonight)) &&
        x.night && x.night.destination === locId &&
        x.night.workDone && !x.night.action && !(x.role === 'guard' && x.night.patrol));
    },

    // 投票權
    canVoteExile(g, seat) {
      const p = H.p(g, seat);
      return p.alive && !p.absent && !p.voteBanned && !p.idiotFlipped;
    },
    canVoteFamine(g, seat) {
      const p = H.p(g, seat);
      return p.alive && !p.absent; // 禁票不影響；白癡可投
    },
    canVoteBuild(g, seat) {
      const p = H.p(g, seat);
      return p.alive; // 缺席、禁票、翻牌白癡均可
    },
    canVoteSheriff(g, seat, candidates) {
      const p = H.p(g, seat);
      return p.alive && !candidates.includes(seat); // 缺席者可用密封選票；禁票與白癡可投
    },
    voteWeight(g, seat, type) {
      if (type === 'sheriff') return 1; // 警長選票固定 1 票
      return g.sheriffSeat === seat ? 1.5 : 1;
    },

    // 勝負判定：批次結束時呼叫。先狼勝、再狼滅。
    checkWolfWin(g) {
      const alive = H.alive(g);
      const wolves = alive.filter((x) => WV.ROLES[x.role].faction === 'WOLF');
      if (wolves.length === 0) return false;
      const nonWolves = alive.filter((x) => WV.ROLES[x.role].faction !== 'WOLF');
      // 特殊條款：非狼存活者全為「暗戀對象屬狼人陣營」的暗戀者
      if (nonWolves.length > 0 && nonWolves.every((x) =>
        x.role === 'admirer' && x.admirerTarget != null &&
        WV.ROLES[H.p(g, x.admirerTarget).role].faction === 'WOLF')) return true;
      const gods = alive.filter((x) => WV.ROLES[x.role].faction === 'GOD');
      const civs = alive.filter((x) => WV.ROLES[x.role].faction === 'CIVILIAN');
      if (g.settings.wolfWinMode === 'side') return gods.length === 0 || civs.length === 0;
      return nonWolves.length === 0; // 屠城
    },
    checkWolfExtinct(g) {
      return H.wolves(g).length === 0;
    },
    // 批次後勝負：回傳 winner 物件或 null
    evaluateWin(g) {
      if (H.checkWolfWin(g)) return { side: 'wolf', reason: g.settings.wolfWinMode === 'side' ? '屠邊' : '屠城' };
      if (H.checkWolfExtinct(g)) return { side: 'good', reason: '狼人全滅' };
      return null;
    },

    // 玩家個人勝負（遊戲結束時）
    personalResult(g, seat) {
      const p = H.p(g, seat);
      if (!g.winner) return null;
      if (p.role === 'admirer' && p.admirerTarget != null) {
        const targetWolf = WV.ROLES[H.p(g, p.admirerTarget).role].faction === 'WOLF';
        return (g.winner.side === 'wolf') === targetWolf;
      }
      const isWolf = WV.ROLES[p.role].faction === 'WOLF';
      return (g.winner.side === 'wolf') === isWolf;
    },
  };

  WV.makePlayer = makePlayer;
  WV.freshNight = freshNight;
  WV.createGame = createGame;
  WV.validateCustomRoles = validateCustomRoles;
  WV.H = H;
})();
