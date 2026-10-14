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

  out.push(['the game is called Focus', meta.title === 'Focus']);
  out.push(['the module id is unchanged', meta.id === 'dotreturn']);

  // ---- tuning invariants: a wider circle, the same speed-to-radius ratio.
  out.push(['the circle grew 15%', Math.abs(R / 0.036 - 1.15) < 0.001]);
  out.push(['V holds the R/V ratio', Math.abs(R / V - 5) < 0.001]);
  out.push(['the wind pushes at half drift speed', WIND === 0.50]);

  // ---- init seats the table, not the room.
  // The hub passes the whole room roster under `seats`; `atTable` is the
  // filtered list of people who actually opened this game.
  const room = [
    { id: 'w1', name: 'Sam', game: 'dotreturn' },
    { id: 'b1', name: 'Bo', game: 'dotreturn' },
    { id: 'x1', name: 'Zed', game: 'other' },        // in the room, at another table
    { id: 'w9', name: 'Eve', game: 'dotreturn', spectator: true }
  ];
  const st0 = init({ seats: room, atTable: [room[0], room[1]] });
  out.push(['init seats the table', st0.players.join(',') === 'w1,b1' && !!st0.dots.b1]);
  out.push(['init ignores people at other tables', st0.players.indexOf('x1') < 0]);
  out.push(['init never seats a spectator', st0.players.indexOf('w9') < 0]);
  out.push(['init starts ready', st0.phase === 'ready' && st0.epoch === 0]);
  out.push(['the first seated player hosts', st0.hostId === 'w1']);

  // Fall back to `seats` when there is no atTable, and still drop spectators.
  const legacy = init({ seats: [{ id: 'w1' }, { id: 'w9', spectator: true }] });
  out.push(['init falls back to seats', legacy.players.join(',') === 'w1']);

  // ---- start opens a 3s reveal, then the round plays
  const started = reduce(st0, { a: 'start' }, ctx('w1'));
  out.push(['start begins a round', started.phase === 'reveal' && started.epoch === 1]);
  out.push(['start resets lapses', started.lapses === 0]);
  out.push(['start sets a 70s clock after the reveal',
    Math.abs((started.endsAt - started.revealEndsAt) / 1000 - 70) < 0.5]);
  out.push(['the round records its table', started.table.join(',') === 'w1,b1']);
  out.push(['a two-player round is not solo', started.solo === false]);
  out.push(['a guest cannot start the round',
    !!reduce(st0, { a: 'start' }, ctx('b1')).error]);
  out.push(['a round cannot be started twice while revealing',
    !!reduce(started, { a: 'start' }, ctx('w1')).error]);
  const played = reduce(started, { a: 'revealend' }, ctx('w1'));
  out.push(['the reveal hands over to play', played.phase === 'play']);

  const soloStart = reduce(init({ seats: [{ id: 'w1' }] }), { a: 'start' }, ctx('w1'));
  out.push(['a one-player round is solo', soloStart.solo === true]);

  // ---- swipe only moves the sender's dot
  const swiped = reduce(played, { a: 'swipe', ang: 1.5 }, ctx('w1'));
  out.push(['swipe sets the heading', swiped.dots.w1.a === 1.5]);
  out.push(['swipe leaves other dots alone', swiped.dots.b1.a === played.dots.b1.a]);
  out.push(['swipe rejects a bogus angle',
    !!reduce(played, { a: 'swipe', ang: 'north' }, ctx('w1')).error]);
  out.push(['a spectator cannot swipe',
    !!reduce(played, { a: 'swipe', ang: 1 }, ctx('ghost')).error]);

  // ---- exit / in: lapses are latched so they cannot be double counted.
  // Away time accrues between the two; the score is time, not count.
  const once = reduce(played, { a: 'exit' }, ctx('w1'));
  out.push(['first exit counts', once.lapses === 1 && once.dots.w1.out === true]);
  out.push(['exit opens an interval', typeof once.dots.w1.outSince === 'number']);
  const twice = reduce(once, { a: 'exit' }, ctx('w1'));
  out.push(['a repeat exit does not count', twice.lapses === 1]);
  const other = reduce(once, { a: 'exit' }, ctx('b1'));
  out.push(['another dot adds to the lapse count', other.lapses === 2]);
  const back = reduce(other, { a: 'in' }, ctx('w1'));
  out.push(['coming back re-arms the latch', back.dots.w1.out === false]);
  const again = reduce(back, { a: 'exit' }, ctx('w1'));
  out.push(['the same dot may count again', again.lapses === 3]);
  out.push(['lapses are shared, not per player', again.lapses === 3 && !('lapses' in again.dots.w1)]);

  // ---- reroll: a new trajectory, rate limited
  const rolled = reduce(played, { a: 'reroll' }, ctx('w1'));
  out.push(['reroll picks a new heading',
    rolled.dots.w1.a !== played.dots.w1.a && rolled.dots.w1.a >= 0 && rolled.dots.w1.a < Math.PI * 2]);
  out.push(['reroll does not touch the other dot', rolled.dots.b1.a === played.dots.b1.a]);
  const tooSoon = reduce(rolled, { a: 'reroll' }, ctx('w1'));
  out.push(['a second reroll inside the cooldown is ignored',
    tooSoon.dots.w1.a === rolled.dots.w1.a]);
  const cooled = reduce(rolled, { a: 'reroll' }, ctx('b1'));
  out.push(['the cooldown is per dot', cooled.dots.b1.a !== played.dots.b1.a]);
  out.push(['a spectator cannot reroll',
    !!reduce(played, { a: 'reroll' }, ctx('ghost')).error]);

  // ---- join mid-round. The latecomer is seated but benched until the next
  // round: handing them a heading now would bump the epoch and re-anchor
  // every running dot back to dead centre. A lobby join still re-anchors.
  const joined = reduce(played, { a: 'join' }, ctx('w2'));
  out.push(['join adds the latecomer', joined.players.join(',') === 'w1,b1,w2']);
  out.push(['a mid-round join does not re-anchor the table', joined.epoch === played.epoch]);
  out.push(['the latecomer is benched until the next round', joined.dots.w2.benched === true]);
  out.push(['a benched dot cannot steer',
    !!reduce(joined, { a: 'swipe', ang: 1 }, ctx('w2')).error]);
  out.push(['a benched dot cannot touch the tally',
    !!reduce(joined, { a: 'exit' }, ctx('w2')).error]);
  const lobbyJoin = reduce(st0, { a: 'join' }, ctx('w2'));
  out.push(['a lobby join still re-anchors', lobbyJoin.epoch === st0.epoch + 1]);
  out.push(['a lobby join is not benched', lobbyJoin.dots.w2.benched === false]);
  out.push(['a dot already at the table is left alone',
    reduce(joined, { a: 'join' }, ctx('w1')).players.length === 3]);
  out.push(['a full table turns people away',
    !!reduce(Object.assign({}, joined,
      { players: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] }),
      { a: 'join' }, ctx('w2')).error]);
  out.push(['a table of nine still seats one more',
    !reduce(Object.assign({}, joined,
      { players: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }),
      { a: 'join' }, ctx('w2')).error]);

  // ---- the clock
  out.push(['the round cannot be ended early',
    !!reduce(played, { a: 'finish' }, ctx('w1')).error]);
  const ranOut = Object.assign({}, once, { endsAt: Date.now() - 10 });
  const done = reduce(ranOut, { a: 'finish' }, ctx('w1'));
  out.push(['the round ends when the clock runs out',
    done.phase === 'over' && done.over.lapses === 1]);
  out.push(['nothing is recorded mid-round', summarize(played, nameOf) === null]);
  out.push(['nothing is recorded during the reveal', summarize(started, nameOf) === null]);
  out.push(['a second finish changes nothing',
    reduce(done, { a: 'finish' }, ctx('w1')).phase === 'over' &&
    reduce(done, { a: 'finish' }, ctx('w1')).lapses === 1]);

  // ---- a round can be replayed, and only by whoever may start one
  const replay = reduce(done, { a: 'start' }, ctx('w1'));
  out.push(['the host can replay a table round', replay.phase === 'reveal' && replay.epoch > done.epoch]);
  out.push(['a guest cannot replay a table round',
    !!reduce(done, { a: 'start' }, ctx('b1')).error]);
  const soloPlayed = reduce(soloStart, { a: 'revealend' }, ctx('w1'));
  const soloDone = reduce(Object.assign({}, soloPlayed, { endsAt: Date.now() - 10 }),
    { a: 'finish' }, ctx('w1'));
  const soloAgain = reduce(soloDone, { a: 'start' }, ctx('w1'));
  out.push(['a solo round replays itself', soloAgain.phase === 'reveal' && soloAgain.solo === true]);
  out.push(['a round cannot be started twice',
    !!reduce(reduce(replay, { a: 'revealend' }, ctx('w1')), { a: 'start' }, ctx('w1')).error]);

  // ---- project: the score is not in the snapshot until the reveal
  const view = project(played, 'w1');
  out.push(['lapses are hidden while playing', view.lapses === null && view.over === null]);
  out.push(['project stamps the viewer', view.you === 'w1']);
  out.push(['hidden for everyone, not just opponents',
    project(played, 'b1').lapses === null]);
  out.push(['project strips dots to heading and bench flag',
    view.dots.w1.a !== undefined && view.dots.w1.benched === false &&
    !('away' in view.dots.w1) && !('out' in view.dots.w1) && !('outSince' in view.dots.w1)]);
  const finalView = project(done, 'w1');
  out.push(['lapses are revealed at the end',
    finalView.lapses === 1 && finalView.over.lapses === 1]);
  out.push(['the real state was never mutated',
    played.lapses === 0 && played.phase === 'play']);

  // ---- the record line names the table, not the room
  const crowded = init({ seats: room, atTable: [room[0], room[1]] });
  const crowdedPlay = reduce(reduce(crowded, { a: 'start' }, ctx('w1')), { a: 'revealend' }, ctx('w1'));
  const tableDone = reduce(Object.assign({}, crowdedPlay,
    { endsAt: Date.now() - 10 }), { a: 'finish' }, ctx('w1'));
  out.push(['the record line credits only the table',
    summarize(tableDone, nameOf) === 'Sam and Bo let the dot get away for an average of 0.0 seconds']);
  const soloState = reduce(Object.assign({}, played, {
    players: ['w1'], dots: { w1: played.dots.w1 }, table: ['w1'], endsAt: Date.now() - 10
  }), { a: 'finish' }, ctx('w1'));
  out.push(['solo sentence', summarize(soloState, nameOf) === 'Sam let the dot get away for 0.0 seconds']);
  out.push(['table sentence',
    summarize(done, nameOf) === 'Sam and Bo let the dot get away for an average of 0.0 seconds']);
  const soloHit = reduce(Object.assign({}, played, {
    players: ['w1'], dots: { w1: played.dots.w1 }, table: ['w1'],
    lapses: 1, endsAt: Date.now() - 10
  }), { a: 'finish' }, ctx('w1'));
  out.push(['lapses do not reach the record line',
    summarize(soloHit, nameOf) === 'Sam let the dot get away for 0.0 seconds']);

  // ---- away time is scored, lapses are only displayed. Date.now is stubbed
  // for this block and restored after, so nothing above or below can tell.
  const realNow = Date.now;
  let fakeNow = 1000000;
  Date.now = function () { return fakeNow; };
  const tick0 = init({ seats: [{ id: 'w1' }], atTable: [{ id: 'w1' }] });
  const tickPlayed = reduce(reduce(tick0, { a: 'start' }, ctx('w1')),
    { a: 'revealend' }, ctx('w1'));
  const tickOut = reduce(tickPlayed, { a: 'exit' }, ctx('w1'));
  fakeNow += 3000;
  const tickIn = reduce(tickOut, { a: 'in' }, ctx('w1'));
  out.push(['exit at 0 and in at 3000 accrues 3000 ms', tickIn.dots.w1.away === 3000]);
  out.push(['in closes the interval', tickIn.dots.w1.outSince === null]);
  // finish with a dot still out closes at endsAt, not at now
  const tickOut2 = reduce(tickPlayed, { a: 'exit' }, ctx('w1'));
  const tickEnd = Object.assign({}, tickOut2, { endsAt: fakeNow + 5000 });
  fakeNow += 6000;
  const tickDone = reduce(tickEnd, { a: 'finish' }, ctx('w1'));
  out.push(['finish closes an open interval at endsAt',
    tickDone.phase === 'over' && tickDone.dots.w1.away === 5000 && tickDone.over.away === 5000]);
  // two dots sum, divided by the frozen table — a benched mid-round joiner
  // joins the roster but never the divisor
  const tick2 = init({ seats: [{ id: 'w1' }, { id: 'b1' }], atTable: [{ id: 'w1' }, { id: 'b1' }] });
  const tick2Played = reduce(reduce(tick2, { a: 'start' }, ctx('w1')),
    { a: 'revealend' }, ctx('w1'));
  let tick2State = reduce(tick2Played, { a: 'exit' }, ctx('w1'));
  fakeNow += 3000;
  tick2State = reduce(tick2State, { a: 'in' }, ctx('w1'));
  tick2State = reduce(tick2State, { a: 'exit' }, ctx('b1'));
  fakeNow += 1000;
  tick2State = reduce(tick2State, { a: 'in' }, ctx('b1'));
  tick2State = reduce(tick2State, { a: 'join' }, ctx('w2'));
  const tick2End = Object.assign({}, tick2State, { endsAt: fakeNow });
  const tick2Done = reduce(tick2End, { a: 'finish' }, ctx('w1'));
  out.push(['two dots sum', tick2Done.over.away === 4000]);
  out.push(['per-player division uses the table, not the roster',
    tick2Done.over.players === 2 && tick2Done.over.perPlayer === 2]);
  out.push(['lapses are displayed, never scored',
    tick2Done.over.lapses === 2 && tick2Done.over.perPlayer === 2]);
  out.push(['the record line averages away time',
    summarize(tick2Done, nameOf) === 'Sam and Bo let the dot get away for an average of 2.0 seconds']);
  // three players take the comma branch: 'Ann, Bo and Cy'
  const names3 = { w1: 'Ann', b1: 'Bo', w2: 'Cy' };
  const nameOf3 = (id) => names3[id] || id;
  const trioDone = Object.assign({}, tick2Done, {
    players: ['w1', 'b1', 'w2'], table: ['w1', 'b1', 'w2']
  });
  out.push(['three-player sentence',
    summarize(trioDone, nameOf3) === 'Ann, Bo and Cy let the dot get away for an average of 2.0 seconds']);
  const tickReplay = reduce(tick2Done, { a: 'start' }, ctx('w1'));
  out.push(['start resets away time and lapses',
    tickReplay.lapses === 0 && tickReplay.dots.w1.away === 0 && tickReplay.dots.w1.out === false]);
  out.push(['replay unbenched the waiter', tickReplay.dots.w2.benched === false]);
  Date.now = realNow;

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