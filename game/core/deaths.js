/* 《人狼村》死亡處理引擎
   通用死亡佇列：暗戀猜測 → 最終死亡 → 九尾狐連鎖 → 勝負 → 遺言 → 死亡能力 → 警徽。
   白天與夜間批次共用；夜死不發遺言、黎明才公布。 */
(function () {
  const WV = (globalThis.WV = globalThis.WV || {});
  const C = () => WV.CAUSE;

  const CAUSE_TEXT = {
    WOLF_KILL: '狼人之爪', WOLF_SUICIDE: '自我了斷', POISON: '毒藥', ASSASSIN: '暗殺',
    EXILE: '放逐', FAMINE: '飢荒處決', DUEL: '決鬥', DUEL_BACKFIRE: '決鬥失敗',
    HUNTER_TAKE: '獵人帶走', EXPLODE: '自爆', ADMIRER_SUB: '代替所愛之人死去',
    ADMIRER_FOLLOW: '殉情', FOX_DRAIN: '靈力枯竭',
  };

  Object.assign(WV.Game.prototype, {
    /** 排入一筆死亡。opts: {night, noGuess, front, origCause, deferWin}
        deferWin：夜間批次內的死亡於「整批結束後」才檢查勝負（規則 4.3）。 */
    queueDeath(seat, cause, opts) {
      opts = opts || {};
      const item = {
        seat, cause, night: !!opts.night, noGuess: !!opts.noGuess,
        origCause: opts.origCause || null, deferWin: !!opts.deferWin,
      };
      if (opts.front) this.g.deathQueue.unshift(item);
      else this.g.deathQueue.push(item);
    },

    /** 逐項處理死亡佇列；完成後呼叫 onDone。過程可能建立需要輸入的階段。 */
    drainDeathQueue(onDone) {
      this._dqDone = onDone || null;
      this._dqStep();
    },

    _dqFinish() {
      const done = this._dqDone;
      this._dqDone = null;
      // 勝負已定：立即收場（白天遺言已於佇列中處理完畢）
      if (this.g.winner) { this.concludeIfWon(); return; }
      if (done) done();
    },

    _dqStep() {
      const g = this.g;
      const item = g.deathQueue.shift();
      if (!item) { this._dqFinish(); return; }
      const p = WV.H.p(g, item.seat);
      if (!p || !p.alive) { this._dqStep(); return; } // 已死亡（例如同批重複）

      // 1. 暗戀猜測：對象經一般保護與救援後仍將死亡，且該暗戀者的猜測未觸發過。
      //    九尾狐尾盡優先級更高，不觸發猜測。勝負已定時亦不再觸發（遺言期間不能再發動能力）。
      if (!item.noGuess && item.cause !== C().FOX_DRAIN && !g.winner) {
        const admirer = g.players.find((a) =>
          a.alive && a.role === 'admirer' && a.admirerTarget === p.seat && !a.admirerGuessDone);
        if (admirer) {
          this._beginGuess(item, admirer.seat);
          return; // 等待猜測階段
        }
      }
      this._finalizeItem(item);
    },

    _beginGuess(item, admirerSeat) {
      const g = this.g;
      if (!item.night) {
        this.logPub('死亡的陰影籠罩了 ' + WV.H.p(g, item.seat).name + '，時間彷彿停了下來——有人正被給予最後一次回頭的機會。', 'guess');
      }
      this.notify(item.seat, 'guessPrompt', { cause: item.cause });
      const candidates = WV.H.alive(g).filter((x) => x.seat !== item.seat).map((x) => x.seat);
      this.setStage('guess', WV.TIMING.ADMIRER_GUESS, [item.seat],
        { guesser: item.seat, admirerSeat, item, candidates });
    },

    /** 猜測結果處理（正確→代死；錯誤/逾時→殉情） */
    _resolveGuess(ctx, guessedSeat) {
      const g = this.g;
      const admirer = WV.H.p(g, ctx.admirerSeat);
      admirer.admirerGuessDone = true; // 猜測整局只觸發一次
      const item = ctx.item;
      const correct = guessedSeat === ctx.admirerSeat;
      if (correct) {
        // 代死：對象存活，暗戀者以原事件死因紀錄死亡；不可再救、不觸發死亡職業能力、不再猜測
        const beloved = WV.H.p(g, item.seat);
        if (beloved.night && beloved.night.dying) beloved.night.dying = null;
        this.notify(item.seat, 'guessResult', { correct: true, admirer: admirer.seat });
        this.notify(admirer.seat, 'admirerSub', { for: item.seat });
        if (!item.night) {
          this.logPub(admirer.seat + '號 ' + admirer.name + ' 從人群中走出，代替 ' +
            beloved.seat + '號 ' + beloved.name + ' 走入了死亡。', 'death');
        }
        this.queueDeath(admirer.seat, C().ADMIRER_SUB,
          { night: item.night, noGuess: true, front: true, origCause: item.cause, deferWin: item.deferWin });
        this._dqStep();
      } else {
        // 殉情：兩人一同死亡
        this.notify(item.seat, 'guessResult', { correct: false });
        this.queueDeath(ctx.admirerSeat, C().ADMIRER_FOLLOW,
          { night: item.night, noGuess: true, front: true, deferWin: item.deferWin });
        item.noGuess = true;
        this.g.deathQueue.unshift(item); // 對象以原死因死亡（殉情連鎖不可再救）
        this._dqStep();
      }
    },

    /** 最終死亡：狀態、九尾狐、勝負、公布、遺言、死亡能力、警徽 */
    _finalizeItem(item) {
      const g = this.g;
      const p = WV.H.p(g, item.seat);
      p.alive = false;
      p.deathDay = g.day;
      p.deathAtNight = !!item.night;
      p.deathCause = item.cause;
      if (p.night) p.night.diedTonight = !!item.night;
      this.emit({ t: 'death', seat: p.seat, cause: item.cause, night: item.night });

      if (!item.night) {
        this.logPub(p.seat + '號 ' + p.name + ' 死亡（' + (CAUSE_TEXT[item.cause] || '不明') + '）。', 'death');
      }

      // 九尾狐扣尾（僅計最終死亡；狼人陣營不扣）：平民/暗戀者 -1，神職 -2
      this._applyFoxTails(p, item);

      // 勝負：先狼勝、再狼滅（夜間批次內延後到整批結束）
      if (!item.deferWin && !g.winner) {
        const w = WV.H.evaluateWin(g);
        if (w) this.finishGame(w);
      }

      // 夜間死亡：不發遺言、不觸發白天反應（獵人於黎明處理）
      if (item.night) { this._dqStep(); return; }

      // 白天死亡一律有遺言
      this.setStage('lastwords', WV.TIMING.LAST_WORDS, [p.seat], { seat: p.seat, afterQueue: true, item });
    },

    _applyFoxTails(deadP, item) {
      const g = this.g;
      const faction = WV.ROLES[deadP.role].faction;
      let loss = 0;
      if (faction === 'CIVILIAN') loss = 1;
      else if (faction === 'GOD') loss = 2;
      if (loss === 0) return;
      for (const fox of g.players.filter((x) => x.alive && x.role === 'fox')) {
        fox.foxTails = Math.max(0, fox.foxTails - loss);
        if (fox.foxTails === 0) {
          // 尾盡：立即、不可阻止、不觸發暗戀猜測
          this.queueDeath(fox.seat, C().FOX_DRAIN,
            { night: item.night, noGuess: true, front: true, deferWin: item.deferWin });
        }
      }
    },

    /** 白天死亡的後續反應（遺言結束後）：死亡能力 → 警徽 → 下一筆 */
    _afterLastWords(ctx) {
      const g = this.g;
      const p = WV.H.p(g, ctx.seat);
      const item = ctx.item;
      // 勝負已定：遺言期間不能再發動能力、提案或投票
      if (!g.winner) {
        // 獵人：遭一般放逐時可翻牌開槍（狼刀死亡於黎明處理）
        if (item && item.cause === C().EXILE && p.role === 'hunter' && !p.hunterShotUsed) {
          this.setStage('hunter.decide', WV.TIMING.ABILITY, [p.seat], { seat: p.seat, night: false, chain: 'day' });
          return;
        }
      }
      this._afterDeathAbility(ctx);
    },

    _afterDeathAbility(ctx) {
      const g = this.g;
      const p = WV.H.p(g, ctx.seat);
      // 警徽：白天死亡的警長，遺言結束後立即移交
      if (g.sheriffSeat === p.seat && !g.badgeDestroyed) {
        this.setStage('badge.transfer', WV.TIMING.BADGE_TRANSFER, [p.seat], { seat: p.seat });
        return;
      }
      this._dqStep();
    },
  });

  // ---- 階段處理器 ----
  const SH = WV.Game.prototype.stageHandlers;

  // 暗戀猜測：15 秒、逾時視為猜錯
  SH['guess'] = {
    submit(seat, type, data, st) {
      if (seat !== st.ctx.guesser) return { ok: false, error: '並非你的抉擇' };
      if (type !== 'guess') return { ok: false, error: '未知操作' };
      const target = data.target;
      if (!st.ctx.candidates.includes(target)) return { ok: false, error: '目標不合法' };
      st.ctx.guessed = target;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) { this._resolveGuess(ctx, ctx.guessed == null ? -1 : ctx.guessed); },
    timeout(st) { st.ctx.guessed = -1; this.resolveStage(); },
  };

  // 遺言：15 秒，可提前結束；期間死者可對全村發言
  SH['lastwords'] = {
    submit(seat, type, data, st) {
      if (seat !== st.ctx.seat) return { ok: false, error: '不是你的遺言時間' };
      if (type === 'done') { this.settleAwait(seat); return { ok: true }; }
      return { ok: false, error: '未知操作' };
    },
    resolve(ctx) {
      if (ctx.afterQueue) this._afterLastWords(ctx);
      else if (ctx.thenDawn) this._dawnNextLastWords();
    },
    timeout() { this.resolveStage(); },
  };

  // 獵人翻牌開槍（放逐當場／黎明皆用此階段；逾時視為放棄）
  SH['hunter.decide'] = {
    submit(seat, type, data, st) {
      if (seat !== st.ctx.seat) return { ok: false, error: '並非你的抉擇' };
      if (type === 'skip') { st.ctx.shot = null; this.settleAwait(seat); return { ok: true }; }
      if (type !== 'shoot') return { ok: false, error: '未知操作' };
      const t = WV.H.p(this.g, data.target);
      if (!t || !t.alive || t.seat === seat) return { ok: false, error: '目標不合法' };
      st.ctx.shot = t.seat;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      const g = this.g;
      const hunter = WV.H.p(g, ctx.seat);
      if (ctx.shot != null && !g.winner) {
        hunter.hunterShotUsed = true;
        hunter.revealedRole = 'hunter';
        const t = WV.H.p(g, ctx.shot);
        this.logPub(hunter.seat + '號 ' + hunter.name + ' 翻開獵人的身分，扣下了最後的扳機——帶走 ' +
          t.seat + '號 ' + t.name + '！', 'death');
        // 獵人帶走：不可被阻止或救援；不觸發另一名獵人
        this.queueDeath(t.seat, WV.CAUSE.HUNTER_TAKE, { front: true });
      } else if (ctx.shot == null) {
        // 放棄不公開身分
      }
      if (ctx.chain === 'dawn') this._dawnAfterHunter(ctx);
      else this._afterDeathAbility(ctx);
    },
    timeout(st) { st.ctx.shot = null; this.resolveStage(); },
  };

  // 警徽移交：選擇繼承人或撕毀；逾時 = 撕毀（設計決定）
  SH['badge.transfer'] = {
    submit(seat, type, data, st) {
      if (seat !== st.ctx.seat) return { ok: false, error: '並非你的抉擇' };
      if (type === 'tear') { st.ctx.heir = 'tear'; this.settleAwait(seat); return { ok: true }; }
      if (type !== 'give') return { ok: false, error: '未知操作' };
      const t = WV.H.p(this.g, data.target);
      if (!t || !t.alive) return { ok: false, error: '只能移交給存活玩家' };
      st.ctx.heir = t.seat;
      this.settleAwait(seat);
      return { ok: true };
    },
    resolve(ctx) {
      const g = this.g;
      if (ctx.heir === 'tear' || ctx.heir == null) {
        g.sheriffSeat = null;
        g.badgeDestroyed = true;
        this.logPub('警徽在眾人面前被撕毀。本局不會再有警長。', 'sheriff');
      } else {
        g.sheriffSeat = ctx.heir;
        const t = WV.H.p(g, ctx.heir);
        this.logPub('警徽移交給 ' + t.seat + '號 ' + t.name + '。', 'sheriff');
      }
      if (ctx.thenContinueDay) this.gotoDayStep(ctx.thenContinueDay);
      else this._dqStep();
    },
    timeout(st) { st.ctx.heir = 'tear'; this.resolveStage(); },
  };
})();
