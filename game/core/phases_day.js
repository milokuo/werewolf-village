/* 《人狼村》白天流程
   第一日（準備日）：會議 → 暗戀選擇 → 目的地鎖定。
   第二日起：夜死公布 → 黎明反應 → 公開情報 → 食物/飢荒 → 夜死警長移交 →
   第二日警長競選 → 發言順序 → 會議 → 建設 → 放逐 → 目的地最終確認。 */
(function () {
  const WV = (globalThis.WV = globalThis.WV || {});
  const H = WV.H;
  const SH = WV.Game.prototype.stageHandlers;

  Object.assign(WV.Game.prototype, {
    beginDay() {
      const g = this.g;
      g.day += 1;
      g.isNight = false;
      // 隔日狀態轉移
      for (const p of g.players) {
        if (!p.alive) continue;
        p.absent = p.absentNext; p.absentNext = false;
        p.voteBanned = p.voteBannedNext; p.voteBannedNext = false;
        p.lastExileVote = null;
        WV.freshNight(p);
      }
      this.dealNightCards();
      g.dayPlan = g.day === 1
        ? ['meeting', 'admirer', 'finaldest']
        : ['dawn', 'reactions', 'intel', 'food', 'badge', 'election', 'sheriffdir', 'meeting', 'build', 'exile', 'finaldest'];
      g.dayStepIdx = -1;
      this.logPub('—— 第 ' + g.day + ' 天' + (g.day === 1 ? '（準備日）' : '') + ' ——', 'day');
      this.gotoDayStep(null);
    },

    dealNightCards() {
      const g = this.g;
      for (const p of H.alive(g)) {
        p.night.cards = this.rng.sample(g.openLocs, 3);
      }
    },

    gotoDayStep(stepId) {
      const g = this.g;
      if (g.winner) { this.concludeIfWon(); return; }
      if (stepId == null) g.dayStepIdx += 1;
      else g.dayStepIdx = g.dayPlan.indexOf(stepId);
      const step = g.dayPlan[g.dayStepIdx];
      if (!step) { this.beginNight(); return; }
      this['dayStep_' + step]();
    },
    nextDayStep() { this.gotoDayStep(null); },

    // ---- 黎明公布 ----
    dayStep_dawn() {
      const g = this.g;
      const dead = g.players.filter((p) => !p.alive && p.deathAtNight && p.deathDay === g.day - 1)
        .sort((a, b) => a.seat - b.seat);
      if (dead.length === 0) {
        this.logPub('黎明鐘聲響起。昨夜是平安夜，沒有人死亡。', 'dawn');
      } else {
        this.logPub('黎明鐘聲響起。昨夜死亡：' + dead.map((p) => p.seat + '號 ' + p.name).join('、') + '。死因與職業不會公開。', 'dawn');
      }
      for (const p of H.alive(g)) {
        if (p.absent) this.logPub(p.seat + '號 ' + p.name + ' 昨夜前往獵人小屋，今日缺席（可聽會議、不可發言與投票）。', 'dawn');
      }
      this.setStage('dawn.reveal', WV.TIMING.DAWN_REVEAL, [], { dead: dead.map((p) => p.seat) });
    },

    // ---- 黎明反應：第一夜遺言 + 獵人死亡能力 ----
    dayStep_reactions() {
      const g = this.g;
      const q = [];
      const lastNight = g.players.filter((p) => !p.alive && p.deathAtNight && p.deathDay === g.day - 1)
        .sort((a, b) => a.seat - b.seat);
      for (const p of lastNight) {
        if (g.day === 2) q.push({ type: 'lastwords', seat: p.seat }); // 第一夜死者才有遺言
        if (p.role === 'hunter' && p.deathCause === WV.CAUSE.WOLF_KILL && !p.hunterShotUsed) {
          q.push({ type: 'hunter', seat: p.seat });
        }
      }
      g.dawnQueue = q;
      this._dawnNext();
    },
    _dawnNext() {
      const g = this.g;
      if (g.winner) { this.concludeIfWon(); return; }
      const item = g.dawnQueue.shift();
      if (!item) { this.nextDayStep(); return; }
      if (item.type === 'lastwords') {
        this.logPub(H.p(g, item.seat).seat + '號 ' + H.p(g, item.seat).name + ' 的遺言：', 'lastwords');
        this.setStage('lastwords', WV.TIMING.LAST_WORDS, [item.seat], { seat: item.seat, thenDawn: true });
      } else if (item.type === 'hunter') {
        this.setStage('hunter.decide', WV.TIMING.ABILITY, [item.seat], { seat: item.seat, chain: 'dawn' });
      }
    },
    _dawnNextLastWords() { this._dawnNext(); },
    _dawnAfterHunter() {
      // 獵人若開槍，帶走的死亡已排入佇列 → 完整處理（遺言、警徽、暗戀等）後回到黎明佇列
      if (this.g.deathQueue.length) this.drainDeathQueue(() => this._dawnNext());
      else this._dawnNext();
    },

    // ---- 公開情報 ----
    dayStep_intel() {
      const g = this.g;
      // 禁票公開（不公開長老身分）
      for (const p of H.alive(g)) {
        if (p.voteBanned) this.logPub(p.seat + '號 ' + p.name + ' 今日被剝奪一般放逐投票權。', 'intel');
      }
      // 大燈 / 瞭望塔報告
      const r = g.nightReports;
      if (r && (r.tower || r.lamp)) {
        const lines = [];
        const locs = r.tower ? g.openLocs : ['mill', 'well', 'smithy'];
        for (const l of locs) {
          if (!g.openLocs.includes(l)) { lines.push(WV.LOCATIONS[l].name + '：未開放'); continue; }
          if (l === 'cottage') { lines.push('村舍（合計）：' + r.counts[l] + ' 人'); continue; }
          lines.push(WV.LOCATIONS[l].name + '：' + (r.counts[l] || 0) + ' 人');
        }
        this.logPub((r.tower ? '瞭望塔的守望者' : '大燈的光') + '帶來昨夜的地點人數——' + lines.join('；') + '。', 'intel');
      }
      // 資源資訊（依房主公開模式）
      const d = g.resourceDelta;
      if (d) {
        const mode = this.settings.resourceInfoMode;
        let text = '目前庫存：食物 ' + g.resources.food + '、材料 ' + g.resources.material + '、藥草 ' + g.resources.herb + '。';
        if (mode >= 2) text += ' 昨夜變動：食物 ' + fmtDelta(d.food) + '、材料 ' + fmtDelta(d.material) + '、藥草 ' + fmtDelta(d.herb) + '。';
        if (mode >= 3 && d.perLoc && d.perLoc.length) {
          text += ' 各地點：' + d.perLoc.map((x) => x.name + ' ' + fmtDelta(x.amount)).join('、') + '。';
          if (d.arsonLoss) text += ' 另有不明損失：食物 -' + d.arsonLoss + '。';
        }
        this.logPub(text, 'resource');
      }
      this.nextDayStep();
    },

    // ---- 食物與飢荒 ----
    dayStep_food() {
      this._famineCheck();
    },
    _famineCheck() {
      const g = this.g;
      if (g.winner) { this.concludeIfWon(); return; }
      const alive = H.alive(g).length;
      if (alive === 0) { this.nextDayStep(); return; }
      if (alive > g.resources.food) {
        this.logPub('存活 ' + alive + ' 人，食物僅 ' + g.resources.food + ' 份。飢荒降臨，必須有人犧牲——進行匿名飢荒投票。', 'famine');
        this._beginFamineVote(null, 1);
      } else {
        g.resources.food -= alive;
        this.logPub('每名存活玩家消耗 1 份食物，剩餘食物 ' + g.resources.food + ' 份。', 'resource');
        this.nextDayStep();
      }
    },
    _beginFamineVote(restrictTargets, round) {
      const g = this.g;
      const voters = H.alive(g).filter((p) => H.canVoteFamine(g, p.seat)).map((p) => p.seat);
      const targets = (restrictTargets || H.aliveSeats(g));
      this.setStage('famine.vote', WV.TIMING.VOTE, voters, { votes: {}, targets, round });
    },

    // ---- 夜死警長移交 ----
    dayStep_badge() {
      const g = this.g;
      const s = g.sheriffSeat != null ? H.p(g, g.sheriffSeat) : null;
      if (s && !s.alive && !g.badgeDestroyed) {
        this.logPub('警長 ' + s.seat + '號 ' + s.name + ' 已在昨夜死亡，現在移交警徽。', 'sheriff');
        this.setStage('badge.transfer', WV.TIMING.BADGE_TRANSFER, [s.seat], { seat: s.seat, thenContinueDay: 'election' });
        return;
      }
      this.nextDayStep();
    },

    // ---- 警長競選（僅第二日一次）----
    dayStep_election() {
      const g = this.g;
      if (g.day !== 2 || g.electionHeld) { this.nextDayStep(); return; }
      g.electionHeld = true;
      const eligible = H.alive(g).filter((p) => !p.absent).map((p) => p.seat);
      if (eligible.length === 0) { this.nextDayStep(); return; }
      this.logPub('警長競選開始。願意參選者請上前一步（警長在放逐、飢荒與建設中擁有 1.5 票，並決定發言順序）。', 'sheriff');
      this.setStage('election.signup', WV.TIMING.ABILITY, eligible, { runs: {} });
    },
    _electionSpeeches(candidates, isPK) {
      const g = this.g;
      g.electionState = { candidates: candidates.slice(), speechIdx: -1, isPK, withdrawn: [] };
      this._electionNextSpeech();
    },
    _electionNextSpeech() {
      const g = this.g, es = g.electionState;
      es.speechIdx += 1;
      const remaining = es.candidates.filter((s) => !es.withdrawn.includes(s));
      if (es.speechIdx >= es.candidates.length) { this._electionVote(remaining); return; }
      const speaker = es.candidates[es.speechIdx];
      if (es.withdrawn.includes(speaker) || !H.p(g, speaker).alive) { this._electionNextSpeech(); return; }
      const p = H.p(g, speaker);
      const secs = p.isAI ? this.settings.aiSpeechSeconds : WV.TIMING.ELECTION_SPEECH;
      this.logPub(p.seat + '號 ' + p.name + ' 發表競選演說：', 'sheriff');
      this.setStage('election.speech', secs, [speaker], { speaker });
    },
    _electionVote(candidates) {
      const g = this.g;
      candidates = candidates.filter((s) => H.p(g, s).alive);
      if (candidates.length === 0) {
        this.logPub('所有候選人退選或死亡，本局沒有警長。', 'sheriff');
        this.nextDayStep(); return;
      }
      if (candidates.length === 1) {
        g.sheriffSeat = candidates[0];
        const p = H.p(g, candidates[0]);
        this.logPub('僅剩一名候選人，' + p.seat + '號 ' + p.name + ' 自動當選警長。', 'sheriff');
        this.nextDayStep(); return;
      }
      const voters = H.alive(g).filter((p) => H.canVoteSheriff(g, p.seat, candidates)).map((p) => p.seat);
      if (voters.length === 0) { this.logPub('沒有可投票者，本局沒有警長。', 'sheriff'); this.nextDayStep(); return; }
      const round = (g.electionState && g.electionState.votedOnce) ? 2 : 1;
      this.setStage('election.vote', WV.TIMING.VOTE, voters, { votes: {}, candidates, round });
    },

    // ---- 警長選擇發言方向 ----
    dayStep_sheriffdir() {
      const g = this.g;
      const s = H.sheriff(g);
      if (s && s.alive && !s.absent) {
        this.setStage('sheriff.direction', WV.TIMING.ABILITY, [s.seat], {});
        return;
      }
      g.speechDirection = null;
      this.nextDayStep();
    },

    // ---- 白天會議 ----
    dayStep_meeting() {
      const g = this.g;
      if (g.day === 1 || this.settings.speechMode === 'free') {
        this.logPub(g.day === 1
          ? '準備日會議開始：認識彼此、閱讀板子、討論今晚的工作分配。會議期間即可暫選目的地。'
          : '自由討論開始。', 'meeting');
        const alive = H.alive(g).filter((p) => !p.absent).map((p) => p.seat);
        this.setStage('day.meeting.open', this.settings.meetingSeconds, [], { canReady: alive, ready: [] });
        return;
      }
      const order = this.computeSpeechOrder(g.speechDirection);
      g.speechPlan = { order, idx: -1 };
      if (order.length === 0) { this.nextDayStep(); return; }
      this.logPub('輪流發言開始，順序：' + order.map((s) => s + '號').join(' → ') + '。', 'meeting');
      this._nextSpeaker();
    },
    _nextSpeaker() {
      const g = this.g, sp = g.speechPlan;
      if (g.winner) { this.concludeIfWon(); return; }
      sp.idx += 1;
      while (sp.idx < sp.order.length) {
        const seat = sp.order[sp.idx];
        const p = H.p(g, seat);
        if (p.alive && !p.absent) break;
        sp.idx += 1;
      }
      if (sp.idx >= sp.order.length) { this.nextDayStep(); return; }
      const seat = sp.order[sp.idx];
      const p = H.p(g, seat);
      const secs = p.isAI ? this.settings.aiSpeechSeconds : this.settings.speechSeconds;
      this.setStage('day.speech', secs, [seat], { speaker: seat });
    },

    // ---- 建設提案與表決 ----
    dayStep_build() {
      const g = this.g;
      const affordable = this.affordableConstructions();
      if (affordable.length === 0) { this.nextDayStep(); return; }
      g.buildState = { proposals: [] };
      this.logPub('材料足以動工（庫存 ' + g.resources.material + '）。可提出建設提案：' +
        affordable.map((c) => WV.CONSTRUCTIONS[c].name + '（' + WV.constructionCost(c, g.totalRoles) + ' 材料）').join('、') + '。', 'build');
      this.setStage('build.propose', WV.TIMING.ABILITY, [], {});
    },
    affordableConstructions() {
      const g = this.g;
      return Object.keys(WV.CONSTRUCTIONS).filter((c) => {
        if (c === 'lamp' && g.constructions.lamp) return false;
        if (c === 'fence' && g.constructions.fence) return false;
        if (c === 'beacon' && g.constructions.beacon) return false;
        return WV.constructionCost(c, g.totalRoles) <= g.resources.material;
      });
    },
    inputPropose(seat, data) {
      const g = this.g;
      if (!this.stageIs('build.propose')) return { ok: false, error: '目前不是提案時間' };
      const p = H.p(g, seat);
      if (!p.alive) return { ok: false, error: '死者不能提案' };
      const c = data.construction;
      if (!this.affordableConstructions().includes(c)) return { ok: false, error: '材料不足或已建成' };
      if (g.buildState.proposals.some((x) => x.construction === c)) return { ok: false, error: '此建設已被提案' };
      let fenceLoc = null;
      if (c === 'fence') {
        fenceLoc = data.fenceLoc;
        if (!g.openLocs.includes(fenceLoc) || WV.LOCATIONS[fenceLoc].isCottage) {
          return { ok: false, error: '柵欄地點不合法（不能指定村舍）' };
        }
      }
      g.buildState.proposals.push({ construction: c, fenceLoc, proposer: seat });
      this.logPub(p.seat + '號 ' + p.name + ' 提案建設【' + WV.CONSTRUCTIONS[c].name + '】' +
        (fenceLoc ? '（保護地點：' + WV.LOCATIONS[fenceLoc].name + '）' : '') + '。', 'build');
      this.touch();
      return { ok: true };
    },

    // ---- 一般放逐 ----
    dayStep_exile() {
      const g = this.g;
      const voters = H.alive(g).filter((p) => H.canVoteExile(g, p.seat)).map((p) => p.seat);
      g.exileState = { round: 1 };
      if (voters.length === 0) { this.logPub('沒有合法投票者，今日無人放逐。', 'exile'); this.nextDayStep(); return; }
      this.logPub('一般放逐投票開始（匿名進行，結算後公開去向）。', 'exile');
      this.setStage('exile.vote', WV.TIMING.VOTE, voters, { votes: {}, targets: H.aliveSeats(g), round: 1 });
    },
    _exilePKSpeeches(tied) {
      const g = this.g;
      g.exileState = { round: 2, tied: tied.slice(), speechIdx: -1 };
      this.logPub('平票！平票者依序補充發言後，進行只限平票者的重投：' + tied.map((s) => s + '號').join('、') + '。', 'exile');
      this._exileNextPKSpeech();
    },
    _exileNextPKSpeech() {
      const g = this.g, es = g.exileState;
      es.speechIdx += 1;
      if (es.speechIdx >= es.tied.length) {
        const voters = H.alive(g).filter((p) => H.canVoteExile(g, p.seat)).map((p) => p.seat);
        if (voters.length === 0) { this.logPub('沒有合法投票者，今日無人放逐。', 'exile'); this.nextDayStep(); return; }
        this.setStage('exile.vote', WV.TIMING.VOTE, voters, { votes: {}, targets: es.tied, round: 2 });
        return;
      }
      const seat = es.tied[es.speechIdx];
      const p = H.p(g, seat);
      if (!p.alive) { this._exileNextPKSpeech(); return; }
      const secs = p.isAI ? this.settings.aiSpeechSeconds : WV.TIMING.PK_SPEECH;
      this.setStage('day.speech.pk', secs, [seat], { speaker: seat, kind: 'exile' });
    },
    _resolveExile(top) {
      const g = this.g;
      const p = H.p(g, top);
      // 白癡翻牌免死
      if (p.role === 'idiot' && !p.idiotFlipped) {
        this.setStage('exile.idiot', WV.TIMING.ABILITY, [p.seat], { seat: p.seat });
        return;
      }
      this.queueDeath(top, WV.CAUSE.EXILE);
      this.drainDeathQueue(() => this.nextDayStep());
    },

    // ---- 暗戀者選擇對象（第一個白天結束後）----
    dayStep_admirer() {
      const g = this.g;
      const admirers = H.alive(g).filter((p) => p.role === 'admirer' && p.admirerTarget == null).map((p) => p.seat);
      if (admirers.length === 0) { this.nextDayStep(); return; }
      this.setStage('day.admirer', WV.TIMING.ABILITY, admirers, { choices: {} });
    },

    // ---- 目的地最終確認 ----
    dayStep_finaldest() {
      const g = this.g;
      const alive = H.aliveSeats(g);
      if (alive.length === 0) { this.beginNight(); return; }
      this.logPub('夜幕將至。所有人最後一次確認今晚的目的地。', 'night');
      this.setStage('day.finaldest', WV.TIMING.DESTINATION, alive, { confirmed: {} });
    },
    _lockDestinations() {
      const g = this.g;
      for (const p of H.alive(g)) {
        const n = p.night;
        if (p.role === 'guard' && n.prefPatrol) {
          n.patrol = n.prefPatrol.slice();
          n.destination = n.prefGoto || n.patrol[0];
          continue;
        }
        let dest = n.prefDest;
        if (!dest || !g.openLocs.includes(dest)) dest = this.rng.pick(n.cards); // 隨機代選不消耗夜行令
        if (!n.cards.includes(dest)) {
          if (p.nightPassUsed || p.role === 'guard') dest = this.rng.pick(n.cards);
          else { p.nightPassUsed = true; n.usedPassTonight = true; this.notify(p.seat, 'nightPass', { loc: dest }); }
        }
        n.destination = dest;
      }
    },
  });

  function fmtDelta(n) { return (n >= 0 ? '+' : '') + n; }

  // ================= 階段處理器 =================

  SH['dawn.reveal'] = {
    resolve() { this.nextDayStep(); },
  };

  // 準備日／自由討論：可提前全員準備結束
  SH['day.meeting.open'] = {
    submit(seat, type, data, st) {
      if (type !== 'ready') return { ok: false, error: '未知操作' };
      if (!st.ctx.canReady.includes(seat)) return { ok: false, error: '無法表示準備' };
      if (!st.ctx.ready.includes(seat)) st.ctx.ready.push(seat);
      this.touch();
      const stillAlive = st.ctx.canReady.filter((s) => WV.H.p(this.g, s).alive);
      if (stillAlive.every((s) => st.ctx.ready.includes(s))) this.resolveStage();
      return { ok: true };
    },
    resolve() { this.nextDayStep(); },
  };

  // 輪流發言
  SH['day.speech'] = {
    submit(seat, type, data, st) {
      if (type === 'done' && seat === st.ctx.speaker) { this.settleAwait(seat); return { ok: true }; }
      return { ok: false, error: '未知操作' };
    },
    resolve() { this._nextSpeaker(); },
    timeout() { this.resolveStage(); },
  };

  // 放逐平票補充發言
  SH['day.speech.pk'] = {
    submit(seat, type, data, st) {
      if (type === 'done' && seat === st.ctx.speaker) { this.settleAwait(seat); return { ok: true }; }
      return { ok: false, error: '未知操作' };
    },
    resolve() { this._exileNextPKSpeech(); },
    timeout() { this.resolveStage(); },
  };

  // 警長競選報名
  SH['election.signup'] = {
    submit(seat, type, data, st) {
      if (type !== 'run') return { ok: false, error: '未知操作' };
      if (!this.g.stage.awaiting.has(seat) && st.ctx.runs[seat] == null) return { ok: false, error: '無法報名' };
      st.ctx.runs[seat] = !!data.run;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      const g = this.g;
      let candidates = Object.keys(ctx.runs).filter((s) => ctx.runs[s]).map(Number).sort((a, b) => a - b);
      // 系統不允許所有人參選：必須至少保留一名投票者
      const aliveAll = H.aliveSeats(g);
      if (candidates.length >= aliveAll.length && candidates.length > 0) {
        const dropped = candidates[candidates.length - 1];
        candidates = candidates.filter((s) => s !== dropped);
        this.logPub('必須至少保留一名投票者，' + dropped + '號的參選被系統取消。', 'sheriff');
      }
      if (candidates.length === 0) {
        this.logPub('無人參選，本局沒有警長。', 'sheriff');
        this.nextDayStep(); return;
      }
      this.logPub('參選者：' + candidates.map((s) => s + '號').join('、') + '。候選人依號碼發言。', 'sheriff');
      this._electionSpeeches(candidates, false);
    },
    timeout(st) {
      for (const s of Array.from(this.g.stage.awaiting)) st.ctx.runs[s] = false;
      this.g.stage.awaiting.clear();
      this.resolveStage();
    },
  };

  // 競選發言（發言者可退選）
  SH['election.speech'] = {
    submit(seat, type, data, st) {
      const es = this.g.electionState;
      if (type === 'done' && seat === st.ctx.speaker) { this.settleAwait(seat); return { ok: true }; }
      if (type === 'withdraw') {
        if (!es.candidates.includes(seat)) return { ok: false, error: '你不是候選人' };
        if (!es.withdrawn.includes(seat)) es.withdrawn.push(seat);
        this.logPub(seat + '號退選，恢復警長投票權。', 'sheriff');
        if (seat === st.ctx.speaker) this.settleAwait(seat);
        this.touch();
        return { ok: true };
      }
      return { ok: false, error: '未知操作' };
    },
    resolve() { this._electionNextSpeech(); },
    timeout() { this.resolveStage(); },
  };

  // 警長投票（固定 1 票；逾時隨機投給合法候選人）
  SH['election.vote'] = {
    submit(seat, type, data, st) {
      if (!st.awaiting.has(seat)) return { ok: false, error: '你沒有投票資格或已投票' };
      if (type !== 'vote') return { ok: false, error: '未知操作' };
      if (!st.ctx.candidates.includes(data.target)) return { ok: false, error: '目標不是候選人' };
      st.ctx.votes[seat] = data.target;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      const g = this.g;
      const es = g.electionState || {};
      const candidates = ctx.candidates.filter((s) => !(es.withdrawn || []).includes(s) && H.p(g, s).alive);
      const tally = {};
      for (const c of candidates) tally[c] = 0;
      for (const [voter, t] of Object.entries(ctx.votes)) {
        if (tally[t] != null) tally[t] += 1; // 每張警長選票固定 1 票
      }
      const entries = Object.entries(tally).map(([s, v]) => [Number(s), v]).sort((a, b) => b[1] - a[1]);
      this.logPub('警長選舉開票：' + entries.map(([s, v]) => s + '號 ' + v + ' 票').join('、') + '。', 'sheriff');
      if (entries.length === 0) { this.logPub('沒有有效候選人，本局沒有警長。', 'sheriff'); this.nextDayStep(); return; }
      const top = entries[0][1];
      const tied = entries.filter(([, v]) => v === top).map(([s]) => s);
      if (tied.length === 1) {
        g.sheriffSeat = tied[0];
        this.logPub(tied[0] + '號 ' + H.p(g, tied[0]).name + ' 當選警長，獲得 1.5 票與發言順序決定權。', 'sheriff');
        this.nextDayStep(); return;
      }
      if (ctx.round >= 2) {
        this.logPub('PK 再度平票，本局沒有警長。', 'sheriff');
        this.nextDayStep(); return;
      }
      this.logPub('平票！平票者重新發言後進行 PK 重投：' + tied.map((s) => s + '號').join('、') + '。', 'sheriff');
      g.electionState = { candidates: tied, speechIdx: -1, isPK: true, withdrawn: [], votedOnce: true };
      this._electionNextSpeech();
    },
    timeout(st) {
      for (const s of Array.from(st.awaiting)) {
        st.ctx.votes[s] = this.rng.pick(st.ctx.candidates);
      }
      st.awaiting.clear();
      this.resolveStage();
    },
  };

  // 警長選擇發言方向
  SH['sheriff.direction'] = {
    submit(seat, type, data, st) {
      if (seat !== this.g.sheriffSeat) return { ok: false, error: '你不是警長' };
      if (type !== 'direction' || !['forward', 'back'].includes(data.dir)) return { ok: false, error: '未知操作' };
      st.ctx.dir = data.dir;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      this.g.speechDirection = ctx.dir || (this.rng.chance(0.5) ? 'forward' : 'back');
      this.logPub('警長決定發言由自己的' + (this.g.speechDirection === 'forward' ? '下一號' : '上一號') + '方向開始。', 'sheriff');
      this.nextDayStep();
    },
    timeout(st) { this.resolveStage(); },
  };

  // 建設提案窗口（提案經 inputPropose 進入）
  SH['build.propose'] = {
    resolve() {
      const g = this.g;
      const props = (g.buildState && g.buildState.proposals) || [];
      if (props.length === 0) {
        this.logPub('沒有建設提案。', 'build');
        g.buildState = null;
        this.nextDayStep(); return;
      }
      const voters = H.alive(g).filter((p) => H.canVoteBuild(g, p.seat)).map((p) => p.seat);
      this.logPub('建設表決開始：需要「超過存活玩家人數一半」的票值才能通過，每天最多通過一案。', 'build');
      this.setStage('build.vote', WV.TIMING.VOTE, voters, { votes: {}, proposals: props });
    },
  };

  SH['build.vote'] = {
    submit(seat, type, data, st) {
      if (!st.awaiting.has(seat)) return { ok: false, error: '你已表態或無表決權' };
      if (type === 'abstain') { st.ctx.votes[seat] = null; this.settleAwait(seat); return { ok: true }; }
      if (type !== 'vote') return { ok: false, error: '未知操作' };
      const idx = data.proposal;
      if (!(idx >= 0 && idx < st.ctx.proposals.length)) return { ok: false, error: '提案不存在' };
      st.ctx.votes[seat] = idx;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      const g = this.g;
      const aliveCount = H.alive(g).length;
      const need = aliveCount / 2; // 嚴格大於
      const totals = ctx.proposals.map(() => 0);
      for (const [voter, idx] of Object.entries(ctx.votes)) {
        if (idx == null) continue;
        totals[idx] += H.voteWeight(g, Number(voter), 'build');
      }
      const lines = ctx.proposals.map((p, i) =>
        WV.CONSTRUCTIONS[p.construction].name + ' ' + totals[i] + ' 票');
      this.logPub('建設表決結果：' + lines.join('、') + '（門檻 >' + need + '）。', 'build');
      const passIdx = totals.findIndex((v) => v > need);
      if (passIdx >= 0) {
        const p = ctx.proposals[passIdx];
        g.pendingConstruction = { id: p.construction, fenceLoc: p.fenceLoc, day: g.day };
        this.logPub('【' + WV.CONSTRUCTIONS[p.construction].name + '】提案通過！今晚只要至少一名廣場玩家完成 10 秒建設工作，工程即完成。', 'build');
      } else {
        this.logPub('沒有提案取得過半票值，今日沒有工程。', 'build');
      }
      g.buildState = null;
      this.nextDayStep();
    },
    timeout(st) {
      for (const s of Array.from(st.awaiting)) st.ctx.votes[s] = null; // 逾時視為棄權
      st.awaiting.clear();
      this.resolveStage();
    },
  };

  // 一般放逐投票（匿名進行、結算公開去向；逾時視為棄票）
  SH['exile.vote'] = {
    submit(seat, type, data, st) {
      if (!st.awaiting.has(seat)) return { ok: false, error: '你沒有投票權或已投票' };
      const p = H.p(this.g, seat);
      if (type === 'abstain') {
        st.ctx.votes[seat] = null;
        p.lastExileVote = null;
        this.settleAwait(seat);
        return { ok: true };
      }
      if (type !== 'vote') return { ok: false, error: '未知操作' };
      if (!st.ctx.targets.includes(data.target)) return { ok: false, error: '目標不合法' };
      st.ctx.votes[seat] = data.target;
      p.lastExileVote = data.target; // 潛行者依據：當天最後一次有效放逐投票
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      const g = this.g;
      const tally = {};
      const detail = [];
      for (const [voterS, t] of Object.entries(ctx.votes)) {
        const voter = Number(voterS);
        if (t == null) { detail.push(voter + '號→棄票'); continue; }
        const w = H.voteWeight(g, voter, 'exile');
        tally[t] = (tally[t] || 0) + w;
        detail.push(voter + '號→' + t + '號' + (w !== 1 ? '（1.5）' : ''));
      }
      this.logPub('放逐投票公開：' + (detail.length ? detail.join('，') : '全員棄票') + '。', 'exile');
      const entries = Object.entries(tally).map(([s, v]) => [Number(s), v]).sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) { this.logPub('無人得票，今日無人放逐。', 'exile'); this.nextDayStep(); return; }
      const top = entries[0][1];
      const tied = entries.filter(([, v]) => v === top).map(([s]) => s);
      if (tied.length > 1) {
        if (ctx.round >= 2) { this.logPub('再次平票，今日無人放逐。', 'exile'); this.nextDayStep(); return; }
        this._exilePKSpeeches(tied);
        return;
      }
      const exiled = tied[0];
      this.logPub(exiled + '號 ' + H.p(g, exiled).name + ' 以 ' + top + ' 票成為放逐結果。', 'exile');
      this._resolveExile(exiled);
    },
    timeout(st) {
      for (const s of Array.from(st.awaiting)) {
        st.ctx.votes[s] = null; // 逾時視為棄票
        H.p(this.g, s).lastExileVote = null;
      }
      st.awaiting.clear();
      this.resolveStage();
    },
  };

  // 白癡翻牌決定（逾時 = 翻牌免死，設計決定）
  SH['exile.idiot'] = {
    submit(seat, type, data, st) {
      if (seat !== st.ctx.seat) return { ok: false, error: '並非你的抉擇' };
      if (type === 'flip') { st.ctx.flip = true; this.settleAwait(seat); return { ok: true }; }
      if (type === 'accept') { st.ctx.flip = false; this.settleAwait(seat); return { ok: true }; }
      return { ok: false, error: '未知操作' };
    },
    resolve(ctx) {
      const g = this.g;
      const p = H.p(g, ctx.seat);
      if (ctx.flip !== false) {
        p.idiotFlipped = true;
        p.revealedRole = 'idiot';
        this.logPub(p.seat + '號 ' + p.name + ' 翻開了白癡的身分——處刑取消！他保住性命，但永久失去一般放逐投票權。當天不改放第二高票。', 'exile');
        this.nextDayStep();
      } else {
        this.queueDeath(ctx.seat, WV.CAUSE.EXILE);
        this.drainDeathQueue(() => this.nextDayStep());
      }
    },
    timeout(st) { st.ctx.flip = true; this.resolveStage(); },
  };

  // 飢荒投票（永久匿名、不可棄票、逾時隨機；平票重投一次後隨機處決）
  SH['famine.vote'] = {
    submit(seat, type, data, st) {
      if (!st.awaiting.has(seat)) return { ok: false, error: '你沒有投票資格或已投票' };
      if (type !== 'vote') return { ok: false, error: '飢荒投票不能棄票' };
      if (!st.ctx.targets.includes(data.target)) return { ok: false, error: '目標不合法' };
      st.ctx.votes[seat] = data.target;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      const g = this.g;
      const tally = {};
      for (const [voterS, t] of Object.entries(ctx.votes)) {
        tally[t] = (tally[t] || 0) + H.voteWeight(g, Number(voterS), 'famine');
      }
      const entries = Object.entries(tally).map(([s, v]) => [Number(s), v]).sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) { this.nextDayStep(); return; }
      const top = entries[0][1];
      const tied = entries.filter(([, v]) => v === top).map(([s]) => s);
      if (tied.length > 1) {
        if (ctx.round === 1) {
          this.logPub('飢荒投票平票，立即重投（只限平票者為目標）。', 'famine');
          this._beginFamineVote(tied, 2);
          return;
        }
        const victim = this.rng.pick(tied);
        this.logPub('再次平票，命運的骰子落下——' + victim + '號成為犧牲者（' + top + ' 加權票）。', 'famine');
        this.queueDeath(victim, WV.CAUSE.FAMINE);
        this.drainDeathQueue(() => this._famineCheck());
        return;
      }
      const victim = tied[0];
      this.logPub('飢荒的犧牲者是 ' + victim + '號 ' + H.p(g, victim).name + '（' + top + ' 加權票；投票者永久保密）。', 'famine');
      this.queueDeath(victim, WV.CAUSE.FAMINE);
      this.drainDeathQueue(() => this._famineCheck());
    },
    timeout(st) {
      // 逾時由系統隨機投給一名合法目標（不投自己）
      for (const s of Array.from(st.awaiting)) {
        const opts = st.ctx.targets.filter((t) => t !== s);
        st.ctx.votes[s] = this.rng.pick(opts.length ? opts : st.ctx.targets);
      }
      st.awaiting.clear();
      this.resolveStage();
    },
  };

  // 暗戀者選擇對象（第一個白天結束後；逾時隨機）
  SH['day.admirer'] = {
    submit(seat, type, data, st) {
      if (!st.awaiting.has(seat)) return { ok: false, error: '並非你的抉擇' };
      if (type !== 'choose') return { ok: false, error: '未知操作' };
      const t = H.p(this.g, data.target);
      if (!t || !t.alive || t.seat === seat) return { ok: false, error: '目標不合法' };
      st.ctx.choices[seat] = t.seat;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      const g = this.g;
      for (const [seatS, target] of Object.entries(ctx.choices)) {
        const p = H.p(g, Number(seatS));
        p.admirerTarget = target;
        this.notify(p.seat, 'admirerChosen', { target });
      }
      this.nextDayStep();
    },
    timeout(st) {
      for (const s of Array.from(st.awaiting)) {
        const opts = H.alive(this.g).filter((x) => x.seat !== s).map((x) => x.seat);
        st.ctx.choices[s] = this.rng.pick(opts);
      }
      st.awaiting.clear();
      this.resolveStage();
    },
  };

  // 目的地最終確認
  SH['day.finaldest'] = {
    submit(seat, type, data, st) {
      if (!st.awaiting.has(seat)) return { ok: false, error: '已確認或不需確認' };
      if (type === 'confirmDest') {
        const r = this.inputDestPref(seat, { loc: data.loc });
        if (!r.ok) return r;
        this.settleAwait(seat);
        return { ok: true };
      }
      if (type === 'confirmPatrol') {
        const r = this.inputDestPref(seat, { patrol: data.patrol, goto: data.goto });
        if (!r.ok) return r;
        this.settleAwait(seat);
        return { ok: true };
      }
      if (type === 'confirmKeep') { this.settleAwait(seat); return { ok: true }; }
      return { ok: false, error: '未知操作' };
    },
    resolve() {
      // 守衛無偏好時：隨機合法巡邏
      const g = this.g;
      for (const p of H.alive(g)) {
        if (p.role === 'guard' && !p.night.prefPatrol && !p.night.prefDest) {
          const pairs = [];
          for (const [a, b] of WV.MAP_EDGES) {
            if (!g.openLocs.includes(a) || !g.openLocs.includes(b)) continue;
            if (WV.LOCATIONS[a].isCottage || WV.LOCATIONS[b].isCottage) continue;
            if (this.hasLegalPatrol(p) && (p.guardLastPatrol.includes(a) || p.guardLastPatrol.includes(b))) continue;
            pairs.push([a, b]);
          }
          if (pairs.length) {
            const pick = this.rng.pick(pairs);
            p.night.prefPatrol = pick;
            p.night.prefGoto = this.rng.pick(pick);
          }
        }
      }
      this._lockDestinations();
      this.beginNight();
    },
    timeout(st) { st.awaiting.clear(); this.resolveStage(); },
  };
})();
