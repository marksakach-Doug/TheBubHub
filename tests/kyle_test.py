#!/usr/bin/env python3
"""Rules tests for the Kyle Knows the Code module game (games/kyle/index.js).

Follows tests/dotreturn_test.py: loads the *shipped* source and exercises it,
rather than re-implementing the rules in Python. The game module is an ES
module, so the `export` keywords are stripped and the remainder is injected
as a classic script — nothing about the logic changes.

The parts worth guarding are the ones the table and the record sheet depend
on: unit scoring priority (red > white > orange > blue), the level rules
(step/turn/sweep), guess validation, the hidden code in project(), and the
record sentence in summarize().

    pip install playwright && playwright install chromium
    python3 tests/kyle_test.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "kyle" / "index.js"

JS_CASES = r"""
() => {
  const out = [];
  const ctx = (id) => ({ from: { id: id, name: id }, rng: Math.random });
  const nameOf = (id) => ({ dev: 'Dev', w1: 'Sam' }[id] || id || 'Someone');

  out.push(['meta id is kyle', meta.id === 'kyle']);
  out.push(['meta title', meta.title === 'Kyle Knows the Code']);
  out.push(['kyle is soloable', meta.soloable === true]);

  // ---- init / play gating
  const s0 = init();
  out.push(['init starts at home', s0.phase === 'home' && s0.won === false]);
  out.push(['guess before play is refused',
    !!reduce(s0, { a: 'guess', g: [0, 0] }, ctx('dev')).error]);
  out.push(['unknown path is refused',
    !!reduce(s0, { a: 'play', path: 'nope' }, ctx('dev')).error]);

  const s1 = reduce(s0, { a: 'play', path: 'classic' }, ctx('dev'));
  out.push(['play starts a round', s1.phase === 'play' && s1.round === 1 && s1.won === false]);
  out.push(['first classic level is Pocket Duets', s1.cfg.name === 'Pocket Duets']);
  out.push(['code units match the form',
    s1.code.length === 2 && s1.given.length === 0]);
  out.push(['nothing is recorded mid-round', summarize(s1, nameOf) === null]);

  // ---- deterministic code for scoring: S=4, k=2, form AB
  const fix = (s) => Object.assign({}, s, {
    cfg: Object.assign({}, s.cfg, { S: 4, k: 2, form: 'AB', name: 'Pocket Duets' }),
    code: [[0, 1], [2, 3]]
  });
  const t1 = fix(s1);
  out.push(['short guess is refused',
    !!reduce(t1, { a: 'guess', g: [0, 1, 2] }, ctx('dev')).error]);
  out.push(['out-of-range note is refused',
    !!reduce(t1, { a: 'guess', g: [0, 1, 2, 9] }, ctx('dev')).error]);

  const exact = reduce(t1, { a: 'guess', g: [0, 1, 2, 3] }, ctx('dev'));
  out.push(['exact guess wins', exact.won === true && exact.rows[0].red === 2]);
  out.push(['winner is recorded', exact.wonBy === 'dev']);
  out.push(['win advances progress', exact.prog.classic === 1]);
  out.push(['record sentence, singular',
    summarize(exact, nameOf) === 'Dev cracked Pocket Duets in 1 try']);
  out.push(['no more guesses after a win',
    !!reduce(exact, { a: 'guess', g: [0, 1, 2, 3] }, ctx('dev')).error]);
  const nxt = reduce(exact, { a: 'next' }, ctx('dev'));
  out.push(['next starts a fresh round',
    nxt.phase === 'play' && nxt.won === false && nxt.rows.length === 0 && nxt.round === 2]);
  out.push(['next without a win is refused',
    !!reduce(t1, { a: 'next' }, ctx('dev')).error]);

  // two tries -> plural
  const miss = reduce(t1, { a: 'guess', g: [0, 0, 0, 0] }, ctx('dev'));
  out.push(['wrong guess does not win', miss.won === false]);
  const win2 = reduce(miss, { a: 'guess', g: [0, 1, 2, 3] }, ctx('dev'));
  out.push(['record sentence, plural',
    summarize(win2, nameOf) === 'Dev cracked Pocket Duets in 2 tries']);

  // ---- scoring priority: exact melodies beat reordered notes
  const swapped = reduce(t1, { a: 'guess', g: [2, 3, 0, 1] }, ctx('dev'));
  out.push(['exact melodies in other slots are white, not orange/blue',
    swapped.rows[0].white === 2 && swapped.rows[0].orange === 0 && swapped.rows[0].blue === 0]);
  const reord = reduce(t1, { a: 'guess', g: [1, 0, 3, 2] }, ctx('dev'));
  out.push(['same notes out of order in place are orange',
    reord.rows[0].orange === 2 && reord.rows[0].red === 0 && reord.rows[0].white === 0]);
  const moved = reduce(t1, { a: 'guess', g: [3, 2, 1, 0] }, ctx('dev'));
  out.push(['same notes out of order elsewhere are blue',
    moved.rows[0].blue === 2 && moved.rows[0].red === 0 && moved.rows[0].white === 0 && moved.rows[0].orange === 0]);
  const exactBeatsOrange = reduce(t1, { a: 'guess', g: [0, 1, 3, 2] }, ctx('dev'));
  out.push(['an exact unit scores red, not orange',
    exactBeatsOrange.rows[0].red === 1 && exactBeatsOrange.rows[0].orange === 1]);
  out.push(['melody pluralises to melodies',
    exact.rows[0].text === 'Two melodies are right and in the right spot.']);
  out.push(['zero-feedback line pluralises too',
    miss.rows[0].text === 'None of those melodies are in the code.']);

  // ---- level rules
  const stepState = Object.assign({}, t1, {
    cfg: { S: 5, k: 2, form: 'AB', name: 'x', rule: 'step' }, code: [[0, 1], [1, 2]]
  });
  out.push(['step rule rejects a leap',
    !!reduce(stepState, { a: 'guess', g: [0, 2, 1, 2] }, ctx('dev')).error]);
  out.push(['step rule accepts adjacent moves',
    !reduce(stepState, { a: 'guess', g: [0, 1, 2, 1] }, ctx('dev')).error]);
  const turnState = Object.assign({}, t1, {
    cfg: { S: 6, k: 3, form: 'AB', name: 'x', rule: 'turn' }, code: [[1, 2, 1], [2, 3, 2]]
  });
  out.push(['turn rule accepts X-Y-X',
    !reduce(turnState, { a: 'guess', g: [1, 2, 1, 2, 3, 2] }, ctx('dev')).error]);
  out.push(['turn rule rejects a run',
    !!reduce(turnState, { a: 'guess', g: [0, 1, 2, 2, 3, 2] }, ctx('dev')).error]);
  const sweepState = Object.assign({}, t1, {
    cfg: { S: 6, k: 3, form: 'AB', name: 'x', rule: 'sweep' }, code: [[0, 1, 2], [3, 2, 1]]
  });
  out.push(['sweep rule accepts a rise and a fall',
    !reduce(sweepState, { a: 'guess', g: [0, 1, 2, 3, 2, 1] }, ctx('dev')).error]);
  out.push(['sweep rule rejects a turn',
    !!reduce(sweepState, { a: 'guess', g: [0, 2, 1, 3, 2, 1] }, ctx('dev')).error]);

  // ---- project: the code stays hidden until it is cracked
  out.push(['code is hidden while playing', project(t1, 'dev').code === null]);
  out.push(['code is revealed on a win',
    JSON.stringify(project(exact, 'dev').code) === JSON.stringify([[0, 1], [2, 3]])]);

  // ---- home
  const home = reduce(exact, { a: 'home' }, ctx('dev'));
  out.push(['home returns to the menu', home.phase === 'home']);
  out.push(['nothing is recorded from home', summarize(home, nameOf) === null]);

  // ---- tips: every path opener teaches the loop, every new concept is
  // introduced where it first appears, and the hard finales coach.
  const tipOf = (path, name) => PATHS[path].levels.find((l) => l.name === name).tip || '';
  out.push(['every path opener has a tip that teaches Ask Kyle',
    Object.keys(PATHS).every((p) => /Ask Kyle/.test(PATHS[p].levels[0].tip || ''))]);
  out.push(['calls opener explains lowercase vs CAPITALS',
    /lowercase/i.test(tipOf('calls', "Kyle's 8-Note Jam")) &&
    /CAPITALS/.test(tipOf('calls', "Kyle's 8-Note Jam"))]);
  ['Double Triads', 'Three Little Intervals'].forEach((n) =>
    out.push([n + ' introduces its novelty: ' + (tipOf('classic', n).slice(0, 40)) + '…',
      !!tipOf('classic', n)]));
  [['songs', 'Hexatonic Chorus'], ['songs', 'Folk Ballad Arch'], ['songs', 'Pentatonic Rondo'],
   ['rhythm', 'Rhythm Triplets']].forEach(([p, n]) =>
    out.push([n + ' introduces its shape', !!tipOf(p, n)]));
  [['songs', 'Blues Riff Cycle'], ['songs', 'Sixteen-Note Chiptune'],
   ['calls', 'Interleaved Duet']].forEach(([p, n]) =>
    out.push([n + ' coaches one motif at a time', /motif/i.test(tipOf(p, n))]));

  return out;
}
"""


def main():
    src = GAME.read_text(encoding="utf-8")
    # The module only exports these; stripping `export` lets a classic
    # <script> injector expose them, exactly like tests/dotreturn_test.py.
    src = src.replace("export const", "const").replace("export function", "function")
    src += "\nwindow.__kyle = { meta, init, reduce, project, summarize };\n"

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
    print("%d/%d kyle rules held" % (len(got) - bad, len(got)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
