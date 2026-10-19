// One shared suite for every game that has a card.
//
// This exists so that adding a game touches nothing. `test.sh` runs this once;
// it finds every games/<id>/scenarios.json and runs the same gate over it. A new
// game is two files and no edit to a suite table — and no test file that can be
// silently forgotten, which is exactly how `tests/chess_play.py` ended up
// unwired for a year.

import fs from 'node:fs';
import path from 'node:path';
import { checkOne, GATE_ROOT } from '../scripts/check-game.mjs';

const GAMES = path.join(GATE_ROOT, 'games');

function cards() {
  if (!fs.existsSync(GAMES)) return [];
  return fs.readdirSync(GAMES)
    .filter((d) => fs.existsSync(path.join(GAMES, d, 'scenarios.json')))
    .sort();
}

const ids = cards();
console.log(`game scenarios — ${ids.length} card(s): ${ids.join(', ') || '(none yet)'}`);

if (!ids.length) {
  // Not a failure: a fresh repo legitimately has no cards yet, and failing here
  // would mean test.sh is red before anybody has written anything. The gate's
  // own fixture suite is what proves the machinery works.
  console.log('  no cards yet — nothing to replay');
  process.exit(0);
}

let failed = 0;

for (const id of ids) {
  // A card is not a test file: it is the SPEC. So before replaying it, insist
  // that it is a spec a stranger could actually check — a card nobody reads
  // cannot catch a wrong rule, it can only be satisfied.
  const card = JSON.parse(fs.readFileSync(path.join(GAMES, id, 'scenarios.json'), 'utf8'));
  const notes = [];
  if (!Array.isArray(card.scenarios) || card.scenarios.length < 2) {
    notes.push('needs at least two scenarios');
  }
  const finished = (card.scenarios || []).filter((s) => s.expect && typeof s.expect.summarize === 'string');
  if (!finished.length) notes.push('needs one scenario that ends the game, or summarize() is never tested');
  const refuses = (card.scenarios || []).filter((s) => s.expect && s.expect.error);
  if (!refuses.length) notes.push('needs one scenario that expects a refusal, or validation is never tested');
  if (!card.rules) notes.push('has no "rules" field, so a reader cannot tell what it is supposed to build');
  // Any id a card names must exist, or the expectations are about nobody.
  const roster = card.roster || [];
  for (const sc of card.scenarios || []) {
    for (const step of sc.steps || []) {
      if (step.as && !roster.some((r) => r.id === step.as)) {
        notes.push(`scenario "${sc.name}" has a step by "${step.as}", who is not in the roster`);
      }
    }
  }

  if (notes.length) {
    console.log(`FAIL  ${id} — the card itself is not a usable spec:`);
    notes.forEach((n) => console.log(`        · ${n}`));
    failed++;
    continue;
  }

  const { failures, fatal } = await checkOne(id, GATE_ROOT);
  if (fatal) {
    console.log(`FAIL  ${id} — ${fatal}`);
    failed++;
    continue;
  }
  if (failures.length) {
    console.log(`FAIL  ${id}`);
    console.log('');
    failures.forEach((f) => {
      console.log(`  ✗ ${f.id} — ${f.title}`);
      f.fix.split('\n').forEach((l) => console.log('    ' + (l.startsWith('    ') ? l.slice(4) : l)));
      console.log('');
    });
    failed++;
  } else {
    console.log(`  ok   ${id} — ${card.scenarios.length} scenarios`);
  }
}

if (failed) {
  console.log(`\n${failed} of ${ids.length} game(s) failed.`);
  process.exit(1);
}
console.log(`\nall ${ids.length} game(s) pass`);