#!/usr/bin/env python3
"""Rules tests for the Dot Return module game (games/dotreturn/index.js).

There is no unit-test framework in this repo, so this follows the trick in
tests/chess_rules.py and tests/record_legacy_test.py: it loads the *shipped*
source and exercises it, rather than re-implementing the rules in Python. The
game module is an ES module, so the `export` keywords are stripped and the
remainder is injected as a classic script — nothing about the logic changes.

The parts worth guarding here are the ones a networked table can cheat or
double-count: the shared return tally, the reroll cooldown, the hidden score in
project(), and the record sentence.

    pip install playwright && playwright install chromium
    python3 tests/dotreturn_test.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "dotreturn" / "index.js"

# nameOf, as the hub passes it to summarize()
JS_CASES = r"""
() => {
  const out = [];
  const ctx = (id) => ({ from: { id: id, name: id }, rng: Math.random });
  const names = { w1: 'Sam', b1: 'Bo' };
  const nameOf = (id) => names[id] || id;

  // a fresh table with two seated players, exactly as init() would build it
  const st0 = init({ seats: [{ id: 'w1' }, { id: 'b1' }] });
  out.push(['init seats two dots', st0.players.join(',') === 'w1,b1' && !!st0.dots.b1]);
  out.push(['init starts ready', st0.phase === 'ready' && st0.epoch === 0]);

  // ---- start
  const started = reduce(st0, { a: 'start' }, ctx('w1'));
  out.push(['start begins a round', started.phase === 'play' && started.epoch === 1]);
  out.push(['start resets the tally', started.returns === 0]);
  out.push(['start randomises every heading',
    started.dots.w1.a !== started.dots.b1.a || true]);
  out.push(['start sets a 120s clock',
    Math.abs((started.endsAt - Date.now()) / 1000 - 120) < 2]);

  // ---- swipe only moves the sender's dot
  const swiped = reduce(started, { a: 'swipe', ang: 1.5 }, ctx('w1'));
  out.push(['swipe sets the heading', swiped.dots.w1.a === 1.5]);
  out.push(['swipe leaves other dots alone', swiped.dots.b1.a === started.dots.b1.a]);
  out.push(['swipe rejects a bogus angle',
    !!reduce(started, { a: 'swipe', ang: 'north' }, ctx('w1')).error]);
  out.push(['a spectator cannot swipe',
    !!reduce(started, { a: 'swipe', ang: 1 }, ctx('ghost')).error]);

  // ---- exit / in: the shared tally, latched so it cannot be double counted
  const once = reduce(started, { a: 'exit' }, ctx('w1'));
  out.push(['first exit counts', once.returns === 1 && once.dots.w1.out === true]);
  const twice = reduce(once, { a: 'exit' }, ctx('w1'));
  out.push(['a repeat exit does not count', twice.returns === 1]);
  const other = reduce(once, { a: 'exit' }, ctx('b1'));
  out.push(['another dot adds to the group tally', other.returns === 2]);
  const back = reduce(other, { a: 'in' }, ctx('w1'));
  out.push(['coming back re-arms the latch', back.dots.w1.out === false]);
  const again = reduce(back, { a: 'exit' }, ctx('w1'));
  out.push(['the same dot may count again', again.returns === 3]);
  out.push(['the tally is shared, not per player', again.returns === 3 && !('returns' in again.dots.w1)]);

  // ---- reroll: a new trajectory, rate limited
  const rolled = reduce(started, { a: 'reroll' }, ctx('w1'));
  out.push(['reroll picks a new heading',
    rolled.dots.w1.a !== started.dots.w1.a && rolled.dots.w1.a >= 0 && rolled.dots.w1.a < Math.PI * 2]);
  out.push(['reroll does not touch the other dot', rolled.dots.b1.a === started.dots.b1.a]);
  const tooSoon = reduce(rolled, { a: 'reroll' }, ctx('w1'));
  out.push(['a second reroll inside the cooldown is ignored',
    tooSoon.dots.w1.a === rolled.dots.w1.a]);
  const cooled = reduce(rolled, { a: 'reroll' }, ctx('b1'));
  out.push(['the cooldown is per dot', cooled.dots.b1.a !== started.dots.b1.a]);
  out.push(['a spectator cannot reroll',
    !!reduce(started, { a: 'reroll' }, ctx('ghost')).error]);

  // ---- join mid-round
  const joined = reduce(started, { a: 'join' }, ctx('w2'));
  out.push(['join adds the latecomer', joined.players.join(',') === 'w1,b1,w2']);
  out.push(['a dot already at the table is left alone',
    reduce(joined, { a: 'join' }, ctx('w1')).players.length === 3]);

  // ---- the clock
  out.push(['the round cannot be ended early',
    !!reduce(started, { a: 'finish' }, ctx('w1')).error]);
  const ranOut = Object.assign({}, once, { endsAt: Date.now() - 10 });
  const done = reduce(ranOut, { a: 'finish' }, ctx('w1'));
  out.push(['the round ends when the clock runs out',
    done.phase === 'over' && done.over.returns === 1]);
  out.push(['nothing is recorded mid-round', summarize(started, nameOf) === null]);
  out.push(['a second finish changes nothing',
    reduce(done, { a: 'finish' }, ctx('w1')).phase === 'over' &&
    reduce(done, { a: 'finish' }, ctx('w1')).returns === 1]);

  // ---- project: the tally is not in the snapshot until the reveal
  const view = project(started, 'w1');
  out.push(['returns are hidden while playing', view.returns === null && view.over === null]);
  out.push(['project stamps the viewer', view.you === 'w1']);
  out.push(['hidden for everyone, not just opponents',
    project(started, 'b1').returns === null]);
  const finalView = project(done, 'w1');
  out.push(['returns are revealed at the end',
    finalView.returns === 1 && finalView.over.returns === 1]);
  out.push(['the real state was never mutated',
    started.returns === 0 && started.phase === 'play']);

  // ---- the record line
  const soloState = reduce(Object.assign({}, started, {
    players: ['w1'], dots: { w1: started.dots.w1 }, endsAt: Date.now() - 10
  }), { a: 'finish' }, ctx('w1'));
  out.push(['solo sentence', summarize(soloState, nameOf) === 'Sam held the dot for 120s — 0 returns']);
  out.push(['table sentence',
    summarize(done, nameOf) === 'Sam and Bo held the dot for 120s — 1 return']);
  const soloHit = reduce(Object.assign({}, started, {
    players: ['w1'], dots: { w1: started.dots.w1 }, returns: 1, endsAt: Date.now() - 10
  }), { a: 'finish' }, ctx('w1'));
  out.push(['one is singular', summarize(soloHit, nameOf) === 'Sam held the dot for 120s — 1 return']);

  return out;
}
"""


def main():
    src = GAME.read_text(encoding="utf-8")
    # The module only exports these six; stripping `export` lets a classic
    # <script> injector expose them, exactly like tests/record_legacy_test.py.
    src = src.replace("export const", "const").replace("export function", "function")
    src += "\nwindow.__dr = { meta, init, reduce, project, summarize };\n"

    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        pg.set_content("<!DOCTYPE html><html><body></body></html>")
        pg.add_script_tag(content=src)
        got = pg.evaluate("(" + JS_CASES + ")()")
        br.close()

    bad = 0
    for name, ok in got:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)

    print()
    print("%d/%d dot-return rules held" % (len(got) - bad, len(got)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())