// MiniGo engine: 7x7 Go rules + a Monte Carlo tree search bot.
//
// Everything lives inside makeEngine() on purpose. A game must not need the
// build tool to make a Web Worker, so index.js turns makeEngine.toString() into
// the worker's source. That only works while this function is completely
// self-contained: no imports, no outer variables, no template literals, no
// import.meta. tests/minigo_test.mjs runs it in an empty VM context to prove it.

export function makeEngine() {
  'use strict';
  const N = 7, AREA = 49, PASS = 49;

  // ---------- randomness (seedable so tests are reproducible) ----------
  let rnd = Math.random;
  function seed(s) {
    let a = s >>> 0;
    rnd = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rand(n) { return (rnd() * n) | 0; }

  // ---------- geometry ----------
  const NB = [], NB8 = [], DIAG = [], EDGE = [];
  for (let i = 0; i < AREA; i++) {
    const x = i % N, y = (i / N) | 0;
    const o = [], d = [], all = [];
    let off = false;
    if (x > 0) o.push(i - 1);
    if (x < N - 1) o.push(i + 1);
    if (y > 0) o.push(i - N);
    if (y < N - 1) o.push(i + N);
    const dxs = [-1, 1, -1, 1], dys = [-1, -1, 1, 1];
    for (let k = 0; k < 4; k++) {
      const xx = x + dxs[k], yy = y + dys[k];
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) off = true; else d.push(yy * N + xx);
    }
    NB.push(Int8Array.from(o));
    DIAG.push(Int8Array.from(d));
    NB8.push(Int8Array.from(o.concat(d)));
    EDGE.push(off);
  }

  // ---------- groups and moves ----------
  let stamp = 0;
  const seen = new Int32Array(AREA), lseen = new Int32Array(AREA);
  const stones = new Int8Array(AREA), rstack = new Int8Array(AREA);
  let nStones = 0, nLibs = 0, lastLib = -1, outKo = -1;

  // Flood the group at i. Leaves its stones in stones[0..nStones), its liberty
  // count in nLibs, and (when nLibs is 1) the liberty in lastLib.
  function flood(b, i) {
    stamp++;
    const c = b[i];
    nStones = 0; nLibs = 0; lastLib = -1;
    stones[nStones++] = i; seen[i] = stamp;
    for (let k = 0; k < nStones; k++) {
      const nb = NB[stones[k]];
      for (let m = 0; m < nb.length; m++) {
        const q = nb[m], v = b[q];
        if (v === 0) {
          if (lseen[q] !== stamp) { lseen[q] = stamp; nLibs++; lastLib = q; }
        } else if (v === c && seen[q] !== stamp) {
          seen[q] = stamp; stones[nStones++] = q;
        }
      }
    }
  }

  // Play colour c at i on b, in place. Returns the number of stones captured, or
  // -1 if the move is illegal (b is then untouched). On success nStones/nLibs
  // describe the new stone's group and outKo is the simple-ko point (or -1).
  function playStone(b, i, c, ko) {
    if (b[i] !== 0 || i === ko) return -1;
    b[i] = c;
    const o = 3 - c, nb = NB[i];
    let caps = 0, capPt = -1;
    for (let m = 0; m < nb.length; m++) {
      const q = nb[m];
      if (b[q] === o) {
        flood(b, q);
        if (nLibs === 0) {
          for (let k = 0; k < nStones; k++) b[stones[k]] = 0;
          caps += nStones; capPt = stones[0];
        }
      }
    }
    flood(b, i);
    if (caps === 0 && nLibs === 0) { b[i] = 0; return -1; }       // suicide
    // A ko needs a lone stone to take a lone stone and be left with one liberty.
    outKo = (caps === 1 && nStones === 1 && nLibs === 1) ? capPt : -1;
    return caps;
  }

  // A true eye: all neighbours are c, and the diagonals cannot be cut apart.
  function isEye(b, i, c) {
    const nb = NB[i];
    for (let m = 0; m < nb.length; m++) if (b[nb[m]] !== c) return false;
    const o = 3 - c, d = DIAG[i];
    let bad = 0;
    for (let m = 0; m < d.length; m++) if (b[d[m]] === o) bad++;
    return EDGE[i] ? bad === 0 : bad <= 1;
  }

  // Area scoring, fast: black area minus white area (no komi).
  function areaDiff(b) {
    let bl = 0, wh = 0;
    stamp++;
    for (let i = 0; i < AREA; i++) {
      const v = b[i];
      if (v === 1) bl++;
      else if (v === 2) wh++;
      else if (seen[i] !== stamp) {
        let n = 0, top = 0, mask = 0;
        rstack[top++] = i; seen[i] = stamp;
        while (top > 0) {
          const p = rstack[--top];
          n++;
          const nb = NB[p];
          for (let m = 0; m < nb.length; m++) {
            const q = nb[m], u = b[q];
            if (u === 0) { if (seen[q] !== stamp) { seen[q] = stamp; rstack[top++] = q; } }
            else mask |= u;
          }
        }
        if (mask === 1) bl += n; else if (mask === 2) wh += n;
      }
    }
    return bl - wh;
  }

  // ---------- rules API used by the game (plain arrays in, plain arrays out) ----------
  function applyMove(pos, i, c) {
    const b = pos.b;
    if (typeof i !== 'number' || i !== (i | 0) || i < 0 || i >= AREA) return { err: 'That is not a point on the board.' };
    if (b[i]) return { err: 'That point is taken.' };
    if (i === pos.ko) return { err: 'Ko: you cannot retake immediately.' };
    const t = Int8Array.from(b);
    const caps = playStone(t, i, c, pos.ko);
    if (caps < 0) return { err: 'Suicide is not allowed.' };
    const key = Array.prototype.join.call(t, '');
    if (pos.hist && pos.hist.indexOf(key) >= 0) return { err: 'Ko: that would repeat an earlier position.' };
    return { b: Array.from(t), ko: outKo, caps: caps, key: key };
  }

  // The points of the group containing i (empty list if i is empty).
  function groupOf(b, i) {
    if (!b[i]) return [];
    const t = Int8Array.from(b);
    flood(t, i);
    return Array.from(stones.subarray(0, nStones));
  }

  // Full scoring for the UI: dead stones are lifted first, then area is counted.
  function score(b, dead, komi) {
    const bb = Array.from(b, function (v, i) { return (dead && dead[i]) ? 0 : v; });
    const terr = new Array(AREA).fill(0), mark = new Array(AREA).fill(false);
    let bl = 0, wh = 0;
    for (let i = 0; i < AREA; i++) {
      if (bb[i] === 1) bl++; else if (bb[i] === 2) wh++;
    }
    for (let i = 0; i < AREA; i++) {
      if (bb[i] || mark[i]) continue;
      const reg = [i];
      let mask = 0;
      mark[i] = true;
      for (let k = 0; k < reg.length; k++) {
        const nb = NB[reg[k]];
        for (let m = 0; m < nb.length; m++) {
          const q = nb[m];
          if (bb[q]) mask |= bb[q];
          else if (!mark[q]) { mark[q] = true; reg.push(q); }
        }
      }
      if (mask === 1 || mask === 2) {
        if (mask === 1) bl += reg.length; else wh += reg.length;
        for (let k = 0; k < reg.length; k++) terr[reg[k]] = mask;
      }
    }
    return { black: bl, white: wh + komi, terr: terr, diff: bl - (wh + komi) };
  }

  // ---------- playouts ----------
  // Settings, switched by Searcher.start() from the search config.
  let HEUR = true, P_LOCAL = 0.4, REC = false;
  const MAXSTEPS = 160;
  const tmp = new Int8Array(AREA), work = new Int8Array(AREA);
  const empt = new Int8Array(AREA), cand = new Int8Array(6);
  const plMv = new Int8Array(MAXSTEPS + 8), plCol = new Int8Array(MAXSTEPS + 8);
  let plLen = 0;

  // Try the move on a scratch copy; commit it to b only if it is legal (and, when
  // asked, not a self-atari that captures nothing).
  function tryApply(b, i, c, ko, avoidAtari) {
    if (b[i] !== 0 || i === ko) return false;
    tmp.set(b);
    const caps = playStone(tmp, i, c, ko);
    if (caps < 0) return false;
    if (avoidAtari && caps === 0 && nLibs === 1) return false;
    b.set(tmp);
    return true;
  }

  // Choose and play one playout move for colour c. Returns the point, or PASS.
  function pickMove(b, c, ko, last) {
    if (HEUR && last >= 0) {
      // 1. Answer an atari beside the last move: capture the group, or run with it.
      let nc = 0;
      const nb = NB[last];
      for (let m = -1; m < nb.length; m++) {
        const q = m < 0 ? last : nb[m];
        if (b[q] === 0) continue;
        flood(b, q);
        if (nLibs === 1 && nc < 6) {
          const lib = lastLib;
          let dup = false;
          for (let k = 0; k < nc; k++) if (cand[k] === lib) dup = true;
          if (!dup) cand[nc++] = lib;
        }
      }
      if (nc > 0) {
        const s0 = rand(nc);
        for (let k = 0; k < nc; k++) {
          const mv = cand[(s0 + k) % nc];
          if (tryApply(b, mv, c, ko, true)) return mv;
        }
      }
      // 2. Often, a move touching the last one: fights are local.
      if (rnd() < P_LOCAL) {
        const n8 = NB8[last], s0 = rand(n8.length);
        for (let k = 0; k < n8.length; k++) {
          const mv = n8[(s0 + k) % n8.length];
          if (b[mv] === 0 && !isEye(b, mv, c) && tryApply(b, mv, c, ko, true)) return mv;
        }
      }
    }
    // 3. Any random legal move that does not fill our own eye.
    let n = 0;
    for (let i = 0; i < AREA; i++) {
      if (b[i] === 0 && i !== ko && !isEye(b, i, c)) empt[n++] = i;
    }
    let rem = n;
    while (rem > 0) {
      const r = rand(rem), mv = empt[r];
      empt[r] = empt[--rem]; empt[rem] = mv;      // rejected moves collect at the end
      if (tryApply(b, mv, c, ko, HEUR)) return mv;
    }
    // Only self-ataris (or nothing) are left. Playing them would kill our own groups
    // inside our own territory, so pass; the opponent's dead stones get captured by
    // the atari rule above, not by suicide.
    return PASS;
  }

  // Play random moves to the end of the game; return the winning colour.
  function playout(b0, ko0, turn0, passes0, last0, komi) {
    const b = work;
    b.set(b0);
    let ko = ko0, c = turn0, passes = passes0, last = last0, steps = 0;
    plLen = 0;
    while (passes < 2 && steps < MAXSTEPS) {
      steps++;
      const mv = pickMove(b, c, ko, last);
      if (mv === PASS) { passes++; ko = -1; last = -1; }
      else {
        passes = 0; ko = outKo; last = mv;
        if (REC) { plMv[plLen] = mv; plCol[plLen++] = c; }
      }
      c = 3 - c;
    }
    return areaDiff(b) - komi > 0 ? 1 : 2;
  }

  // ---------- Monte Carlo tree search ----------
  const DEFAULTS = {
    ms: 1500,        // wall-clock budget
    iters: 1e9,      // iteration cap (the strength dial for weak levels)
    heur: true,      // smart playouts
    pLocal: 0.4,     // chance of a move beside the last one when nothing is in atari
    rave: true,      // AMAF/RAVE blending (measured: 28/42 wins vs plain UCT at 80-100ms)
    raveB2: 0.05,    // RAVE bias; larger trusts RAVE less
    c: 0.3,          // UCT exploration
    reuse: true      // keep the tree between the bot's moves
  };

  function Node(parent, m, mover) {
    this.parent = parent; this.m = m; this.mover = mover;
    this.n = 0; this.w = 0;       // visits, and wins for the player who played m
    this.ra = 0; this.rw = 0;     // RAVE visits and wins
    this.kids = []; this.untried = null;
  }

  function genMoves(b, turn, ko) {
    const out = [];
    for (let i = 0; i < AREA; i++) {
      if (b[i] !== 0 || i === ko || isEye(b, i, turn)) continue;
      tmp.set(b);
      if (playStone(tmp, i, turn, ko) >= 0) out.push(i);
    }
    out.push(PASS);
    return out;
  }

  function selectChild(node, cfg) {
    const kids = node.kids, lnN = Math.log(node.n + 1);
    let best = null, bv = -Infinity;
    for (let k = 0; k < kids.length; k++) {
      const c = kids[k];
      let v = c.w / c.n;
      if (cfg.rave && c.ra > 0) {
        const beta = c.ra / (c.n + c.ra + 4 * c.n * c.ra * cfg.raveB2);
        v = (1 - beta) * v + beta * (c.rw / c.ra);
      }
      v += cfg.c * Math.sqrt(lnN / c.n);
      if (v > bv) { bv = v; best = c; }
    }
    return best;
  }

  const iterB = new Int8Array(AREA);
  const path = new Array(260);
  const amaf = [null, new Int32Array(AREA + 1), new Int32Array(AREA + 1)];
  let amafStamp = 0;

  function Searcher() {
    this.root = null; this.prev = null; this.lastChosen = -2;
    this.pos = null; this.cfg = null; this.iters = 0; this.deadline = 0;
    this.done = true; this.reused = false;
  }

  Searcher.prototype.reset = function () { this.root = null; this.prev = null; this.lastChosen = -2; };

  // If the position is one the previous search had already looked at (our move,
  // then the opponent's reply), return that subtree so its work is not wasted.
  Searcher.prototype._advance = function (pos) {
    const p = this.prev;
    if (!this.root || !p || p.turn !== pos.turn) return null;
    let mine = null;
    for (let k = 0; k < this.root.kids.length; k++) if (this.root.kids[k].m === this.lastChosen) mine = this.root.kids[k];
    if (!mine) return null;
    const t = Int8Array.from(p.b);
    let ko = p.ko, passes = p.passes, c = p.turn;
    if (this.lastChosen === PASS) { passes++; ko = -1; }
    else { if (playStone(t, this.lastChosen, c, ko) < 0) return null; ko = outKo; passes = 0; }
    c = 3 - c;
    const after = Int8Array.from(t);
    for (let k = 0; k < mine.kids.length; k++) {
      const g = mine.kids[k];
      t.set(after);
      let ko2 = ko, passes2 = passes;
      if (g.m === PASS) { passes2++; ko2 = -1; }
      else { if (playStone(t, g.m, c, ko) < 0) continue; ko2 = outKo; passes2 = 0; }
      if (passes2 !== pos.passes || ko2 !== pos.ko) continue;
      let same = true;
      for (let i = 0; i < AREA; i++) if (t[i] !== pos.b[i]) { same = false; break; }
      if (same) { g.parent = null; return g; }
    }
    return null;
  };

  Searcher.prototype.start = function (pos, cfgIn) {
    const cfg = Object.assign({}, DEFAULTS, cfgIn || {});
    HEUR = !!cfg.heur; P_LOCAL = cfg.pLocal; REC = !!cfg.rave;
    this.cfg = cfg;
    this.pos = {
      b: Int8Array.from(pos.b), ko: pos.ko, turn: pos.turn, passes: pos.passes,
      last: pos.last, komi: pos.komi, hist: new Set(pos.hist || [])
    };
    let root = cfg.reuse ? this._advance(this.pos) : null;
    this.reused = !!root;
    if (!root) root = new Node(null, -1, 3 - pos.turn);
    this.root = root;
    this.iters = 0;
    this.deadline = performance.now() + cfg.ms;
    this.done = false;
  };

  // Run for up to sliceMs; returns true once the budget is spent.
  Searcher.prototype.step = function (sliceMs) {
    if (this.done) return true;
    const end = Math.min(performance.now() + sliceMs, this.deadline);
    let k = 0;
    for (;;) {
      this._iterate();
      this.iters++;
      if (this.iters >= this.cfg.iters) { this.done = true; break; }
      if ((++k & 7) === 0 && performance.now() >= end) break;
    }
    if (performance.now() >= this.deadline) this.done = true;
    return this.done;
  };

  Searcher.prototype._iterate = function () {
    const P = this.pos, cfg = this.cfg, komi = P.komi;
    const b = iterB;
    b.set(P.b);
    let ko = P.ko, turn = P.turn, passes = P.passes, last = P.last;
    let node = this.root, len = 0;
    path[len++] = node;
    while (passes < 2) {
      let child;
      if (node.untried === null) node.untried = genMoves(b, turn, ko);
      if (node.untried.length > 0) {                       // expansion
        const u = node.untried, k = rand(u.length), mv = u[k];
        u[k] = u[u.length - 1]; u.pop();
        child = new Node(node, mv, turn);
        node.kids.push(child);
      } else if (node.kids.length > 0) {                   // selection
        child = selectChild(node, cfg);
      } else break;
      const mv = child.m;
      if (mv === PASS) { passes++; ko = -1; last = -1; }
      else { playStone(b, mv, turn, ko); ko = outKo; passes = 0; last = mv; }
      turn = 3 - turn;
      node = child;
      path[len++] = node;
      if (child.n === 0 && child.kids.length === 0 && child.untried === null) break;   // new leaf: evaluate it
    }
    plLen = 0;
    const winner = passes >= 2 ? (areaDiff(b) - komi > 0 ? 1 : 2) : playout(b, ko, turn, passes, last, komi);
    for (let j = 0; j < len; j++) {
      const nd = path[j];
      nd.n++;
      if (nd.mover === winner) nd.w++;
    }
    if (cfg.rave) {
      amafStamp++;
      for (let k = 0; k < plLen; k++) amaf[plCol[k]][plMv[k]] = amafStamp;
      for (let j = len - 1; j >= 0; j--) {
        const nd = path[j], kids = nd.kids;
        for (let k = 0; k < kids.length; k++) {
          const c = kids[k];
          if (c.m !== PASS && amaf[c.mover][c.m] === amafStamp) { c.ra++; if (winner === c.mover) c.rw++; }
        }
        if (j > 0 && nd.m !== PASS) amaf[nd.mover][nd.m] = amafStamp;
      }
    }
  };

  // The most-visited legal move (never one that repeats an earlier position).
  Searcher.prototype.result = function () {
    const P = this.pos;
    const kids = this.root.kids.slice().sort(function (a, c) { return c.n - a.n; });
    let pick = null;
    for (let k = 0; k < kids.length; k++) {
      const c = kids[k];
      if (c.m === PASS) { pick = c; break; }
      tmp.set(P.b);
      if (playStone(tmp, c.m, P.turn, P.ko) < 0) continue;
      if (P.hist.has(Array.prototype.join.call(tmp, ''))) continue;
      pick = c; break;
    }
    const mv = pick ? pick.m : PASS;
    this.prev = { b: Int8Array.from(P.b), ko: P.ko, turn: P.turn, passes: P.passes };
    this.lastChosen = mv;
    return {
      move: mv, iters: this.iters, reused: this.reused,
      visits: pick ? pick.n : 0, winrate: pick && pick.n ? pick.w / pick.n : 0.5
    };
  };

  return {
    N: N, AREA: AREA, PASS: PASS, DEFAULTS: DEFAULTS,
    seed: seed, applyMove: applyMove, score: score, areaDiff: areaDiff, groupOf: groupOf,
    Searcher: Searcher,
    // exposed for tests and the self-play harness
    _playout: playout, _playStone: playStone, _isEye: isEye,
    _setPlayout: function (heur, pLocal, rec) { HEUR = heur; P_LOCAL = pLocal; REC = rec; },
    _ko: function () { return outKo; }
  };
}

export const engine = makeEngine();
