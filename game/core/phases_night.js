/* 《人狼村》夜間流程（內部規則附錄第 4 節的 15 步結算）
   花蝴蝶 → 守衛重選 → 狼隊討論 → 15 秒行動 → 烽火台 → 狼刀救援 → 批次一死亡 →
   查驗/禁票 → 神職攻擊 → 女巫救援 → 暗夜術士 → 批次二死亡 → 資源結算 */
(function () {
  const WV = (globalThis.WV = globalThis.WV || {});
  const H = WV.H;
  const SH = WV.Game.prototype.stageHandlers;

  Object.assign(WV.Game.prototype, {
    beginNight() {
      const g = this.g;
      if (g.winner) { this.concludeIfWon(); return; }
      g.isNight = true;
      g.arsonTonight = false;
      g.wellPoisoned = false;
      g.herbSabotage = false;
      g.builtTonight = null;
      g.completedConstructionTonight = null;
      if (this.settings.reshuffleAppearance) this.dealAppearances();
      for (const p of H.alive(g)) {
        const n = p.night;
        n.workMs = 0; n.workDone = false; n.pressAt = null;
        n.action = null; n.sabotageKind = null; n.killExecutor = false;
        n.dying = null; n.savedBy = null; n.diedTonight = false;
        n.antidoteBatches = {}; n.poisonedTonight = false;
      }
      this.logPub('—— 第 ' + g.day + ' 夜 ——　夜幕落下，村民各自走向今晚的目的地。', 'night');
      g.nightPlan = ['butterfly', 'guardredo', 'wolfchat', 'action', 'beacon',
        'wolfsave', 'batch1', 'postinfo', 'godattack', 'godsave', 'warlock', 'batch2', 'settle'];
      g.nightStepIdx = -1;
      this.nextNightStep();
    },
    nextNightStep() {
      const g = this.g;
      if (g.winner) { this.concludeIfWon(); return; }
      g.nightStepIdx += 1;
      const step = g.nightPlan[g.nightStepIdx];
      if (!step) { this.beginDay(); return; }
      this['nightStep_' + step]();
    },

    // ---- 花蝴蝶擁抱 ----
    nightStep_butterfly() {
      const g = this.g;
      const eligible = H.alive(g).filter((p) => p.role === 'butterfly' && p.butterflyUses > 0).map((p) => p.seat);
      if (eligible.length === 0) { this.nextNightStep(); return; }
      this.setStage('night.butterfly', WV.TIMING.ABILITY, eligible, { hugs: {} });
    },

    // ---- 被封鎖守衛改為一般工作 ----
    nightStep_guardredo() {
      const g = this.g;
      const blocked = H.alive(g).filter((p) =>
        p.role === 'guard' && p.night.hugged && p.night.patrol).map((p) => p.seat);
      if (blocked.length === 0) { this._snapshotPresence(); this.nextNightStep(); return; }
      for (const s of blocked) {
        const p = H.p(g, s);
        p.night.patrol = null; // 巡邏失效
        this.notify(s, 'patrolBlocked', {});
      }
      this.setStage('night.guardredo', WV.TIMING.ABILITY, blocked, { moves: {} });
    },
    _snapshotPresence() {
      const g = this.g;
      const m = {};
      for (const l of g.openLocs) m[l] = [];
      for (const p of H.alive(g)) {
        if (p.night.destination) m[p.night.destination].push(p.seat);
      }
      g.lastNightPresence = m;
    },

    // ---- 狼隊討論（30 秒）----
    nightStep_wolfchat() {
      const g = this.g;
      const wolves = H.wolves(g).map((p) => p.seat);
      if (wolves.length === 0) { this.nextNightStep(); return; }
      const mates = H.wolves(g).map((w) => ({
        seat: w.seat, name: w.name, role: w.role,
        dest: w.night.destination, destName: w.night.destination ? WV.LOCATIONS[w.night.destination].name : null,
      }));
      for (const s of wolves) this.notify(s, 'wolfDests', { mates });
      this.setStage('night.wolfchat', WV.TIMING.WOLF_CHAT, [], { wolves, ready: [] });
    },

    // ---- 15 秒地點行動 ----
    nightStep_action() {
      this.setStage('night.action', WV.TIMING.NIGHT_ACTION, [], {});
    },
    workRequiredMs() { return WV.TIMING.WORK_REQUIRED * 1000 * (this.speed || 0); },
    /** 完成工作時呼叫：處理建設完成 */
    _onWorkDone(p) {
      const g = this.g;
      p.night.workDone = true;
      if (p.night.destination === 'square' && g.pendingConstruction && !g.builtTonight) {
        const c = g.pendingConstruction;
        const cost = WV.constructionCost(c.id, g.totalRoles);
        if (g.resources.material >= cost) {
          g.resources.material -= cost;
          g.builtTonight = c.id;
          g.completedConstructionTonight = { id: c.id, fenceLoc: c.fenceLoc };
          this.notify(p.seat, 'buildDone', { id: c.id });
        }
      }
    },
    _finalizeWork() {
      const g = this.g;
      const endAt = this.g.stage ? this.g.stage.endsAt : this.now;
      for (const p of H.alive(g)) {
        const n = p.night;
        if (n.pressAt != null) {
          n.workMs += Math.max(0, Math.min(this.now, endAt) - n.pressAt);
          n.pressAt = null;
        }
        if (!n.action && !n.workDone && !(p.role === 'guard' && n.patrol) &&
            n.workMs >= this.workRequiredMs()) {
          this._onWorkDone(p);
        }
      }
    },

    // ---- 烽火台判定 ----
    nightStep_beacon() {
      const g = this.g;
      if (g.builtTonight !== 'beacon') { this.nextNightStep(); return; }
      g.constructions.beacon = true;
      g.pendingConstruction = null;
      this.logPub(WV.TEXT.constructions.beacon, 'build');
      // 神蹟：取消當晚所有尚待結算的非狼人死亡；狼人自殺不受阻止
      for (const p of g.players) {
        if (p.night && p.night.dying && WV.ROLES[p.role].faction !== 'WOLF') p.night.dying = null;
      }
      this.finishGame({ side: 'good', reason: '烽火台' });
      const wolfDying = g.players.filter((p) => p.alive && p.night && p.night.dying);
      for (const p of wolfDying) this.queueDeath(p.seat, p.night.dying.causes[0], { night: true, noGuess: true, deferWin: true });
      this.drainDeathQueue(() => this.concludeIfWon());
    },

    // ---- 狼刀批次：女巫救援窗口 ----
    nightStep_wolfsave() {
      this._witchSaveStage(1, 'wolfsave');
    },
    _witchSaveStage(batch, stepName) {
      const g = this.g;
      const witches = [];
      for (const p of g.players) {
        if (p.role !== 'witch') continue;
        // 批次一瀕死或已死的女巫，仍可進入其後依法開放的用藥階段（內部規則 6）
        if (!(p.alive || (p.night && p.night.diedTonight))) continue;
        if (!p.night || p.night.hugged) continue;
        if (p.night.poisonedTonight) continue;             // 用毒後不能再用解藥
        if (p.night.antidoteBatches[batch]) continue;      // 每批次一次
        if (g.resources.herb < 1) continue;
        const visible = this._witchSavable(p.seat, batch);
        if (visible.length === 0) continue;
        this.notify(p.seat, 'dyingList', { batch, list: visible.map((x) => ({ seat: x.seat, name: x.name, loc: x.night.destination, locName: WV.LOCATIONS[x.night.destination].name })) });
        witches.push(p.seat);
      }
      if (witches.length === 0) { this.nextNightStep(); return; }
      this.setStage('night.' + stepName, WV.TIMING.ABILITY, witches, { batch });
    },
    /** 女巫可見且可救的瀕死者（批次一僅狼刀可救；不含依設定不可自救的自己） */
    _witchSavable(witchSeat, batch) {
      const g = this.g;
      const w = H.p(g, witchSeat);
      return H.witchVisibleDying(g, witchSeat, batch).filter((x) => {
        if (batch === 1 && !x.night.dying.causes.includes(WV.CAUSE.WOLF_KILL)) return false; // 自殺不可救
        if (x.seat === witchSeat && !this.settings.witchSelfSave) return false;
        return true;
      });
    },
    _applyAntidote(witchSeat, targetSeat, batch) {
      const g = this.g;
      const w = H.p(g, witchSeat);
      const t = H.p(g, targetSeat);
      if (g.resources.herb < 1) return { ok: false, error: '藥草已耗盡' };
      if (!t || !t.night.dying || t.night.dying.batch !== batch) return { ok: false, error: '目標已無需救援' };
      if (!this._witchSavable(witchSeat, batch).some((x) => x.seat === targetSeat)) {
        return { ok: false, error: '目標不在可救範圍' };
      }
      g.resources.herb -= 1;
      w.night.antidoteBatches[batch] = true;
      t.night.dying = null; // 一份解藥取消同批次全部攻擊
      t.night.savedBy = 'witch';
      this.notify(targetSeat, 'saved', { batch });
      this.notify(witchSeat, 'antidoteUsed', { target: targetSeat, batch });
      return { ok: true };
    },

    // ---- 批次一最終死亡 ----
    nightStep_batch1() { this._finalizeBatch(1); },
    nightStep_batch2() { this._finalizeBatch(2); },
    _finalizeBatch(batch) {
      const g = this.g;
      const dying = g.players
        .filter((p) => p.alive && p.night && p.night.dying && p.night.dying.batch === batch)
        .sort((a, b) => a.seat - b.seat);
      if (dying.length === 0) { this._batchWinCheck(); return; }
      for (const p of dying) {
        this.queueDeath(p.seat, p.night.dying.causes[0], { night: true, deferWin: true });
      }
      this.drainDeathQueue(() => this._batchWinCheck());
    },
    _batchWinCheck() {
      const g = this.g;
      if (!g.winner) {
        const w = H.evaluateWin(g); // 先狼勝、再狼滅
        if (w) this.finishGame(w);
      }
      if (g.winner) { this.concludeIfWon(); return; }
      this.nextNightStep();
    },

    // ---- 工作後情報與控制：預言家查驗、禁票長老 ----
    nightStep_postinfo() {
      const g = this.g;
      const canAct = (p) => (p.alive || (p.night && p.night.diedTonight)) && p.night && !p.night.hugged;
      const seers = g.players.filter((p) => p.role === 'seer' && canAct(p)).map((p) => p.seat);
      const elders = g.players.filter((p) => p.role === 'elder' && canAct(p)).map((p) => p.seat);
      if (seers.length === 0 && elders.length === 0) { this.nextNightStep(); return; }
      this.setStage('night.postinfo', WV.TIMING.ABILITY, [...seers, ...elders],
        { seers, elders, checks: {}, bans: {} });
    },

    // ---- 神職攻擊批次：潛行者暗殺 + 女巫毒藥 ----
    nightStep_godattack() {
      const g = this.g;
      const canAct = (p) => (p.alive || (p.night && p.night.diedTonight)) && p.night && !p.night.hugged;
      const stalkers = g.players.filter((p) => {
        if (p.role !== 'stalker' || !canAct(p)) return false;
        if (p.lastExileVote == null) return false;
        const t = H.p(g, p.lastExileVote);
        return t && t.alive; // 目標入夜前死亡或批次一死亡 → 不能暗殺
      }).map((p) => p.seat);
      const witches = g.players.filter((p) => {
        if (p.role !== 'witch' || !canAct(p)) return false;
        if (p.night.antidoteBatches[1]) return false; // 已用解藥不能再用毒
        if (g.resources.herb < 1) return false;
        return this._poisonTargets(p.seat).length > 0;
      }).map((p) => p.seat);
      if (stalkers.length === 0 && witches.length === 0) { this.nextNightStep(); return; }
      for (const s of stalkers) {
        const p = H.p(g, s);
        this.notify(s, 'assassinReady', { target: p.lastExileVote });
      }
      this.setStage('night.godattack', WV.TIMING.ABILITY, [...stalkers, ...witches],
        { stalkers, witches, assassinations: [], poisons: {} });
    },
    /** 女巫毒殺合法目標：同地點、其他存活玩家；村舍無目標；受保護地點按鈕不可用 */
    _poisonTargets(witchSeat) {
      const g = this.g;
      const w = H.p(g, witchSeat);
      const loc = w.night.destination;
      if (!loc || WV.LOCATIONS[loc].isCottage) return [];
      if (g.constructions.fence === loc) return [];
      if (H.guardedLocs(g).has(loc)) return [];
      return H.atLocation(g, loc).filter((x) => x.seat !== witchSeat && x.alive);
    },
    _markDying(seat, cause, batch) {
      const p = H.p(this.g, seat);
      if (!p.alive) return;
      if (!p.night.dying) {
        p.night.dying = { batch, causes: [cause] };
        this.notify(seat, 'dying', { batch });
      } else if (p.night.dying.batch === batch) {
        p.night.dying.causes.push(cause);
      }
    },

    // ---- 神職攻擊的女巫救援窗口 ----
    nightStep_godsave() {
      this._witchSaveStage(2, 'godsave');
    },

    // ---- 暗夜術士挽救 ----
    nightStep_warlock() {
      const g = this.g;
      const canAct = (p) => (p.alive || (p.night && p.night.diedTonight)) && p.night && !p.night.hugged;
      const warlocks = g.players.filter((p) => p.role === 'warlock' && !p.warlockUsed && canAct(p));
      if (warlocks.length === 0) { this.nextNightStep(); return; }
      const dying = g.players.filter((p) => p.alive && p.night && p.night.dying && p.night.dying.batch === 2);
      const eligible = [];
      for (const w of warlocks) {
        const list = dying.filter((x) => x.seat !== w.seat); // 不能自救
        if (list.length === 0) continue;
        this.notify(w.seat, 'warlockList', { list: list.map((x) => ({ seat: x.seat, name: x.name })) });
        eligible.push(w.seat);
      }
      if (eligible.length === 0) { this.nextNightStep(); return; }
      this.setStage('night.warlock', WV.TIMING.ABILITY, eligible, { saves: {} });
    },

    // ---- 資源與隔日狀態 ----
    nightStep_settle() {
      const g = this.g;
      const delta = { food: 0, material: 0, herb: 0, perLoc: [], arsonLoss: 0 };

      // 農田縱火：加入本夜新產量前，庫存減半（向下取整）
      if (g.arsonTonight) {
        const loss = g.resources.food - Math.floor(g.resources.food / 2);
        g.resources.food -= loss;
        delta.arsonLoss = loss;
        delta.food -= loss;
      }

      const workers = {};
      for (const l of g.openLocs) workers[l] = H.effectiveWorkers(g, l).length;

      // 農田＋水井
      if (g.openLocs.includes('farm')) {
        const base = Math.min(workers.farm || 0, WV.LOCATIONS.farm.cap) * WV.LOCATIONS.farm.produce;
        let farmTotal = 0;
        if (base > 0) {
          const wellBonus = (workers.well || 0) >= 1 ? 1 : 0;
          const poison = g.wellPoisoned ? 1 : 0;
          farmTotal = Math.max(0, base + wellBonus - poison);
        }
        if (farmTotal > 0 || workers.farm > 0) delta.perLoc.push({ loc: 'farm', name: '農田（含水井）', amount: farmTotal });
        g.resources.food += farmTotal;
        delta.food += farmTotal;
      }
      // 磨坊、獵人小屋
      for (const l of ['mill', 'hunterhut']) {
        if (!g.openLocs.includes(l)) continue;
        const n = Math.min(workers[l] || 0, WV.LOCATIONS[l].cap) * WV.LOCATIONS[l].produce;
        if (n > 0) { g.resources.food += n; delta.food += n; delta.perLoc.push({ loc: l, name: WV.LOCATIONS[l].name, amount: n }); }
      }
      // 材料
      for (const l of ['smithy', 'lumber', 'mine']) {
        if (!g.openLocs.includes(l)) continue;
        const n = Math.min(workers[l] || 0, WV.LOCATIONS[l].cap) * WV.LOCATIONS[l].produce;
        if (n > 0) { g.resources.material += n; delta.material += n; delta.perLoc.push({ loc: l, name: WV.LOCATIONS[l].name, amount: n }); }
      }
      // 藥草園：破壞與停產
      if (g.openLocs.includes('herbgarden')) {
        if (g.herbSabotage) {
          g.herbGardenBlocked = 2; // 其後兩晚停產
        } else if (g.herbGardenBlocked > 0) {
          g.herbGardenBlocked -= 1;
        } else if ((workers.herbgarden || 0) >= 1) {
          g.resources.herb += 1;
          delta.herb += 1;
          delta.perLoc.push({ loc: 'herbgarden', name: '藥草園', amount: 1 });
        }
      }

      // 獵人小屋缺席
      for (const p of H.alive(g)) {
        if (p.night.destination === 'hunterhut') p.absentNext = true;
      }

      // 大燈／瞭望塔報告（含當晚後來死亡者：以鎖定時快照計）
      const towerActive = (workers.watchtower || 0) >= 1;
      const lampActive = g.constructions.lamp || g.builtTonight === 'lamp';
      if (towerActive || lampActive) {
        const counts = {};
        for (const [l, seats] of Object.entries(g.lastNightPresence || {})) counts[l] = seats.length;
        g.nightReports = { tower: towerActive, lamp: lampActive, counts };
      } else g.nightReports = null;

      // 建設完成／提案失效
      if (g.builtTonight && g.builtTonight !== 'beacon') {
        const c = g.completedConstructionTonight;
        if (c.id === 'lamp') g.constructions.lamp = true;
        if (c.id === 'fence') g.constructions.fence = c.fenceLoc; // 自下一夜起生效
        g.pendingConstruction = null;
        this.logPub('昨夜，廣場傳來徹夜的敲擊聲——【' + WV.CONSTRUCTIONS[c.id].name + '】完成了！' +
          (c.id === 'fence' ? '（保護地點：' + WV.LOCATIONS[c.fenceLoc].name + '）' : ''), 'build');
        this.logPub(WV.TEXT.constructions[c.id], 'flavor');
      } else if (g.pendingConstruction) {
        this.logPub('昨夜無人完成建設工作，【' + WV.CONSTRUCTIONS[g.pendingConstruction.id].name + '】提案失效，材料未消耗。', 'build');
        g.pendingConstruction = null;
      }

      // 守衛連守限制更新（實際執行巡邏才計）
      for (const p of g.players) {
        if (p.role !== 'guard') continue;
        p.guardLastPatrol = (p.alive || p.night) && p.night && p.night.patrol ? p.night.patrol.slice() : [];
      }

      // 九尾狐私下得知尾數
      for (const fox of g.players.filter((x) => x.alive && x.role === 'fox')) {
        this.notify(fox.seat, 'foxTails', { tails: fox.foxTails });
      }

      g.resourceDelta = delta;
      this.beginDay();
    },
  });

  // ================= 夜間階段處理器 =================

  // 花蝴蝶：選擇擁抱或跳過
  SH['night.butterfly'] = {
    submit(seat, type, data, st) {
      if (!st.awaiting.has(seat)) return { ok: false, error: '並非你的抉擇' };
      if (type === 'skip') { st.ctx.hugs[seat] = null; this.settleAwait(seat); return { ok: true }; }
      if (type !== 'hug') return { ok: false, error: '未知操作' };
      const t = H.p(this.g, data.target);
      if (!t || !t.alive || t.seat === seat) return { ok: false, error: '目標不合法' };
      st.ctx.hugs[seat] = t.seat;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      const g = this.g;
      for (const [seatS, target] of Object.entries(ctx.hugs)) {
        if (target == null) continue;
        const b = H.p(g, Number(seatS));
        b.butterflyUses -= 1; // 確認即消耗
        const t = H.p(g, target);
        t.night.hugged = true;
        this.notify(t.seat, 'hugged', {});
        this.notify(b.seat, 'hugConfirmed', { target, usesLeft: b.butterflyUses });
      }
      this.nextNightStep(); // → 守衛重選
    },
    timeout(st) {
      for (const s of Array.from(st.awaiting)) st.ctx.hugs[s] = null;
      st.awaiting.clear();
      this.resolveStage();
    },
  };

  // 被封鎖守衛重選工作地點（任一開放地點；逾時 = 隨機）
  SH['night.guardredo'] = {
    submit(seat, type, data, st) {
      if (!st.awaiting.has(seat)) return { ok: false, error: '並非你的抉擇' };
      if (type !== 'move') return { ok: false, error: '未知操作' };
      if (!this.g.openLocs.includes(data.loc)) return { ok: false, error: '地點未開放' };
      st.ctx.moves[seat] = data.loc;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      const g = this.g;
      for (const [seatS, loc] of Object.entries(ctx.moves)) {
        H.p(g, Number(seatS)).night.destination = loc;
      }
      this._snapshotPresence();
      this.nextNightStep(); // → wolfchat
    },
    timeout(st) {
      for (const s of Array.from(st.awaiting)) {
        st.ctx.moves[s] = this.rng.pick(this.g.openLocs);
      }
      st.awaiting.clear();
      this.resolveStage();
    },
  };

  // 狼隊討論：全員 ready 可提前結束
  SH['night.wolfchat'] = {
    submit(seat, type, data, st) {
      if (type !== 'ready') return { ok: false, error: '未知操作' };
      if (!st.ctx.wolves.includes(seat)) return { ok: false, error: '你不在狼隊頻道' };
      if (!st.ctx.ready.includes(seat)) st.ctx.ready.push(seat);
      this.touch();
      const aliveWolves = st.ctx.wolves.filter((s) => H.p(this.g, s).alive);
      if (aliveWolves.every((s) => st.ctx.ready.includes(s))) this.resolveStage();
      return { ok: true };
    },
    resolve() { this.nextNightStep(); },
  };

  // 15 秒地點行動
  SH['night.action'] = {
    submit(seat, type, data, st) {
      const g = this.g;
      const p = H.p(g, seat);
      if (!p.alive || !p.night.destination) return { ok: false, error: '你不在任何地點' };
      const n = p.night;
      const guardPatrolling = p.role === 'guard' && n.patrol;

      if (type === 'workPress') {
        if (n.action) return { ok: false, error: '已選擇其他行動，不能再工作' };
        if (guardPatrolling) return { ok: false, error: '巡邏時不能工作' };
        if (n.pressAt == null) n.pressAt = this.now;
        return { ok: true };
      }
      if (type === 'workRelease') {
        if (n.pressAt != null) {
          n.workMs += Math.max(0, this.now - n.pressAt);
          n.pressAt = null;
          if (!n.action && !n.workDone && n.workMs >= this.workRequiredMs()) this._onWorkDone(p);
          this.touch();
        }
        return { ok: true, workMs: n.workMs };
      }
      if (type === 'workFull') {
        // AI／斷線代管專用捷徑
        if (!p.isAI && !p.aiTakeover) return { ok: false, error: '未知操作' };
        if (n.action || guardPatrolling) return { ok: false, error: '不能工作' };
        n.workMs = this.workRequiredMs();
        this._onWorkDone(p);
        return { ok: true };
      }
      if (type === 'laze') {
        if (!H.isWolf(g, seat)) return { ok: false, error: '只有狼人能刻意偷懶' };
        if (n.action) return { ok: false, error: '已選擇其他行動' };
        n.action = 'laze'; n.workMs = 0; n.workDone = false; n.pressAt = null;
        this.touch();
        return { ok: true };
      }
      if (type === 'kill') {
        if (!H.isWolf(g, seat)) return { ok: false, error: '你沒有利爪' };
        if (n.action) return { ok: false, error: '已選擇其他行動' };
        const loc = n.destination;
        if (!H.canKillAt(g, loc)) return { ok: false, error: '此地無法出刀' };
        const here = H.atLocation(g, loc);
        const victim = here.find((x) => WV.ROLES[x.role].faction !== 'WOLF');
        n.action = 'kill'; n.killExecutor = true;
        n.workMs = 0; n.workDone = false; n.pressAt = null; // 執行刀人的狼人不能工作
        this._markDying(victim.seat, WV.CAUSE.WOLF_KILL, 1);
        this.notify(seat, 'killDone', { victim: victim.seat });
        this.touch();
        return { ok: true };
      }
      if (type === 'suicide') {
        if (!H.isWolf(g, seat)) return { ok: false, error: '未知操作' };
        if (n.action) return { ok: false, error: '已選擇其他行動' };
        if (!H.canSuicideAt(g, n.destination)) return { ok: false, error: '此地無法自我了斷' };
        n.action = 'suicide';
        n.workMs = 0; n.workDone = false; n.pressAt = null;
        this._markDying(seat, WV.CAUSE.WOLF_SUICIDE, 1);
        this.touch();
        return { ok: true };
      }
      if (type === 'sabotage') {
        if (!H.isWolf(g, seat)) return { ok: false, error: '未知操作' };
        if (n.action) return { ok: false, error: '已選擇其他行動' };
        const kind = H.canSabotage(g, seat);
        if (!kind) return { ok: false, error: '必須獨處於可破壞的地點' };
        n.action = 'sabotage'; n.sabotageKind = kind;
        n.workMs = 0; n.workDone = false; n.pressAt = null;
        if (kind === 'poisonWell') g.wellPoisoned = true;
        if (kind === 'burnFarm') { g.arsonTonight = true; }
        if (kind === 'ruinHerbs') g.herbSabotage = true;
        this.notify(seat, 'sabotageDone', { kind, text: WV.TEXT.wolfActions[kind] });
        this.touch();
        return { ok: true };
      }
      return { ok: false, error: '未知操作' };
    },
    resolve() { this._finalizeWork(); this.nextNightStep(); },
    timeout() { this.resolveStage(); },
  };

  // 女巫救援（批次一與批次二共用邏輯）
  function witchSaveHandler() {
    return {
      submit(seat, type, data, st) {
        if (!st.awaiting.has(seat)) return { ok: false, error: '並非你的抉擇' };
        if (type === 'skip') { this.settleAwait(seat); return { ok: true }; }
        if (type !== 'save') return { ok: false, error: '未知操作' };
        const r = this._applyAntidote(seat, data.target, st.ctx.batch);
        if (!r.ok) return r;
        this.settleAwait(seat);
        return { ok: true };
      },
      resolve() { this.nextNightStep(); },
      timeout(st) { st.awaiting.clear(); this.resolveStage(); },
    };
  }
  SH['night.wolfsave'] = witchSaveHandler();
  SH['night.godsave'] = witchSaveHandler();

  // 查驗與禁票（同時等待）
  SH['night.postinfo'] = {
    submit(seat, type, data, st) {
      const g = this.g;
      if (!st.awaiting.has(seat)) return { ok: false, error: '並非你的抉擇' };
      if (type === 'check') {
        if (!st.ctx.seers.includes(seat)) return { ok: false, error: '你不是預言家' };
        const t = H.p(g, data.target);
        if (!t || !t.alive || t.seat === seat) return { ok: false, error: '只能查驗其他存活玩家' };
        st.ctx.checks[seat] = t.seat;
        this.settleAwait(seat);
        return { ok: true };
      }
      if (type === 'ban') {
        if (!st.ctx.elders.includes(seat)) return { ok: false, error: '你不是禁票長老' };
        const t = H.p(g, data.target);
        if (!t || !t.alive) return { ok: false, error: '目標不合法' };
        const elder = H.p(g, seat);
        if (elder.elderLastTarget === t.seat) return { ok: false, error: '不能連續兩晚指定同一人' };
        st.ctx.bans[seat] = t.seat;
        this.settleAwait(seat);
        return { ok: true };
      }
      if (type === 'skip') { this.settleAwait(seat); return { ok: true }; }
      return { ok: false, error: '未知操作' };
    },
    resolve(ctx) {
      const g = this.g;
      for (const [seerS, target] of Object.entries(ctx.checks)) {
        const seer = Number(seerS);
        const result = H.isWolf(g, target) ? 'wolf' : 'good';
        this.notify(seer, 'checkResult', { target, result });
      }
      for (const [elderS, target] of Object.entries(ctx.bans)) {
        const elder = H.p(g, Number(elderS));
        H.p(g, target).voteBannedNext = true;
        elder.elderLastTarget = target;
        this.notify(elder.seat, 'banConfirmed', { target });
      }
      // 未使用禁票 → 解除連選限制
      for (const s of ctx.elders) {
        if (ctx.bans[s] == null) H.p(g, s).elderLastTarget = null;
      }
      this.nextNightStep();
    },
    timeout(st) { st.awaiting.clear(); this.resolveStage(); },
  };

  // 神職攻擊：潛行者決定是否暗殺；女巫決定是否用毒
  SH['night.godattack'] = {
    submit(seat, type, data, st) {
      const g = this.g;
      if (!st.awaiting.has(seat)) return { ok: false, error: '並非你的抉擇' };
      if (type === 'assassinate') {
        if (!st.ctx.stalkers.includes(seat)) return { ok: false, error: '你不是潛行者' };
        if (data.confirm) st.ctx.assassinations.push(seat);
        this.settleAwait(seat);
        return { ok: true };
      }
      if (type === 'poison') {
        if (!st.ctx.witches.includes(seat)) return { ok: false, error: '你不是女巫' };
        if (g.resources.herb < 1) return { ok: false, error: '藥草已耗盡' };
        const targets = this._poisonTargets(seat);
        if (!targets.some((x) => x.seat === data.target)) return { ok: false, error: '目標不合法' };
        g.resources.herb -= 1;
        const w = H.p(g, seat);
        w.night.poisonedTonight = true;
        st.ctx.poisons[seat] = data.target;
        this.settleAwait(seat);
        return { ok: true };
      }
      if (type === 'skip') { this.settleAwait(seat); return { ok: true }; }
      return { ok: false, error: '未知操作' };
    },
    resolve(ctx) {
      const g = this.g;
      for (const s of ctx.assassinations) {
        const stalker = H.p(g, s);
        const t = H.p(g, stalker.lastExileVote);
        if (!t || !t.alive) continue;
        if (WV.LOCATIONS[t.night.destination] && WV.LOCATIONS[t.night.destination].isCottage) {
          this.notify(s, 'assassinFailed', { target: t.seat, reason: 'cottage' });
          continue; // 村舍不可穿透
        }
        this._markDying(t.seat, WV.CAUSE.ASSASSIN, 2); // 穿透柵欄與守衛
        this.notify(s, 'assassinDone', { target: t.seat });
      }
      for (const [witchS, target] of Object.entries(ctx.poisons)) {
        this._markDying(target, WV.CAUSE.POISON, 2);
        this.notify(Number(witchS), 'poisonDone', { target });
      }
      this.nextNightStep();
    },
    timeout(st) { st.awaiting.clear(); this.resolveStage(); },
  };

  // 暗夜術士挽救
  SH['night.warlock'] = {
    submit(seat, type, data, st) {
      const g = this.g;
      if (!st.awaiting.has(seat)) return { ok: false, error: '並非你的抉擇' };
      if (type === 'skip') { this.settleAwait(seat); return { ok: true }; }
      if (type !== 'rescue') return { ok: false, error: '未知操作' };
      const t = H.p(g, data.target);
      if (!t || !t.alive || !t.night.dying || t.night.dying.batch !== 2) return { ok: false, error: '目標已無需挽救' };
      if (t.seat === seat) return { ok: false, error: '不能挽救自己' };
      st.ctx.saves[seat] = t.seat;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      const g = this.g;
      for (const [wS, target] of Object.entries(ctx.saves)) {
        const w = H.p(g, Number(wS));
        const t = H.p(g, target);
        if (w.warlockUsed || !t.night.dying || t.night.dying.batch !== 2) continue;
        w.warlockUsed = true; // 每局一次，用後永失
        t.night.dying = null;
        t.night.savedBy = 'warlock';
        this.notify(t.seat, 'savedByUnknown', {});
        this.notify(w.seat, 'rescueDone', { target });
      }
      this.nextNightStep();
    },
    timeout(st) { st.awaiting.clear(); this.resolveStage(); },
  };
})();
