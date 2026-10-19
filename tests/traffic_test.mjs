import vm from 'node:vm';
import assert from 'node:assert/strict';
import { makeEngine } from '../games/TRAFFIC/engine.js';
import * as traffic from '../games/TRAFFIC/index.js';

// 1. Prove makeEngine() is 100% self-contained in a bare VM context (Worker-ready)
const isolatedEngine = vm.runInNewContext('(' + makeEngine.toString() + ')()');
isolatedEngine.seed(42);
const puz = isolatedEngine.generatePuzzle({ size: 9, mode: 'standard', iters: 25 });
assert.equal(puz.size, 9);
assert.ok(puz.optimal && puz.optimal.complete, 'Optimal route must be solvable');
assert.ok(puz.gps && puz.gps.cost >= puz.optimal.cost, 'Turn-aware optimal must beat or tie turn-blind GPS');

// 2. Verify BubHub v10 module contract (init -> reduce -> project -> prune -> summarize)
let st = traffic.init({
  atTable: [{ id: 'p1', name: 'Alice', host: true }, { id: 'p2', name: 'Bob', host: false }],
  rng: () => 0.42
});

// Project must hide optimal solution and peer coordinates while playing
const viewP1 = traffic.project(st, 'p1');
assert.equal(viewP1.puzzle.optimal, null, 'Optimal route must be hidden during play');

// Submit p1 using the optimal cells
st = traffic.reduce(st, { a: 'setPath', cells: st.puzzle.optimal.cells }, { from: { id: 'p1', host: true } });
st = traffic.reduce(st, { a: 'submit' }, { from: { id: 'p1', host: true } });
assert.equal(st.phase, 'playing', 'Round waits for p2');

// If p2 disconnects, prune() removes p2 and finishes the round automatically
st = traffic.prune(st, 'p2');
assert.equal(st.phase, 'over', 'Round completes when remaining seated players have submitted');
assert.equal(traffic.summarize(st, (id) => (id === 'p1' ? 'Alice' : id)), 'Alice cleared TRAFFIC at 100% efficiency');

// 3. REGRESSION: delivery routes may revisit a tile.
// validatePath used to reject any repeated tile, but the solver searches
// (cell, direction, checkpointMask) — collecting several packages often means
// doubling back through a junction. The ban made the engine reject its own
// solution and left ~85% of delivery maps unwinnable, because the player's only
// way to submit is a route that passes the same check.
{
  const E = makeEngine();
  let checked = 0, looped = 0;
  for (const size of [7, 9, 11]) {
    for (let s = 0; s < 60; s++) {
      E.seed(s * 104729 + size * 13);
      const p = E.generatePuzzle({ size, mode: 'delivery', iters: 40 });
      checked++;
      const cells = p.optimal.cells;
      if (new Set(cells).size !== cells.length) looped++;
      const v = E.validatePath(p, cells);
      assert.ok(!v.err, `solver's own optimal must validate (size ${size} seed ${s}): ${v.err}`);
      assert.ok(p.optimal.hitAllCheckpoints, 'optimal collects every package');
      assert.ok(p.optimal.complete, 'optimal reaches the end');
      assert.ok(p.gps.cost >= p.optimal.cost - 1e-9, 'turn-aware optimal never costs more than turn-blind GPS');
    }
  }
  // If the solver ever stops needing revisits this still passes; if it does need
  // them and someone reinstates the ban, the assert above fires first. This is
  // here so the count is visible when that happens.
  assert.ok(checked === 180, `expected 180 generated delivery maps, got ${checked}`);
  console.log(`  delivery: ${looped}/${checked} optimal routes revisit a tile (all still valid)`);
}

// 4. The id must match the folder name, case included. The registry test keys
// MENU_ORDER off games/*/index.js directory names, so a mismatch here fails the
// whole suite for a reason that looks nothing like a casing problem.
assert.equal(traffic.meta.id, 'TRAFFIC', 'meta.id matches the games/TRAFFIC folder');

console.log('TRAFFIC engine + module tests passed!');