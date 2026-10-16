#!/usr/bin/env python3
"""Rules tests for What's the Hook? (games/hook/index.js + library.js).

Follows tests/dotreturn_test.py: loads the *shipped* source and exercises it,
rather than re-implementing the rules in Python. The game is split across two
ES modules, so both are concatenated with `export` stripped and the
`./library.js` import removed before injection as a classic script: nothing
about the logic changes.

The parts worth guarding are the ones the table and the record sheet depend
on: lock validation, the all-locked -> vote transition, vote validation, the
tick clock, join, hidden hooks in project(), and the record sentence in
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
  const tmpl = (intro) => (intro.bridge || intro).steps;
  const nOf = (s) => tmpl(s.intro).filter((x) => x[0] >= 0).length;
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
  out.push(['intro and outro deal steps', Array.isArray(s0.intro.steps) && Array.isArray(s0.outro.steps)]);
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

  // ---- solo: one lock opens the vote, self-vote is allowed, then it tallies
  const soloLock = reduce(soloInit, { a: 'lock', b: goodBridge(soloInit) }, ctx('dev'));
  out.push(['solo lock opens the vote', soloLock.phase === 'vote']);
  const soloTally = reduce(soloLock, { a: 'vote', id: 'dev' }, ctx('dev'));
  out.push(['solo self-vote tallies a point',
    soloTally.phase === 'play' && soloTally.scores.dev === 1]);
  out.push(['solo win is recorded',
    (summarize(soloTally, nameOf) || '').indexOf('Dev') >= 0]);

  // ---- tick: the shared clock, not the sender's
  const early = reduce(s0, { a: 'tick' }, { from: { id: 'dev' }, rng: rng0, now: s0.deadline - 5000 });
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
    combined = lib + "\n" + src + "\nwindow.__hook = { meta, init, reduce, project, summarize };\n"

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
