#!/usr/bin/env python3
"""Rule and projection tests for games/cule/index.js."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "cule" / "index.js"

NODE_SCRIPT = r"""
import * as cule from './games/cule/index.js';
import assert from 'node:assert/strict';

// 1. Meta & init
assert.equal(cule.meta.id, 'cule');
assert.equal(cule.meta.players.min, 4);
assert.equal(cule.meta.soloable, false);

let seed = 1;
const rng = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const ctx3 = {
  atTable: [
    { id: 'p1', name: 'Ann' },
    { id: 'p2', name: 'Bo' },
    { id: 'p3', name: 'Cy' }
  ],
  rng
};
let st = cule.init(ctx3);
assert.equal(st.players.length, 3);
assert.equal(st.murdererId, null);

// Minimum 4 players enforced
let res = cule.reduce(st, { a: 'startDark' }, { from: { id: 'p1', host: true }, rng });
assert.ok(res.error, 'startDark must reject with < 4 players');

// 4th player joins -> murdererId assigned
st = cule.reduce(st, { a: 'join' }, { from: { id: 'p4', host: false }, rng });
assert.equal(st.players.length, 4);
assert.ok(st.murdererId, 'murdererId assigned once 4 players are seated');

// Project in hallway hides murdererId from innocents
const innocentId = st.players.find(id => id !== st.murdererId);
assert.equal(cule.project(st, innocentId).murdererId, null);
assert.equal(cule.project(st, st.murdererId).murdererId, st.murdererId);

// Cut the lights -> dark phase anonymizes other sprites
st = cule.reduce(st, { a: 'startDark' }, { from: { id: 'p1', host: true }, rng });
assert.equal(st.phase, 'dark');
const darkView = cule.project(st, 'p1');
assert.equal(darkView.sprites['p1'].anon, false);
assert.equal(darkView.sprites['p2'].anon, true);

// Lights on -> alibi phase builds roomPoly & isolates privateChat
st = cule.reduce(st, { a: 'lightsOn' }, { from: { id: 'p1', host: true }, rng });
assert.equal(st.phase, 'alibi');
assert.equal(st.spotlightPair.length, 2);
assert.equal(st.roomPoly.length, 4);

const [spotA, spotB] = st.spotlightPair;
const outsider = st.players.find(id => !st.spotlightPair.includes(id));

st = cule.reduce(st, { a: 'pairChat', t: 'secret plan' }, { from: { id: spotA }, rng });
assert.equal(cule.project(st, spotB).privateChat.length, 1);
assert.equal(cule.project(st, outsider).privateChat, null);
assert.equal(cule.project(st, outsider).trueEmojis, null);

// Submit alibi & outside players vote
st = cule.reduce(st, { a: 'submitAlibi', t: 'We were polishing the 🎷!' }, { from: { id: spotA }, rng });
assert.equal(st.phase, 'vote');

const outsiders = st.players.filter(id => !st.spotlightPair.includes(id));
for (const oid of outsiders) {
  st = cule.reduce(st, { a: 'vote', v: 'lie' }, { from: { id: oid }, rng });
}
assert.equal(st.phase, 'reveal');
const summary = cule.summarize(st, id => id.toUpperCase());
assert.ok(summary && summary.includes('Cule'), 'summarize produces a Cule record sentence');
console.log('cule_test: OK');
"""

def main():
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", NODE_SCRIPT],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        sys.exit(1)
    print(proc.stdout.strip())

if __name__ == "__main__":
    main()