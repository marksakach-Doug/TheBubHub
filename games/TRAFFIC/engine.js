// TRAFFIC engine: 7x7 / 9x9 / 11x11 logistics rules, turn-aware state-space
// Dijkstra solver, AI benchmarks, and evolutionary map generator.
//
// Everything lives inside makeEngine() on purpose so makeEngine.toString() can
// run inside a Web Worker or an empty VM test context with no bundler support:
// no imports, no outer variables, no template literals, no import.meta.

export function makeEngine() {
  'use strict';

  // Tile types
  var TILE_ROAD = 0;
  var TILE_WALL = 1;
  var TILE_TRAFFIC = 2;
  var TILE_GRIDLOCK = 3;
  var TILE_HIGHWAY = 4;

  // Base terrain cost multipliers
  var TILE_COST = [1.0, 999999.0, 2.2, 3.5, 0.55];

  // Turn multipliers (UPS logistics model)
  var MULT_STRAIGHT = 1.0;
  var MULT_RIGHT = 1.1;
  var MULT_LEFT = 1.6;
  var MULT_UTURN = 1.8;

  // 8 compass directions: N, NE, E, SE, S, SW, W, NW (clockwise) + 8 = NONE
  var DR = [-1, -1, 0, 1, 1, 1, 0, -1];
  var DC = [0, 1, 1, 1, 0, -1, -1, -1];
  var DSTEP = [1.0, 1.41421356, 1.0, 1.41421356, 1.0, 1.41421356, 1.0, 1.41421356];
  var DIR_NONE = 8;

  // ---------- seedable PRNG (Mulberry32, matches MiniGo) ----------
  var rnd = Math.random;
  function seed(s) {
    var a = s >>> 0;
    rnd = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function useRng(fn) {
    rnd = typeof fn === 'function' ? fn : Math.random;
  }
  function rand(n) {
    return (rnd() * n) | 0;
  }

  // ---------- geometry & direction helpers ----------
  function dirBetween(r1, c1, r2, c2) {
    var dr = r2 - r1, dc = c2 - c1;
    for (var d = 0; d < 8; d++) {
      if (DR[d] === dr && DC[d] === dc) return d;
    }
    return -1;
  }

  // Cross-product turn detection:
  // (prevDr * currDc) - (prevDc * currDr)
  // > 0 => LEFT turn (1.6x)
  // < 0 => RIGHT turn (1.1x)
  // = 0 => STRAIGHT (1.0x) or U-TURN (1.8x if dot < 0)
  function classifyTurn(prevDir, currDir) {
    if (prevDir < 0 || prevDir >= 8 || currDir < 0 || currDir >= 8) {
      return { type: 'start', mult: MULT_STRAIGHT, cross: 0 };
    }
    var pdr = DR[prevDir], pdc = DC[prevDir];
    var cdr = DR[currDir], cdc = DC[currDir];
    var cross = (pdr * cdc) - (pdc * cdr);
    var dot = (pdr * cdr) + (pdc * cdc);
    if (cross > 0) return { type: 'left', mult: MULT_LEFT, cross: cross };
    if (cross < 0) return { type: 'right', mult: MULT_RIGHT, cross: cross };
    if (dot < 0) return { type: 'uturn', mult: MULT_UTURN, cross: 0 };
    return { type: 'straight', mult: MULT_STRAIGHT, cross: 0 };
  }

  // Check if moving from cell i1 to i2 on an N*N grid is legal (no wall, no pinched diagonal)
  function canStep(grid, N, i1, i2) {
    if (i2 < 0 || i2 >= N * N) return false;
    if (grid[i2] === TILE_WALL) return false;
    var r1 = (i1 / N) | 0, c1 = i1 % N;
    var r2 = (i2 / N) | 0, c2 = i2 % N;
    var dr = r2 - r1, dc = c2 - c1;
    if (Math.abs(dr) > 1 || Math.abs(dc) > 1 || (dr === 0 && dc === 0)) return false;
    // Prevent squeezing diagonally between two touching buildings
    if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
      if (grid[r1 * N + c2] === TILE_WALL && grid[r2 * N + c1] === TILE_WALL) return false;
    }
    return true;
  }

  // ---------- pre-allocated state-space Dijkstra buffers ----------
  // Max N = 11 => 121 cells * 9 dirs * 16 checkpoint masks = 17,424 states
  var MAX_STATES = 121 * 9 * 16;
  var distBuf = new Float64Array(MAX_STATES);
  var parentBuf = new Int32Array(MAX_STATES);
  var visitedBuf = new Uint8Array(MAX_STATES);
  var heapState = new Int32Array(MAX_STATES * 2);
  var heapCost = new Float64Array(MAX_STATES * 2);
  var cpLookup = new Int8Array(121);

  // Solve shortest path on puzzle with configurable weights:
  // policy = 'optimal' (full turn + terrain weights)
  //        | 'gps'     (terrain weights, ignores turn penalties)
  //        | 'greedy'  (ignores both terrain weights and turn penalties)
  function solve(puzzle, policy) {
    var N = puzzle.size;
    var AREA = N * N;
    var grid = puzzle.grid;
    var start = puzzle.start;
    var end = puzzle.end;
    var cps = puzzle.checkpoints || [];
    var numCp = cps.length;
    var fullMask = (1 << numCp) - 1;
    var totalStates = AREA * 9 * (1 << numCp);

    var useTurns = policy !== 'gps' && policy !== 'greedy';
    var useTerrain = policy !== 'greedy';

    for (var i = 0; i < AREA; i++) cpLookup[i] = -1;
    for (var k = 0; k < numCp; k++) cpLookup[cps[k]] = k;

    for (var s = 0; s < totalStates; s++) {
      distBuf[s] = Infinity;
      parentBuf[s] = -1;
      visitedBuf[s] = 0;
    }

    var startMask = cpLookup[start] >= 0 ? (1 << cpLookup[start]) : 0;
    var startState = ((start * 9 + DIR_NONE) << numCp) | startMask;
    distBuf[startState] = 0;

    var heapLen = 0;
    function push(st, cost) {
      var idx = heapLen++;
      heapState[idx] = st;
      heapCost[idx] = cost;
      while (idx > 0) {
        var p = (idx - 1) >> 1;
        if (heapCost[p] <= heapCost[idx]) break;
        var ts = heapState[p], tc = heapCost[p];
        heapState[p] = heapState[idx]; heapCost[p] = heapCost[idx];
        heapState[idx] = ts; heapCost[idx] = tc;
        idx = p;
      }
    }

    function pop() {
      var topSt = heapState[0];
      heapLen--;
      if (heapLen > 0) {
        heapState[0] = heapState[heapLen];
        heapCost[0] = heapCost[heapLen];
        var idx = 0;
        for (;;) {
          var l = (idx << 1) + 1, r = l + 1, sm = idx;
          if (l < heapLen && heapCost[l] < heapCost[sm]) sm = l;
          if (r < heapLen && heapCost[r] < heapCost[sm]) sm = r;
          if (sm === idx) break;
          var ts = heapState[idx], tc = heapCost[idx];
          heapState[idx] = heapState[sm]; heapCost[idx] = heapCost[sm];
          heapState[sm] = ts; heapCost[sm] = tc;
          idx = sm;
        }
      }
      return topSt;
    }

    push(startState, 0);
    var goalState = -1;

    while (heapLen > 0) {
      var curr = pop();
      if (visitedBuf[curr]) continue;
      visitedBuf[curr] = 1;

      var mask = curr & fullMask;
      var tmp = curr >> numCp;
      var prevDir = tmp % 9;
      var cell = (tmp / 9) | 0;

      if (cell === end && mask === fullMask) {
        goalState = curr;
        break;
      }

      var r = (cell / N) | 0, c = cell % N;
      var baseDist = distBuf[curr];

      for (var d = 0; d < 8; d++) {
        var nr = r + DR[d], nc = c + DC[d];
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        var nextCell = nr * N + nc;
        if (grid[nextCell] === TILE_WALL) continue;
        if (DR[d] !== 0 && DC[d] !== 0) {
          if (grid[r * N + nc] === TILE_WALL && grid[nr * N + c] === TILE_WALL) continue;
        }

        var terrainW = useTerrain ? TILE_COST[grid[nextCell]] : 1.0;
        var turnM = 1.0;
        if (useTurns && prevDir !== DIR_NONE) {
          turnM = classifyTurn(prevDir, d).mult;
        }

        var stepCost = DSTEP[d] * terrainW * turnM;
        var nextMask = mask;
        var cpIdx = cpLookup[nextCell];
        if (cpIdx >= 0) nextMask |= (1 << cpIdx);

        var nextState = ((nextCell * 9 + d) << numCp) | nextMask;
        if (visitedBuf[nextState]) continue;

        var newCost = baseDist + stepCost;
        if (newCost < distBuf[nextState]) {
          distBuf[nextState] = newCost;
          parentBuf[nextState] = curr;
          push(nextState, newCost);
        }
      }
    }

    if (goalState < 0) return null;

    var rev = [];
    var trace = goalState;
    while (trace >= 0) {
      var tCell = ((trace >> numCp) / 9) | 0;
      if (rev.length === 0 || rev[rev.length - 1] !== tCell) {
        rev.push(tCell);
      }
      trace = parentBuf[trace];
    }
    rev.reverse();
    return evaluatePath(puzzle, rev);
  }

  // ---------- path evaluation & rules API ----------
  // Evaluates any cell array [c0, c1, ...] under the true TRAFFIC logistics rules
  function evaluatePath(puzzle, cells) {
    var N = puzzle.size;
    var grid = puzzle.grid;
    var cps = puzzle.checkpoints || [];
    if (!cells || !cells.length) {
      return {
        cells: [], nodes: [], cost: 0, distance: 0,
        leftTurns: 0, rightTurns: 0, straightMoves: 0, uturns: 0,
        Complete: false, hitAllCheckpoints: false
      };
    }

    var nodes = [];
    var totalCost = 0;
    var totalDist = 0;
    var leftTurns = 0, rightTurns = 0, straightMoves = 0, uturns = 0;
    var prevDir = DIR_NONE;
    var seenCp = {};

    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var r = (cell / N) | 0, c = cell % N;
      for (var k = 0; k < cps.length; k++) {
        if (cps[k] === cell) seenCp[cell] = true;
      }

      if (i === 0) {
        nodes.push({
          cell: cell, r: r, c: c,
          direction: null, dirIdx: DIR_NONE,
          turn: 'start', turnMultiplier: 1.0,
          stepCost: 0, totalCost: 0
        });
        continue;
      }

      var prevCell = cells[i - 1];
      var pr = (prevCell / N) | 0, pc = prevCell % N;
      var d = dirBetween(pr, pc, r, c);
      var turnInfo = prevDir === DIR_NONE
        ? { type: 'first', mult: 1.0, cross: 0 }
        : classifyTurn(prevDir, d);

      if (turnInfo.type === 'left') leftTurns++;
      else if (turnInfo.type === 'right') rightTurns++;
      else if (turnInfo.type === 'uturn') uturns++;
      else if (turnInfo.type === 'straight') straightMoves++;

      var stepDist = d >= 0 ? DSTEP[d] : 1.0;
      var terrainW = TILE_COST[grid[cell]] || 1.0;
      var stepCost = stepDist * terrainW * turnInfo.mult;

      totalDist += stepDist;
      totalCost += stepCost;
      prevDir = d;

      nodes.push({
        cell: cell, r: r, c: c,
        direction: { dr: r - pr, dc: c - pc }, dirIdx: d,
        turn: turnInfo.type, turnMultiplier: turnInfo.mult,
        stepCost: Math.round(stepCost * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100
      });
    }

    var hitCount = 0;
    for (var m = 0; m < cps.length; m++) {
      if (seenCp[cps[m]]) hitCount++;
    }
    var hitAll = hitCount === cps.length;
    var startsOk = cells[0] === puzzle.start;
    var endsOk = cells[cells.length - 1] === puzzle.end;

    return {
      cells: cells.slice(),
      nodes: nodes,
      cost: Math.round(totalCost * 100) / 100,
      distance: Math.round(totalDist * 100) / 100,
      leftTurns: leftTurns,
      rightTurns: rightTurns,
      straightMoves: straightMoves,
      uturns: uturns,
      hitAllCheckpoints: hitAll,
      checkpointsHit: hitCount,
      complete: startsOk && endsOk && hitAll && cells.length >= 2
    };
  }

  // Apply a target cell interaction to an existing player path:
  // - If cell is adjacent and legal, appends it (even if already in the path —
  //   doubling back through a junction is how several packages get collected)
  // - Else if cell is already in path, truncates back to that cell (backtrack)
  // - If cell is diagonal-blocked by one building, corner-assists through open neighbor
  // - If cell is a short straight/diagonal line jump (<= 3 steps), steps along it
  function applyStep(puzzle, currentCells, targetCell) {
    var N = puzzle.size;
    var AREA = N * N;
    var grid = puzzle.grid;
    if (typeof targetCell !== 'number' || targetCell < 0 || targetCell >= AREA) {
      return { err: 'Out of bounds.' };
    }
    if (grid[targetCell] === TILE_WALL) {
      return { err: 'Blocked by building.' };
    }

    var path = (currentCells && currentCells.length) ? currentCells.slice() : [puzzle.start];
    var last = path[path.length - 1];

    // A legal step from the vehicle always wins. Checked before the backtrack
    // branch so re-entering a tile the route already used stays possible.
    if (canStep(grid, N, last, targetCell)) {
      path.push(targetCell);
      return { cells: path, changed: true };
    }

    // Otherwise, tapping an earlier cell in our path rewinds to it.
    var existingIdx = path.indexOf(targetCell);
    if (existingIdx >= 0) {
      if (existingIdx === path.length - 1) return { cells: path, changed: false };
      return { cells: path.slice(0, existingIdx + 1), changed: true };
    }

    var r1 = (last / N) | 0, c1 = last % N;
    var r2 = (targetCell / N) | 0, c2 = targetCell % N;
    var dr = r2 - r1, dc = c2 - c1;

    // Corner-assist when diagonal is pinched or thumb skips a corner
    if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
      var elbowA = r1 * N + c2;
      var elbowB = r2 * N + c1;
      var okA = grid[elbowA] !== TILE_WALL && path.indexOf(elbowA) < 0;
      var okB = grid[elbowB] !== TILE_WALL && path.indexOf(elbowB) < 0;
      if (okA || okB) {
        var pick = okA ? elbowA : elbowB;
        if (okA && okB) {
          var evA = evaluatePath(puzzle, path.concat([elbowA, targetCell])).cost;
          var evB = evaluatePath(puzzle, path.concat([elbowB, targetCell])).cost;
          pick = evA <= evB ? elbowA : elbowB;
        }
        path.push(pick, targetCell);
        return { cells: path, changed: true };
      }
    }

    // Short line interpolation (up to 4 tiles in a straight or diagonal line)
    var adR = Math.abs(dr), adC = Math.abs(dc);
    var steps = Math.max(adR, adC);
    if (steps >= 2 && steps <= 4 && (dr === 0 || dc === 0 || adR === adC)) {
      var sr = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
      var sc = dc === 0 ? 0 : (dc > 0 ? 1 : -1);
      var temp = path.slice();
      var cur = last;
      var ok = true;
      for (var s = 1; s <= steps; s++) {
        var nr = r1 + sr * s, nc = c1 + sc * s;
        var nxt = nr * N + nc;
        if (!canStep(grid, N, cur, nxt) || temp.indexOf(nxt) >= 0) {
          ok = false;
          break;
        }
        temp.push(nxt);
        cur = nxt;
      }
      if (ok) return { cells: temp, changed: true };
    }

    return { err: 'Step must connect to your current vehicle position.' };
  }

  function validatePath(puzzle, cells) {
    if (!Array.isArray(cells) || cells.length === 0 || cells[0] !== puzzle.start) {
      return { err: 'Route must begin at START.' };
    }
    var N = puzzle.size;
    // Revisiting a tile is legal. The solver searches (cell, direction,
    // checkpointMask), so collecting several packages often means doubling back
    // through a junction — banning repeats here rejected the solver's own
    // answer and made most delivery maps unwinnable.
    for (var i = 1; i < cells.length; i++) {
      var prev = cells[i - 1], curr = cells[i];
      if (!canStep(puzzle.grid, N, prev, curr)) {
        return { err: 'Illegal step in route.' };
      }
    }
    return { ok: true, eval: evaluatePath(puzzle, cells) };
  }

  // ---------- procedural candidate generator & evolutionary Searcher ----------
  function buildCandidate(size, mode) {
    var N = size || 9;
    var AREA = N * N;
    var grid = new Array(AREA);
    for (var i = 0; i < AREA; i++) grid[i] = TILE_ROAD;

    // Pick opposite corner quadrants for Start and End
    var pad = N >= 9 ? 2 : 1;
    var sr = rand(pad), sc = rand(pad);
    var er = N - 1 - rand(pad), ec = N - 1 - rand(pad);
    var flip = rand(4);
    if (flip === 1) { var t1 = sc; sc = ec; ec = t1; }
    else if (flip === 2) { var t2 = sr; sr = er; er = t2; }
    else if (flip === 3) { var t3 = sr; sr = er; er = t3; var t4 = sc; sc = ec; ec = t4; }

    var start = sr * N + sc;
    var end = er * N + ec;

    var wallProb = mode === 'rush' ? 0.17 : (mode === 'highway' ? 0.18 : 0.21);
    var jamProb = mode === 'rush' ? 0.26 : 0.15;
    var gridlockProb = mode === 'rush' ? 0.16 : 0.07;

    for (var idx = 0; idx < AREA; idx++) {
      if (idx === start || idx === end) continue;
      var roll = rnd();
      if (roll < wallProb) grid[idx] = TILE_WALL;
      else if (roll < wallProb + gridlockProb) grid[idx] = TILE_GRIDLOCK;
      else if (roll < wallProb + gridlockProb + jamProb) grid[idx] = TILE_TRAFFIC;
    }

    // Carve an expressway belt in highway or standard modes
    if (mode === 'highway' || (mode === 'standard' && rnd() < 0.65)) {
      var hr = 1 + rand(N - 2);
      var hc = 1 + rand(N - 2);
      var count = mode === 'highway' ? N - 1 : ((N / 2) | 0);
      var horiz = rnd() < 0.5;
      for (var k = 0; k < count; k++) {
        var cell = horiz ? (hr * N + ((hc + k) % N)) : (((hr + k) % N) * N + hc);
        if (cell !== start && cell !== end) grid[cell] = TILE_HIGHWAY;
      }
    }

    // Plant congestion along the direct diagonal midline to punish naive straight/left cuts
    var midR = ((sr + er) / 2) | 0;
    var midC = ((sc + ec) / 2) | 0;
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var mr = midR + dr, mc = midC + dc;
        if (mr >= 0 && mr < N && mc >= 0 && mc < N) {
          var mIdx = mr * N + mc;
          if (mIdx !== start && mIdx !== end && grid[mIdx] === TILE_ROAD && rnd() < 0.55) {
            grid[mIdx] = rnd() < 0.45 ? TILE_GRIDLOCK : TILE_TRAFFIC;
          }
        }
      }
    }

    var checkpoints = [];
    if (mode === 'delivery') {
      var targetCps = N <= 7 ? 2 : 3;
      var tries = 0;
      while (checkpoints.length < targetCps && tries < 80) {
        tries++;
        var cr = 1 + rand(N - 2), cc = 1 + rand(N - 2);
        var cIdx = cr * N + cc;
        if (cIdx === start || cIdx === end || grid[cIdx] === TILE_WALL) continue;
        if (checkpoints.indexOf(cIdx) >= 0) continue;
        grid[cIdx] = TILE_ROAD;
        checkpoints.push(cIdx);
      }
    }

    return {
      size: N,
      mode: mode || 'standard',
      grid: grid,
      start: start,
      end: end,
      checkpoints: checkpoints
    };
  }

  // Score how interesting a candidate map is:
  // Rewards maps where the UPS Turn-Aware Optimal path beats the Turn-Blind GPS path
  // and makes purposeful right turns around congestion.
  function scoreCandidate(cand) {
    var opt = solve(cand, 'optimal');
    if (!opt || !opt.complete) return null;
    var gps = solve(cand, 'gps');
    var greedy = solve(cand, 'greedy');

    var gpsEval = gps ? evaluatePath(cand, gps.cells) : opt;
    var greedyEval = greedy ? evaluatePath(cand, greedy.cells) : opt;

    var turnSavings = Math.max(0, gpsEval.cost - opt.cost);
    var trafficSavings = Math.max(0, greedyEval.cost - opt.cost);
    var rightRatio = opt.rightTurns - opt.leftTurns * 0.5;
    var lenBonus = Math.min(opt.cells.length, cand.size * 2) * 0.4;

    var quality = turnSavings * 4.5 + trafficSavings * 1.8 + rightRatio * 1.5 + lenBonus;
    return {
      puzzle: {
        size: cand.size,
        mode: cand.mode,
        grid: cand.grid,
        start: cand.start,
        end: cand.end,
        checkpoints: cand.checkpoints,
        optimal: opt,
        gps: gpsEval,
        greedy: greedyEval,
        quality: Math.round(quality * 100) / 100
      },
      quality: quality
    };
  }

  // Time-sliced Searcher (matches MiniGo Searcher.start / step / result contract)
  function Searcher() {
    this.cfg = null;
    this.best = null;
    this.iters = 0;
    this.deadline = 0;
    this.done = true;
  }

  Searcher.prototype.start = function (cfgIn) {
    var cfg = Object.assign({ size: 9, mode: 'standard', ms: 40, iters: 45 }, cfgIn || {});
    this.cfg = cfg;
    this.best = null;
    this.iters = 0;
    var now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.deadline = now + cfg.ms;
    this.done = false;
  };

  Searcher.prototype.step = function (sliceMs) {
    if (this.done) return true;
    var nowFn = typeof performance !== 'undefined' ? function () { return performance.now(); } : Date.now;
    var end = Math.min(nowFn() + (sliceMs || 15), this.deadline);
    var k = 0;
    for (;;) {
      var cand = buildCandidate(this.cfg.size, this.cfg.mode);
      var scored = scoreCandidate(cand);
      if (scored && (!this.best || scored.quality > this.best.quality)) {
        this.best = scored;
      }
      this.iters++;
      if (this.iters >= this.cfg.iters && this.best) {
        this.done = true;
        break;
      }
      if ((++k & 3) === 0 && nowFn() >= end && this.best) break;
      if (this.iters >= this.cfg.iters * 3) {
        this.done = true;
        break;
      }
    }
    if (nowFn() >= this.deadline && this.best) this.done = true;
    return this.done;
  };

  Searcher.prototype.result = function () {
    if (this.best) return this.best.puzzle;
    // Guaranteed fallback open city if all random candidates were blocked
    var N = (this.cfg && this.cfg.size) || 9;
    var grid = new Array(N * N).fill(TILE_ROAD);
    var fallback = {
      size: N,
      mode: (this.cfg && this.cfg.mode) || 'standard',
      grid: grid,
      start: 0,
      end: N * N - 1,
      checkpoints: []
    };
    var opt = solve(fallback, 'optimal');
    fallback.optimal = opt;
    fallback.gps = opt;
    fallback.greedy = opt;
    fallback.quality = 1;
    return fallback;
  };

  function generatePuzzle(cfg) {
    var options = Object.assign({ size: 9, mode: 'standard', iters: 40, ms: 500 }, cfg || {});
    var s = new Searcher();
    s.start(options);
    while (!s.done) {
      s.step(options.ms);
    }
    return s.result();
  }

  return {
    TILE_ROAD: TILE_ROAD,
    TILE_WALL: TILE_WALL,
    TILE_TRAFFIC: TILE_TRAFFIC,
    TILE_GRIDLOCK: TILE_GRIDLOCK,
    TILE_HIGHWAY: TILE_HIGHWAY,
    TILE_COST: TILE_COST,
    MULT_STRAIGHT: MULT_STRAIGHT,
    MULT_RIGHT: MULT_RIGHT,
    MULT_LEFT: MULT_LEFT,
    MULT_UTURN: MULT_UTURN,
    seed: seed,
    useRng: useRng,
    classifyTurn: classifyTurn,
    canStep: canStep,
    solve: solve,
    evaluatePath: evaluatePath,
    applyStep: applyStep,
    validatePath: validatePath,
    generatePuzzle: generatePuzzle,
    Searcher: Searcher
  };
}

export const engine = makeEngine();