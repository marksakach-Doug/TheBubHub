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
  let plLen = 0, lastDiff = 0;

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
    lastDiff = areaDiff(b) - komi;
    return lastDiff > 0 ? 1 : 2;
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
    this.sm = 0;                  // sum of the final score margin, from that player's side
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

  // The root's child for move mv, created if need be. Unlike genMoves this accepts a move that
  // fills our own eye: someone may well play one, and we want to say how bad it was.
  function forcedChild(node, b, turn, ko, mv) {
    for (let k = 0; k < node.kids.length; k++) if (node.kids[k].m === mv) return node.kids[k];
    if (node.untried === null) node.untried = genMoves(b, turn, ko);
    const at = node.untried.indexOf(mv);
    if (at >= 0) node.untried.splice(at, 1);
    else if (mv !== PASS) {
      tmp.set(b);
      if (playStone(tmp, mv, turn, ko) < 0) return null;
    }
    const child = new Node(node, mv, turn);
    node.kids.push(child);
    return child;
  }

  function Searcher() {
    this.root = null; this.prev = null; this.lastChosen = -2;
    this.pos = null; this.cfg = null; this.iters = 0; this.deadline = 0;
    this.done = true; this.reused = false; this.force = -1;
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
    this.force = -1;
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
      if (node === this.root && this.force >= 0) {         // judging one move: always go through it
        child = forcedChild(node, b, turn, ko, this.force);
        if (!child) break;
      } else {
        if (node.untried === null) node.untried = genMoves(b, turn, ko);
        if (node.untried.length > 0) {                     // expansion
          const u = node.untried, k = rand(u.length), mv = u[k];
          u[k] = u[u.length - 1]; u.pop();
          child = new Node(node, mv, turn);
          node.kids.push(child);
        } else if (node.kids.length > 0) {                 // selection
          child = selectChild(node, cfg);
        } else break;
      }
      const mv = child.m;
      if (mv === PASS) { passes++; ko = -1; last = -1; }
      else { playStone(b, mv, turn, ko); ko = outKo; passes = 0; last = mv; }
      turn = 3 - turn;
      node = child;
      path[len++] = node;
      if (child.n === 0 && child.kids.length === 0 && child.untried === null) break;   // new leaf: evaluate it
    }
    plLen = 0;
    let winner;
    if (passes >= 2) { lastDiff = areaDiff(b) - komi; winner = lastDiff > 0 ? 1 : 2; }
    else winner = playout(b, ko, turn, passes, last, komi);
    for (let j = 0; j < len; j++) {
      const nd = path[j];
      nd.n++;
      if (nd.mover === winner) nd.w++;
      nd.sm += nd.mover === 1 ? lastDiff : -lastDiff;
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

  // ---------- rating a move ----------
  // Search the position the move was played in, then judge the played move and the move the search
  // likes best on equal terms: each gets the same number of FRESH visits, and only those are
  // compared. (The search's favourite is its favourite partly because it got lucky early, so its
  // old numbers are too rosy to hold up against a move that never had a chance to be lucky.)
  // The rating is how much win probability and how many points the played move cost. It is the
  // bot's opinion, not a proof.
  function Rater() {
    this.s = null; this.move = -1; this.phase = 0; this.k = 0; this.cfg = null;
    this.topNode = null; this.base = null;
  }

  function snap(node) { return node ? { n: node.n, w: node.w, sm: node.sm } : { n: 0, w: 0, sm: 0 }; }
  function kidFor(root, m) {
    for (let k = 0; k < root.kids.length; k++) if (root.kids[k].m === m) return root.kids[k];
    return null;
  }

  Rater.prototype.start = function (pos, move, cfgIn) {
    this.cfg = Object.assign({}, DEFAULTS, { ms: 1500, iters: 4000, extra: 1000 }, cfgIn || {});
    this.s = new Searcher();
    this.s.start(pos, Object.assign({}, this.cfg, { reuse: false }));
    this.move = move; this.phase = 0; this.k = 0; this.topNode = null; this.base = null;
  };

  // Phases: 0 the main search; 1 extra visits for the played move; 2 the same for the favourite.
  Rater.prototype.step = function (sliceMs) {
    const c = this.cfg, root = this.s.root;
    if (this.phase === 0) {
      if (this.s.step(sliceMs)) {
        let top = null;
        for (let k = 0; k < root.kids.length; k++) if (!top || root.kids[k].n > top.n) top = root.kids[k];
        this.topNode = top;
        this.base = { top: snap(top), played: snap(kidFor(root, this.move)) };
        if (!top || top.m === this.move) { this.phase = 3; return true; }     // it IS the favourite
        this.phase = 1; this.s.force = this.move; this.k = 0;
      }
      return false;
    }
    HEUR = !!c.heur; P_LOCAL = c.pLocal; REC = !!c.rave;
    const end = performance.now() + sliceMs;
    while (this.k < c.extra) {
      this.s._iterate(); this.s.iters++; this.k++;
      if ((this.k & 7) === 0 && performance.now() >= end) return false;
    }
    if (this.phase === 1) { this.phase = 2; this.s.force = this.topNode.m; this.k = 0; return false; }
    this.phase = 3;
    return true;
  };

  Rater.prototype.result = function () {
    const root = this.s.root, move = this.move, top = this.topNode;
    if (!top) return { rating: 100, best: move, played: move, decided: '' };
    if (top.m === move) {
      return { rating: 100, best: move, played: move, wrBest: top.w / top.n, wrPlayed: top.w / top.n,
        ptsBest: top.sm / top.n, ptsPlayed: top.sm / top.n, decided: top.w / top.n > 0.97 ? 'won' : top.w / top.n < 0.03 ? 'lost' : '' };
    }
    const pn = kidFor(root, move) || { n: 0, w: 0, sm: 0 };
    const dP = { n: Math.max(1, pn.n - this.base.played.n), w: pn.w - this.base.played.w, sm: pn.sm - this.base.played.sm };
    const dB = { n: Math.max(1, top.n - this.base.top.n), w: top.w - this.base.top.w, sm: top.sm - this.base.top.sm };
    const wrP = dP.w / dP.n, wrB = dB.w / dB.n, ptP = dP.sm / dP.n, ptB = dB.sm / dB.n;
    // 25 points of win probability, or 12 points of score, is worth the whole 100%.
    const loss = Math.max(Math.max(0, wrB - wrP) / 0.25, Math.max(0, ptB - ptP) / 12);
    return {
      rating: Math.max(0, Math.min(100, Math.round(100 * (1 - loss)))), best: top.m, played: move,
      wrBest: wrB, wrPlayed: wrP, ptsBest: ptB, ptsPlayed: ptP, visitsBest: dB.n, visitsPlayed: dP.n,
      decided: wrB > 0.97 ? 'won' : wrB < 0.03 ? 'lost' : ''
    };
  };

  // ---------- tsumego: life-and-death problems, made and checked by exact search ----------
  // A problem is a corner of the board where the attacker's wall is already alive (it has two
  // eyes elsewhere), so the only question is the group inside. It is solved by exhaustive
  // search, not by MCTS: every answer the player is told is right is proven, and every move
  // they are told is wrong has a proven refutation within the stated depth.

  const bsChain = new Int8Array(AREA), bsReg = new Int8Array(AREA), bsOut = new Int8Array(AREA);
  const bsLib = new Int32Array(AREA), bsAdj = new Int32Array(32), bsVit = new Int32Array(32);
  const bsStk = new Int8Array(AREA);

  // Benson's algorithm. Marks in bsOut every stone of colour c that can never be captured, and
  // returns true if there is at least one.
  function benson(b, c) {
    bsOut.fill(0); bsChain.fill(-1); bsReg.fill(-1);
    let nCh = 0, nRg = 0;
    for (let i = 0; i < AREA; i++) {
      if (b[i] !== c || bsChain[i] >= 0) continue;
      if (nCh >= 30) return false;
      let top = 0;
      bsStk[top++] = i; bsChain[i] = nCh;
      while (top > 0) {
        const nb = NB[bsStk[--top]];
        for (let m = 0; m < nb.length; m++) {
          const q = nb[m];
          if (b[q] === c && bsChain[q] < 0) { bsChain[q] = nCh; bsStk[top++] = q; }
        }
      }
      nCh++;
    }
    if (nCh === 0) return false;
    for (let i = 0; i < AREA; i++) {
      if (b[i] !== 0) continue;
      let msk = 0;
      const nb = NB[i];
      for (let m = 0; m < nb.length; m++) if (b[nb[m]] === c) msk |= 1 << bsChain[nb[m]];
      bsLib[i] = msk;
    }
    for (let i = 0; i < AREA; i++) {
      if (b[i] === c || bsReg[i] >= 0) continue;
      if (nRg >= 30) return false;
      let top = 0, adj = 0, all = -1;
      bsStk[top++] = i; bsReg[i] = nRg;
      while (top > 0) {
        const p = bsStk[--top];
        if (b[p] === 0) all &= bsLib[p];
        const nb = NB[p];
        for (let m = 0; m < nb.length; m++) {
          const q = nb[m];
          if (b[q] === c) adj |= 1 << bsChain[q];
          else if (bsReg[q] < 0) { bsReg[q] = nRg; bsStk[top++] = q; }
        }
      }
      bsAdj[nRg] = adj; bsVit[nRg] = adj & all;      // vital: every empty point is a liberty of the chain
      nRg++;
    }
    let aliveC = (1 << nCh) - 1, aliveR = (1 << nRg) - 1;
    for (;;) {
      let removed = 0;
      for (let ch = 0; ch < nCh; ch++) {
        if (!((aliveC >> ch) & 1)) continue;
        let cnt = 0;
        for (let r = 0; r < nRg; r++) if (((aliveR >> r) & 1) && ((bsVit[r] >> ch) & 1)) cnt++;
        if (cnt < 2) removed |= 1 << ch;
      }
      if (!removed) break;
      aliveC &= ~removed;
      for (let r = 0; r < nRg; r++) if (((aliveR >> r) & 1) && (bsAdj[r] & removed)) aliveR &= ~(1 << r);
    }
    if (!aliveC) return false;
    for (let i = 0; i < AREA; i++) if (b[i] === c && ((aliveC >> bsChain[i]) & 1)) bsOut[i] = 1;
    return true;
  }

  function countOf(b, c) {
    let n = 0;
    for (let i = 0; i < AREA; i++) if (b[i] === c) n++;
    return n;
  }

  // goal 'kill': the attacker wins by capturing every defending stone.
  // goal 'live': the defender wins by making a group that Benson's algorithm calls unconditionally
  // alive. Anything else (two passes, a seki, running out of depth) counts against the seeker.
  function makeSolver(att, def, zone, goal, limit) {
    return {
      att: att, def: def, zone: zone, goal: goal, seeker: goal === 'kill' ? att : def,
      t: new Map(), f: new Map(), nodes: 0, limit: limit || 150000
    };
  }

  function solve(S, b, ko, turn, passes, depth) {
    const has = countOf(b, S.def) > 0;
    const alive = has && benson(b, S.def);
    if (S.goal === 'kill') { if (!has) return true; if (alive) return false; }
    else { if (alive) return true; if (!has) return false; }
    if (passes >= 2 || depth <= 0) return false;
    const key = String.fromCharCode.apply(null, b) + turn + ',' + ko + ',' + passes;
    const tv = S.t.get(key);
    if (tv !== undefined && depth >= tv) return true;
    const fv = S.f.get(key);
    if (fv !== undefined && depth <= fv) return false;
    if (++S.nodes > S.limit) throw new Error('limit');
    const seek = turn === S.seeker;
    let res = !seek, decided = false;
    for (let k = 0; k < S.zone.length && !decided; k++) {
      const p = S.zone[k];
      if (b[p] !== 0 || p === ko) continue;
      const nb = Int8Array.from(b);
      if (playStone(nb, p, turn, ko) < 0) continue;
      const v = solve(S, nb, outKo, 3 - turn, 0, depth - 1);
      if (seek && v) { res = true; decided = true; }
      else if (!seek && !v) { res = false; decided = true; }
    }
    if (!decided) {
      const v = solve(S, b, -1, 3 - turn, passes + 1, depth - 1);
      if (seek && v) res = true;
      else if (!seek && !v) res = false;
    }
    if (res) { const o = S.t.get(key); if (o === undefined || depth < o) S.t.set(key, depth); }
    else { const o = S.f.get(key); if (o === undefined || depth > o) S.f.set(key, depth); }
    return res;
  }

  // The seeker's first moves that win within depth plies (this move included).
  function winningMoves(S, b, ko, turn, depth) {
    const out = [];
    for (let k = 0; k < S.zone.length; k++) {
      const p = S.zone[k];
      if (b[p] !== 0 || p === ko) continue;
      const nb = Int8Array.from(b);
      if (playStone(nb, p, turn, ko) < 0) continue;
      if (solve(S, nb, outKo, 3 - turn, 0, depth - 1)) out.push(p);
    }
    return out;
  }

  // minKD..maxKD: the shortest forced win, in plies (the first move counts). They come in odd
  // numbers because the seeker moves first and last. 3 is a short tactic, 5 and 7 take some
  // reading, 9 and more are hard. A, D and E are the size of the contested area, the defender's
  // stones and the empty points inside it.
  const TLEVEL = {
    easy:   { eyeMin: 3, eyeMax: 4, minD: 3, maxD: 12, minE: 2, maxE: 6, minKD: 3, maxKD: 5,  maxSol: 2, limit: 60000 },
    medium: { eyeMin: 4, eyeMax: 5, minD: 3, maxD: 12, minE: 3, maxE: 7, minKD: 5, maxKD: 7,  maxSol: 2, limit: 150000 },
    hard:   { eyeMin: 5, eyeMax: 6, minD: 3, maxD: 12, minE: 4, maxE: 8, minKD: 7, maxKD: 11, maxSol: 2, limit: 300000 }
  };

  function growRegion(allowed, start, size) {
    const set = [start], inSet = new Int8Array(AREA);
    inSet[start] = 1;
    while (set.length < size) {
      const frontier = [];
      for (let k = 0; k < set.length; k++) {
        const nb = NB[set[k]];
        for (let m = 0; m < nb.length; m++) {
          const q = nb[m];
          if (allowed[q] && !inSet[q] && frontier.indexOf(q) < 0) frontier.push(q);
        }
      }
      if (!frontier.length) break;
      const q = frontier[rand(frontier.length)];
      inSet[q] = 1; set.push(q);
    }
    return set;
  }

  function xform(k, x, y) {
    const m = N - 1;
    switch (k) {
      case 0: return [x, y]; case 1: return [m - x, y]; case 2: return [x, m - y]; case 3: return [m - x, m - y];
      case 4: return [y, x]; case 5: return [m - y, x]; case 6: return [y, m - x]; default: return [m - y, m - x];
    }
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (b.indexOf(a[i]) < 0) return false;
    return true;
  }

  // A layout is the 5x5 box in the top-left corner (25 cells: 0 empty, 1 attacker, 2 defender).
  // Everything outside the box is attacker stones, except two single-point eyes, which make that
  // whole mass unconditionally alive. Only the box is up for grabs.
  const BOX = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) BOX.push(y * N + x);
  const EYE_A = 3 * N + 6, EYE_B = 6 * N + 6, ANCHOR = 6;     // (6,3), (6,6), and (6,0), an outside stone

  function buildBoard(cells) {
    const b = new Int8Array(AREA).fill(1);
    for (let k = 0; k < 25; k++) b[BOX[k]] = cells[k];
    b[EYE_A] = 0; b[EYE_B] = 0;
    return b;
  }

  // Is this a sane position for a problem? Returns the board, or null.
  function checkLayout(L, cells) {
    let nE = 0, nD = 0;
    for (let k = 0; k < 25; k++) { if (cells[k] === 0) nE++; else if (cells[k] === 2) nD++; }
    if (nE < L.minE || nE > L.maxE || nD < L.minD || nD > L.maxD) return null;
    const b = buildBoard(cells);
    for (let i = 0; i < AREA; i++) if (b[i]) { flood(b, i); if (nLibs === 0) return null; }
    let first = -1;
    for (let i = 0; i < AREA; i++) if (b[i] === 2) { first = i; break; }
    flood(b, first);
    if (nStones !== nD) return null;                           // the defender is one group
    if (!benson(b, 1) || !bsOut[ANCHOR]) return null;          // the attacker's mass lives
    return b;
  }

  // How far a layout is from a good problem: 0 is one right answer, in range. Larger is worse.
  // Also says which way to push it: alive (needs a weaker defender) or too dead (a stronger one).
  function judgeLayout(L, b) {
    const S = makeSolver(1, 2, BOX, 'kill', L.limit);
    let kd = 0, K = [];
    try {
      for (let d = 1; d <= L.maxKD + 2 && !kd; d++) if (winningMoves(S, b, -1, 1, d).length) kd = d;
      if (!kd) return { e: 8, kd: 0, K: [], alive: true };
      K = winningMoves(S, b, -1, 1, L.maxKD + 4);
    } catch (err) { if (err && err.message === 'limit') return null; throw err; }
    let legal = 0;
    for (let k = 0; k < 25; k++) {
      const p = BOX[k];
      if (b[p] === 0) { const t = Int8Array.from(b); if (playStone(t, p, 1, -1) >= 0) legal++; }
    }
    let e = Math.max(0, K.length - 1);
    if (K.length >= legal) e += 3;
    if (kd < L.minKD) e += (L.minKD - kd) / 2; else if (kd > L.maxKD) e += (kd - L.maxKD) / 2;
    return { e: e, kd: kd, K: K, alive: false, legal: legal };
  }

  function mutateLayout(cells, alive) {
    const out = Int8Array.from(cells);
    if (rnd() < 0.5) {                                          // swap two neighbouring cells
      for (let tries = 0; tries < 12; tries++) {
        const k = rand(25), x = k % 5, y = (k / 5) | 0;
        const k2 = rnd() < 0.5 ? (x < 4 ? k + 1 : -1) : (y < 4 ? k + 5 : -1);
        if (k2 < 0 || cells[k] === cells[k2]) continue;
        out[k] = cells[k2]; out[k2] = cells[k];
        return out;
      }
    }
    for (let tries = 0; tries < 12; tries++) {
      const k = rand(25), v = cells[k];
      let nv = -1;
      if (rnd() < 0.15) nv = (v + 1 + rand(2)) % 3;            // now and then, any change at all
      else if (alive) { if (v === 0) nv = 1; else if (v === 2) nv = rnd() < 0.5 ? 1 : 0; }
      else { if (v === 1) nv = rnd() < 0.7 ? 0 : 2; else if (v === 0) nv = 2; }
      if (nv < 0) continue;
      out[k] = nv;
      return out;
    }
    return null;
  }

  // A starting layout shaped like a real problem: an eye space of a few points against an edge,
  // ringed by the defender's stones, with a little noise so that it is not a perfect shape.
  function eyeLayout(L) {
    const sub = new Int8Array(AREA);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sub[y * N + x] = 1;
    const seeds = [];
    for (let k = 0; k < 4; k++) { seeds.push(k); if (k > 0) seeds.push(k * N); }
    const E = growRegion(sub, seeds[rand(seeds.length)], L.eyeMin + rand(L.eyeMax - L.eyeMin + 1));
    const cells = new Int8Array(25).fill(1);
    const at = function (p) { return (p / N | 0) * 5 + p % N; };
    const inE = new Int8Array(AREA);
    E.forEach(function (p) { inE[p] = 1; cells[at(p)] = 0; });
    const ring = [];
    E.forEach(function (p) {
      const x = p % N, y = (p / N) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx > 4 || yy > 4) continue;
        const q = yy * N + xx;
        if (!inE[q] && ring.indexOf(q) < 0) ring.push(q);
      }
    });
    ring.forEach(function (q) { cells[at(q)] = 2; });
    // noise: weaken the ring, give it a tail, or put an attacker stone in the eye space
    if (rnd() < 0.6 && ring.length > 4) cells[at(ring[rand(ring.length)])] = rnd() < 0.5 ? 0 : 1;
    if (rnd() < 0.4) { const q = ring[rand(ring.length)], nb = NB[q], r = nb[rand(nb.length)]; if (r % N <= 4 && ((r / N) | 0) <= 4 && cells[at(r)] === 1) cells[at(r)] = 2; }
    if (rnd() < 0.25 && E.length > L.eyeMin) cells[at(E[rand(E.length)])] = 1;
    return cells;
  }

  // One attempt: a starting layout, pushed toward a problem by a little local search, then verified.
  function tryPuzzle(L, goalIn) {
    let cells = eyeLayout(L);
    let b = checkLayout(L, cells), cur = b ? judgeLayout(L, b) : null;
    for (let step = 0; step < 14; step++) {
      if (cur && cur.e === 0 && cur.K.length <= L.maxSol && cur.kd >= L.minKD && cur.kd <= L.maxKD) {
        const puzzle = finishPuzzle(L, b, goalIn);
        if (puzzle) return puzzle;
        return null;
      }
      const next = mutateLayout(cells, cur ? cur.alive : rnd() < 0.5);
      if (!next) continue;
      const nb = checkLayout(L, next);
      if (!nb) continue;
      const nj = judgeLayout(L, nb);
      if (!nj) continue;
      if (!cur || nj.e <= cur.e || rnd() < 0.1) { cells = next; b = nb; cur = nj; }
    }
    return null;
  }

  // Verify a promising layout properly, then dress it up: random symmetry, random colours.
  function finishPuzzle(L, b, goalIn) {
    const Dv = L.maxKD + 4;
    try {
      const S = makeSolver(1, 2, BOX, 'kill', L.limit);
      let kd = 0;
      for (let d = 1; d <= L.maxKD && !kd; d++) if (winningMoves(S, b, -1, 1, d).length) kd = d;
      if (!kd || kd < L.minKD) return null;
      const K = winningMoves(S, b, -1, 1, Dv);
      if (!K.length || K.length > L.maxSol) return null;
      // Four plies deeper must give the same answers, or a move we call wrong could win slowly.
      if (!sameSet(K, winningMoves(makeSolver(1, 2, BOX, 'kill', L.limit * 2), b, -1, 1, Dv + 4))) return null;
      let goal = 'kill', sols = K;
      if (goalIn !== 'kill') {
        // The same position as a live problem: the defender moves first and must make two eyes.
        const Lv = winningMoves(makeSolver(1, 2, BOX, 'live', L.limit), b, -1, 2, Dv);
        const liveOk = Lv.length > 0 && Lv.length <= L.maxSol &&
          sameSet(Lv, winningMoves(makeSolver(1, 2, BOX, 'live', L.limit * 2), b, -1, 2, Dv + 4));
        if (goalIn === 'live' && !liveOk) return null;
        if (liveOk && (goalIn === 'live' || rnd() < 0.5)) { goal = 'live'; sols = Lv; }
      }
      const tf = rand(8), sw = rnd() < 0.5;
      const map = function (i) { const xy = xform(tf, i % N, (i / N) | 0); return xy[1] * N + xy[0]; };
      const nb = new Array(AREA).fill(0);
      for (let i = 0; i < AREA; i++) nb[map(i)] = b[i] ? (sw ? 3 - b[i] : b[i]) : 0;
      const attC = sw ? 2 : 1, defC = 3 - attC;
      return {
        v: 1, goal: goal, att: attC, def: defC, zone: BOX.map(map), b: nb, ko: -1,
        toPlay: goal === 'kill' ? attC : defC, solutions: sols.map(map), depth: Dv, kd: kd
      };
    } catch (err) {
      if (err && err.message === 'limit') return null;
      throw err;
    }
  }

  // Make a puzzle: level 'easy' | 'medium' | 'hard', goal 'kill' | 'live' | anything else for either.
  // Gives up after about ms milliseconds and returns null; call again.
  function tsumegoGenerate(level, goal, ms) {
    const L = TLEVEL[level] || TLEVEL.easy, t0 = performance.now();
    let tries = 0;
    while (tries === 0 || performance.now() - t0 < ms) {
      tries++;
      const p = tryPuzzle(L, goal);
      if (p) { p.level = TLEVEL[level] ? level : 'easy'; p.tries = tries; return p; }
    }
    return null;
  }

  // st: { b, ko, turn, passes, att, def, zone, goal, depth }. The player to move is the seeker.
  function stSolver(st, limit) { return makeSolver(st.att, st.def, st.zone, st.goal, limit || 300000); }

  function tsumegoSolutions(st) {
    return winningMoves(stSolver(st), st.b, st.ko, st.turn, st.depth);
  }

  // 'solved' once the goal is reached, else ''.
  function tsumegoDone(st) {
    if (st.goal === 'kill') return countOf(st.b, st.def) === 0 ? 'solved' : '';
    return countOf(st.b, st.def) > 0 && benson(st.b, st.def) ? 'solved' : '';
  }

  // The opponent's most stubborn reply: the one that keeps the seeker from winning for longest.
  function tsumegoReply(st) {
    const S = stSolver(st), opp = st.turn, mover = opp;
    let bestMove = PASS, bestD = -1;
    const cands = [];
    for (let k = 0; k < st.zone.length; k++) {
      const p = st.zone[k];
      if (st.b[p] !== 0 || p === st.ko) continue;
      const nb = Int8Array.from(st.b);
      if (playStone(nb, p, mover, st.ko) < 0) continue;
      cands.push({ m: p, b: nb, ko: outKo, passes: 0 });
    }
    cands.push({ m: PASS, b: Int8Array.from(st.b), ko: -1, passes: st.passes + 1 });
    for (let k = 0; k < cands.length; k++) {
      const c = cands[k];
      let d = 1;
      while (d <= st.depth && !solve(S, c.b, c.ko, 3 - mover, c.passes, d)) d++;
      if (d > bestD) { bestD = d; bestMove = c.m; }
    }
    return { move: bestMove, depth: bestD };
  }

  return {
    N: N, AREA: AREA, PASS: PASS, DEFAULTS: DEFAULTS,
    seed: seed, applyMove: applyMove, score: score, areaDiff: areaDiff, groupOf: groupOf,
    Searcher: Searcher, Rater: Rater,
    tsumegoGenerate: tsumegoGenerate, tsumegoSolutions: tsumegoSolutions,
    tsumegoReply: tsumegoReply, tsumegoDone: tsumegoDone, tsumegoLevels: Object.keys(TLEVEL),
    _benson: function (b, c) { const r = benson(b, c); return { alive: r, stones: Array.from(bsOut) }; },
    // exposed for tests and the self-play harness
    _playout: playout, _playStone: playStone, _isEye: isEye,
    _setPlayout: function (heur, pLocal, rec) { HEUR = heur; P_LOCAL = pLocal; REC = rec; },
    _ko: function () { return outKo; }
  };
}

export const engine = makeEngine();
