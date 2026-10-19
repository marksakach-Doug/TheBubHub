#!/usr/bin/env python3
"""Tests for the module registry (src/registry.js).

This file exists because of a bug that shipped silently. `loadRegistry()` used
to guard its glob behind `typeof import.meta.glob === 'function'`, which is
true under `npm run dev` and *always false* in a production bundle: Vite
rewrites the `import.meta.glob(...)` call at build time but leaves the guard as
a runtime property check on something that no longer exists. The module branch
was therefore skipped in production and every module game vanished — bubhub.us
served 15 iframe games and zero module games, with no error anywhere.

The guard has to fail here rather than in production, so these tests assert the
bug's shape as text, and then run the real `loadRegistry()` the two ways it can
ever be run: as a built bundle (glob replaced by a stub loader map) and with no
Vite at all (no glob, so the catch must fall through to the legacy list).

    pip install playwright && playwright install chromium
    python3 tests/module_registry_test.py
"""
import json
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "src" / "registry.js"
GAMES_JS = ROOT / "public" / "games.js"
GAMES = sorted((ROOT / "games").glob("*/index.js"))

# Ids declared in the real public/games.js, commented-out lines excluded.
LEGACY_IDS = set(re.findall(r"^\s*\{ id: '([a-z0-9]+)'",
                            GAMES_JS.read_text(encoding="utf-8"), re.M))

# Stand-ins for window.BUB_GAMES, so the legacy branch has something to find.
# Keep these ids that have NO games/<id>/index.js — a module id here would be
# filtered out as a duplicate, which is a different test.
LEGACY = [
    {"id": "chess", "title": "Chess", "file": "chess.html", "players": "2"},
    {"id": "warp", "title": "Warp Front", "file": "warpfront.html", "players": "1-3"},
    {"id": "goldberg", "title": "Goldberg", "file": "goldberg.html", "players": "2-3",
     "maxPlayers": 3},
    # 3-8: needs three, takes eight. It belongs in the 2-8 group, and the
    # "max <= 3 or else 2-8" split must not leave it in a bucket of its own.
    {"id": "the96game", "title": "The 96 Game", "file": "the96game.html", "players": "3-8"},
]

# A subsequence of src/registry.js MENU_ORDER: this fixture registers the four
# module ids plus the legacy stand-ins above, so it cannot produce the whole
# list. The ids it CAN produce must appear in MENU_ORDER, and in this relative
# order — which is what catches a rename or a forgotten entry. The two
# source_checks below compare against the real games/ directory and games.js,
# so this stays honest without duplicating the full order here.
MENU_ORDER = [
    # small tables
    "chess", "minigo", "goldberg", "warp",
    # the 2-8 crowd
    "eggs", "hook", "dotreturn", "the96game",
    # trailing: TRAFFIC is registered by the stub below (its folder is
    # games/TRAFFIC) but has no entry in the LEGACY stand-ins, so it sorts last.
    "TRAFFIC",
]


def strip(src):
    """Strip `export` so a classic <script> can define the functions globally."""
    return (src.replace("export async function", "async function")
               .replace("export function", "function"))


def strip_comments(src):
    """Comments must not trip the guard search — the fix explains the guard in
    prose, and prose about `typeof import.meta.glob` is not the bug.

    Order matters: strip `//` lines FIRST. A `//` comment containing
    `games/*/index.js` opens a fake block comment if blocks go first, and the
    non-greedy match then eats real code — which is how this helper briefly
    passed a file that still had the guard in it.
    """
    src = re.sub(r"//[^\n]*", "", src)
    return re.sub(r"/\*.*?\*/", "", src, flags=re.S)


def source_checks():
    """The bug was a shape, so some of it can only be checked as text."""
    out = []
    src = REGISTRY.read_text(encoding="utf-8")

    out.append((
        "no typeof import.meta.glob guard in src/",
        not any(re.search(r"typeof\s+import\.meta\.glob",
                          strip_comments(p.read_text(encoding="utf-8")))
                for p in (ROOT / "src").rglob("*.js"))))

    out.append((
        "the glob call is still there",
        "import.meta.glob('../games/*/index.js')" in src))

    # The non-Vite fallback depends on the call being inside a try: a plain
    # `python3 -m http.server` must get the legacy list, not a stack trace.
    call_at = src.find("import.meta.glob(")
    try_at = src.rfind("try {", 0, call_at)
    catch_at = src.find("} catch", call_at)
    out.append((
        "the glob call sits inside a try/catch",
        try_at != -1 and catch_at != -1 and try_at < call_at < catch_at))

    out.append((
        "every shipped game module sits at games/<id>/index.js",
        bool(GAMES) and all(g.parent.parent.name == "games" and g.name == "index.js"
                            for g in GAMES)))

    # Every game the hub can show must have a place in the menu order, or it
    # falls off the end of the list and lands wherever the sort puts it. Read
    # the real games/ directory and the real games.js, not the fixture above.
    # Solo games (`solo: true`) go in the Solo list, not the multiplayer menu,
    # so they have no place in MENU_ORDER. Everything else must.
    solo_ids = set(re.findall(r"^\s*\{ id: '([a-z0-9]+)'[^\n]*solo: true",
                              GAMES_JS.read_text(encoding="utf-8"), re.M))
    real_ids = ({g.parent.name for g in GAMES} | set(LEGACY_IDS)) - solo_ids
    mo = re.search(r"const MENU_ORDER = \[(.*?)\];", src, re.S)
    # Ids may be upper case (TRAFFIC is), so this cannot assume [a-z0-9] only —
    # an all-caps id written here would be invisible to the parser and the
    # "names every game that exists" check would fail for the wrong reason.
    declared = re.findall(r"'([A-Za-z0-9]+)'", mo.group(1)) if mo else []
    out.append((
        "the menu order names every game that exists",
        bool(declared) and real_ids <= set(declared)))
    out.append((
        "the menu order names no game that does not exist",
        set(declared) <= real_ids))
    out.append((
        "no game is listed twice in the menu order",
        len(declared) == len(set(declared))))
    return out


# Run inside the page: loadRegistry() is already a global from the injected
# script, so this only reports what it assembled. The `typeof` check keeps a
# regression a *reported failure* instead of a ReferenceError traceback — with
# the guard back, `import.meta` makes the classic script unparseable.
INSPECT = r"""
() => (typeof loadRegistry === 'function'
  ? loadRegistry().then((full) => {
      const ids = (pred) => full.filter(pred).map((g) => g.meta.id);
      const all = full.map((g) => g.meta.id);
      return {
        modules: ids((g) => g.kind === 'module'),
        legacy: ids((g) => g.kind === 'iframe'),
        soloCorner: ids((g) => g.meta.solo || g.meta.soloable || g.meta.lobby),
        roomList: ids((g) => !g.meta.solo),
        dupes: all.filter((id, i) => all.indexOf(id) !== i),
        order: roomLists(full).multi.map((g) => g.meta.id),
        sections: multiplayerSections(full).map((s) => s.title),
        small: (multiplayerSections(full)[0] || { games: [] })
          .games.map((g) => g.meta.id),
        wide: (multiplayerSections(full)[1] || { games: [] })
          .games.map((g) => g.meta.id),
        counts: full.reduce((acc, g) => {
          const l = playerLabel(g.meta);
          if (l) acc[g.meta.id] = l;
          return acc;
        }, {})
      };
    })
  : { modules: [], legacy: [], soloCorner: [], roomList: [], dupes: [],
      order: [], sections: [], small: [], wide: [], counts: {},
      note: 'loadRegistry was never defined — the file did not parse' })
"""

COUNT_VIA = r"""
() => (typeof window.__lr === 'function'
  ? window.__lr().then((full) => ({
      modules: full.filter((g) => g.kind === 'module').length,
      legacy: full.filter((g) => g.kind === 'iframe').length
    }))
  : { modules: 0, legacy: 0 })
"""


def main():
    results = list(source_checks())

    raw = REGISTRY.read_text(encoding="utf-8")
    game_ids = [g.parent.name for g in GAMES]

    with sync_playwright() as p:
        br = p.chromium.launch()

        # ---- as a production bundle: the glob call replaced by a loader map,
        # which is precisely what Vite emits.
        pg = br.new_page()
        warnings = []
        pg.on("console", lambda m: warnings.append(m.text) if m.type == "warning" else None)
        pg.set_content("<!DOCTYPE html><html><body></body></html>")
        pg.evaluate("() => { window.BUB_GAMES = " + json.dumps(LEGACY) + "; }")
        # real loader *functions*, not JSON strings — a string would throw
        # inside the registry and be swallowed as "game module failed"
        # Real player ranges for the module games, because the menu grouping is
        # under test: a stub of '1-2' for everything would group them all as
        # small tables and the assertions would be about the stub.
        pg.evaluate("""(ids) => {
          const RANGES = {
            dotreturn: '2-8', eggs: '2-8', hook: '2-8', minigo: '2'
          };
          window.__loaded = {};
          ids.forEach((id) => {
            window.__loaded['../games/' + id + '/index.js'] = () => Promise.resolve({
              meta: { id: id, title: id, players: RANGES[id] || '2-8', soloable: true }
            });
          });
        }""", game_ids)
        stubbed = strip(raw).replace(
            "import.meta.glob('../games/*/index.js')", "__glob('../games/*/index.js')")
        pg.add_script_tag(content="function __glob() { return window.__loaded; }\n" + stubbed)
        got = pg.evaluate("(" + INSPECT + ")")

        # ---- with no Vite at all: `import.meta.glob` does not exist, so the
        # call throws and the catch has to fall through to the legacy games.
        pg2 = br.new_page()
        pg2.set_content("<!DOCTYPE html><html><body></body></html>")
        pg2.evaluate("() => { window.BUB_GAMES = " + json.dumps(LEGACY) + "; }")
        pg2.add_script_tag(content="window.__lr = loadRegistry;\n" + strip(raw),
                           type="module")
        fb = pg2.evaluate("(" + COUNT_VIA + ")")
        br.close()

    results += [
        ("a built bundle registers every module game",
         sorted(got["modules"]) == sorted(game_ids)),
        ("the multiplayer menu is in the order people asked for",
         got["order"] == MENU_ORDER),
        ("the small tables group first", got["sections"][0] == "Two or three players"),
        ("the 2-8 crowd is its own group", got["sections"][1] == "Two to eight players"),
        # Two groups and no third: a game that needs three and takes eight is
        # not "other", it is one of the eight-player tables.
        ("there is no leftover Other group", len(got["sections"]) == 2),
        ("Chess, MiniGo, Goldberg and Warp Front share the small group",
         got["small"] == ["chess", "minigo", "goldberg", "warp"]),
        ("a module count and a legacy count read the same",
         got["counts"]["eggs"] == "2-8 players" and got["counts"]["chess"] == "2 players"
         and got["counts"]["goldberg"] == "2-3 players"),
        ("Focus says 2-8 on the menu", got["counts"]["dotreturn"] == "2-8 players"),
        ("a game that needs three still lands in the 2-8 group",
         "the96game" in got["wide"]),
        ("a built bundle still registers the legacy games",
         got["legacy"] == [g["id"] for g in LEGACY]),
        ("a module id wins over a legacy entry with the same id",
         got["dupes"] == []),
        ("Dot Return is in the pre-room Solo Corner",
         "dotreturn" in got["soloCorner"]),
        ("Dot Return keeps its real count in the in-room list",
         "dotreturn" in got["roomList"]),
        ("without Vite it falls back to the legacy list instead of throwing",
         fb["modules"] == 0 and fb["legacy"] == len(LEGACY)),
        ("no game module failed to load in the built shape",
         not any("game module failed" in w for w in warnings)),
    ]

    bad = 0
    for name, ok in results:
        bad += not ok
        print(("  ok   " if ok else "  FAIL ") + name)

    print()
    print("%d/%d registry checks passed" % (len(results) - bad, len(results)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())