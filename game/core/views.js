/* 《人狼村》資訊過濾層
   每個座位的個人化視圖：只包含該玩家依規則可知的資訊。
   重要原則：
   - 夜間死亡在黎明公布前，對他人一律顯示為存活。
   - 玩家看不到自己的匿名外觀；夜間同地點他人只以匿名外觀呈現。
   - 按鈕可用狀態由伺服器計算（禁用本身就是規則設計的情報）。
   - 死者可觀戰（設計決定），但持有待移交警徽者在決定前不給觀戰資訊。 */
(function () {
  const WV = (globalThis.WV = globalThis.WV || {});
  const H = WV.H;

  // 夜間僅參與者可見的祕密階段
  const SECRET_STAGES = ['night.butterfly', 'night.guardredo', 'night.wolfsave', 'night.postinfo',
    'night.godattack', 'night.godsave', 'night.warlock'];

  function displayAlive(g, p) {
    return p.alive || (g.isNight && p.night && p.night.diedTonight);
  }

  function publicStage(engine, seat) {
    const g = engine.g;
    const st = g.stage;
    if (!st) return null;
    const mine = st.awaiting.has(seat);
    const base = { id: st.id, endsAt: st.endsAt, startedAt: st.startedAt, awaitingCount: st.awaiting.size, mine };
    if (st.id === 'guess') {
      if (st.ctx.item && st.ctx.item.night && !mine) return { id: 'night.hidden', endsAt: st.endsAt, startedAt: st.startedAt, mine: false };
      return Object.assign(base, { target: st.ctx.guesser, night: !!(st.ctx.item && st.ctx.item.night) });
    }
    if (SECRET_STAGES.includes(st.id) && !mine) {
      return { id: 'night.hidden', endsAt: st.endsAt, startedAt: st.startedAt, mine: false };
    }
    switch (st.id) {
      case 'day.speech':
      case 'day.speech.pk':
      case 'election.speech':
        return Object.assign(base, { speaker: st.ctx.speaker, kind: st.ctx.kind || null });
      case 'lastwords':
        return Object.assign(base, { speaker: st.ctx.seat });
      case 'hunter.decide':
        return Object.assign(base, { hunter: st.ctx.seat }); // 獵人已翻牌，公開
      case 'badge.transfer':
        return Object.assign(base, { from: st.ctx.seat });
      case 'exile.vote':
        return Object.assign(base, { targets: st.ctx.targets, round: st.ctx.round });
      case 'famine.vote':
        return Object.assign(base, { targets: st.ctx.targets, round: st.ctx.round });
      case 'election.vote':
        return Object.assign(base, { candidates: st.ctx.candidates, round: st.ctx.round });
      case 'build.vote':
        return Object.assign(base, {
          proposals: st.ctx.proposals.map((p) => ({
            construction: p.construction, name: WV.CONSTRUCTIONS[p.construction].name,
            fenceLoc: p.fenceLoc, proposer: p.proposer,
            cost: WV.constructionCost(p.construction, g.totalRoles),
          })),
        });
      case 'exile.idiot':
        return Object.assign(base, { seat: st.ctx.seat }); // 白癡翻牌抉擇公開進行
      default:
        return base;
    }
  }

  /** 該座位目前需要的輸入描述（含合法選項；只給等待中的本人） */
  function youAwait(engine, seat) {
    const g = engine.g;
    const st = g.stage;
    if (!st || !st.awaiting.has(seat)) return null;
    const p = H.p(g, seat);
    const aliveOthers = () => H.alive(g).filter((x) => x.seat !== seat).map((x) => ({ seat: x.seat, name: x.name }));
    const aliveAll = () => H.alive(g).map((x) => ({ seat: x.seat, name: x.name }));
    switch (st.id) {
      case 'guess':
        return { id: st.id, candidates: st.ctx.candidates.map((s) => ({ seat: s, name: H.p(g, s).name })) };
      case 'lastwords':
        return { id: st.id };
      case 'hunter.decide':
        return { id: st.id, targets: aliveOthers() };
      case 'badge.transfer':
        return { id: st.id, targets: aliveAll().filter((x) => x.seat !== seat) };
      case 'exile.vote':
      case 'famine.vote':
        return {
          id: st.id, round: st.ctx.round,
          targets: st.ctx.targets.filter((s) => H.p(g, s).alive).map((s) => ({ seat: s, name: H.p(g, s).name })),
          canAbstain: st.id === 'exile.vote',
        };
      case 'election.signup':
        return { id: st.id };
      case 'election.speech':
        return { id: st.id, canWithdraw: true };
      case 'election.vote':
        return { id: st.id, candidates: st.ctx.candidates.map((s) => ({ seat: s, name: H.p(g, s).name })) };
      case 'sheriff.direction':
        return { id: st.id };
      case 'day.speech':
      case 'day.speech.pk':
        return { id: st.id };
      case 'day.meeting.open':
        return null; // 無強制輸入
      case 'build.vote':
        return { id: st.id, proposals: publicStage(engine, seat).proposals };
      case 'exile.idiot':
        return { id: st.id };
      case 'day.admirer':
        return { id: st.id, targets: aliveOthers() };
      case 'day.finaldest': {
        const n = p.night;
        return {
          id: st.id,
          cards: n.cards.map((l) => ({ loc: l, name: WV.LOCATIONS[l].name })),
          openLocs: g.openLocs,
          passAvailable: !p.nightPassUsed && p.role !== 'guard',
          isGuard: p.role === 'guard',
          prefDest: n.prefDest, prefPatrol: n.prefPatrol, prefGoto: n.prefGoto,
          lastPatrol: p.guardLastPatrol,
        };
      }
      case 'night.butterfly':
        return { id: st.id, targets: aliveOthers(), usesLeft: p.butterflyUses };
      case 'night.guardredo':
        return { id: st.id, openLocs: g.openLocs };
      case 'night.wolfsave':
      case 'night.godsave': {
        const list = engine._witchSavable(seat, st.ctx.batch).map((x) => ({
          seat: x.seat, name: x.name, loc: x.night.destination, locName: WV.LOCATIONS[x.night.destination].name,
        }));
        return { id: st.id, batch: st.ctx.batch, list, herb: g.resources.herb };
      }
      case 'night.postinfo': {
        const out = { id: st.id };
        if (st.ctx.seers.includes(seat)) out.checkTargets = aliveOthers();
        if (st.ctx.elders.includes(seat)) {
          out.banTargets = H.alive(g)
            .filter((x) => x.seat !== p.elderLastTarget)
            .map((x) => ({ seat: x.seat, name: x.name }));
        }
        return out;
      }
      case 'night.godattack': {
        const out = { id: st.id };
        if (st.ctx.stalkers.includes(seat)) {
          const t = H.p(g, p.lastExileVote);
          out.assassinTarget = t ? { seat: t.seat, name: t.name } : null;
        }
        if (st.ctx.witches.includes(seat)) {
          out.poisonTargets = engine._poisonTargets(seat).map((x) => ({ seat: x.seat, name: x.name }));
          out.herb = g.resources.herb;
        }
        return out;
      }
      case 'night.warlock': {
        const dying = g.players.filter((x) => x.alive && x.night && x.night.dying && x.night.dying.batch === 2 && x.seat !== seat);
        return { id: st.id, list: dying.map((x) => ({ seat: x.seat, name: x.name })) };
      }
      default:
        return { id: st.id };
    }
  }

  /** 夜間地點場景（本人視角）：匿名身影、總人數、可用行動 */
  function nightScene(engine, seat) {
    const g = engine.g;
    if (!g.isNight) return null;
    const p = H.p(g, seat);
    if (!p.night || !p.night.destination) return null;
    // 前幾晚已死者不在任何地點（改以觀戰視角呈現）
    if (!p.alive && !(p.night && p.night.diedTonight)) return null;
    const loc = p.night.destination;
    const locDef = WV.LOCATIONS[loc];
    const here = H.atLocation(g, loc); // 含瀕死
    const others = locDef.isCottage ? [] : here.filter((x) => x.seat !== seat).map((x) => {
      const a = WV.APPEARANCES.find((ap) => ap.id === x.appearanceId);
      return { appearance: a ? a.name : '身影', color: a ? a.color : '#666' };
    });
    const st = g.stage;
    const actionStage = st && st.id === 'night.action';
    const isWolf = H.isWolf(g, seat);
    const n = p.night;
    const guardPatrolling = p.role === 'guard' && !!n.patrol;
    const liveWorkMs = n.workMs + (n.pressAt != null ? Math.max(0, engine.now - n.pressAt) : 0);
    return {
      loc, locName: locDef.name, isCottage: !!locDef.isCottage,
      text: WV.TEXT.locations[loc],
      totalHere: locDef.isCottage ? 1 : here.length,
      others,
      patrol: n.patrol ? n.patrol.map((l) => ({ loc: l, name: WV.LOCATIONS[l].name })) : null,
      chatChannel: (!locDef.isCottage) ? ('loc:' + loc) : null,
      work: {
        requiredMs: engine.workRequiredMs(),
        workMs: liveWorkMs,
        done: n.workDone,
        pressed: n.pressAt != null,
        canWork: actionStage && !n.action && !guardPatrolling && p.alive,
      },
      actions: actionStage ? {
        canKill: isWolf && p.alive && !n.action && H.canKillAt(g, loc),
        canSuicide: isWolf && p.alive && !n.action && H.canSuicideAt(g, loc),
        sabotageKind: (isWolf && p.alive && !n.action) ? H.canSabotage(g, seat) : null,
        canLaze: isWolf && p.alive && !n.action,
        building: !!(g.pendingConstruction && loc === 'square' && !g.builtTonight),
        pendingConstruction: g.pendingConstruction ? {
          id: g.pendingConstruction.id, name: WV.CONSTRUCTIONS[g.pendingConstruction.id].name,
        } : null,
      } : null,
      dying: !!n.dying,
      action: n.action,
    };
  }

  function forSeat(engine, seat) {
    const g = engine.g;
    const me = H.p(g, seat);
    const badgePending = g.stage && g.stage.id === 'badge.transfer' && g.stage.ctx.seat === seat;
    const spectating = !me.alive && !badgePending && !(g.isNight && me.night && me.night.diedTonight);

    const players = g.players.map((p) => {
      const shown = displayAlive(g, p);
      return {
        seat: p.seat, name: p.name, isAI: p.isAI, connected: p.connected, aiTakeover: p.aiTakeover,
        alive: shown,
        deathDay: shown ? null : p.deathDay,
        deathAtNight: shown ? null : p.deathAtNight,
        absent: p.absent, voteBanned: p.voteBanned,
        idiotFlipped: p.idiotFlipped,
        revealedRole: p.revealedRole,
        revealedWolfSide: p.revealedWolfSide,
        isSheriff: g.sheriffSeat === p.seat,
      };
    });

    const view = {
      rev: engine.rev,
      serverNow: engine.now,
      ended: engine.ended,
      day: g.day, isNight: g.isNight,
      config: {
        boardId: engine.settings.boardId,
        wolfWinMode: engine.settings.wolfWinMode,
        speechMode: engine.settings.speechMode,
        resourceInfoMode: engine.settings.resourceInfoMode,
        witchSelfSave: engine.settings.witchSelfSave,
        reshuffleAppearance: engine.settings.reshuffleAppearance,
        totalRoles: g.totalRoles,
      },
      board: g.publicBoard,
      openLocs: g.openLocs,
      resources: Object.assign({}, g.resources),
      constructions: {
        lamp: g.constructions.lamp,
        fence: g.constructions.fence,
        beacon: g.constructions.beacon,
      },
      pendingConstruction: g.pendingConstruction ? {
        id: g.pendingConstruction.id,
        name: WV.CONSTRUCTIONS[g.pendingConstruction.id].name,
        fenceLoc: g.pendingConstruction.fenceLoc,
      } : null,
      sheriffSeat: g.sheriffSeat, badgeDestroyed: g.badgeDestroyed,
      players,
      stage: publicStage(engine, seat),
      youAwait: youAwait(engine, seat),
      publicLog: g.publicLog.slice(-120),
      ending: g.ending || null,
    };

    // ---- 本人私有資訊 ----
    const n = me.night;
    view.you = {
      seat: me.seat, name: me.name, alive: me.alive,
      role: me.role, roleName: WV.ROLES[me.role].name,
      faction: WV.ROLES[me.role].faction,
      factionName: WV.TEXT.factionNames[WV.ROLES[me.role].faction],
      legend: WV.TEXT.roles[me.role],
      absent: me.absent, voteBanned: me.voteBanned, idiotFlipped: me.idiotFlipped,
      nightPassUsed: me.nightPassUsed,
      foxTails: me.role === 'fox' ? me.foxTails : null,
      butterflyUses: me.role === 'butterfly' ? me.butterflyUses : null,
      knightUsed: me.role === 'knight' ? me.knightUsed : null,
      warlockUsed: me.role === 'warlock' ? me.warlockUsed : null,
      hunterShotUsed: me.role === 'hunter' ? me.hunterShotUsed : null,
      admirerTarget: me.admirerTarget,
      lastExileVote: me.lastExileVote,
      dying: !!(n && n.dying),
      hugged: !!(n && n.hugged),
      privateLog: (me.privateLog || []).slice(-60),
      canExplode: !g.isNight && g.day >= 2 && me.alive && !me.absent &&
        H.isWolf(g, seat) && engine.interruptibleNow() && !engine._interruptBusy,
      canDuel: !g.isNight && g.day >= 2 && me.alive && !me.absent &&
        me.role === 'knight' && !me.knightUsed && engine.interruptibleNow() && !engine._interruptBusy,
      canPropose: !!(g.stage && g.stage.id === 'build.propose' && me.alive),
      affordable: (g.stage && g.stage.id === 'build.propose' && me.alive) ? engine.affordableConstructions() : null,
    };
    if (n && !g.isNight) {
      view.you.destPanel = {
        cards: n.cards.map((l) => ({ loc: l, name: WV.LOCATIONS[l].name })),
        prefDest: n.prefDest, prefPatrol: n.prefPatrol, prefGoto: n.prefGoto,
        passAvailable: !me.nightPassUsed && me.role !== 'guard',
        isGuard: me.role === 'guard',
        lastPatrol: me.guardLastPatrol,
      };
    }
    if (H.isWolf(g, seat)) {
      view.you.wolfTeam = g.players
        .filter((x) => WV.ROLES[x.role].faction === 'WOLF')
        .map((x) => ({
          seat: x.seat, name: x.name, role: x.role, roleName: WV.ROLES[x.role].name,
          alive: displayAlive(g, x),
          dest: (g.isNight && x.night && x.night.destination) ? {
            loc: x.night.destination, name: WV.LOCATIONS[x.night.destination].name,
          } : null,
        }));
    }
    view.scene = nightScene(engine, seat);

    // ---- 觀戰（死者；設計決定：亡者之眼可見全部身分與行動）----
    if (spectating) {
      view.spectate = {
        roles: Object.fromEntries(g.players.map((p) => [p.seat, {
          role: p.role, roleName: WV.ROLES[p.role].name, faction: WV.ROLES[p.role].faction,
          alive: p.alive,
        }])),
        destinations: g.isNight ? Object.fromEntries(
          g.players.filter((p) => p.night && p.night.destination)
            .map((p) => [p.seat, WV.LOCATIONS[p.night.destination].name])) : null,
      };
    }
    return view;
  }

  /** 頻道成員（訊息投遞時判定）。死者觀戰可收到全部頻道（待移交警徽者除外）。 */
  function receiversFor(engine, channel) {
    const g = engine.g;
    const out = [];
    for (const p of g.players) {
      const badgePending = g.stage && g.stage.id === 'badge.transfer' && g.stage.ctx.seat === p.seat;
      const deadSpectator = !p.alive && !badgePending && !(g.isNight && p.night && p.night.diedTonight);
      if (deadSpectator) { out.push(p.seat); continue; } // 觀戰收全部
      if (channel === 'meeting') { out.push(p.seat); continue; } // 全村（含缺席，唯讀）
      if (channel === 'dead') continue; // 僅死者（上面已包含）
      if (channel === 'wolf') {
        if (H.isWolf(g, p.seat) && (p.alive || (p.night && p.night.diedTonight))) out.push(p.seat);
        continue;
      }
      if (channel.startsWith('loc:')) {
        const loc = channel.slice(4);
        if ((p.alive || (g.isNight && p.night && p.night.diedTonight)) &&
            p.night && p.night.destination === loc && !WV.LOCATIONS[loc].isCottage) out.push(p.seat);
        continue;
      }
    }
    return out;
  }

  WV.Views = { forSeat, receiversFor, publicStage, youAwait, nightScene };
})();
