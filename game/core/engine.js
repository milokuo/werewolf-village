/* 《人狼村》遊戲引擎底盤
   權威狀態機：階段（stage）＋等待輸入（awaiting）＋逾時預設值。
   所有時間由外部驅動（server / 測試）透過 tick(now) 推進，可完全重現。 */
(function () {
  const WV = (globalThis.WV = globalThis.WV || {});
  const H = () => WV.H;

  class Game {
    /**
     * @param {object} opts
     *  players: [{name, isAI}] 依座位序
     *  settings: 房主設定（併入 DEFAULT_SETTINGS）
     *  seed: 亂數種子
     *  speed: 時間倍率（1=正常，0=測試瞬時）
     */
    constructor(opts) {
      this.settings = Object.assign({}, WV.DEFAULT_SETTINGS, opts.settings || {});
      this.speed = opts.speed == null ? 1 : opts.speed;
      this.rng = new WV.Rng(opts.seed == null ? 1 : opts.seed);
      const players = opts.players.map((p, i) => WV.makePlayer(i + 1, p.name, !!p.isAI));
      this.g = WV.createGame(players, this.settings, this.rng);
      // 測試鉤子：指定職業分配（必須是本局職業列表的重排）
      if (opts.forceRoles) {
        const sorted = (a) => a.slice().sort().join(',');
        if (sorted(opts.forceRoles) !== sorted(this.g.players.map((p) => p.role))) {
          throw new Error('forceRoles 與板子職業組成不符');
        }
        this.g.players.forEach((p, i) => { p.role = opts.forceRoles[i]; });
      }
      this.g.stage = null;
      this.listeners = [];
      this.rev = 0;
      this.now = 0;
      this._interruptBusy = false;
      this.ended = false;
    }

    // ---- 事件與紀錄 ----
    onEvent(cb) { this.listeners.push(cb); }
    emit(evt) { for (const cb of this.listeners) cb(evt); }
    touch() { this.rev++; }

    logPub(text, kind) {
      const entry = { day: this.g.day, night: this.g.isNight, kind: kind || 'info', text, at: this.now };
      this.g.publicLog.push(entry);
      this.emit({ t: 'log', entry });
      this.touch();
    }
    notify(seat, kind, payload) {
      const p = H().p(this.g, seat);
      if (!p.privateLog) p.privateLog = [];
      const entry = { day: this.g.day, night: this.g.isNight, kind, payload, at: this.now };
      p.privateLog.push(entry);
      this.emit({ t: 'notify', seat, entry });
      this.touch();
    }
    chatMsg(channel, fromLabel, text, meta) {
      const msg = Object.assign({ channel, from: fromLabel, text, at: this.now, day: this.g.day }, meta || {});
      this.emit({ t: 'chat', msg });
      if (!this.g.chatHistory) this.g.chatHistory = [];
      this.g.chatHistory.push(msg);
      if (this.g.chatHistory.length > 1200) this.g.chatHistory.splice(0, 200);
      this.touch();
    }

    // ---- 階段機 ----
    /** seconds 依 speed 縮放；awaitingSeats: 需要輸入的座位陣列 */
    setStage(id, seconds, awaitingSeats, ctx) {
      const dur = Math.max(0, seconds * (this.speed || 0)) * 1000;
      this.g.stage = {
        id,
        endsAt: this.now + dur,
        startedAt: this.now,
        awaiting: new Set(awaitingSeats || []),
        ctx: ctx || {},
      };
      this.emit({ t: 'stage', id, ctx: this.g.stage.ctx });
      this.touch();
    }
    stageIs(...ids) { return this.g.stage && ids.includes(this.g.stage.id); }
    /** 完成某座位的等待；全數完成且允許提前 → resolve */
    settleAwait(seat, earlyResolve = true) {
      const st = this.g.stage;
      if (!st) return;
      st.awaiting.delete(seat);
      if (earlyResolve && st.awaiting.size === 0) this.resolveStage();
    }
    resolveStage() {
      const st = this.g.stage;
      if (!st) return;
      this.g.stage = null;
      const h = this.stageHandlers[st.id];
      if (!h || !h.resolve) throw new Error('無 resolve 處理器：' + st.id);
      h.resolve.call(this, st.ctx);
    }

    /** 外部驅動：處理逾時。回傳是否有變化。 */
    tick(now) {
      this.now = Math.max(this.now, now);
      if (this.ended) return false;
      const st = this.g.stage;
      if (!st) return false;
      if (this.now < st.endsAt) return false;
      const h = this.stageHandlers[st.id];
      if (h && h.timeout) h.timeout.call(this, st);
      else this.resolveStage();
      return true;
    }

    /** 測試/AI 驅動：一路推進直到需要輸入或結束（speed=0 時用） */
    drain(maxSteps = 500) {
      let n = 0;
      while (!this.ended && this.g.stage && n++ < maxSteps) {
        const st = this.g.stage;
        if (st.awaiting.size > 0) break;              // 等待玩家輸入
        if (this.now < st.endsAt) break;              // 真實計時中
        const before = st;
        this.tick(this.now);
        if (this.g.stage === before) break;           // 防呆
      }
    }

    // ---- 玩家輸入 ----
    /** 回傳 {ok} 或 {ok:false, error} */
    submit(seat, type, data) {
      if (this.ended) return { ok: false, error: '遊戲已結束' };
      data = data || {};
      try {
        // 全域型輸入（不綁定階段）
        if (type === 'chat') return this.inputChat(seat, data);
        if (type === 'claim') return this.inputClaim(seat, data);
        if (type === 'destPref') return this.inputDestPref(seat, data);
        if (type === 'explode') return this.inputExplode(seat);
        if (type === 'duel') return this.inputDuel(seat, data);
        if (type === 'propose') return this.inputPropose(seat, data);
        // 階段型輸入
        const st = this.g.stage;
        if (!st) return { ok: false, error: '目前沒有可操作的階段' };
        const h = this.stageHandlers[st.id];
        if (!h || !h.submit) return { ok: false, error: '此階段不接受輸入' };
        const r = h.submit.call(this, seat, type, data, st);
        return r || { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // ---- 發言與聊天 ----
    channelFor(seat) {
      const g = this.g, p = H().p(g, seat);
      const st = g.stage;
      // 遺言：死者在自己的遺言階段可對全村發言
      if (st && st.id === 'lastwords' && st.ctx.seat === seat) return 'meeting';
      // 當晚死亡者在夜間能力階段結束前仍可於地點頻道說話
      const diedTonight = g.isNight && p.night && p.night.diedTonight;
      if (!p.alive && !diedTonight) return 'dead';
      if (g.isNight) {
        if (st && st.id === 'night.wolfchat' && p.alive && H().isWolf(g, seat)) return 'wolf';
        const locStages = ['night.wolfchat', 'night.action', 'night.wolfsave', 'night.postinfo',
          'night.godattack', 'night.godsave', 'night.warlock'];
        if (st && locStages.includes(st.id)) {
          const loc = p.night && p.night.destination;
          if (!loc || WV.LOCATIONS[loc].isCottage) return null; // 村舍彼此隔離
          return 'loc:' + loc;
        }
        return null;
      }
      // 白天：會議頻道
      if (p.absent) return null; // 缺席可聽不可說
      if (st && (st.id === 'day.speech' || st.id === 'day.speech.pk' || st.id === 'election.speech')) {
        return st.ctx.speaker === seat ? 'meeting' : null; // 輪流發言：僅發言者
      }
      return 'meeting';
    }

    inputChat(seat, data) {
      const g = this.g, p = H().p(g, seat);
      const text = String(data.text || '').slice(0, 300).trim();
      if (!text) return { ok: false, error: '空訊息' };
      // 猜測者本人禁止溝通
      if (g.stage && g.stage.id === 'guess' && g.stage.ctx.guesser === seat) {
        return { ok: false, error: '猜測期間不能與他人溝通' };
      }
      const ch = this.channelFor(seat);
      if (!ch) return { ok: false, error: '現在無法發言' };
      let label;
      if (ch.startsWith('loc:')) {
        label = this.appearanceName(seat); // 夜間匿名
        this.chatMsg(ch, label, text, { anon: true });
      } else {
        label = p.seat + '號 ' + p.name;
        this.chatMsg(ch, label, text, { seat });
      }
      return { ok: true };
    }

    /** 結構化聲明：{kind:'role'|'check'|'accuse'|'defend', role?, target?, result?} */
    inputClaim(seat, data) {
      const g = this.g, p = H().p(g, seat);
      const ch = this.channelFor(seat);
      if (ch !== 'meeting') return { ok: false, error: '只能在白天會議中聲明' };
      let text = '';
      const tName = (s) => { const t = H().p(g, s); return t ? t.seat + '號 ' + t.name : '?'; };
      if (data.kind === 'role') {
        const rn = WV.ROLES[data.role] ? WV.ROLES[data.role].name : '?';
        text = '我聲稱自己是【' + rn + '】。';
      } else if (data.kind === 'check') {
        text = '我查驗了 ' + tName(data.target) + '，結果是【' + (data.result === 'wolf' ? '壞人' : '好人') + '】。';
      } else if (data.kind === 'accuse') {
        text = '我懷疑 ' + tName(data.target) + ' 是狼人。';
      } else if (data.kind === 'defend') {
        text = '我認為 ' + tName(data.target) + ' 是好人。';
      } else return { ok: false, error: '未知聲明' };
      this.chatMsg('meeting', p.seat + '號 ' + p.name, text, { seat, claim: data });
      this.emit({ t: 'claimMade', seat, claim: data });
      return { ok: true };
    }

    // ---- 匿名外觀 ----
    dealAppearances() {
      const g = this.g;
      const pool = this.rng.shuffle(WV.APPEARANCES.map((a) => a.id));
      g.players.forEach((p, i) => { p.appearanceId = pool[i % pool.length]; });
    }
    appearanceName(seat) {
      const p = H().p(this.g, seat);
      const a = WV.APPEARANCES.find((x) => x.id === p.appearanceId);
      return a ? a.name : '身影';
    }

    // ---- 目的地暫選（白天任意時刻）----
    inputDestPref(seat, data) {
      const g = this.g, p = H().p(g, seat);
      if (g.isNight) return { ok: false, error: '已入夜' };
      if (!p.alive) return { ok: false, error: '死者無法選擇' };
      if (!p.night) return { ok: false, error: '尚未發牌' };
      if (p.role === 'guard' && data.patrol) {
        const err = this.validatePatrol(p, data.patrol);
        if (err) return { ok: false, error: err };
        p.night.prefPatrol = data.patrol.slice();
        p.night.prefGoto = data.goto && data.patrol.includes(data.goto) ? data.goto : data.patrol[0];
        p.night.prefDest = null;
        this.touch();
        return { ok: true };
      }
      const loc = data.loc;
      if (!g.openLocs.includes(loc)) return { ok: false, error: '地點未開放' };
      const inCards = p.night.cards.includes(loc);
      if (!inCards) {
        if (p.role === 'guard') return { ok: false, error: '守衛沒有夜行令' };
        if (p.nightPassUsed) return { ok: false, error: '夜行令已用過' };
      }
      p.night.prefDest = loc;
      p.night.prefPatrol = null;
      this.touch();
      return { ok: true };
    }

    validatePatrol(p, pair) {
      const g = this.g;
      if (!Array.isArray(pair) || pair.length !== 2) return '需選擇兩個地點';
      const [a, b] = pair;
      if (a === b) return '兩地不可相同';
      for (const l of pair) {
        if (!g.openLocs.includes(l)) return '地點未開放';
        if (WV.LOCATIONS[l].isCottage) return '不能巡邏村舍';
      }
      if (!WV.isAdjacent(a, b)) return '兩地必須直接相連';
      // 連守限制：不得包含前一晚任一地點；無合法組合時解除
      if (p.guardLastPatrol.length && this.hasLegalPatrol(p)) {
        if (pair.some((l) => p.guardLastPatrol.includes(l))) return '不能連續兩晚保護前一晚選過的地點';
      }
      return null;
    }
    hasLegalPatrol(p) {
      const g = this.g;
      for (const [a, b] of WV.MAP_EDGES) {
        if (!g.openLocs.includes(a) || !g.openLocs.includes(b)) continue;
        if (WV.LOCATIONS[a].isCottage || WV.LOCATIONS[b].isCottage) continue;
        if (p.guardLastPatrol.includes(a) || p.guardLastPatrol.includes(b)) continue;
        return true;
      }
      return false;
    }

    // ---- 遊戲開始 ----
    start(now) {
      this.now = now == null ? this.now : now;
      const g = this.g;
      this.dealAppearances();
      // 公開板子
      const roleCounts = {};
      for (const p of g.players) roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
      g.publicBoard = roleCounts;
      for (const p of g.players) {
        this.notify(p.seat, 'role', { role: p.role });
        if (H().isWolf(g, p.seat)) {
          const mates = H().wolves(g).map((w) => ({ seat: w.seat, name: w.name, role: w.role }));
          this.notify(p.seat, 'wolfTeam', { mates });
        }
      }
      this.logPub('《人狼村》開始。本局 ' + g.totalRoles + ' 個角色槽位，狼人勝利模式：' +
        (this.settings.wolfWinMode === 'side' ? '屠邊' : '屠城') + '。', 'system');
      this.logPub('初始資源：食物 ' + g.resources.food + '、材料 0、藥草 ' + g.resources.herb + '。', 'system');
      this.beginDay();
    }

    // ---- 勝利結束 ----
    finishGame(winner) {
      const g = this.g;
      if (g.winner) return;
      g.winner = winner;
    }
    /** 死亡反應全部處理完後正式收場 */
    concludeIfWon() {
      const g = this.g;
      if (!g.winner || this.ended) return false;
      this.ended = true;
      const results = g.players.map((p) => ({
        seat: p.seat, name: p.name, role: p.role, alive: p.alive,
        won: H().personalResult(g, p.seat),
      }));
      let endingText;
      if (g.winner.side === 'good') {
        endingText = g.winner.reason === '烽火台' ? WV.TEXT.endings.goodBeacon : WV.TEXT.endings.goodExterminate;
      } else endingText = WV.TEXT.endings.wolfWin;
      g.ending = { winner: g.winner, results, text: endingText };
      this.logPub((g.winner.side === 'good' ? '好人方' : '狼人陣營') + '獲得勝利（' + g.winner.reason + '）。', 'end');
      this.emit({ t: 'end', ending: g.ending });
      this.g.stage = null;
      this.touch();
      return true;
    }

    // ---- 發言順序 ----
    computeSpeechOrder(direction) {
      const g = this.g;
      const speakable = (s) => { const p = H().p(g, s); return p.alive && !p.absent; };
      const N = g.players.length;
      const seatsFrom = (start, dir) => {
        const out = [];
        for (let i = 1; i <= N; i++) {
          let s = ((start - 1 + dir * i) % N + N) % N + 1;
          out.push(s);
        }
        return out;
      };
      const sheriff = H().sheriff(g);
      if (sheriff && sheriff.alive && !sheriff.absent) {
        const dir = direction === 'back' ? -1 : 1;
        const order = seatsFrom(sheriff.seat, dir).filter((s) => s !== sheriff.seat && speakable(s));
        order.push(sheriff.seat); // 警長永遠最後
        return order;
      }
      // 無（可主持的）警長：依規則隨機
      const dir = this.rng.chance(0.5) ? 1 : -1;
      let startSeat;
      const lastNightDead = g.players.filter((p) => !p.alive && p.deathDay === g.day && p.deathAtNight);
      if (!sheriff && lastNightDead.length > 0) {
        const d = this.rng.pick(lastNightDead);
        const scan = seatsFrom(d.seat, dir);
        startSeat = scan.find(speakable);
      } else {
        const cands = g.players.filter((p) => speakable(p.seat));
        if (!cands.length) return [];
        startSeat = this.rng.pick(cands).seat;
      }
      if (startSeat == null) return [];
      const order = [startSeat, ...seatsFrom(startSeat, dir).filter((s) => s !== startSeat && speakable(s))];
      return order;
    }

    // ---- 中斷：狼人自爆 ----
    interruptibleNow() {
      const st = this.g.stage;
      if (!st) return false;
      return ['day.speech', 'day.meeting.open', 'build.propose', 'build.vote', 'exile.vote', 'day.speech.pk']
        .includes(st.id);
    }
    inputExplode(seat) {
      const g = this.g, p = H().p(g, seat);
      if (g.day < 2) return { ok: false, error: '準備日不能自爆' };
      if (!p.alive || p.absent) return { ok: false, error: '無法自爆' };
      if (!H().isWolf(g, seat)) return { ok: false, error: '只有狼人陣營可以自爆' };
      if (!this.interruptibleNow()) return { ok: false, error: '目前不能自爆' };
      if (this._interruptBusy) return { ok: false, error: '已有自爆發生，其餘取消' };
      this._interruptBusy = true;
      // 中止會議與尚未發動的白天能力
      this.g.stage = null;
      this.g.buildState = null;
      this.g.exileState = null;
      p.revealedWolfSide = true;
      this.logPub(p.seat + '號 ' + p.name + ' 當眾自爆，公開為狼人陣營！會議立即中止。', 'death');
      g.dayStepOverride = 'finaldest'; // 跳過放逐，保留目的地最終確認
      this.queueDeath(seat, WV.CAUSE.EXPLODE);
      this.drainDeathQueue(() => { this._interruptBusy = false; this.gotoDayStep('finaldest'); });
      return { ok: true };
    }

    // ---- 中斷：騎士決鬥 ----
    inputDuel(seat, data) {
      const g = this.g, p = H().p(g, seat);
      if (g.day < 2) return { ok: false, error: '準備日不能決鬥' };
      if (!p.alive || p.absent) return { ok: false, error: '無法決鬥' };
      if (p.role !== 'knight') return { ok: false, error: '只有騎士能發起決鬥' };
      if (p.knightUsed) return { ok: false, error: '決鬥已使用過' };
      // 決鬥屬白天能力，不受前一晚花蝴蝶封鎖
      if (!this.interruptibleNow()) return { ok: false, error: '目前不能決鬥' };
      if (this._interruptBusy) return { ok: false, error: '請稍候' };
      const t = H().p(g, data.target);
      if (!t || !t.alive || t.seat === seat) return { ok: false, error: '目標不合法' };
      this._interruptBusy = true;
      p.knightUsed = true;
      p.revealedRole = 'knight';
      const targetIsWolf = H().isWolf(g, t.seat);
      this.logPub(p.seat + '號 ' + p.name + ' 亮出聖徽，向 ' + t.seat + '號 ' + t.name + ' 發起決鬥！', 'duel');
      const savedStage = this.g.stage; this.g.stage = null;
      const pausedAt = this.now;
      if (targetIsWolf) {
        this.logPub('聖徽迸出光芒——' + t.seat + '號 ' + t.name + ' 是狼人陣營！決鬥勝利，白天直接結束。', 'duel');
        g.buildState = null; g.exileState = null;
        this.queueDeath(t.seat, WV.CAUSE.DUEL);
        this.drainDeathQueue(() => { this._interruptBusy = false; this.gotoDayStep('finaldest'); });
      } else {
        this.logPub('聖徽沉默不語——' + t.seat + '號 ' + t.name + ' 不是狼人。騎士倒在自己的劍下，白天繼續。', 'duel');
        this.queueDeath(seat, WV.CAUSE.DUEL_BACKFIRE);
        this.drainDeathQueue(() => {
          this._interruptBusy = false;
          // 恢復被中斷的階段（計時順延中斷期間）
          if (this.g.winner) { this.concludeIfWon(); return; }
          this.g.stage = savedStage;
          if (savedStage) {
            savedStage.endsAt += Math.max(0, this.now - pausedAt);
            this.emit({ t: 'stage', id: savedStage.id, ctx: savedStage.ctx });
            this.touch();
          } else this.gotoDayStep(null); // 保險：續行
        });
      }
      return { ok: true };
    }
  }

  // 各階段處理器由 phases_day / phases_night / deaths 注入
  Game.prototype.stageHandlers = {};

  WV.Game = Game;
})();
