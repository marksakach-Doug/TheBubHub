#!/usr/bin/env python3
"""Rules tests for the Music Bridge module game (games/musicbridge/index.js).

Follows tests/dotreturn_test.py: loads the *shipped* source and exercises it,
rather than re-implementing the rules in Python. The game module is an ES
module, so the `export` keywords are stripped and the remainder is injected
as a classic script: nothing about the logic changes.

The parts worth guarding are the ones the table and the record sheet depend
on: lock validation, the all-locked -> reveal transition, arbiter-only
approve/next, hidden bridges in project(), and the record sentence in
summarize().

    pip install playwright && playwright install chromium
    python3 tests/musicbridge_test.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "musicbridge" / "index.js"

JS_CASES = r"""
() => {
  const out = [];
  const ctx = (id) => ({ from: { id: id, name: id }, rng: Math.random });
  const nameOf = (id) => ({ dev: 'Dev', w1: 'Sam' }[id] || id || 'Someone');
  const table = (ids) => ids.map((id) => ({ id: id, name: id }));
  const validBridge = [0, 1, 2, 3];

  out.push(['meta id is musicbridge', meta.id === 'musicbridge']);
  out.push(['meta title is Music Bridge', meta.title === 'Music Bridge']);
  out.push(['music bridge is soloable', meta.soloable === true]);
  out.push(['solo range starts at one', meta.players && meta.players.min === 1]);

  // ---- init seats the table
  const s0 = init({ seats: table(['dev', 'w1']), atTable: table(['dev', 'w1']) });
  out.push(['init starts in play', s0.phase === 'play' && s0.round === 1]);
  out.push(['init seats the table', s0.order.join(',') === 'dev,w1']);
  out.push(['first seat arbitrates', s0.arbiter === 'dev']);
  out.push(['intro/outro are 4 valid beats',
    s0.intro.length === 4 && s0.outro.length === 4 &&
    s0.intro.concat(s0.outro).every((n) => Number.isInteger(n) && n >= 0 && n < 8)]);
  out.push(['nothing is recorded mid-play', summarize(s0, nameOf) === null]);

  // ---- lock validation
  out.push(['short bridge is refused',
    !!reduce(s0, { a: 'lock', bridge: [0, 1, 2] }, ctx('dev')).error]);
  out.push(['out-of-range note is refused',
    !!reduce(s0, { a: 'lock', bridge: [0, 1, 2, 9] }, ctx('dev')).error]);
  out.push(['spectator lock is refused',
    !!reduce(s0, { a: 'lock', bridge: validBridge }, ctx('stranger')).error]);
  out.push(['unknown action is refused',
    !!reduce(s0, { a: 'nope' }, ctx('dev')).error]);

  // ---- two-player flow: one lock stays in play, both locks reveal
  const oneIn = reduce(s0, { a: 'lock', bridge: validBridge }, ctx('dev'));
  out.push(['first lock stays in play', oneIn.phase === 'play' && !!oneIn.locked.dev]);
  out.push(['bridges stay hidden while composing',
    Object.keys(project(oneIn, 'w1').submissions).length === 0]);
  const bothIn = reduce(oneIn, { a: 'lock', bridge: [4, 5, 6, 7] }, ctx('w1'));
  out.push(['all locked moves to reveal', bothIn.phase === 'reveal']);
  out.push(['reveal counts the plays', bothIn.played === 2]);
  out.push(['reveal shows both bridges',
    JSON.stringify(project(bothIn, 'dev').submissions.dev) === JSON.stringify(validBridge)]);
  out.push(['lock after reveal is refused',
    !!reduce(bothIn, { a: 'lock', bridge: validBridge }, ctx('dev')).error]);

  // ---- approve is arbiter-only, in reveal only, and toggles
  out.push(['non-arbiter cannot approve',
    !!reduce(bothIn, { a: 'approve', targetId: 'w1' }, ctx('w1')).error]);
  out.push(['approve before reveal is refused',
    !!reduce(oneIn, { a: 'approve', targetId: 'w1' }, ctx('dev')).error]);
  out.push(['approve of unknown player is refused',
    !!reduce(bothIn, { a: 'approve', targetId: 'ghost' }, ctx('dev')).error]);
  const appr = reduce(bothIn, { a: 'approve', targetId: 'w1' }, ctx('dev'));
  out.push(['approve latches and counts', appr.approved.w1 === true && appr.found === 1]);
  const unappr = reduce(appr, { a: 'approve', targetId: 'w1' }, ctx('dev'));
  out.push(['approve toggles off', unappr.approved.w1 === false && unappr.found === 0]);

  // ---- record sentence only for judged reveals
  out.push(['nothing recorded without approvals', summarize(bothIn, nameOf) === null]);
  out.push(['nothing recorded mid-play', summarize(oneIn, nameOf) === null]);
  const line = summarize(appr, nameOf);
  out.push(['approved bridges are recorded',
    typeof line === 'string' && line.indexOf('Music Bridge:') === 0 && line.indexOf('1 approved bridge') >= 0]);

  // ---- next advances, rotates the arbiter, and resets the table
  out.push(['non-arbiter cannot advance',
    !!reduce(appr, { a: 'next' }, ctx('w1')).error]);
  out.push(['next before reveal is refused',
    !!reduce(oneIn, { a: 'next' }, ctx('dev')).error]);
  const nxt = reduce(appr, { a: 'next' }, ctx('dev'));
  out.push(['next starts a fresh round',
    nxt.phase === 'play' && nxt.round === 2 && Object.keys(nxt.locked).length === 0 &&
    Object.keys(nxt.submissions).length === 0]);
  out.push(['arbiter rotates', nxt.arbiter === 'w1']);

  // ---- solo table of one reveals on a single lock
  const solo = init({ seats: table(['dev']), atTable: table(['dev']) });
  const soloDone = reduce(solo, { a: 'lock', bridge: validBridge }, ctx('dev'));
  out.push(['solo lock reveals', soloDone.phase === 'reveal' && soloDone.played === 1]);

  return out;
}
"""


def main():
    src = GAME.read_text(encoding="utf-8")
    # The module only exports these; stripping `export` lets a classic
    # <script> injector expose them, exactly like tests/dotreturn_test.py.
    src = src.replace("export const", "const").replace("export function", "function")
    src += "\nwindow.__musicbridge = { meta, init, reduce, project, summarize };\n"

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
    print("%d/%d music bridge rules held" % (len(got) - bad, len(got)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
