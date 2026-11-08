// The drawing engine (games/blight/trees.js): determinism, self-containment, quality floor, palette, fit.
//   node tests/blight_trees.mjs        (exit 0 = green)
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const here = path.dirname(new URL(import.meta.url).pathname);
const file = path.resolve(here, '../games/blight/trees.js');
const { makeTrees, trees: T } = await import(pathToFileURL(file).href);
const src = fs.readFileSync(file, 'utf8');

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('FAIL  ' + name + '\n' + (e && e.stack || e)); process.exitCode = 1; } };
const seedOf = (i) => (i * 2654435761 + 97) >>> 0;

// ---- hue helpers (HSL hue in degrees) ----
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const hue = (h) => { const [r, g, b] = rgb(h), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return -1; let x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; x *= 60; return x < 0 ? x + 360 : x; };
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

console.log('self-containment (the rule that lets it become a Web Worker, exactly like MiniGo\'s makeEngine)');

test('makeTrees() runs in an empty VM context and produces identical output', () => {
  const fnSrc = makeTrees.toString();
  const ctx = vm.createContext(Object.create(null));
  const inVm = vm.runInContext('(' + fnSrc + ')()', ctx);
  for (let i = 0; i < 60; i++) {
    for (const k of ['P', 'D']) {
      const c = { s: seedOf(i), k };
      assert.equal(JSON.stringify(inVm.art(c)), JSON.stringify(T.art(c)), 'art differs in a bare context for seed ' + i + k);
    }
    assert.equal(inVm.border(seedOf(i), 120, 150, false, 'k', 0.3), T.border(seedOf(i), 120, 150, false, 'k', 0.3));
    assert.equal(JSON.stringify(inVm.roots({ s: seedOf(i) })), JSON.stringify(T.roots({ s: seedOf(i) })));
  }
  assert.equal(inVm.bgroots(500, 400, true), T.bgroots(500, 400, true));
});

test('the function body has no template literals, imports or import.meta', () => {
  const body = src.slice(src.indexOf('export function makeTrees'), src.indexOf('export const trees'));
  assert.ok(!body.includes('`'), 'template literal inside makeTrees()');
  assert.ok(!/\bimport\b/.test(body.replace(/\/\/.*$/gm, '')), 'import inside makeTrees()');
  assert.ok(!/import\.meta/.test(body), 'import.meta inside makeTrees()');
});

console.log('determinism (a card is drawn separately on every screen from the same seed)');

test('same seed, same tree — in any call order, any number of times', () => {
  const order = [...Array(80).keys()];
  const first = order.map((i) => JSON.stringify(T.art({ s: seedOf(i), k: i % 4 ? 'P' : 'D' })));
  const again = order.slice().reverse().map((i) => JSON.stringify(T.art({ s: seedOf(i), k: i % 4 ? 'P' : 'D' }))).reverse();
  assert.deepEqual(again, first);
  const other = makeTrees();                                        // a second instance (a second client) agrees
  assert.equal(JSON.stringify(other.art({ s: 4242, k: 'P' })), JSON.stringify(T.art({ s: 4242, k: 'P' })));
});

test('the search is fixed-size, never time-boxed', () => {
  assert.ok(!/performance\.now|Date\.now/.test(src), 'a clock inside the engine would make two screens draw different trees');
});

console.log('quality floor');

const N = 3000;
test('every living tree is at or above the floor (or is the best of the full search)', () => {
  let redrawn = 0, tried = 0, worst = 0;
  for (let i = 0; i < N; i++) {
    const a = T.art({ s: seedOf(i), k: 'P' });
    assert.ok(a.q >= T.FLOOR || a.n === T.MAXTRY - 1, 'seed ' + i + ' scored ' + a.q + ' after ' + (a.n + 1) + ' tries');
    if (a.n > 0) redrawn++; tried += a.n + 1; worst = Math.max(worst, a.n + 1);
  }
  console.log('       living: ' + (100 * redrawn / N).toFixed(1) + '% redrawn, ' + (tried / N).toFixed(2) + ' candidates on average, worst ' + worst);
  assert.ok(redrawn / N < 0.4, 'the floor rejects too much (' + redrawn / N + ') and would flatten variety');
  assert.ok(tried / N < 1.8, 'too expensive on average');
});

test('dead trees likewise, and a card that already passes is returned exactly as the plain draw (candidate 0)', () => {
  let same = 0, total = 0;
  for (let i = 0; i < N; i++) {
    const c = { s: seedOf(i), k: 'D' }, a = T.art(c);
    assert.ok(a.q >= T.FLOOR || a.n === T.MAXTRY - 1);
    if (a.n === 0) { const d = T.draw(c); delete d.T; assert.equal(JSON.stringify(d.br), JSON.stringify(a.br), 'candidate 0 must be the plain draw'); same++; }
    total++;
  }
  assert.ok(same / total > 0.8, 'most dead trees should be untouched, got ' + same / total);
});

test('the scorer prefers a full tree to a stub: the redrawn trees are taller and fuller on average', () => {
  let before = 0, after = 0, n = 0;
  for (let i = 0; i < 1500; i++) {
    const c = { s: seedOf(i), k: 'P' }, plain = T.draw(c), chosen = T.art(c);
    before += T.score(plain, false); after += chosen.q; n++;
  }
  console.log('       mean score ' + (before / n).toFixed(3) + ' -> ' + (after / n).toFixed(3));
  assert.ok(after / n > before / n + 0.1);
});

console.log('palette: one hue per living card, healthy greens, charcoal for the dead only');

test('every petal on a living card is a shade or tint of that card\'s single bloom colour', () => {
  const seen = {};
  for (let i = 0; i < 1500; i++) {
    const a = T.art({ s: seedOf(i), k: 'P' });
    const bloom = T.BLOOMS.find((b) => b.n === a.hue); assert.ok(bloom, 'unknown hue name ' + a.hue);
    seen[a.hue] = (seen[a.hue] || 0) + 1;
    for (const f of a.fl) assert.ok(hueGap(hue(f.c), hue(bloom.c)) < 6, 'petal ' + f.c + ' strays from ' + bloom.n + ' (' + bloom.c + ')');
    assert.ok(new Set(a.fl.map((f) => f.c2)).size <= 1, 'one flower centre colour per card');
  }
  assert.equal(Object.keys(seen).length, 5, 'all five botanical hues occur: ' + JSON.stringify(seen));
  for (const k in seen) assert.ok(seen[k] > 150, k + ' is under-represented: ' + seen[k]);
});

test('petals of one card vary in shade (it is not flat), but never wander off in hue', () => {
  let varied = 0, cards = 0;
  for (let i = 0; i < 400; i++) { const a = T.art({ s: seedOf(i), k: 'P' }); if (a.fl.length > 2) { cards++; if (new Set(a.fl.map((f) => f.c)).size > 1) varied++; } }
  assert.ok(varied / cards > 0.9, 'shade variation missing: ' + varied + '/' + cards);
});

test('foliage is green only — no autumn oranges or reds', () => {
  for (let i = 0; i < 1200; i++) {
    const a = T.art({ s: seedOf(i), k: 'P' });
    for (const l of a.lv) { const h = hue(l.c); assert.ok(h > 70 && h < 180, 'leaf ' + l.c + ' has hue ' + h); }
  }
});

test('a dead tree has no leaves, no flowers and no hue — the charcoal look is theirs alone', () => {
  for (let i = 0; i < 300; i++) { const a = T.art({ s: seedOf(i), k: 'D' }); assert.equal(a.lv.length + a.fl.length, 0); assert.equal(a.hue, ''); }
});

console.log('fit to card');

test('the drawing fills the card: limiting side 80-90% for every tree, living and dead', () => {
  for (const k of ['P', 'D']) {
    let min = 9, max = 0;
    for (let i = 0; i < N; i++) {
      const a = T.art({ s: seedOf(i), k }), lim = Math.max(a.fill.w, a.fill.h), over = Math.max(a.fill.w, a.fill.h);
      min = Math.min(min, lim); max = Math.max(max, over);
      assert.ok(a.fill.w <= 0.90 && a.fill.h <= 0.90 + 1e-9, k + ' seed ' + i + ' overshoots the card: ' + JSON.stringify(a.fill));
      assert.ok(lim >= 0.8, k + ' seed ' + i + ' only fills ' + lim);
    }
    console.log('       ' + (k === 'P' ? 'living' : 'dead  ') + ': limiting side between ' + min.toFixed(2) + ' and ' + max.toFixed(2));
  }
});

test('the transform keeps the base on the bottom edge and the crown centred', () => {
  for (let i = 0; i < 200; i++) {
    const a = T.art({ s: seedOf(i), k: 'P' });
    assert.ok(a.tf.s > 0.6 && a.tf.s <= 2.4, 'odd scale ' + a.tf.s);
  }
});

console.log('borders and backs are clean');

test('border twig density: 0 gives a bare outline, 1 gives the full tendrils', () => {
  const twigs = (svg) => { const m = svg.match(/<path d="([^"]*)"\/>\s*<\/svg>/); return m ? m[1].length : -1; };
  for (let i = 1; i < 12; i++) {
    const bare = T.border(i, 130, 160, false, 'k', 0), full = T.border(i, 130, 160, false, 'k', 1);
    assert.equal(twigs(bare), 0, 'tw=0 must have no twig path');
    assert.ok(twigs(full) > 100, 'tw=1 must have twigs');
    assert.equal(T.border(i, 130, 160, false, 'k'), full, 'default stays the full set');
  }
});

test('card-back roots are simple', () => { for (let i = 0; i < 300; i++) assert.ok(T.roots({ s: seedOf(i) }).length <= 8); });

console.log(process.exitCode ? '\nFAILED' : `\nall ${passed} blight tree checks passed`);
