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


# The hand-pinned prefix, shared by the source check and the browser check.
PINNED_FOR_MENU = [
    "chess", "minigo", "goldberg", "warp",
    "eggs", "hook", "dotreturn", "the96game",
    "lotr", "wordbridge", "blastoff", "grammar", "TRAFFIC",
]


def is_subsequence(needle, haystack):
    """Is `needle` a subsequence of `haystack`, order preserved?

    Equality was the wrong assertion the moment a game could be added without
    editing the registry: the fixture can never produce the whole menu, and the
    menu grows on its own now.
    """
    it = iter(haystack)
    return all(any(x == n for x in it) for n in needle)


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

    # MENU_ORDER is a HAND-PINNED PREFIX, not a roster. `menuOrder()` sorts
    # anything not named in it to the end of the list in registry order, so a
    # new game appears in the menu with no edit here at all — which is what
    # makes "a new game is two files" true. This check used to demand that every
    # game be listed, which made adding a game a three-file change (the game,
    # this array, and whatever doc told you to edit the array) and made a
    # builder agent's first task a failure it could not fix from its own folder.
    #
    # So: check the PINNED prefix — the ids people actually argued about, in the
    # order they asked for — and check the two things that were really the bug
    # behind this check all along: a listed id that no longer exists, and a
    # listed id twice. A game that is simply absent from the list is correct.
    #
    # Both registries have to be read: legacy entries declare `solo: true`
    # inline in games.js, module games declare it in their own `meta`.
    solo_ids = set(re.findall(r"^\s*\{ id: '([a-z0-9]+)'[^\n]*solo: true",
                              GAMES_JS.read_text(encoding="utf-8"), re.M))
    for g in GAMES:
        if re.search(r"\bsolo:\s*true\b", g.read_text(encoding="utf-8")):
            solo_ids.add(g.parent.name)
    real_ids = ({g.parent.name for g in GAMES} | set(LEGACY_IDS)) - solo_ids
    mo = re.search(r"const MENU_ORDER = \[(.*?)\];", src, re.S)
    # Ids may be upper case (TRAFFIC is), so this cannot assume [a-z0-9] only —
    # an all-caps id written here would be invisible to the parser and the
    # "names every game that exists" check would fail for the wrong reason.
    declared = re.findall(r"'([A-Za-z0-9]+)'", mo.group(1)) if mo else []
    # The pinned prefix: the people who chose these positions. Everything after
    # them is a game added later, which is exactly what sorting to the end means.
    PINNED = PINNED_FOR_MENU
    # The pinned ids must all be declared, and in this relative order.
    pos = [declared.index(p) for p in PINNED if p in declared]
    out.append((
        "the hand-pinned menu prefix is all still there, in order",
        all(p in declared for p in PINNED) and pos == sorted(pos)))
    out.append((
        "the menu order names no game that does not exist",
        set(declared) <= real_ids))
    out.append((
        "no game is listed twice in the menu order",
        len(declared) == len(set(declared))))
    # And the promise the whole design rests on, asserted for real in the
    # browser below: a game absent from MENU_ORDER still appears, last.
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
        }, {}),
        // The promise that lets a new game skip src/registry.js entirely: an id
        // that is NOT in MENU_ORDER still appears in the menu, after every id
        // that is. Computed by asking menuOrder() to sort a list that contains
        // one id nobody pinned, rather than by reading this test's own copy of
        // MENU_ORDER — otherwise this would pass even if menuOrder() were
        // rewritten to drop unlisted games, which is the bug it exists to catch.
        unlisted: (() => {
          const PINNED = window.__pinned || [];
          const withNew = PINNED.concat(['zzz-a-game-nobody-pinned']);
          const sorted = menuOrder(withNew.map((id) => ({ meta: { id: id } })))
            .map((g) => g.meta.id);
          const at = sorted.indexOf('zzz-a-game-nobody-pinned');
          return {
            stillThere: at >= 0,
            last: sorted[sorted.length - 1] === 'zzz-a-game-nobody-pinned',
            keptOrder: JSON.stringify(sorted.slice(0, at)) === JSON.stringify(PINNED)
          };
        })()
      };
    })
  : { modules: [], legacy: [], soloCorner: [], roomList: [], dupes: [],
      order: [], sections: [], small: [], wide: [], counts: {},
      unlisted: {},
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
    # Which of those are `solo: true` in their own source — read, not listed.
    solo_module_ids = [g.parent.name for g in GAMES
                       if re.search(r"\bsolo:\s*true\b", g.read_text(encoding="utf-8"))]

    with sync_playwright() as p:
        br = p.chromium.launch()

        # ---- as a production bundle: the glob call replaced by a loader map,
        # which is precisely what Vite emits.
        pg = br.new_page()
        warnings = []
        pg.on("console", lambda m: warnings.append(m.text) if m.type == "warning" else None)
        pg.set_content("<!DOCTYPE html><html><body></body></html>")
        pg.evaluate("() => { window.BUB_GAMES = " + json.dumps(LEGACY) + "; }")
        pg.evaluate("(ids) => { window.__soloIds = ids; }", solo_module_ids)
        pg.evaluate("(ids) => { window.__pinned = ids; }", PINNED_FOR_MENU)
        # real loader *functions*, not JSON strings — a string would throw
        # inside the registry and be swallowed as "game module failed"
        # Real player ranges for the module games, because the menu grouping is
        # under test: a stub of '1-2' for everything would group them all as
        # small tables and the assertions would be about the stub.
        # SOLO mirrors it for the same reason, in the other direction: a module
        # with `solo: true` has no place in the multiplayer menu, and stubbing
        # every game as soloable would put it in one. Read the real flag rather
        # than maintaining a second list of which ids are solo by hand.
        pg.evaluate("""(ids) => {
          const RANGES = {
            dotreturn: '2-8', eggs: '2-8', hook: '2-8', minigo: '2'
          };
          const SOLO = new Set(window.__soloIds || []);
          window.__loaded = {};
          ids.forEach((id) => {
            window.__loaded['../games/' + id + '/index.js'] = () => Promise.resolve({
              meta: SOLO.has(id)
                ? { id: id, title: id, players: 'solo', solo: true }
                : { id: id, title: id, players: RANGES[id] || '2-8', soloable: true }
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
        # A SUBSEQUENCE, not equality. The fixture cannot produce the whole
        # menu (it registers four stand-in module ids plus the legacy list), and
        # the menu now grows without anyone editing this file — which is the
        # change that made equality wrong. What still has to hold is that every
        # id this fixture can produce is present, in this relative order.
        ("the multiplayer menu is in the order people asked for",
         is_subsequence(MENU_ORDER, got["order"])),
        ("the small tables group first", got["sections"][0] == "Two or three players"),
        ("the 2-8 crowd is its own group", got["sections"][1] == "Two to eight players"),
        # Two groups and no third: a game that needs three and takes eight is
        # not "other", it is one of the eight-player tables.
        ("there is no leftover Other group", len(got["sections"]) == 2),
        # The reason a new game is two files and not four.
        ("a game absent from MENU_ORDER still reaches the menu",
         got["unlisted"].get("stillThere") is True),
        ("...and lands after every pinned one", got["unlisted"].get("last") is True),
        ("...without disturbing the order of the pinned ones",
         got["unlisted"].get("keptOrder") is True),
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