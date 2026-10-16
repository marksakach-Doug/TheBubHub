#!/usr/bin/env python3
"""Host kick + refresh-ghost cleanup (offline — node, no browser needed).

Loads the SHIPPED modules via tests/kick_ghost.mjs (not a re-implementation)
and asserts the behaviour the room fix depends on: KICK on the wire, seat
freed on removal, refresh-rejoin reclaiming the old slot, game-state prune,
and sane heartbeat constants. Also greps src/main.js for the wiring the
harness cannot see (boot button, dropGuest/pruneGames call sites, KICK and
PING handling).

    python3 tests/kick_ghost_test.py
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HARNESS = ROOT / "tests" / "kick_ghost.mjs"
MAIN = ROOT / "src" / "main.js"


def main():
    fails = []
    try:
        raw = subprocess.run(
            ["node", str(HARNESS)], capture_output=True, text=True,
            cwd=str(ROOT), timeout=60,
        )
    except FileNotFoundError:
        print("FAIL: node not found on PATH")
        return 1
    if raw.returncode != 0:
        print(f"FAIL: harness exited {raw.returncode}\n{raw.stderr[-2000:]}")
        return 1
    try:
        cases = json.loads(raw.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        print(f"FAIL: harness printed no JSON\n{raw.stdout[-2000:]}")
        return 1
    for label, ok in cases:
        print(('PASS' if ok else 'FAIL') + ': ' + label)
        if not ok:
            fails.append(label)

    # Structural wiring in the hub shell (behaviour lives behind PeerJS/DOM).
    src = MAIN.read_text(encoding="utf-8")
    wiring = [
        ("roster shows a boot button to the host", "⛔ boot" in src),
        ("doKick sends KICK then drops the guest",
         "function doKick" in src and "T.KICK" in src and "dropGuest(id)" in src),
        ("host cannot kick itself", "id === s.me.id" in src),
        ("guest-left path prunes games", "kind === 'guest-left'" in src
         and "dropGuest(p.id)" in src),
        ("HELLO reclaims refresh ghosts", "findReclaimId" in src),
        ("heartbeat sweeps silent guests", "startHeartbeat" in src
         and "DEAD_MS" in src and "T.PING" in src),
        ("kicked guest leaves without redialling",
         "m.type === T.KICK" in src and "Removed by the host." in src),
        ("removal prunes module + legacy state", "function pruneGames" in src
         and "prunePlayerState" in src and "pushRosterToGames" in src),
    ]
    for label, ok in wiring:
        print(('PASS' if ok else 'FAIL') + ': ' + label)
        if not ok:
            fails.append(label)

    if fails:
        print(f"\n{len(fails)} FAILURE(S)")
        return 1
    print(f"\nALL GREEN ({len(cases) + len(wiring)} checks)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
