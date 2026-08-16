/* 《人狼村》可播種隨機數 — 伺服器與測試共用，保證可重現 */
(function () {
  const WV = (globalThis.WV = globalThis.WV || {});

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Rng {
    constructor(seed) {
      this.seed = seed >>> 0;
      this._next = mulberry32(this.seed);
    }
    next() { return this._next(); }
    int(maxExclusive) { return Math.floor(this._next() * maxExclusive); }
    range(min, maxInclusive) { return min + this.int(maxInclusive - min + 1); }
    pick(arr) { return arr[this.int(arr.length)]; }
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    sample(arr, n) { return this.shuffle(arr).slice(0, n); }
    chance(p) { return this._next() < p; }
  }

  WV.Rng = Rng;
})();
