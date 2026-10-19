// Clicker rules. A node harness, no browser: it drives the shipped module
// exactly as the hub does — init -> reduce -> project — because every bug that
// ever stopped this board from starting was in that seam.
import assert from 'node:assert/strict';
import * as clicker from '../games/clicker/index.js';

// A fixed rng so a deal is reproducible and a failure is readable.
function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ME = { id: 'p1', name: 'Alice', host: true };
const ctx = { atTable: [ME], seats: [ME], rng: seeded(7) };
const act = { from: { id: 'p1', host: true }, rng: seeded(11) };

// Play one level the honest way — every button in the queue, in order — and
// return the state after it. Reading `queue` is what the test is allowed to do;
// a real client only ever sees colours.
function playLevel(st, c) {
  // The bound is captured up front: clearing a level deals a NEW, longer queue,
  // so re-reading st.queue.length would walk straight into the next level.
  const n = st.queue.length;
  for (let i = st.step; i < n; i++) {
    st = clicker.reduce(st, { a: 'hit', cell: st.queue[i] }, c || act);
    if (st.error) throw new Error('playLevel hit a denial: ' + st.error);
  }
  return st;
}

let ok = 0;
function check(name, fn) {
  fn();
  console.log('  ok   ' + name);
  ok++;
}

// ------------------------------------------------- the contract itself ----

check('exports every function the module contract requires', () => {
  ['init', 'reduce', 'project', 'mount', 'summarize', 'roundId'].forEach(function (k) {
    assert.equal(typeof clicker[k], 'function', k + ' must be an exported function');
  });
  assert.equal(typeof clicker.meta, 'object', 'meta is an exported object');
  assert.ok(clicker.meta.id, 'meta.id is required');
});

check('meta.id matches the folder name and is solo-only', () => {
  assert.equal(clicker.meta.id, 'clicker');
  assert.equal(clicker.meta.solo, true);
  assert.equal(clicker.meta.soloable, undefined);
  assert.equal(clicker.meta.players, 'solo');
  assert.ok(clicker.meta.desc && clicker.meta.desc.length > 10, 'desc is the button tooltip');
});

// ---------------------------------------------------------------- init ----

check('init seats one player from atTable and skips spectators', () => {
  const st = clicker.init({
    atTable: [ME, { id: 'ghost', name: 'Watcher', spectator: true }],
    seats: [ME, { id: 'lobby', name: 'Lobby' }],
    rng: seeded(3)
  });
  assert.deepEqual(st.players, ['p1'], 'a spectator and the lobby must not be seated');
  assert.equal(st.level, 1);
  assert.equal(st.score, 0);
  assert.equal(st.step, 0);
});

check('init deals one cell at level 1', () => {
  const st = clicker.init(ctx);
  assert.equal(st.queue.length, 1, 'level 1 is exactly one button');
  const c = st.queue[0];
  assert.ok(Number.isInteger(c) && c >= 0 && c < 81, 'a cell index on the 9x9 board');
});

// -------------------------------------------------------------- reduce ----

check('level 1 scores a point on one click and grows the board', () => {
  const st = clicker.init(ctx);
  const out = clicker.reduce(st, { a: 'hit', cell: st.queue[0] }, act);
  assert.notEqual(out, st, 'reduce must return a new state, not the old one');
  assert.equal(out.score, 1);
  assert.equal(out.level, 2);
  assert.equal(out.step, 0);
  assert.equal(out.queue.length, 2, 'one more button every level');
  assert.equal(new Set(out.queue).size, 2, 'buttons never stack on one cell');
});

check('the queue is dealt in random order, so red is not always the first cell', () => {
  let sawDifferent = false;
  for (let seed = 1; seed <= 25 && !sawDifferent; seed++) {
    const st = clicker.init({ atTable: [ME], rng: seeded(seed) });
    const out = clicker.reduce(st, { a: 'hit', cell: st.queue[0] },
      { from: { id: 'p1' }, rng: seeded(seed + 500) });
    // If the new button were always dealt first the red one would never move.
    if (out.queue[1] !== out.queue[0]) sawDifferent = true;
  }
  assert.ok(sawDifferent, 'the added button must land somewhere random in the queue');
});

check('a hit on a blue cell is refused and does not advance the step', () => {
  const st = clicker.init(ctx);
  const wrong = (st.queue[0] + 1) % 81;
  const out = clicker.reduce(st, { a: 'hit', cell: wrong }, act);
  assert.ok(out.error, 'a wrong click must be a denial, not a silent no-op');
  assert.equal(out.step, undefined, 'a denial is { error }, not a mutated state');
  assert.equal(clicker.project(st, 'p1').step, 0, 'the step on screen is untouched');
});

check('cells off the board are refused', () => {
  const st = clicker.init(ctx);
  [-1, 81, NaN, 'x'].forEach(function (cell) {
    assert.ok(clicker.reduce(st, { a: 'hit', cell: cell }, act).error,
      'cell ' + cell + ' must be refused');
  });
});

check('the queue must be cleared in order, and each step moves red along', () => {
  let st = clicker.init(ctx);
  // Climb to a five-button level so the red -> orange -> blue ladder is real.
  for (let lvl = 1; lvl < 5; lvl++) st = playLevel(st);
  assert.equal(st.level, 5);
  assert.equal(st.queue.length, 5);

  st = clicker.reduce(st, { a: 'hit', cell: st.queue[0] }, act);
  assert.equal(st.level, 5, 'not cleared yet, so the level holds');
  assert.equal(st.score, 4);
  assert.equal(st.step, 1);

  // The cell that was orange is now the one owed.
  assert.equal(st.queue[st.step], st.queue[1]);
});

check('an unknown action is refused rather than ignored', () => {
  const st = clicker.init(ctx);
  assert.ok(clicker.reduce(st, { a: 'nonsense' }, act).error);
  assert.ok(clicker.reduce(st, {}, act).error);
});

check('reduce never mutates the state it was given', () => {
  const st = clicker.init(ctx);
  const before = JSON.stringify(st);
  clicker.reduce(st, { a: 'hit', cell: st.queue[0] }, act);
  assert.equal(JSON.stringify(st), before, 'the previous state may already be in project()');
});

check('an unseated player is refused', () => {
  const st = clicker.init(ctx);
  const out = clicker.reduce(st, { a: 'hit', cell: st.queue[0] },
    { from: { id: 'stranger' }, rng: Math.random });
  assert.ok(out.error);
  assert.ok(/watching|seated/i.test(out.error), 'the refusal has to say why: ' + out.error);
});

check('the board fills at level 81 and stays legal', () => {
  let st = clicker.init(ctx);
  while (st.level < 81) st = playLevel(st);
  assert.equal(st.level, 81);
  assert.equal(st.queue.length, 81);
  assert.equal(new Set(st.queue).size, 81, 'all 81 cells, no duplicates');
  st = clicker.reduce(st, { a: 'hit', cell: st.queue[0] }, act);
  assert.equal(st.level, 81, 'a full board cannot grow');
  assert.equal(st.queue.length, 81);
  assert.equal(st.score, 80);
});

// ------------------------------------------------------------- project ----

check('project paints exactly one red and one orange, and never leaks the queue', () => {
  let st = clicker.init(ctx);
  while (st.level < 4) st = playLevel(st);

  let view = clicker.project(st, 'p1');
  assert.equal(view.cells.length, 4);
  assert.equal(view.cells.filter(function (c) { return c.colour === 'red'; }).length, 1,
    'one button is owed a click');
  assert.equal(view.cells.filter(function (c) { return c.colour === 'orange'; }).length, 1,
    'one button is queued after it');
  assert.equal(view.cells.filter(function (c) { return c.colour === 'blue'; }).length, 2);
  assert.equal(view.queue, undefined, 'the view must not carry the hidden order');
  assert.equal(view.step, 0);
  assert.equal(view.total, 4);

  // Click the red one: it goes blue, the orange one becomes red, and the old
  // red is marked done.
  const red = view.cells.find(function (c) { return c.colour === 'red'; });
  st = clicker.reduce(st, { a: 'hit', cell: red.row * 9 + red.col }, act);
  view = clicker.project(st, 'p1');
  const done = view.cells.filter(function (c) { return c.done; });
  assert.equal(done.length, 1);
  assert.equal(view.cells.filter(function (c) { return c.colour === 'red'; }).length, 1);
  assert.equal(view.cells.filter(function (c) { return c.colour === 'orange'; }).length, 1);
});

check('the ladder walks all the way down, one click at a time', () => {
  // The regression this guards: colours were computed from the queue's own
  // index instead of the index minus `step`, so after the first click of a
  // five-button level NOTHING was red any more and the level could not be
  // finished. Only the last click is a level completion, so the whole ladder
  // has to be walked to see it.
  let st = clicker.init(ctx);
  while (st.level < 5) st = playLevel(st);
  assert.equal(st.queue.length, 5);

  for (let i = 0; i < 5; i++) {
    const view = clicker.project(st, 'p1');
    const red = view.cells.filter(function (c) { return c.colour === 'red'; });
    assert.equal(red.length, 1, 'exactly one red at step ' + view.step);
    const orange = view.cells.filter(function (c) { return c.colour === 'orange'; });
    assert.equal(orange.length, i === 4 ? 0 : 1, 'one orange until the queue runs out');
    assert.equal(view.cells.filter(function (c) { return !c.done; }).length, 5 - i);

    st = clicker.reduce(st, { a: 'hit', cell: red[0].row * 9 + red[0].col }, act);
    if (st.error) throw new Error('step ' + i + ' was denied: ' + st.error);
  }
  assert.equal(st.level, 6, 'clearing all five advanced the level');
  assert.equal(st.score, 5);
});

check('every projected cell sits on the 9x9 board', () => {
  let st = clicker.init(ctx);
  for (let i = 0; i < 6; i++) st = playLevel(st);
  clicker.project(st, 'p1').cells.forEach(function (c) {
    assert.ok(c.col >= 0 && c.col < 9, 'col in range: ' + c.col);
    assert.ok(c.row >= 0 && c.row < 9, 'row in range: ' + c.row);
    assert.ok(['red', 'orange', 'blue'].indexOf(c.colour) >= 0, 'colour is one of three');
  });
});

// -------------------------------------------------------------- record ----

check('a run is recorded when it is reset, and not before', () => {
  let st = clicker.init(ctx);
  assert.equal(clicker.summarize(st, (id) => 'Alice'), null, 'nothing while still playing');

  while (st.level < 3) st = playLevel(st);
  assert.equal(clicker.summarize(st, (id) => 'Alice'), null);

  const ended = clicker.reduce(st, { a: 'reset' }, act);
  const line = clicker.summarize(ended, (id) => 'Alice');
  assert.equal(line, 'Alice scored 2 points in Clicker, reaching level 3');
  assert.equal(ended.run, st.run + 1, 'the round id moves with the run');
  assert.equal(clicker.roundId(ended), 'run' + (st.run + 1));

  const next = clicker.reduce(ended, { a: 'hit', cell: ended.queue[0] }, act);
  assert.equal(clicker.summarize(next, (id) => 'Alice'), null,
    'the finished run stops being reported once the next one starts');
});

check('one point is singular and a zero run is not recorded', () => {
  const one = clicker.reduce(playLevel(clicker.init(ctx)), { a: 'reset' }, act);
  assert.equal(clicker.summarize(one, () => 'Bo'), 'Bo scored 1 point in Clicker, reaching level 2');

  const two = clicker.reduce(playLevel(playLevel(clicker.init(ctx))), { a: 'reset' }, act);
  assert.equal(clicker.summarize(two, () => 'Bo'), 'Bo scored 2 points in Clicker, reaching level 3');

  const fresh = clicker.init(ctx);
  assert.equal(clicker.summarize(clicker.reduce(fresh, { a: 'reset' }, act), () => 'Bo'), null,
    'scoring nothing is not a run');
});

console.log('\nALL GREEN (' + ok + ' checks)');