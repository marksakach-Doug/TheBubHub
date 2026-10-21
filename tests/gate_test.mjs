// The gate's own test.
//
// A gate nobody has tried to fool is a gate with an unknown number of holes.
// So: six deliberately broken games, each one a real mistake someone actually
// made, and each one has to fail on the check that owns it — with a message
// that says what to do, not just what broke.
//
// If you add a check to scripts/check-game.mjs, add a fixture here too. A check
// with no broken example is a check nobody has proved fires.

import fs from 'node:fs';
import path from 'node:path';
import { checkOne, GATE_ROOT } from '../scripts/check-game.mjs';

// The fixtures live under a `games/` level so the gate reads them with exactly
// the same path logic it uses for a real game — no special case in the gate.
const FIX = path.join(GATE_ROOT, 'tests', 'gate_fixtures');

// [fixture, the check that must catch it, a word the message has to contain]
// The word matters as much as the check: a message that says "reduce() threw"
// and stops is not something a weak model can act on. These are the words a
// builder reads to know what to type next.
const CASES = [
  ['no-export', 'exports', 'export'],
  ['throws-on-junk', 'junk-actions', 'never throw'],
  ['set-in-state', 'json-safe', 'JSON'],
  ['innerhtml', 'banned-apis', 'textContent'],
  ['wrong-id-case', 'meta.id', 'match'],
  ['escapes-folder', 'own-folder', 'own folder']
];

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`FAIL  ${name}${detail ? '\n        ' + detail : ''}`); fail++; }
}

console.log('=== gate fixtures — six broken games, each must fail on its own check ===');

for (const [id, wantCheck, wantWord] of CASES) {
  const dir = path.join(FIX, 'games', id);
  if (!fs.existsSync(dir)) { ok(`${id} fixture exists`, false, `missing ${dir}`); continue; }

  const { failures, fatal } = await checkOne(id, FIX);

  ok(`${id}: fails`, !fatal && failures.length > 0, fatal || 'it PASSED — the gate has a hole');

  const hit = failures.find((f) => f.id === wantCheck);
  ok(`${id}: caught by "${wantCheck}"`,
    !!hit,
    hit ? '' : `failures were: ${failures.map((f) => f.id).join(', ') || '(none)'}`);

  if (hit) {
    ok(`${id}: message says what to do ("${wantWord}")`,
      (hit.fix || '').toLowerCase().includes(wantWord.toLowerCase()),
      `message was:\n${(hit.fix || '').split('\n').map((l) => '          ' + l).join('\n')}`);
  }
}

// The real thing must still pass, or the six fixtures prove nothing.
// The reference starter used to live at games/nim. When it is not there,
// any game with a card will do: the point of this check is that a REAL game
// passes the gate, not that one particular folder does.
console.log('');
console.log('=== the reference starter must still pass ===');
const gamesDir = path.join(GATE_ROOT, 'games');
const hasNim = fs.existsSync(path.join(gamesDir, 'nim', 'index.js'));
const ref = hasNim ? 'nim' : fs.readdirSync(gamesDir).find((d) =>
  fs.existsSync(path.join(gamesDir, d, 'scenarios.json')) &&
  fs.existsSync(path.join(gamesDir, d, 'index.js')));
if (!ref) {
  ok('a real game passes the gate', false, 'there is no game with a card to check');
} else {
  const real = await checkOne(ref, GATE_ROOT);
  ok(`${ref} passes the gate`, !real.fatal && real.failures.length === 0,
    real.fatal || real.failures.map((f) => `${f.id}: ${f.fix.split('\n')[0]}`).join('\n'));
}

// And a game that is not a game at all must fail, not crash the gate.
console.log('');
console.log('=== the gate must not crash on nonsense ===');
const noCard = await checkOne('definitely-not-a-game', FIX);
ok('an unknown id is refused, not crashed', !!noCard.fatal && noCard.fatal.includes('no card'));

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);