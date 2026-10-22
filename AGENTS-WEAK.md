# AGENTS-WEAK.md — Bub Hub for a small coding model

Read this whole file before touching anything. It is the short version of
`AGENTS.md`, written as steps instead of explanations.

If a step here is unclear, stop and ask. Do not guess.

## Before you build a new game
Run MarkDougCheck idea mode (MARKDOUGCHECK.md) on the idea first.
DROP: stop and tell MarkDoug why. RESHAPE: build the reshaped version (the
verb must change, not just the skin).
If the idea could be played on paper tonight, say so first.
After building, run `Check games/<id>/` and put the verdict in your final message.

---

## 0. The one rule

**Never report a task as done without pasting the real output of the command
that proves it.**

A verdict with no output under it is not a result. If you did not run the
command, say "I have not verified this yet" and stop there.

Three ways this goes wrong, all of them avoidable:

| You might be about to | Instead |
|---|---|
| Say "looks good, ready to ship" | Run the check. Paste the last 20 lines. |
| Name the file you think caused a failure | Open the failing test. Read the assertion. |
| Assume a folder name's casing | `ls games/` and read it. |

---

## 1. Before you start

```bash
cd /home/mark/Documents/BubHub
cat AGENTS.md              # the full manual — read it, skim nothing
ls games/                  # copy the name EXACTLY, casing included
```

- Copy **`games/dotreturn/`** as your template. It is a complete working game.
- This filesystem is **case-sensitive**. `games/dotreturn` and `games/DotReturn`
  are different folders, and an import with the wrong case fails with
  `ERR_MODULE_NOT_FOUND`.

## 2. What this project is

A peer-to-peer arcade. The **hub** (`src/main.js`) owns identity, rooms, chat,
seating, networking and the record sheet.

**A game is only rules and pixels.** Your game must never touch any of that.

## 3. The loop

```bash
bun run test          # everything
bun run test:syntax   # offline, no browser needed
```

`bun run test` stops at the **first** failure. Read that one line, fix that
file, run again. Do not try to fix several failures at once.

A new test file must be added to one of `test.sh`'s two suite tables in the same
commit as the code it covers. A test that is not wired in never runs.

## 4. Reading a failure

**The failing assertion is your only evidence. Read it before you name a file.**

The test name is a label, not a diagnosis. A check called *"the multiplayer menu
is in the order people asked for"* says nothing about which file is broken —
open it and see what it actually reads and compares.

```bash
python3 tests/module_registry_test.py    # run one suite on its own
node tests/<game>_test.mjs
```

---

## 5. ✅ What you can do

| Task | Where |
|---|---|
| Write a new module game | `games/<id>/index.js` |
| Write a legacy iframe game | `public/<name>.html` + one line in `public/games.js` |
| Write a test for a game | `tests/<game>_test.py` or `.mjs` |
| Fix a game, after reading its own test | `games/<id>/` |
| Add content or data | e.g. Hook's `PAIRS` |

## 6. ⛔ Hand these back

Stop and ask a human. Say what you found and what you would have done.

| Do not touch | Why |
|---|---|
| `src/main.js`, `src/registry.js`, `room/`, `net/`, `plugins/` | Hub core. Everyone's rules live here. |
| `test.sh` suite tables | Mis-wiring one halts the entire suite for everyone. |
| `bun.lock`, `bun install` | One command with a newer bun breaks every future deploy. |
| `git push`, `wrangler`, `bun run build` | Pushing to `main` **deploys to the live site.** |
| `~/.config/bubhub/` | Contains a live credential. Never read it, write it, or paste it anywhere. |
| Renaming or moving any file | Breaks imports in ways the tests will not explain. |
| `tests/presence_test.py`, `tests/chess_rules.py` | They assert on *exact source lines*. A tidy refactor breaks them with no useful error. |

---

## 7. Adding a game — the checklist

If a builder agent is available (`@builder`), skip to step 9 and let it write
`index.js`. These steps are what you do when there is not one.

1. `ls games/` — confirm the folder name and its exact casing.
2. `meta.id` **must match the folder name, casing included.** A test compares
   them, and a mismatch fails the suite for a reason that looks unrelated.
3. Copy `games/nim/index.js` — a small, complete module game whose parts are all
   named. `games/dotreturn/index.js` is the deep reference but it is 1,145
   lines, and copying it invites copying its rules.
4. **Every export needs the word `export` in front of it.** A function you only
   declare is invisible to the hub, and the game dies on open with
   `a.mount is not a function` — with no other symptom.
5. All state changes go through `reduce()`. There is **no tick** — nothing
   changes except when a player sends an action.
6. **Return a new state; never edit the one you were handed.** The previous
   state may already have gone to another player.
7. Never send anything from inside `mount()`. The hub has not assigned the
   handle yet — send from the first `update()`.
8. **Never let an action start a second animation loop**, and never leave
   module-level `let`/`var`. A global board is invisible to the hub, which is
   how a game ends up with a permanently empty screen: the hub holds one copy
   and `mount()` reads another.
9. Export `prune(state, goneId)` if your state keeps its own list of players.
   Without it, someone who leaves still holds a seat and the round deadlocks.
10. Write the card at `cards/<id>.md` and run `node scripts/new-game.mjs
    cards/<id>.md`. It writes `games/<id>/scenarios.json` (the spec, with the
    scenarios) and `games/<id>/index.js` (a working scaffold with the rules left
    blank). Fill in only the regions between the `BUILDER` comments.
11. Run `node scripts/check-game.mjs <id>` until it passes. Its **exit code** is
    the verdict — not the text on screen.
12. **Run `bun run test` and paste the output.**

## 8. The contract, in ten lines

- `init(ctx)` → state. Runs once. Seat `ctx.atTable`, not `ctx.seats`.
- `reduce(state, action, ctx)` → state, or `{ error }`. Host-side only. **The
  only place state changes.** Gate anything shared on `ctx.from.host`.
- `project(state, playerId)` → view. Runs once per player. **Strip anything a
  player must not see here** — the UI will paint whatever it is handed.
- `mount(root, api)` → `{ update, destroy }`. Build the DOM. Re-render from
  `view` only, never from state.
- `summarize(state, nameOf)` → one sentence, or `null`. Use `nameOf(id)` for
  names. Return `null` until the game is genuinely over.
- `roundId(state)` → a stable per-round id, so the record sheet can tell two
  identical scores apart.

Full detail with worked examples: `README.md`, section *"The module contract"*.

## 9. When you finish

Report:

1. What you changed, one line per file.
2. The **pasted output** of `bun run test`.
3. Anything you found but did not fix.
4. Anything you are unsure about.

If step 2 is missing, the work is not finished.
