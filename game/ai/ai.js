/* 《人狼村》AI 玩家（伺服器端）
   規則書 3.3：AI 佔用角色槽位、身分公開；真人斷線可由 AI 暫代。
   實作為啟發式：懷疑度模型 + 身分聲明 + 需求導向目的地 + 各職業決策。
   LM 語言模型 AI 屬未來獨立規格（內部附錄第 10 節）。 */
(function () {
  const WV = (globalThis.WV = globalThis.WV || {});
  const H = () => WV.H;

  const CHAT = {
    meetingIdle: [
      '昨晚大家都去了哪裡？我覺得資源變動有點怪。',
      '先聽聽神職怎麼說吧。',
      '我建議今晚多派人去糧食地點，庫存有點緊。',
      '有人要對昨天的投票解釋一下嗎？',
      '我沒有什麼情報，過。',
      '大家注意一下誰一直在帶風向。',
    ],
    accuse: ['我懷疑{T}號，發言太急了。', '{T}號昨天的票很難解釋，我先掛他。', '我覺得{T}號有問題，建議大家注意。'],
    defend: ['我認為{T}號比較像好人。', '{T}號的行程說得通，我先信。'],
    wolfChat: ['今晚照計劃，分散行動。', '有落單的就處理，沒有就好好工作。', '注意守衛可能巡糧倉一帶。'],
    locIdle: ['……有人在嗎？', '先把工作做完吧。', '今晚風聲不太對勁。'],
    lastWords: ['我是好人，請大家查清楚再投票。', '記住今晚誰不在場……', '別讓村子毀在自己人手裡。'],
  };

  class AIManager {
    constructor(engine) {
      this.engine = engine;
      this.mind = {}; // seat -> knowledge
      this.tasks = []; // {at, fn}
      this.spokenStageKey = {};
      engine.onEvent((evt) => this.onEvent(evt));
      for (const p of engine.g.players) {
        this.mind[p.seat] = {
          rng: new WV.Rng((engine.rng.seed ^ (p.seat * 2654435761)) >>> 0),
          suspicion: {},        // seat -> score
          checks: {},           // seat -> 'wolf'|'good'（自己查的）
          claimedSeers: [],     // {seat, checks:[{target,result}]}
          myClaims: [],
          destChosenDay: 0,
          saidThisStage: null,
        };
      }
    }

    isAISeat(seat) {
      const p = H().p(this.engine.g, seat);
      return p && (p.isAI || p.aiTakeover);
    }

    schedule(delayMs, fn, seatTag) { this.tasks.push({ at: this.engine.now + delayMs, fn, seatTag }); }

    // ---- 事件吸收 ----
    onEvent(evt) {
      const g = this.engine.g;
      if (evt.t === 'claimMade') {
        const { seat, claim } = evt;
        for (const p of g.players) {
          if (p.seat === seat) continue;
          const m = this.mind[p.seat];
          if (!m) continue;
          if (claim.kind === 'role' && claim.role === 'seer') {
            if (!m.claimedSeers.some((c) => c.seat === seat)) m.claimedSeers.push({ seat, checks: [] });
          }
          if (claim.kind === 'check') {
            let c = m.claimedSeers.find((x) => x.seat === seat);
            if (!c) { c = { seat, checks: [] }; m.claimedSeers.push(c); }
            c.checks.push({ target: claim.target, result: claim.result });
            this.absorbClaimedCheck(p, m, seat, claim);
          }
          if (claim.kind === 'accuse') this.bump(m, claim.target, 0.6);
          if (claim.kind === 'defend') this.bump(m, claim.target, -0.4);
        }
      }
      if (evt.t === 'stage') this.onStage(evt.id);
    }

    absorbClaimedCheck(p, m, claimer, claim) {
      const g = this.engine.g;
      const meWolf = H().isWolf(g, p.seat);
      if (meWolf) return; // 狼人知道真相，不受聲明影響
      if (claim.target === p.seat && claim.result === 'wolf') {
        // 說我是狼 → 對方在說謊（或我是暗戀者被誤會？不會，暗戀查好人）
        this.bump(m, claimer, 5);
        return;
      }
      if (p.role === 'seer') {
        // 真預言家：對方冒名
        this.bump(m, claimer, 4);
        return;
      }
      const trust = m.claimedSeers.length > 1 ? 0.5 : 0.9;
      this.bump(m, claim.target, claim.result === 'wolf' ? 3 * trust : -2 * trust);
    }

    bump(m, seat, delta) { m.suspicion[seat] = (m.suspicion[seat] || 0) + delta; }

    suspicionOf(seat) {
      const g = this.engine.g;
      const p = H().p(g, seat);
      const m = this.mind[seat];
      const out = {};
      for (const x of H().alive(g)) {
        if (x.seat === seat) continue;
        let s = m.suspicion[x.seat] || 0;
        if (m.checks[x.seat] === 'wolf') s += 100;
        if (m.checks[x.seat] === 'good') s -= 100;
        if (H().isWolf(g, seat)) s = H().isWolf(g, x.seat) ? -100 : (m.suspicion[x.seat] || 0); // 狼人全知
        if (x.revealedWolfSide) s += 100;
        if (x.idiotFlipped || x.revealedRole) s -= 3;
        out[x.seat] = s + m.rng.next() * 0.8;
      }
      return out;
    }
    topSuspect(seat, candidates) {
      const s = this.suspicionOf(seat);
      let best = null, bestV = -Infinity;
      for (const c of candidates) {
        const v = s[c] == null ? -Infinity : s[c];
        if (v > bestV) { bestV = v; best = c; }
      }
      return { seat: best, score: bestV };
    }
    leastSuspect(seat, candidates) {
      const s = this.suspicionOf(seat);
      let best = null, bestV = Infinity;
      for (const c of candidates) {
        const v = s[c] == null ? Infinity : s[c];
        if (v < bestV) { bestV = v; best = c; }
      }
      return best;
    }

    // ---- 階段反應 ----
    onStage(id) {
      const g = this.engine.g;
      const st = g.stage;
      if (!st) return;
      // 夜間行動：所有 AI 排程行動
      if (id === 'night.action') {
        for (const p of H().alive(g)) {
          if (!this.isAISeat(p.seat)) continue;
          this.schedule(300 + this.mind[p.seat].rng.int(2500) * (this.engine.speed || 0), () => this.nightAction(p.seat));
        }
        return;
      }
      // 白天目的地暫選（會議開始時排程一次）
      if (id === 'day.meeting.open' || id === 'day.speech') {
        for (const p of H().alive(g)) {
          if (!this.isAISeat(p.seat)) continue;
          const m = this.mind[p.seat];
          if (m.destChosenDay !== g.day) {
            m.destChosenDay = g.day;
            this.schedule(500 * (this.engine.speed || 0), () => this.chooseDestPref(p.seat));
          }
        }
      }
      // 自由討論：AI 稍後表示準備（真人可提前結束會議）＋偶爾閒聊
      if (id === 'day.meeting.open') {
        for (const p of H().alive(g)) {
          if (!this.isAISeat(p.seat) || p.absent) continue;
          const m = this.mind[p.seat];
          if (m.rng.chance(0.5)) {
            this.schedule((1000 + m.rng.int(4000)) * (this.engine.speed || 0), () => this.speak(p.seat), p.seat);
          }
          this.schedule((5000 + m.rng.int(4000)) * (this.engine.speed || 0), () => this.trySubmit(p.seat, 'ready', {}), p.seat);
        }
        return;
      }
      // 發言/聊天排程
      if (id === 'day.speech' && this.isAISeat(st.ctx.speaker)) {
        const sp = st.ctx.speaker;
        const spd = this.engine.speed || 0;
        this.schedule(800 * spd, () => this.speak(sp), sp);
        this.schedule((this.engine.settings.aiSpeechSeconds * 1000 - 800) * spd, () => {
          this.trySubmit(sp, 'done', {});
        }, sp);
        return;
      }
      if (id === 'night.wolfchat') {
        for (const s of st.ctx.wolves) {
          if (!this.isAISeat(s)) continue;
          const m = this.mind[s];
          if (m.rng.chance(0.7)) {
            this.schedule((500 + m.rng.int(2000)) * (this.engine.speed || 0), () => {
              this.engine.submit(s, 'chat', { text: m.rng.pick(CHAT.wolfChat) });
            }, s);
          }
          this.schedule(3000 * (this.engine.speed || 0), () => this.trySubmit(s, 'ready', {}), s);
        }
        return;
      }
      if (id === 'lastwords' && this.isAISeat(st.ctx.seat)) {
        const s = st.ctx.seat;
        const m = this.mind[s];
        this.schedule(500 * (this.engine.speed || 0), () => {
          this.engine.submit(s, 'chat', { text: m.rng.pick(CHAT.lastWords) });
        }, s);
        this.schedule(2500 * (this.engine.speed || 0), () => this.trySubmit(s, 'done', {}), s);
        return;
      }
      // 需要輸入的階段：為每個被等待的 AI 座位排程決策
      for (const seat of Array.from(st.awaiting)) {
        if (!this.isAISeat(seat)) continue;
        const m = this.mind[seat];
        this.schedule((400 + m.rng.int(1800)) * (this.engine.speed || 0), () => this.decide(seat), seat);
      }
    }

    tick(now) {
      const due = this.tasks.filter((t) => t.at <= now);
      this.tasks = this.tasks.filter((t) => t.at > now);
      for (const t of due) {
        try { t.fn(); } catch (e) { /* AI 失誤不可拖垮遊戲 */ }
      }
      // 保險：等待中的 AI 完全沒有排程時補上（防漏；不與既有排程重複）
      const st = this.engine.g.stage;
      if (st && st.awaiting.size && st.startedAt != null &&
          (now - st.startedAt) > 4000 * (this.engine.speed || 0)) {
        for (const seat of Array.from(st.awaiting)) {
          if (!this.isAISeat(seat)) continue;
          if (!this.tasks.some((t) => t.seatTag === seat)) {
            this.tasks.push({ at: now, fn: () => this.decide(seat), seatTag: seat });
          }
        }
      }
    }

    trySubmit(seat, type, data) {
      const r = this.engine.submit(seat, type, data);
      return r && r.ok;
    }

    // ---- 發言 ----
    speak(seat) {
      const g = this.engine.g;
      const p = H().p(g, seat);
      if (!p || this.engine.channelFor(seat) !== 'meeting') return;
      const m = this.mind[seat];
      // 預言家：聲明並報查驗
      if (p.role === 'seer' && g.day >= 2 && !H().isWolf(g, seat)) {
        if (!m.myClaims.includes('seer')) {
          m.myClaims.push('seer');
          this.trySubmit(seat, 'claim', { kind: 'role', role: 'seer' });
        }
        const entries = Object.entries(m.checks);
        if (entries.length) {
          const [t, res] = entries[entries.length - 1];
          this.trySubmit(seat, 'claim', { kind: 'check', target: Number(t), result: res });
        }
        return;
      }
      // 高懷疑指控
      const top = this.topSuspect(seat, H().aliveSeats(g).filter((s) => s !== seat));
      if (top.seat && top.score > 2 && m.rng.chance(0.7)) {
        this.trySubmit(seat, 'claim', { kind: 'accuse', target: top.seat });
        return;
      }
      this.trySubmit(seat, 'chat', { text: m.rng.pick(CHAT.meetingIdle) });
    }

    // ---- 目的地策略 ----
    chooseDestPref(seat) {
      const g = this.engine.g;
      const p = H().p(g, seat);
      if (!p || !p.alive || g.isNight || !p.night) return;
      const m = this.mind[seat];
      const cards = p.night.cards;
      if (p.role === 'guard') {
        // 巡邏高價值地點
        const prefer = [['farm', 'well'], ['mill', 'square'], ['square', 'well'], ['smithy', 'square'], ['farm', 'herbgarden']];
        for (const pair of m.rng.shuffle(prefer)) {
          if (!pair.every((l) => g.openLocs.includes(l))) continue;
          const r = this.engine.submit(seat, 'destPref', { patrol: pair, goto: pair[0] });
          if (r.ok) return;
        }
        // 任一合法組合
        for (const [a, b] of m.rng.shuffle(WV.MAP_EDGES)) {
          if (this.engine.submit(seat, 'destPref', { patrol: [a, b], goto: a }).ok) return;
        }
        return;
      }
      const score = {};
      const alive = H().alive(g).length;
      const foodDays = g.resources.food / Math.max(1, alive);
      for (const l of cards) score[l] = 1 + m.rng.next();
      const boost = (l, v) => { if (score[l] != null) score[l] += v; };
      if (foodDays < 2.2) { boost('farm', 3); boost('mill', 3); boost('hunterhut', 2); boost('well', 1.5); }
      else { boost('farm', 1); boost('mill', 1); }
      boost('smithy', 1.2); boost('lumber', 1); boost('mine', 1.2);
      if (g.resources.herb < 1) boost('herbgarden', 1.5);
      if (g.pendingConstruction) boost('square', 4);
      if (p.role === 'witch') { boost('well', 1); boost('square', 0.5); }
      // 危險迴避：好人偶爾躲家
      if (!H().isWolf(g, seat) && m.rng.chance(0.15)) boost('cottage', 2.5);
      if (H().isWolf(g, seat)) {
        // 狼人：獵場與破壞
        boost('cottage', -2);
        if (g.resources.food > alive * 2 && m.rng.chance(0.3)) boost('farm', 2.5); // 縱火機會
        if (m.rng.chance(0.2)) boost('well', 1.5);
        boost('mill', 1); boost('hunterhut', 1.5); boost('mine', 1);
      }
      let best = cards[0], bestV = -Infinity;
      for (const l of cards) if (score[l] > bestV) { bestV = score[l]; best = l; }
      this.engine.submit(seat, 'destPref', { loc: best });
    }

    // ---- 夜間行動 ----
    nightAction(seat) {
      const g = this.engine.g;
      const p = H().p(g, seat);
      if (!p || !p.alive || !g.stage || g.stage.id !== 'night.action') return;
      const scene = WV.Views.nightScene(this.engine, seat);
      if (!scene) return;
      const m = this.mind[seat];
      if (scene.actions) {
        if (scene.actions.canKill) { this.trySubmit(seat, 'kill', {}); return; }
        if (scene.actions.sabotageKind) {
          const kind = scene.actions.sabotageKind;
          const alive = H().alive(g).length;
          const worthArson = kind === 'burnFarm' && g.resources.food >= alive;
          const worthPoison = kind === 'poisonWell';
          const worthRuin = kind === 'ruinHerbs' && g.resources.herb < 2;
          if ((worthArson && m.rng.chance(0.8)) || (worthPoison && m.rng.chance(0.5)) || (worthRuin && m.rng.chance(0.6))) {
            this.trySubmit(seat, 'sabotage', {});
            return;
          }
        }
        if (H().isWolf(g, seat) && m.rng.chance(0.15)) { this.trySubmit(seat, 'laze', {}); return; }
      }
      if (scene.work && scene.work.canWork) this.trySubmit(seat, 'workFull', {});
    }

    // ---- 各階段決策 ----
    decide(seat) {
      const g = this.engine.g;
      const st = g.stage;
      if (!st || !st.awaiting.has(seat)) return;
      const you = WV.Views.youAwait(this.engine, seat);
      if (!you) { this.trySubmit(seat, 'done', {}) || this.trySubmit(seat, 'skip', {}); return; }
      const m = this.mind[seat];
      const p = H().p(g, seat);
      const iAmWolf = H().isWolf(g, seat);
      const seats = (arr) => arr.map((x) => x.seat);
      switch (you.id) {
        case 'guess': {
          // 對象猜暗戀者：無資訊 → 隨機
          this.trySubmit(seat, 'guess', { target: m.rng.pick(seats(you.candidates)) });
          return;
        }
        case 'lastwords': return void this.trySubmit(seat, 'done', {});
        case 'hunter.decide': {
          const top = this.topSuspect(seat, seats(you.targets));
          if (top.seat && top.score > 1) this.trySubmit(seat, 'shoot', { target: top.seat });
          else this.trySubmit(seat, 'skip', {});
          return;
        }
        case 'badge.transfer': {
          const cands = seats(you.targets);
          if (!cands.length) return void this.trySubmit(seat, 'tear', {});
          if (iAmWolf) {
            const mates = cands.filter((s) => H().isWolf(g, s));
            if (mates.length) return void this.trySubmit(seat, 'give', { target: m.rng.pick(mates) });
            return void this.trySubmit(seat, 'tear', {});
          }
          return void this.trySubmit(seat, 'give', { target: this.leastSuspect(seat, cands) });
        }
        case 'exile.vote': {
          const cands = seats(you.targets).filter((s) => s !== seat);
          const legal = iAmWolf ? cands.filter((s) => !H().isWolf(g, s)) : cands;
          const top = this.topSuspect(seat, legal.length ? legal : cands);
          if (top.seat && (top.score > 1.2 || iAmWolf)) this.trySubmit(seat, 'vote', { target: top.seat });
          else if (m.rng.chance(0.5) && top.seat) this.trySubmit(seat, 'vote', { target: top.seat });
          else this.trySubmit(seat, 'abstain', {});
          return;
        }
        case 'famine.vote': {
          const cands = seats(you.targets).filter((s) => s !== seat);
          const legal = iAmWolf ? cands.filter((s) => !H().isWolf(g, s)) : cands;
          const top = this.topSuspect(seat, legal.length ? legal : cands);
          this.trySubmit(seat, 'vote', { target: top.seat || m.rng.pick(cands) });
          return;
        }
        case 'election.signup': {
          let pRun = 0.12;
          if (p.role === 'seer') pRun = 0.85;
          if (iAmWolf) pRun = 0.25;
          this.trySubmit(seat, 'run', { run: m.rng.chance(pRun) });
          return;
        }
        case 'election.speech': {
          if (p.role === 'seer' && !m.myClaims.includes('seer')) {
            m.myClaims.push('seer');
            this.trySubmit(seat, 'claim', { kind: 'role', role: 'seer' });
          }
          this.trySubmit(seat, 'done', {});
          return;
        }
        case 'election.vote': {
          const cands = seats(you.candidates);
          if (iAmWolf) {
            const mates = cands.filter((s) => H().isWolf(g, s));
            return void this.trySubmit(seat, 'vote', { target: mates.length ? m.rng.pick(mates) : m.rng.pick(cands) });
          }
          const claimed = cands.filter((s) => m.claimedSeers.some((c) => c.seat === s));
          return void this.trySubmit(seat, 'vote', { target: claimed.length ? claimed[0] : this.leastSuspect(seat, cands) });
        }
        case 'sheriff.direction':
          return void this.trySubmit(seat, 'direction', { dir: m.rng.chance(0.5) ? 'forward' : 'back' });
        case 'day.speech':
        case 'day.speech.pk':
          this.speak(seat);
          return void this.trySubmit(seat, 'done', {});
        case 'build.vote': {
          // 好人傾向支持；狼人傾向反對烽火台
          const idx = 0;
          const prop = you.proposals[idx];
          if (!prop) return void this.trySubmit(seat, 'abstain', {});
          if (iAmWolf && prop.construction === 'beacon') return void this.trySubmit(seat, 'abstain', {});
          return void this.trySubmit(seat, 'vote', { proposal: idx });
        }
        case 'exile.idiot': return void this.trySubmit(seat, 'flip', {});
        case 'day.admirer':
          return void this.trySubmit(seat, 'choose', { target: this.leastSuspect(seat, seats(you.targets)) });
        case 'day.finaldest': {
          if (p.role === 'guard' && !p.night.prefPatrol && !p.night.prefDest) this.chooseDestPref(seat);
          if (!p.night.prefDest && !p.night.prefPatrol) this.chooseDestPref(seat);
          return void this.trySubmit(seat, 'confirmKeep', {});
        }
        case 'night.butterfly': {
          const top = this.topSuspect(seat, seats(you.targets));
          if (top.seat && top.score > 2 && m.rng.chance(0.8)) this.trySubmit(seat, 'hug', { target: top.seat });
          else if (m.rng.chance(0.3)) this.trySubmit(seat, 'hug', { target: m.rng.pick(seats(you.targets)) });
          else this.trySubmit(seat, 'skip', {});
          return;
        }
        case 'night.guardredo':
          return void this.trySubmit(seat, 'move', { loc: m.rng.pick(you.openLocs.filter((l) => l !== 'cottage')) });
        case 'night.wolfsave':
        case 'night.godsave': {
          if (!you.list.length || you.herb < 1) return void this.trySubmit(seat, 'skip', {});
          // 優先救聲稱預言家者與自己
          const claimed = you.list.find((x) => m.claimedSeers.some((c) => c.seat === x.seat));
          const self = you.list.find((x) => x.seat === seat);
          const pick = claimed || self || you.list[0];
          // 第一夜傾向救人；之後衡量藥草
          if (g.day <= 2 || m.rng.chance(0.75)) this.trySubmit(seat, 'save', { target: pick.seat });
          else this.trySubmit(seat, 'skip', {});
          return;
        }
        case 'night.postinfo': {
          if (you.checkTargets) {
            const unchecked = seats(you.checkTargets).filter((s) => !m.checks[s]);
            const target = unchecked.length ? m.rng.pick(unchecked) : m.rng.pick(seats(you.checkTargets));
            const r = this.engine.submit(seat, 'check', { target });
            if (r.ok) {
              // 結果經 notify 傳回；同步登記於 mind（伺服器端信任自身查詢）
              m.checks[target] = H().isWolf(g, target) ? 'wolf' : 'good';
            }
            return;
          }
          if (you.banTargets) {
            const top = this.topSuspect(seat, seats(you.banTargets));
            if (top.seat && top.score > 1) this.trySubmit(seat, 'ban', { target: top.seat });
            else this.trySubmit(seat, 'skip', {});
            return;
          }
          return void this.trySubmit(seat, 'skip', {});
        }
        case 'night.godattack': {
          if (you.assassinTarget) {
            const s = this.suspicionOf(seat)[you.assassinTarget.seat] || 0;
            if (s > 2 || m.rng.chance(0.35)) this.trySubmit(seat, 'assassinate', { confirm: true });
            else this.trySubmit(seat, 'skip', {});
            return;
          }
          if (you.poisonTargets) {
            const top = this.topSuspect(seat, seats(you.poisonTargets));
            if (top.seat && top.score > 4 && you.herb > 0) this.trySubmit(seat, 'poison', { target: top.seat });
            else this.trySubmit(seat, 'skip', {});
            return;
          }
          return void this.trySubmit(seat, 'skip', {});
        }
        case 'night.warlock': {
          const mates = you.list.filter((x) => H().isWolf(g, x.seat));
          if (mates.length) this.trySubmit(seat, 'rescue', { target: mates[0].seat });
          else this.trySubmit(seat, 'skip', {});
          return;
        }
        default: {
          if (this.trySubmit(seat, 'done', {})) return;
          if (this.trySubmit(seat, 'skip', {})) return;
          if (this.trySubmit(seat, 'abstain', {})) return;
          if (this.trySubmit(seat, 'confirmKeep', {})) return;
        }
      }
    }
  }

  WV.AIManager = AIManager;
})();
