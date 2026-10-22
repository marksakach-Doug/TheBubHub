# Bub Hub — Peer-to-Peer Arcade

Bub Hub is a small multiplayer arcade for browser games. The **hub** owns rooms,
chat, invites, seating, networking and the shared record sheet. A **game** is
just rules and pixels — it never talks to PeerJS, never manages a roster, and
never decides who is seated.

There are two kinds of game:

| | New **module game** (recommended) | **Legacy iframe game** |
|---|---|---|
| Lives in | `games/<id>/index.js` | `public/<name>.html` |
| Registered by | dropped into `games/` — auto-globbed | one line in `public/games.js` |
| Runs in | a Shadow DOM root inside the hub | its own `<iframe>` |
| Talks to the hub via | `api.send(action)` + `reduce()` | a `postMessage` bridge |
| Networking | hub calls your `reduce()` and `project()` | you implement host/guest yourself |
| Seating | hub-owned, handed to you | you implement it |

Start with [`games/nim/index.js`](games/nim/index.js) — a small, complete game
in one file, and the shortest path to understanding the contract.
[`games/dotreturn/index.js`](games/dotreturn/index.js) is the deep reference for
a game that has to think about authority, timing and hiding things; it is 1,145
lines and copying it invites copying its rules.

---

## Contents

1. [Quick start](#quick-start) · 2. [The module contract](#the-module-contract) · 3. [The `api` object](#the-api-object)
4. [Seating, solo and spectators](#seating-solo-and-spectators) · 5. [UX conventions](#ux-conventions)
6. [Hub behaviours that affect you](#hub-behaviours-that-affect-you) · 7. [Networking model](#networking-model)
8. [BubHub Record](#bubhub-record) · 9. [Registry reference](#registry-reference)
10. [Testing](#testing) · 11. [Run, build, deploy](#run-build-deploy) · 12. [File map](#file-map)
13. [Engine notes](#engine-notes) · 14. [Legacy iframe games](#legacy-iframe-games-compat)

---

## Quick start

### A new module game

1. **Run the hub.** `npm install` then `npm run dev`, and open
   <http://localhost:5173>. (ES modules need HTTP — `file://` will not work.)
2. **Create `games/<id>/index.js`** exporting the six functions in
   [the module contract](#the-module-contract). Copy `games/dotreturn/index.js`.
3. **Reload.** `src/registry.js` globs `games/*/index.js` at boot, so the button,
   its tooltip, invites and the record entry all appear on their own. There is
   no other file to edit.

The only rule that is genuinely new: **all state changes go through `reduce()`,
and `reduce()` is the only thing that runs on the host.** Your click handler
calls `api.send(action)` and then waits for the hub to hand you a new `view`.
Never mutate anything you rendered from.

### A legacy iframe game

1. Put a self-contained `.html` file in `public/`.
2. Add one line to `public/games.js`:

```js
{ id: 'mygame', file: 'my-game.html', title: 'My Game', players: '2-4',
  color: '#00ffcc', icon: '🎯', desc: 'One sentence for the button tooltip.' },
```

3. Reload. The game speaks the `postMessage` bridge described in
   [Legacy iframe games](#legacy-iframe-games-compat).

Files in `public/` are copied verbatim to the site root, so a game can use
relative asset paths (`assets/music/…`) exactly as it did before.

---

## The module contract

One ES module per game. All six exports are mandatory unless noted.

```js
export const meta = { id: 'mygame', title: 'My Game', players: '2-4',
                      color: '#00ffcc', icon: '🎯', desc: '…', soloable: true };
```

`meta.id` must be unique across `games/` **and** `public/games.js` — a module
wins over a legacy entry with the same id. See
[Registry reference](#registry-reference) for every field.

### `init(ctx) → state`

Runs once, host-side, when the game is first opened. `ctx` is
`{ seats: <the whole room roster>, atTable: <who opened this game>, options: {} }`.
Seat `atTable`, not `seats` — see
[Seating, solo and spectators](#seating-solo-and-spectators). Return a plain,
JSON-serialisable object — it is cloned into `project()` and shipped to every
client.

State is cached and restored, so it survives a reload and a late joiner.

### `reduce(state, action, ctx) → state | { error }`

The heart of the game. **Host-side only, and the only place state changes.**

- `action` is whatever object you passed to `api.send()`.
- `ctx` is `{ from: { id, name, host }, rng }`.
  - `from.id` is the sender. **Key everything on `id`, never on `name`** — names
    change and get deduplicated mid-session.
  - `from.host` is true when the sender is the room's host (a solo room has a
    host too). Gate anything the table shares on it — dealing a new round,
    skipping a phase, resetting — so one player cannot move everyone.
  - `rng` is a `Math.random` reference handed to you by the hub. Use it instead
    of calling `Math.random()` directly so rolls stay deterministic under a
    seeded replay, and so a bug is reproducible.
- Return the next state to apply it, or `{ error: '…' }` to reject. A rejection
  is routed straight back to the sender as a denial you must display.

**Every action, from every source, arrives here** — a local click and a remote
guest's `send()` are indistinguishable. So keep one `reduce()` and let it be the
only path to a mutation. A disabled button protects nobody: anyone can call
`api.send({ a: 'resign' })` directly.

```js
export function reduce(state, action, ctx) {
  const id = (ctx && ctx.from && ctx.from.id) || '';
  if (state.over) return { error: 'This game is already over.' };
  if (!id || state.players.indexOf(id) < 0) return { error: 'You are watching — not seated.' };
  if (id !== state.turn) return { error: "It isn't your turn." };
  // …mutate a copy, return it
}
```

Return **new** objects rather than mutating `state` in place. The previous
state may already have been handed to `project()` for another player.

### `project(state, playerId) → view`

Runs **once per player, every time state changes**, host-side. Its return value
is exactly what that one client renders. This is the multiplayer safety valve:
anything a player must not see has to be stripped *here*, because the UI will
happily paint whatever it is handed.

```js
export function project(state, playerId) {
  const boost = {};
  state.players.forEach((id) => { boost[id] = (id === playerId || state.over) ? state.boost[id] : null; });
  return { ...state, boost, you: playerId };
}
```

Skip `project()` and you have shipped every hidden value to every client.
Also the right place to compute "whose turn is it" from `playerId`, so each
client renders its own perspective from one shared snapshot.

### `mount(root, api) → { update, destroy }`

Build the DOM. `root` is a **Shadow DOM** node, so your ids and classes cannot
collide with the hub's or with anything else — no prefixing needed, and you
cannot reach the hub's DOM either.

Return an object with:

- `update(view)` — called with the result of `project()`. Re-render from `view`
  alone; never read the authoritative state directly.
- `destroy()` — optional. The hub already cancels your tracked loops and
  empties the shadow root. Clean up only what it cannot see: audio, sockets,
  observers.

`mount()` is wrapped in a try/catch — a throw shows an error card instead of a
blank frame.

### `roundId(state) → string` (optional)

Called by the hub alongside `summarize()`. Returns a stable id for the round
`state` is currently in — the epoch, a deal number, anything that changes when
a new round starts and holds still until the next one.

This is what the record dedupes on. `summarize()` keeps returning the same
sentence for the rest of a round (the hub calls it after every `reduce()`), so
without a round id the hub can only dedupe on the text — which needs a rate
limit, and a rate limit cannot tell "the same round reported again" from "a
second game that happened to score the same". The limit dropped the second and
let the first through in sheets.

```js
export function roundId(state) { return 'e' + state.epoch; }
```

Legacy games send the same thing as `inst` in their `result` payload. A game
with neither still works — it just falls back to a 30-second text limit.

### `prune(state, goneId) → state` (optional)

Called by the host when a player leaves the room, times out, is kicked, or
moves to a different table. Return the state with that player's seat removed.

Export it when your state has its own membership that the shared pruner cannot
see. `room/presence.js` only knows Dot Return's `players` / `table` / `dots`;
Hook keeps an `order` of seats plus `names`, `scores`, `locked`, `subs` and
`votes`, and without a `prune` a departed player holds a seat forever — which
matters most in a game with no clock, because a round that waits for everyone
can then never end. Return the *same object* when there was nothing to remove.

```js
export function prune(state, goneId) {
  if (state.order.indexOf(goneId) < 0) return state;
  return { ...state, order: state.order.filter((id) => id !== goneId) };
}
```

### `summarize(state, nameOf) → string | null`

Called by the hub after every `reduce()` on the host. Return one sentence to
record, or `null` for nothing. `nameOf(playerId)` resolves an id to a display
name using the hub's own roster — never compose names yourself, or you will
write "your friend beat the bot" into a shared sheet nobody can edit.

```js
export function summarize(state, nameOf) {
  if (!state.over || !state.over.winner) return null;
  return `${nameOf(state.over.winner)} won ${meta.title}`;
}
```

The hub de-duplicates by `roundId()` if you export one, and otherwise by
`date|game|text` under a 30-second limit. Return `null` until the game is
genuinely decided — returning a "still playing" line every move defeats the
point of recording results.

Writes go through a `localStorage` outbox and retry, so a line survives being
offline and a reload. Nothing is lost to a failed `fetch` any more; the status
line under the record card says when something is still queued.

---

## The `api` object

The second argument to `mount()`. Built by the hub in `src/main.js:apiFor()`,
with loop-tracking added by `src/stage.js`.

| Field | Type | What it is |
|---|---|---|
| `me` | `{ id, name }` | You. Read `name` fresh on every render — it can change. |
| `seats` | `{ [seatNumber]: playerId }` | The hub's seat map. `0` is the first seat. |
| `roster` | `[{ id, name, host, game, spectator, bot }]` | Everyone in the room. |
| `isSpectator` | `boolean` | True when you are in a room but hold no seat. |
| `atTable` | `[{ id, name, host, game }]` | Who is actually at **your** table: same game, not watching. This is what `init()` should seat. |
| `isHost` | `boolean` | True when you host the room. Solo Corner is a room of one, so it is true there too. |
| `isInRoom` | `boolean` | False in the Solo Corner. Use it to tell "one player" from "nobody has joined yet". |
| `send` | `(action) => void` | Send an action. Host-side this runs `reduce()` locally; otherwise it goes to the host over the network. |
| `root` | ShadowRoot | Your DOM root. |
| `raf(fn)` / `cancelRaf(id)` | | Tracked `requestAnimationFrame`. Cancelled for you on teardown. |
| `setTimeout(fn, ms)` / `setInterval(fn, ms)` | | Tracked timers. Cancelled for you on teardown. |

`roster` and `atTable` are **snapshots taken when the game opened** — they do
not refresh. Anything that must stay live (how many players are at the table
right now) belongs in your projected state, which the hub re-sends on every
`reduce()`. A lobby that counts seats from `atTable` will not notice a guest
walking in.

`init()` receives that same table list under `ctx.atTable`, with the full room
roster still in `ctx.seats`. Seat `atTable` and filter out spectators: a room
holds the lobby and every other table too, so seating the roster hands people
dots for a game they never opened — and, because `join` is then a no-op for
them, they stay seated for the life of the state.

Use `api.raf`, `api.setTimeout` and `api.setInterval` rather than the globals.
They are recorded per mount and cancelled when the game closes, so **a game can
never leak a loop into the next one** — the single most common way a hub with
several games on one page starts melting.

---

## Seating, solo and spectators

**The hub owns seating. Games do not implement it.** There is no `claim` intent,
no `mySeat()`, no seat-reclaim-on-reconnect logic to write.

- Opening a game claims seat `0` for the opener if it is free
  (`src/main.js`). Anyone in a room without a seat is a **spectator**.
- A spectator is never seated implicitly. They can watch, and they can chat.
- `api.isSpectator` tells you which you are. **Make read-only mean read-only:**
  no move highlights, no enabled buttons, and say *why* it is read-only.

A frozen board with no explanation reads as broken. `"👁 watching — waiting for
your turn"` costs nothing and prevents every support question about a dead game.

**Solo is a room of one.** Pre-room (`inRoom === false`), the hub seats you at
`0`, marks you as host of your own table, and runs `reduce()` locally — there is
no network involved at all. There is no separate solo code path, no
"promote myself to local host" timer, and no `soloOrigin` flag to thread through
snapshots. All of that was v9 machinery; in v10 it is gone because the hub does
it for you.

To appear in the pre-room **Solo Corner**, set `soloable: true`. To *relax* the
minimum player count rather than invent a fake second seat, lower your own
check — the hub will happily let one person open the table.

---

## UX conventions

These are hub-owned behaviours a game must cooperate with.

- **You do not own the close button.** The hub closes games from the `✕` /
  `☰ Games` bar and from `Esc`. Never ship your own Hide/Close.
- **No hover-only UI.** The hub runs on phones and the room UI is a drawer. Use
  pointer events for drag/tap so touch works.
- **Tap targets ≥ ~40px** on small screens; test at 390px wide.
- **Name the sides or pieces clearly** rather than relying on colour alone.
- **Keyboard:** `Esc` closes the stage. Don't fight it.
- **Stay in the game.** Players can open several games at once, side by side, in
  one room. Do not assume a game is the only thing on screen, and do not assume
  a game it did not open has gone away.

---

## Hub behaviours that affect you

- **Opening a game never yanks anyone.** Rooms show passive "Table: Chess —
  Ann, Bo" bars with a **Join table** button. Nobody is pulled into your game.
- **Tables are derived from presence**, not a separate protocol. The roster
  drawer groups people by the game they have open, and people with none show as
  "in lobby".
- **Chat is players only.** Game chatter is dropped on purpose.
- **Duplicate names get numbered** — two "john"s become `john` and `john1`, and
  the host renumbers a colliding newcomer on join and tells them. Read
  `api.me.name` fresh; key state on `id`.
- **First visit shows a blocking name modal.** The hub always has a name for you
  (an animal suggestion), so games never handle "no name".
- **Game buttons compute their own text colour** from the background brightness,
  so any hex in `color` works.
- **No rejoin bar, by design.** A reload does not offer a one-click "rejoin" —
  rejoining is an explicit act (paste an invite link, or host again). Your game
  should never assume a seamless restore; expect a fresh mount.

---

## Networking model

- **Hosting a room claims a PeerJS id** — that id *is* the room code.
  **Joining** connects to it. There is no game server.
- **Hub-and-spoke through the host.** Guests send to the host; the host relays
  and owns all state. Your `reduce()` is the host's reducer.
- **There is no host migration.** If the host drops, guests see a 30-second
  countdown ("Host reconnecting… Keep this tab open") and keep redialing the
  same room id with capped backoff (1.5s → ×1.5 → 5s). When it expires the room
  closes, names are kept, and everyone starts a fresh room.
- Hosting retries a just-released room id up to 5 times before giving up.
- Presence is broadcast as each player opens or leaves a game.

**Practical consequence:** the table is authoritative and short-lived. Never
persist anything important to `localStorage` as if a session were permanent, and
make `init()` cheap — it re-runs for every fresh table.

---

## BubHub Record

Finished games can write one line to a shared sheet. You do not write it
yourself — you implement `summarize()` and the hub composes and sends it.

- The host records; guests receive the line over the wire.
- The hub appends the date and de-duplicates.
- `noRecord: true` in `meta` opts out entirely.
- **Every game should send a real result.** The generic usage line is a safety
  net for legacy games that have not been wired up yet, not a finished feature —
  "Sam played Blast Off!" says nothing.
- If a game has no natural final round, report it when the session ends: reset,
  rematch, or leave.

**Legacy games are the awkward case.** They post whatever payload they always
did — `Hub.up('result', { players, laps })`, `{ win, score }`, and so on. Those
shapes used to be turned into a sentence by `bub-record.js`, which the v10 shell
no longer loads. So `plugins/record.js` reconstructs the line in
`describeLegacy()`, resolving ids against the hub roster.

Every registered legacy game has a rule there today — chess, LOTR, Warp Front,
Blast Off!, Grammar, Word Bridge, The 96 Game, Dal Tadka and Waltz Engine —
plus a generic fallback, so a new legacy game records something rather than
vanishing. A game that sends a pre-formatted `text` needs no rule and always
wins.

**Adding a legacy game that records? Add a case to
`tests/record_legacy_test.py` while you are there.** The rules were ported from
`bub-record.js`, with two deliberate differences: the title now comes from the
registry's `meta.title` (so Warp Front no longer records itself as `warp`), and
counts are pluralised correctly (`1 lap`, not `1 laps`).

---

## Registry reference

For **module games** this is `meta` in `games/<id>/index.js`. For **legacy
games** it is one object in `public/games.js` — `file` is required there and
ignored for modules.

| Field | Required | Meaning |
|---|---|---|
| `id` | ✅ | Unique key. Matches your directory name for module games. |
| `title` | ✅ | Display name (buttons, invites, chat, record). |
| `file` | legacy only | HTML file for an iframe game. |
| `players` | ✅ | `'2-4'` or `'solo'`, or `{ min, max }` for nicer tooltips. Informational in-room; also the grouping key. |
| `color` | – | Accent for the button and table bar. Button text colour is computed from its brightness, so any hex works. |
| `icon` | – | Emoji before the button label. |
| `desc` | – | One sentence in the button tooltip. |
| `solo` | – | `true` → Solo Corner; the game is bridge-less by nature. |
| `soloable` | – | `true` → also runs a solo table, so it lists pre-room. Keeps its real `players` count in-room. |
| `lobby` | – | `true` → listed pre-room even if it cannot be *played* alone. Escape hatch; prefer `soloable`. |
| `fill` | legacy only | `true` → viewport-fill game; the hub owns the frame height and ignores any height the game reports. Use for canvas worlds. |
| `grow` | legacy only | `true` → the frame is sized to the game and the whole page scrolls. Use instead of `fill` when a nested scroll on a phone would be worse. |
| `height` | legacy only | Minimum stage height (px) for an iframe game. |
| `menuLabel` | – | Button text only (title/invites/chat/record untouched). For things that are not really "played". |
| `noRecord` | – | `true` → never write to BubHub Record. |

Sections are derived: a game that is neither `solo` nor `soloable` nor `lobby`
appears only in the in-room multiplayer list, never pre-room. Buttons are
listed flat, not grouped by player count.

---

## Testing

There is no unit-test framework, but there is one command that checks the things
worth checking:

```bash
./test.sh                  # syntax + secrets + lockfile + record sentences + game rules
./test.sh --skip-browser   # syntax only — fully offline, no Chromium needed
```

Exit codes: `0` all green, `1` a test failed, `2` environment problem
(missing `python3` or `esprima`).

Prerequisites: `pip install esprima playwright && playwright install chromium`.
Without a browser the suite **fails loudly** rather than quietly skipping — use
`--skip-browser` if that is what you want.

| Script | What it does |
|---|---|
| `tests/jscheck.py` | Parses every `<script>` in the hub, `games/`, and every game in `public/` with a real JS parser. The cheapest way to catch a typo before you reload. |
| `tests/record_test.py` | Runs the legacy `bub-record.js` against stub rosters and checks the exact sentence each payload produces. That file is **not** loaded by the running hub — this is a regression guard for it. |
| `tests/record_legacy_test.py` | Runs the **live** legacy path, `plugins/record.js:describeLegacy()`, and checks the sentence every legacy game actually gets today. |
| `tests/lockfile_test.py` | Fails if `bun.lock`'s format drifts from the bun pinned in `.bun-version` (Cloudflare runs `bun install --frozen-lockfile` with 1.2.15), and runs that frozen install to prove it. No browser. |
| `tests/secrets_test.py` | Fails if any credential-named file is in the working tree, if `.gitignore` stops covering those names, or if anything git would commit contains a literal API token. No browser, no dependency. |
| `tests/chess_rules.py` | Extracts the **real** move generator out of `public/chess.html` and runs it against textbook positions plus 40 full bot games. |
| `tests/module_registry_test.py` | Guards the dev-vs-build trap in `src/registry.js`: asserts no runtime `import.meta.glob` feature check exists, then runs the real `loadRegistry()` both as a built bundle (glob replaced by a loader map) and with no Vite at all. |
| `tests/dotreturn_test.py` | Loads the shipped `games/dotreturn/index.js` and checks its rules: the latched return tally, the reroll cooldown, the hidden score in `project()`, and the record sentence. |
| `tests/dotreturn_play.py` | Mounts Dot Return behind a fake `api` and a fake clock, then asserts on the **DOM**: it builds, the dot moves, a swipe reaches the host, a drift home asks for a new trajectory, and the tally only appears after the clock runs out. |
| `tests/chess_play.py` | **Currently broken** — it drives the pre-v10 shell over `file://` and was dropped from `test.sh`. Porting it to the Vite shell is a separate task. |

`chess_rules.py` works by **extracting the shipped function source** and running
it against assertions rather than re-implementing the rules, so it tests what
players actually play. That approach caught three real bugs during development.
Copy that idea for a game with rules worth trusting.

`module_registry_test.py` exists because a bug of exactly that kind shipped
silently: `loadRegistry()` guarded its glob behind
`typeof import.meta.glob === 'function'`, which is true under `npm run dev` and
**always false in a production bundle**, so every module game was missing from
the live site with no error anywhere. If you touch `src/registry.js`, run that
test and believe it.

The two Dot Return tests cover both halves of a continuous game: the rules that
must not drift, and the pixels. The play test found a real bug on its first run —
an intent sent from inside a frame re-entered `update()` and started a second
`requestAnimationFrame` loop, which a null `rafId` guard cannot catch.

For anything interactive, drive the page with Playwright and assert on the
**DOM**, not on private state. Watch for page errors the whole time — a silent
`ReferenceError` in a game looks exactly like "nothing happens".

---

## Run, build, deploy

The live site is **<https://bubhub.us>**. (There is no thebubhub.com; `thebubhub`
in `wrangler.jsonc` is the Cloudflare Worker's *name*, not a domain.)

```bash
npm install
npm run dev       # Vite dev server on http://localhost:5173 (LAN-exposed)
npm run build     # → dist/
npm run preview   # serve the production build
```

Deployment also targets **Cloudflare Workers** with static assets, via
`@cloudflare/vite-plugin`:

```bash
npm run deploy    # bun run build && wrangler deploy
```

> `npm run deploy` shells out to `bun`. If you don't have Bun installed, run
> `npm run build && npx wrangler deploy` instead.

### Deploying (and keeping the credential out of git)

**Pushing to `main` deploys <https://bubhub.us>.** A failed build leaves the live
site on the last good deployment, so check the log before assuming the site is
broken. To publish without pushing (this path goes out through `wrangler deploy`):

```bash
bun install
bun run build
(cd dist && python3 -m http.server 5180)   # verify the artifact BEFORE publishing
CLOUDFLARE_API_TOKEN="$(cat ~/.config/bubhub/cloudflare-token)" bunx wrangler deploy
```

Verify `dist/` in a browser before you publish — it is the exact artifact that
ships, so it catches a broken build without touching production.

**The token lives at `~/.config/bubhub/cloudflare-token` (mode 600), outside the
repo.** It is the only copy. Never write it into a tracked file, never echo it,
never paste it into a commit or chat; `tests/secrets_test.py` fails the suite if
one reaches anything git would commit. The `account_id` in `wrangler.jsonc` is
*not* a secret — it is there so the deploy knows which account it is publishing
to.

**The lockfile is a contract with CI.** Cloudflare runs
`bun install --frozen-lockfile` with **bun 1.2.15**, pinned in `.bun-version`.
`bun install` writes `bun.lock` in whatever format the *local* bun writes, and
bun 1.3+ writes `"lockfileVersion": 2`, which 1.2.15 cannot parse:

```
error: Unknown lockfile version
  at bun.lock:2:22
warn: Ignoring lockfile
error: lockfile had changes, but lockfile is frozen
```

That is a hard failure on every push, from a commit that changed no
dependencies — it happened here once. So: install dependencies with the pinned
bun (1.2.15 is the default `bun` on this machine, 1.4.3 is aliased
`bun-1.4.3` and must not install here), and let
`tests/lockfile_test.py` — which also runs the real frozen install — catch any
drift.

- `wrangler.jsonc` names the worker `thebubhub` — a worker name, not a domain —
  and serves `dist/`.
- `cloudflare()` must stay in the `plugins` array of `vite.config.js` — wrangler
  refuses to auto-configure a config without a plugin.

### Testing a module game

`npm run test:syntax` (`./test.sh --skip-browser`) parses every script and game
module offline — no browser, no node. `npm run test` adds the browser suites,
which need Playwright + Chromium. A new module game belongs in `test.sh` in the
same commit as its code; an unwired test is a test nobody runs.

**Requirements and limits worth knowing before you start:**

- **ES modules need HTTP.** There is no `file://` support. Opening
  `index.html` from disk shows an empty arcade.
- **`python3 -m http.server` does not work** for the hub: it does not serve
  `public/` at the root and cannot resolve `import.meta.glob`, so the registry
  comes up empty. Use `npm run dev`.
- PeerJS and Tailwind load from CDNs, so the whole arcade **degrades offline**
  and **multiplayer does not work offline**. Prefer inline data and CSS-drawn
  assets in a game over anything fetched at runtime.
- Games are cached hard. If two players see different things, both hard-reload
  (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).

---

## File map

| File | Touch? | Purpose |
|---|---|---|
| `games/<id>/index.js` | ✅ to add a game | A module game. Auto-registered; the only file you create. |
| `public/games.js` | ✅ for legacy games | The legacy registry — one line per iframe game. |
| `public/*.html` | ✅ for legacy games | The legacy games. Copied verbatim to the site root. |
| `public/vietgames/` | ✅ for the Vietnamese site | Standalone VietGames mini-site, served at `/vietgames`. Not a hub game — never add it to `public/games.js`. |
| `index.html` | Rarely | Hub shell markup + the few CSS rules that own the stage frame. |
| `src/main.js` | Rarely | Orchestrator: identity → lobby/room → net → stage → plugins. |
| `src/registry.js` | Rarely | Loads `games/*/index.js` via `import.meta.glob`, merges in `window.BUB_GAMES`. |
| `src/stage.js` | Rarely | Shadow DOM stage, per-mount error boundary, forced teardown of tracked loops. |
| `src/compat.js` | Rarely | The legacy `postMessage` bridge, reimplemented on top of the v10 store. |
| `room/store.js` | Rarely | The roster: identity, seats, presence, cached state. Source of truth. |
| `room/grace.js` | Rarely | The 30-second host-loss countdown. |
| `net/peer.js` | Rarely | PeerJS wrapper. TURN servers via `window.BUB_TURN`. |
| `net/protocol.js` | Rarely | The wire message types. |
| `plugins/chat.js` · `invite.js` · `record.js` | Rarely | Player chat, share links, the record sheet. |
| `tests/*` | – | `jscheck.py`, `chess_rules.py`, `record_test.py`, `record_legacy_test.py`, `dotreturn_test.py`, `dotreturn_play.py`, `chess_play.py` (broken). |
| `.bun-version` | ✅ | The bun version Cloudflare Workers Builds runs. `bun.lock` must be written by *this* bun, or the build fails on every push. |
| `AGENTS.md` | ✅ | The short operating manual for coding agents: the loop, the deploy path, the credential rules, and the gotchas that have already bitten. |
| `test.sh` | – | One command for the checks above. |
| `bub-record.js` | Rarely | Legacy sentence composer. **Only `tests/record_test.py` uses it now**; the running hub goes through `summarize()`. |

---

## Engine notes

Three games carry their own non-trivial logic; all are documented so they can be
copied or fixed.

### Chess (`public/chess.html`)

Own move generator, no library. Board is 64 slots with **index 0 = a8**, so
`sq = file + (8 - rank) * 8`; the renderer draws `row = vr` so White sits at the
bottom.

- `pseudo()` generates king-moves-legal moves (castling, en passant, all four
  promotion pieces); `legal()` runs each through `applyMove()` on a clone and
  drops any that leave your own king attacked.
- En passant lands on the square **directly ahead** (the one the double push
  skipped) and the captured pawn sits at `to - 16` — for both colours, because
  rank 8 is index 0. Easy to get wrong and invisible in testing unless you test
  it.
- Promotions are generated queen-first, so "first match wins" = auto-queen.
- Draws: stalemate, fifty-move, threefold repetition, insufficient material.
- The bot is intentionally 1-ply (material swing, a "will this hang?" check, a
  check bonus, jitter). It can only ever pick from `legal()`, so it cannot cheat.

### Eggs (`games/eggs/index.js`)

Damage-% knockback plus a Mario-style mushroom: the `bean` grows you
BIG → HUGE → TITAN with **no timer** — the size is *spent* by taking a hit
(`shrinkEgg`), and only the abyss or a star still kills you outright.

### Dot Return (`games/dotreturn/index.js`) — a continuous game

The contract has **no tick**: `reduce()` runs when a player sends an intent, and
that is the only time state changes. A game that moves every frame has to split
its physics from its authority, and this one does it like so:

- **Clients integrate, the host decides.** Every client runs the same fixed
  `DT = 1/60` step over every seated player's dot from the same authoritative
  headings, so the table sees one motion. Only the things that must not drift
  live in state: the shared return tally, the headings, the round clock, and an
  `epoch` that clients re-anchor on. The simulation lives in `mount()`'s own
  closure and `view` is only ever read.
- **Anything that must be agreed on is an intent.** `swipe`, `reroll`, `exit`,
  `in`, `start`, `finish`, `join` — all validated host-side, all broadcast.
  A dot that drifts back to dead centre asks for a `reroll` and the *host* rolls
  the new direction, so every client gets the same trajectory; a locally rolled
  `Math.random()` would make the same dot fly two ways on two screens.
- **Client-detected crossings still need a host latch.** A dot leaving the
  hidden circle is noticed locally and reported as `exit`, but the tally only
  moves when `dots[id].out` was false. Without that latch a client that
  re-reports the same crossing — or two clients that disagree by a pixel —
  inflates a number everybody is being timed on.
- **`project()` is where the round's tension lives.** `returns` is sent as
  `null` until `phase === 'over'`, so the reveal cannot leak early.
- **One `running` flag, not a null `rafId`.** An intent sent from inside a frame
  comes straight back through `update()` mid-frame, so the loop guard has to
  survive re-entry — `tests/dotreturn_play.py` asserts there is exactly one.

---

## Legacy iframe games (compat)

The fifteen registered legacy games are single self-contained `.html` files in
`public/`. They run in an `<iframe>` and talk to the hub with a `postMessage`
bridge that `src/compat.js` translates. **This path still works and is still
tested, but new games should use the [module contract](#the-module-contract)**
— with the bridge you write the host/guest split, the seating and the host-loss
handling yourself, and none of that is enforced for you.

### Anatomy

One self-contained `.html`. No imports, no bundler, no CDN. Wrap everything in
an IIFE so nothing leaks onto the shared `window`. You own the close button
*less* than in a module game (the hub closes frames), but you do still own your
layout height and your `hide`/`show` handling.

### Messages you send (`gu` = game-up)

| `k` | `p` | What the hub does |
|---|---|---|
| `hello` | – | Marks the frame ready, flushes queued mail, pushes a `roster`. Send on load **and** on the first click (covers slow frame startup). |
| `height` | number | Resizes the frame, clamped to 200–4000px. **Ignored if the registry sets `fill: true`.** |
| `intent` | any JSON | Non-host → forwarded to the host. Host → fed to your own `onIntent`. |
| `state` | any JSON | Host only. Broadcast to every peer. |
| `say` | string | **No-op.** Game chatter is dropped on purpose; notifications do not go in the chat log. |
| `result` | `{ text }` | Logs one line to the shared sheet. |
| `denied` | `{ to, text }` | Routes a rejection back to one player. |
| `close` | – | Hides your own frame. |
| `invite` | – | **Accepted but does nothing.** Auto-open was removed; tables are passive bars now. |

### Messages you receive (`gd` = game-down)

| `k` | `p` / `from` | Meaning |
|---|---|---|
| `roster` | `{ you:{id,name,isHost}, room, roster:[{id,name,host}] }` | Who is here. Re-sent on every join/leave/rename — treat it as the source of truth for seats. |
| `state` | host state + `from` | Authoritative snapshot. Guests render it; they never simulate. |
| `intent` | guest action + `from` | Host only. Validate, apply, then broadcast `state`. |
| `denied` | `{ text }` | One of your intents was rejected. Show it. |
| `hide` / `show` | – | Your frame was hidden/shown. Stop music, suspend your loop, then resume. |

There is no `reset` — v10 never sends one. Room teardown does not reach your
frame, so do not expect a courtesy notice that the table is gone.

### The golden rule

- **Guests never mutate shared state.** They `up('intent', …)` and render the
  next `state`.
- **The host is the only writer:** validate → mutate → `up('state', snapshot)`.
- **Validate on the host, always.** Use the same `handle()` for local input and
  remote intents, so a client cannot do something the host wouldn't allow.
- **A disabled button is not a check.** Disabling *Resign* for a watcher stops
  the honest path and does nothing about
  `postMessage({k:'intent', p:{a:'resign'}})` from anyone at all. Re-derive
  permission from state on the host and reply `denied` when it fails.
- **Never trust `from.name`** — use `from.id` and resolve the display name from
  your roster.
- **Anything true of the table rather than the position** (seats, solo/room
  origin) must be in every snapshot and every broadcast. A position-only clone
  silently drops them, and the symptom only shows up after an undo.

### Legacy registry extras

`fill`, `grow`, `height`, `lobby`, `menuLabel` and `noRecord` are documented in
[Registry reference](#registry-reference). `fill` and `grow` are mutually
exclusive: `fill` pins the frame to the viewport, `grow` lets the frame size to
the game so the whole page scrolls instead (prefer `grow` when a nested scroll
on a phone would be worse).

---

## Known issues

- `tests/chess_play.py` still targets the pre-v10 shell and fails; it is
  excluded from `test.sh`.
- **Goldberg does not record at all.** It never posts a `result` — the old hub
  inferred "someone played it" from activity, and that hook
  (`compat.hooks.onTouched`) is now an empty stub. It needs a debounce so it
  records once per session rather than on every click; that is a design call,
  not a missing rule.
- `bub-record.js` at the repo root is dead weight for the running hub. Only
  `tests/record_test.py` loads it, as a regression guard on the ported rules.
- `npm run deploy` assumes `bun` is installed.