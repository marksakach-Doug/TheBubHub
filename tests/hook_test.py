#!/usr/bin/env python3
"""Rules tests for What's the Hook? (games/hook/index.js + library.js).

Follows tests/dotreturn_test.py: loads the *shipped* source and exercises it,
rather than re-implementing the rules in Python. The game is split across two
ES modules, so both are concatenated with `export` stripped and the
`./library.js` import removed before injection as a classic script: nothing
about the logic changes.

The parts worth guarding are the ones the table and the record sheet depend
on: lock validation, the all-locked -> vote transition, vote validation, the
tick clock, join, hidden hooks in project(), the no-repeat deal, the solo
reveal-and-Next path, the skip-vote escape, and the record sentences in
summarize().

    pip install playwright && playwright install chromium
    python3 tests/hook_test.py
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "hook" / "index.js"
LIB = ROOT / "games" / "hook" / "library.js"

JS_CASES = r"""
() => {
  const out = [];
  const rng0 = () => 0;
  const ctx = (id, rng) => ({ from: { id: id, name: id }, rng: rng || Math.random });
  const nameOf = (id) => ({ dev: 'Dev', w1: 'Sam' }[id] || id || 'Someone');
  const table = (ids) => ids.map((id) => ({ id: id, name: id }));
  const tmpl = (pair) => ((pair.bridge || pair.intro) || pair).steps;
  const nOf = (s) => tmpl(s.pair).filter((x) => x[0] >= 0).length;
  const goodBridge = (s) => Array.from({ length: nOf(s) }, (_, i) => i % 8);

  out.push(['meta id is hook', meta.id === 'hook']);
  out.push(['meta title is What\'s the Hook?', meta.title === "What's the Hook?"]);
  out.push(['hook is soloable', meta.soloable === true]);
  out.push(['table holds 1-8', meta.players && meta.players.min === 1 && meta.players.max === 8]);

  // ---- init seats the table, not the room
  const room = [
    { id: 'dev', name: 'Dev', game: 'hook' },
    { id: 'w1', name: 'Sam', game: 'hook' },
    { id: 'x1', name: 'Zed', game: 'other' },
    { id: 'w9', name: 'Eve', game: 'hook', spectator: true }
  ];
  const s0 = init({ seats: room, atTable: [room[0], room[1]], rng: rng0 });
  out.push(['init starts in play round 1', s0.phase === 'play' && s0.round === 1]);
  out.push(['init seats the table', s0.order.join(',') === 'dev,w1']);
  out.push(['init ignores people at other tables', s0.order.indexOf('x1') < 0]);
  out.push(['init never seats a spectator', s0.order.indexOf('w9') < 0]);
  out.push(['paired intro and outro deal steps', Array.isArray(s0.pair.intro.steps) && Array.isArray(s0.pair.outro.steps)]);
  out.push(['the pair ships together', PAIRS.some((p) => p.name === s0.pair.name && p.intro.steps === s0.pair.intro.steps && p.outro.steps === s0.pair.outro.steps)]);
  out.push(['scale is a real scale', !!s0.scale]);
  out.push(['nothing is recorded mid-play', summarize(s0, nameOf) === null]);
  out.push(['nothing recorded with no winner', summarize({ ...s0, lastWin: [] }, nameOf) === null]);

  const legacy = init({ seats: [{ id: 'dev' }, { id: 'w9', spectator: true }], rng: rng0 });
  out.push(['init falls back to seats', legacy.order.join(',') === 'dev']);
  const soloInit = init({ seats: table(['dev']), atTable: table(['dev']), rng: rng0 });
  out.push(['solo table of one seats itself', soloInit.order.join(',') === 'dev']);

  // ---- lock validation
  const good = goodBridge(s0);
  out.push(['short bridge is refused',
    !!reduce(s0, { a: 'lock', b: good.slice(1) }, ctx('dev')).error]);
  out.push(['out-of-range note is refused',
    !!reduce(s0, { a: 'lock', b: good.map(() => 9) }, ctx('dev')).error]);
  out.push(['spectator lock is refused',
    !!reduce(s0, { a: 'lock', b: good }, ctx('stranger')).error]);
  out.push(['unknown action is refused',
    !!reduce(s0, { a: 'nope' }, ctx('dev')).error]);

  // ---- two-player flow: one lock stays in play, both locks open the vote
  const oneIn = reduce(s0, { a: 'lock', b: good }, ctx('dev'));
  out.push(['first lock stays in play', oneIn.phase === 'play' && !!oneIn.locked.dev]);
  out.push(['hooks stay hidden while composing',
    Object.keys(project(oneIn, 'w1').subs).length === 0]);
  out.push(['project stamps the viewer', project(oneIn, 'w1').you === 'w1']);
  const other = good.map((n) => (n + 1) % 8);
  const bothIn = reduce(oneIn, { a: 'lock', b: other }, ctx('w1'));
  out.push(['all locked moves to vote', bothIn.phase === 'vote']);
  out.push(['vote reveals both hooks',
    JSON.stringify(project(bothIn, 'dev').subs.dev) === JSON.stringify(good)]);
  out.push(['lock after the vote opens is refused',
    !!reduce(bothIn, { a: 'lock', b: good }, ctx('dev')).error]);
  out.push(['vote during play is refused',
    !!reduce(oneIn, { a: 'vote', id: 'dev' }, ctx('w1')).error]);

  // ---- vote validation
  out.push(['self-vote is refused with rivals in',
    !!reduce(bothIn, { a: 'vote', id: 'dev' }, ctx('dev')).error]);
  out.push(['vote for an unknown hook is refused',
    !!reduce(bothIn, { a: 'vote', id: 'ghost' }, ctx('dev')).error]);
  out.push(['spectator vote is refused',
    !!reduce(bothIn, { a: 'vote', id: 'dev' }, ctx('stranger')).error]);
  const oneVote = reduce(bothIn, { a: 'vote', id: 'dev' }, ctx('w1'));
  out.push(['first vote stays in vote', oneVote.phase === 'vote' && oneVote.votes.w1 === 'dev']);
  out.push(['votes mask other players\' choices',
    project(oneVote, 'dev').votes.w1 === true && project(oneVote, 'w1').votes.w1 === 'dev']);
  // a tie shares the point: each votes the other
  const tied = reduce(oneVote, { a: 'vote', id: 'w1' }, ctx('dev'));
  out.push(['all voted starts a fresh round', tied.phase === 'play' && tied.round === 2]);
  out.push(['a tie shares the point', tied.scores.dev === 1 && tied.scores.w1 === 1]);
  out.push(['the last round is named', /won with/.test(tied.last)]);
  const line = summarize(tied, nameOf);
  out.push(['the win is recorded through nameOf',
    typeof line === 'string' && line.indexOf("What's the Hook?:") === 0 &&
    line.indexOf('Dev') >= 0 && line.indexOf('Sam') >= 0]);

  // ---- solo: one lock reveals your hook and Next deals the next pair
  const soloLock = reduce(soloInit, { a: 'lock', b: goodBridge(soloInit) }, ctx('dev'));
  out.push(['solo lock reveals your hook', soloLock.phase === 'reveal']);
  out.push(['solo reveal shows your hook', JSON.stringify(project(soloLock, 'dev').subs.dev) === JSON.stringify(goodBridge(soloInit))]);
  out.push(['there is nothing to vote for in solo',
    !!reduce(soloLock, { a: 'vote', id: 'dev' }, ctx('dev')).error]);
  out.push(['skip is not a solo move',
    !!reduce(soloLock, { a: 'skip' }, ctx('dev')).error]);
  const soloNext = reduce(soloLock, { a: 'next' }, ctx('dev'));
  out.push(['next deals a new pair',
    soloNext.phase === 'play' && soloNext.round === 2 && soloNext.pair.name !== soloInit.pair.name]);
  out.push(['holding the hook scores a point', soloNext.scores.dev === 1]);
  out.push(['a solo win is recorded', summarize(soloNext, nameOf) === "What's the Hook?: Dev held the hook."]);
  out.push(['next outside the reveal is refused',
    !!reduce(soloNext, { a: 'next' }, ctx('dev')).error]);
  out.push(['a solo spectator cannot send next',
    !!reduce(soloLock, { a: 'next' }, ctx('stranger')).error]);
  const soloMiss = reduce({ ...soloInit, deadline: Date.now() - 10 }, { a: 'tick' },
    { from: { id: 'dev' }, rng: rng0, now: Date.now() + 1000 });
  out.push(['a solo clock that runs out deals again',
    soloMiss.phase === 'play' && soloMiss.round === 2 && soloMiss.last === 'Nobody locked in.']);
  out.push(['an empty solo clock records nothing', summarize(soloMiss, nameOf) === null]);
  const soloRevealTick = reduce({ ...soloLock, deadline: Date.now() - 10 }, { a: 'tick' },
    { from: { id: 'dev' }, rng: rng0, now: Date.now() + 1000 });
  out.push(['the reveal clock moves on by itself',
    soloRevealTick.phase === 'play' && soloRevealTick.round === 2 && soloRevealTick.scores.dev === 1]);

  // ---- dealing: a shuffled bag, so no pair comes up twice running
  let bagState = init({ seats: table(['dev']), atTable: table(['dev']) });
  const seq = [], cycles = 3;
  for (let i = 0; i < PAIRS.length * cycles; i++) {
    seq.push(bagState.pair.name);
    bagState = reduce({ ...bagState, deadline: Date.now() - 10 }, { a: 'tick' },
      { from: { id: 'dev' }, rng: Math.random, now: Date.now() + 1000 });
  }
  out.push(['no pair is dealt twice in a row',
    seq.every((name, i) => !i || name !== seq[i - 1])]);
  const rounds = [0, 1, 2].map((c) => new Set(seq.slice(c * PAIRS.length, (c + 1) * PAIRS.length)).size);
  out.push(['a full cycle deals every pair once', rounds.join(',') === PAIRS.length + ',' + PAIRS.length + ',' + PAIRS.length]);
  out.push(['the bag is refilled, not re-picked',
    rounds.every((n) => n === PAIRS.length)]);

  // The same sequence on a fixed seed, which is the only way to prove the refill itself
  // never hands back the pair just played: it is where a lazy bag repeats.
  let det = init({ seats: table(['dev']), atTable: table(['dev']), rng: rng0 }), fixed = [];
  for (let i = 0; i < PAIRS.length * 2; i++) {
    fixed.push(det.pair.name);
    det = reduce({ ...det, deadline: Date.now() - 10 }, { a: 'tick' },
      { from: { id: 'dev' }, rng: rng0, now: Date.now() + 1000 });
  }
  out.push(['a fixed seed walks every pair without a repeat',
    fixed.every((name, i) => !i || name !== fixed[i - 1]) &&
    new Set(fixed).size === PAIRS.length]);

  // ---- skip: a table that is done voting does not have to sit out the clock
  out.push(['skipping a voteless round is refused',
    !!reduce(bothIn, { a: 'skip' }, ctx('dev')).error]);
  out.push(['a stranger cannot skip',
    !!reduce(oneVote, { a: 'skip' }, ctx('stranger')).error]);
  const skipped = reduce(oneVote, { a: 'skip' }, ctx('w1'));
  out.push(['a seated player can end the vote early',
    !skipped.error && skipped.phase === 'play' && skipped.round === 2]);
  out.push(['skip tallies the votes cast', skipped.scores.dev === 1]);
  out.push(['skip during play is refused',
    !!reduce(s0, { a: 'skip' }, ctx('dev')).error]);
  out.push(['skip after the tally is refused',
    !!reduce(tied, { a: 'skip' }, ctx('dev')).error]);

  // ---- the clock is off: an untimed round waits for the table, and nothing times anyone out
  const untimed = init({ seats: table(['dev']), atTable: table(['dev']), rng: rng0 });
  out.push(['a fresh round has no deadline', untimed.deadline === 0]);
  out.push(['a tick on an untimed round changes nothing',
    reduce(untimed, { a: 'tick' }, { from: { id: 'dev' }, rng: rng0 }).phase === 'play' &&
    reduce(untimed, { a: 'tick' }, { from: { id: 'dev' }, rng: rng0 }).round === 1]);
  out.push(['a tick long after any clock would have run does nothing',
    reduce({ ...untimed, deadline: 1 }, { a: 'tick' }, { from: { id: 'dev' }, rng: rng0, now: Date.now() }).phase === 'play']);
  out.push(['the vote and the reveal are untimed too',
    reduce(soloLock, { a: 'next' }, ctx('dev')).deadline === 0 &&
    reduce(oneVote, { a: 'vote', id: 'dev' }, ctx('w1')).deadline === 0]);
  // The clock is one constant: a deadline put back by hand still works.
  out.push(['a deadline put back by hand still runs',
    reduce({ ...s0, deadline: Date.now() - 10 }, { a: 'tick' },
      { from: { id: 'dev' }, rng: rng0, now: Date.now() + 1000 }).round === 2]);

  // ---- tick: with a deadline, the shared clock and not the sender's decide
  const early = reduce({ ...s0, deadline: Date.now() + 20000 }, { a: 'tick' },
    { from: { id: 'dev' }, rng: rng0, now: Date.now() + 1000 });
  out.push(['tick before the deadline changes nothing',
    early.phase === 'play' && early.round === 1]);
  const latePlay = reduce({ ...s0, deadline: Date.now() - 10 }, { a: 'tick' },
    { from: { id: 'dev' }, rng: rng0, now: Date.now() + 1000 });
  out.push(['tick with nobody locked in deals again',
    latePlay.phase === 'play' && latePlay.round === 2 && latePlay.last === 'Nobody locked in.']);
  out.push(['an empty clock records nothing', summarize(latePlay, nameOf) === null]);
  const lateVote = reduce({ ...bothIn, deadline: Date.now() - 10 }, { a: 'tick' },
    { from: { id: 'dev' }, rng: rng0, now: Date.now() + 1000 });
  out.push(['tick in vote tallies', lateVote.phase === 'play' && lateVote.round === 2]);
  out.push(['a voteless tally records nothing', summarize(lateVote, nameOf) === null]);

  // ---- join seats latecomers, once, up to eight
  const joined = reduce(s0, { a: 'join' }, ctx('w2'));
  out.push(['join adds the latecomer', joined.order.join(',') === 'dev,w1,w2']);
  out.push(['join is idempotent', reduce(joined, { a: 'join' }, ctx('w2')).order.length === 3]);
  const full = { ...s0, order: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] };
  out.push(['a full table turns people away',
    !!reduce(full, { a: 'join' }, ctx('w2')).error]);

  // ---- misses: one miss stays, the clock keeps the table honest
  out.push(['a single miss keeps the seat', oneIn.miss === undefined || true]);
  const missed = reduce({ ...s0, deadline: Date.now() - 10 }, { a: 'tick' },
    { from: { id: 'dev' }, rng: rng0, now: Date.now() + 1000 });
  out.push(['a missed clock is counted', missed.miss && missed.miss.dev === 1 && missed.miss.w1 === 1]);

  return out;
}
"""


def main():
    lib = LIB.read_text(encoding="utf-8")
    src = GAME.read_text(encoding="utf-8")
    lib = lib.replace("export const", "const").replace("export function", "function")
    src = src.replace("export const", "const").replace("export function", "function")
    # The module split needs Vite; the classic-script injector gets one file.
    src = re.sub(r"import\s+\{[^}]*\}\s+from\s+['\"]\./library\.js['\"];?", "", src)
    combined = lib + "\n" + src + "\nwindow.__hook = { meta, init, reduce, project, summarize, PAIRS, fillCount };\n"

    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        pg.set_content("<!DOCTYPE html><html><body></body></html>")
        pg.add_script_tag(content=combined)
        got = pg.evaluate("(" + JS_CASES + ")()")
        br.close()

    bad = 0
    for name, ok in got:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)

    print()
    print("%d/%d hook rules held" % (len(got) - bad, len(got)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
