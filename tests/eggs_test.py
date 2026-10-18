#!/usr/bin/env python3
"""Tests for Eggs (games/eggs/index.js) — the two things that were broken.

**The black screen at the end.** `endRound()` stored the round winner as
`{ id, name }` with no `idx`, and `drawMatchEnd()` read `colorOf(champ.idx)`
to colour the champion's name. `idx` was undefined, `COLORS[NaN]` was
undefined, and `.shell` threw — inside `render()`, which is called from the
16ms interval. A throw in the loop killed the frame loop for good, leaving the
canvas showing the dim overlay that had been painted one line earlier: a black
screen, permanently, on every game. It is not something you can see by reading
the diff, which is why it is asserted here.

**KING OF THE NEST.** A real mode in the standalone build that arrived in the
module port as dead code: `nest` was in the state and never created, so
`drawNest()` returned at its first line and `nestPts` was never scored by
anything. Now it is a third mode with its own scoring, a moving nest, a win
condition and a HUD bar.

The rules that already worked (input routing, prune, match ids) are checked
here too, because they are cheap to check and this file had no coverage at all.

    pip install playwright && playwright install chromium
    python3 tests/eggs_test.py
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = ROOT / "games" / "eggs" / "index.js"

# The module game half: meta, init, reduce, project, roundId, summarize, prune.
RULES_CASES = r"""
() => {
  const out = [];
  const ok = (name, cond) => out.push([name, !!cond]);

  ok('the game is Eggs', meta.id === 'eggs' && meta.title === 'Eggs');
  ok('it is a 2-8 table', meta.players.min === 2 && meta.players.max === 8);

  // ---- lobby: players are objects, and prune has to cope with that
  const ctx = { seats: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }],
                atTable: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }],
                options: {} };
  let s = init(ctx);
  ok('init seats the table', s.players.length === 2 && s.players[0].id === 'a');
  ok('every match has an id', typeof s.matchId === 'string' && s.matchId.length > 4);
  ok('roundId is the match id', roundId(s) === s.matchId);

  ok('a join adds a player', reduce(s, { type: 'JOIN', player: { id: 'c', name: 'Cy' } },
    { from: { id: 'a' } }).players.length === 3);
  ok('a second join by the same id changes nothing',
    reduce(reduce(s, { type: 'JOIN', player: { id: 'b', name: 'Bo' } }, { from: { id: 'a' } }),
      { type: 'JOIN', player: { id: 'b', name: 'Bo' } }, { from: { id: 'a' } }).players.length === 2);

  ok('an input is stored against its sender',
    reduce(s, { type: 'INPUT', inp: { ax: 1 } }, { from: { id: 'b' } }).inputs.b.ax === 1);
  ok('an input is not stored against anyone else',
    Object.keys(reduce(s, { type: 'INPUT', inp: { ax: 1 } }, { from: { id: 'b' } }).inputs).join() === 'b');

  // hostState and matchId are host-only: a guest must not be able to rewrite
  // the world it is being shown.
  const hijack = reduce(s, { type: 'SYNC', hostState: { eggs: [], matchOver: true } },
    { from: { id: 'b' } });
  ok('a guest cannot sync its own world', hijack.hostState === null);
  const host = reduce(s, { type: 'SYNC', hostState: { eggs: [], matchOver: true } },
    { from: { id: 'a', host: true } });
  ok('the host can', !!host.hostState);
  ok('a guest cannot set the match id',
    reduce(s, { type: 'MATCH_ID', matchId: 'mine' }, { from: { id: 'b' } }).matchId === s.matchId);

  // prune must find a leaver: `players` holds objects, so the hub's shared
  // prunePlayerState (players.indexOf(goneId)) can never match. Without the
  // game's own prune a departed player keeps a seat and leaks their input.
  const withInput = reduce(s, { type: 'INPUT', inp: { ax: -1 } }, { from: { id: 'b' } });
  const pruned = prune(withInput, 'b');
  ok('prune drops the leaver', pruned.players.every((p) => p.id !== 'b'));
  ok('prune drops their input', pruned.inputs.b === undefined);
  ok('prune keeps everyone else', pruned.players.length === 1);
  ok('prune of a stranger returns the same object', prune(withInput, 'zz') === withInput);
  ok('prune does not mutate the input', withInput.players.length === 2);

  // summarize reads hostState.roundWinner.{id} — so a round winner with no id
  // must produce null rather than "undefined won a match".
  ok('summarize is null before the match is over', summarize(s, (x) => x) === null);
  const won = reduce(s, { type: 'SYNC', hostState: { matchOver: true, roundWinner: { id: 'b' } } },
    { from: { id: 'a', host: true } });
  ok('summarize names the winner', summarize(won, (x) => x) === 'b won a match of Eggs!');
  ok('a winner with no id does not become the word undefined',
    summarize(reduce(s, { type: 'SYNC', hostState: { matchOver: true, roundWinner: {} } },
      { from: { id: 'a', host: true } }), (x) => x) === null);

  ok('project is the identity — guests read the world from hostState',
    project(s, 'b') === s);

  return out;
}
"""

def _code(src):
    """Source with comments removed: prose about a bug is not the bug."""
    out = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"//[^\n]*", "", out)


# Text guards on the things a headless rules test cannot reach: the canvas
# colour lookup that used to throw, the mode list, and the nest wiring.
SOURCE_GUARDS = [
    # Stripped of comments: the write-up explaining the bug quotes champ.idx,
    # and prose about the bug is not the bug.
    ("the champion colour no longer reads an index that does not exist",
     "champ.idx" not in _code(GAME.read_text(encoding="utf-8")),
     "drawMatchEnd() still reads champ.idx — roundWinner has no idx, so it throws"),
    ("the end screen finds the champion among the eggs instead",
     "eggs.find(function(g){return g.id===champ.id;})" in GAME.read_text(encoding="utf-8"),
     "drawMatchEnd() should look the champion up by id"),
    ("render() is guarded, so a paint error cannot kill the frame loop",
     "catch (err) {\n          drawPaintError(err);" in GAME.read_text(encoding="utf-8"),
     "the 16ms interval calls render() with no try/catch"),
    ("the paint error is drawable and tappable",
     "function drawPaintError(err)" in GAME.read_text(encoding="utf-8"),
     "there is no error screen"),
    ("KING OF THE NEST is a real mode",
     "name: 'KING OF THE NEST'" in GAME.read_text(encoding="utf-8"),
     "the nest mode is missing from MODES"),
    ("the nest is created at the start of a round",
     "if(mode==='nest'){nest=" in GAME.read_text(encoding="utf-8"),
     "startRound never creates the nest, so drawNest() returns immediately"),
    ("nest time only counts while one egg is in it alone",
     "if(ins.length===1)ins[0].nestPts+=rdt;" in GAME.read_text(encoding="utf-8"),
     "nestPts is credited without the alone check"),
    ("a contested nest scores nothing",
     "nest.contested=ins.length>1;" in GAME.read_text(encoding="utf-8"),
     "the nest does not know it is contested"),
    ("first to 25 seconds alone takes the round",
     "top.nestPts>=NEST_WIN" in GAME.read_text(encoding="utf-8"),
     "the nest round has no win condition"),
    ("the nest moves so it cannot be camped",
     "if(nest.moveT>NEST_MOVE_EVERY)moveNest();" in GAME.read_text(encoding="utf-8"),
     "the nest never moves"),
    ("the CPU goes to the nest in nest mode",
     "if(mode==='nest'&&nest){" in GAME.read_text(encoding="utf-8"),
     "botInput has no nest behaviour"),
    ("the mode is host-authoritative, so a guest does not score the wrong round",
     "mode = (MODES[cfg.mode | 0] || MODES[0]).id;" in GAME.read_text(encoding="utf-8"),
     "syncFromHost does not take the mode from the host cfg"),
    ("the nest travels to guests",
     "board = hs.board || null; peg = hs.peg || null; nest = hs.nest || null;",
     "nest is not in syncFromHost"),
]


def main():
    src = GAME.read_text(encoding="utf-8")
    stripped = src.replace("export const", "const").replace("export function", "function")
    stripped += "\nwindow.__eggs = { meta, init, reduce, project, roundId, summarize, prune };\n"

    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.set_content("<!DOCTYPE html><html><body></body></html>")
        pg.add_script_tag(content=stripped)
        got = pg.evaluate("(" + RULES_CASES + ")")
        br.close()

    results = [(name, bool(value)) for name, value in got]

    for name, cond, why in SOURCE_GUARDS:
        results.append((name, cond))
        if not cond:
            print("         " + why)

    bad = 0
    for name, ok in results:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)
    for e in errors:
        bad += 1
        print("  FAIL page error: " + e)

    print()
    print("%d/%d eggs checks passed" % (len(results) + len(errors) - bad,
                                        len(results) + len(errors)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())