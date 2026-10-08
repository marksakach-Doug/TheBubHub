# 🫧 Bub Hub — Peer-to-Peer Arcade

Bub Hub is a tiny, modular arcade for HTML games. The **hub** (`index.html`) owns rooms,
chat, and networking. **Games** are plain `.html` files that render in a shared stage and
talk to the hub through a small `postMessage` bridge. Adding a game never touches `index.html` —
you drop in a file and add one line to `games.js`.

No build step. No server. Double-click `index.html` and play. Multiplayer runs over
[PeerJS](https://peerjs.com/) (peer-to-peer, no game server).

## Layout (game first)

```
┌─────────────────────────────┐
│  Header (logo + name)       │
├─────────────────────────────┤
│  🎮 GAME STAGE (iframes)    │  ← the main thing; placeholder when empty
├─────────────────────────────┤
│  Lobby  — or —  Room UI     │
│    Room UI order:           │
│    1. game invites          │
│    2. chat                  │
│    3. room/game controls    │
├─────────────────────────────┤
│  Footer                     │
└─────────────────────────────┘
```

## Game sections

| Section | Where | Rule | Example |
|---|---|---|---|
| 🎲 **Multiplayer Arcade** | Room UI only | Entry has **no** `solo` flag | Warp Front, LOTR Cards |
| 🎯 **Solo Corner** | Room UI + lobby (if `lobby: true`) | Entry has `solo: true` | Waltz Engine |
| Lobby card | Lobby only | Entry has `lobby: true` | Waltz Engine ("while you wait") |

Sections render from the registry — a section with zero games hides itself automatically.

## Adding a game

1. Drop your `my-game.html` next to `index.html`.
2. Add one line to `games.js`:

```js
window.BUB_GAMES = [
  // Multiplayer (host-authoritative, needs a room):
  { id: 'mygame', file: 'my-game.html', title: 'My Game', players: '2-4', color: '#00ffcc' },

  // Solo (playable with no room; lobby:true also lists it pre-room):
  // { id: 'mygame', file: 'my-game.html', title: 'My Game', players: 'solo',
  //   color: '#d9b26f', solo: true, lobby: true, height: 640 },
];
```

3. Reload `index.html`. Done — buttons, iframes, invites, and roster all derive from the registry.

### Registry fields

| Field | Required | Meaning |
|---|---|---|
| `id` | ✅ | Unique game key. Must match the `game` field your file sends in every bridge message. |
| `file` | ✅ | HTML file loaded into the stage iframe. |
| `title` | ✅ | Display name (buttons, invites, chat). |
| `players` | ✅ | Display string (`'2-4'`, `'solo'`). Informational only. |
| `color` | – | Accent for lobby button + invite bar. |
| `solo` | – | `true` → Solo Corner instead of Multiplayer Arcade. Solo games skip the bridge. |
| `lobby` | – | `true` → also listed in the pre-room lobby card. |
| `height` | – | Fixed stage height (px). Solo games use this since they never report a height. |
| `fill` | – | `true` → viewport-fill game. The hub sizes the frame to the stage (focus mode) instead of trusting the game's reported height. For canvas worlds (Goldberg, Waltz Engine). |

### Solo vs multiplayer criteria

Ask two questions:

1. **Does it need another human?** No → `solo: true` (+ `lobby: true`, `height`).
2. **Does it need shared state?** Yes → multiplayer: exactly one **host** runs the rules,
   everyone else sends **intents**. The hub relays bytes and never reads rules.


## The game ↔ hub bridge (multiplayer)

Games live in a sandboxed-feeling iframe and reach the outside world only via `postMessage`.
Copy the pattern from `warpfront.html` / `lotr.html` (~15 lines):

```js
const GAME_ID = 'warp'; // must equal the registry `id`
const Hub = {
  up(k, p) { try { window.parent.postMessage({ t: 'gu', game: GAME_ID, k, p }, '*'); } catch(e) {} },
  on(e) {
    const m = e.data;
    if (!m || m.game !== GAME_ID) return;
    if (m.t !== 'gd') return;
    if (m.k === 'roster') onRoster(m.p);   // { you, room, roster[] }
    if (m.k === 'state')  onState(m.p, m.from);
    if (m.k === 'intent') onIntent(m.p, m.from); // host only
    if (m.k === 'denied') show(m.p.text);
    if (m.k === 'reset')  reset();
  }
};
window.addEventListener('message', Hub.on);
Hub.up('hello'); // 1. announce yourself; hub replies with roster
```

### Messages your game can send (`gu` = game-up)

| `k` | `p` | Hub does |
|---|---|---|
| `hello` | – | Marks the frame ready, flushes queued mail, pushes roster. |
| `height` | number | Resizes the stage iframe (`min(p, 4000)`). Report on load + resize. |
| `intent` | any JSON | Non-host → forwarded to host. Host → delivered to host's own engine. |
| `state` | any JSON | Host only. Broadcast to all peers. |
| `say` | string | Posted into room chat as the game title. |
| `invite` | – | Host only. Pops a "Show table" bar on every guest's screen. |
| `denied` | `{ to, text }` | Host only. Routes a rejection back to one player. |
| `close` | – | Hides your stage frame (hub shows the placeholder). |

### Messages your game receives (`gd` = game-down)

| `k` | `p` / `from` | Meaning |
|---|---|---|
| `roster` | `{ you: { id, name, isHost }, room, roster: [{ id, name, host }] }` | Who's here + am I host. Re-sent on every join/leave. |
| `state` | `p` = host state, `from` = `{ id, name }` | Authoritative snapshot (guests render, don't simulate). |
| `intent` | `p` = guest action, `from` = `{ id, name }` | Host only. Validate, apply, then `state`. |
| `denied` | `{ text }` | Your intent was rejected — show it. |
| `reset` | – | Room tore down — reset to a fresh table. |
| `hide` | – | Your stage frame was hidden — stop music, suspend your loop. |
| `show` | – | Your stage frame is visible again — resume (music stays off until requested). |

### The golden rule (Warp Front / LOTR pattern)

- **Guests** never mutate shared state. They `up('intent', …)` and render the next `state`.
- **Host** is the only writer: validate `intent` → mutate → `up('state', snapshot)`.
- Keep `state` small, serializable JSON (PeerJS relays it verbatim).
- Report `height` so the game fits the stage instead of scrolling inside it.

### Minimal host check

```js
let isHost = false;
function onRoster(r) { isHost = r.you.isHost; /* enable host-only buttons */ }
function onMove(move) {
  if (isHost) { applyMove(move); Hub.up('state', snapshot()); } // I am host
  else Hub.up('intent', move);                                   // ask the host
}
function onIntent(move, from) { if (valid(move)) { applyMove(move); Hub.up('state', snapshot()); } }
```

## Networking model

- **Host a room** claims a PeerJS id (= the room code). **Join** connects to that id.
- Topology is hub-and-spoke through the host: guests send to the host, the host relays.
  Chat and `say` follow the same path.
- `Disconnect` / unload destroys the peer and resets all game frames.

## Presence (who is where)

- Every hub broadcasts `{ type: 'presence', id, name, game }` on open/close/hello.
- The room controls render one chip per player (`#roster-list`): name + `in <game>` or `in lobby`, so you can tell which game everyone is in.

## Sessions, reconnects & host migration

- Your player id, display name, room, and role are kept in `sessionStorage`
  (`bubhub.session`), so a reload offers **Rejoin `<room>` as host/guest** in the lobby
  — and games that seat players by id (LOTR) keep your seat.
- Hosting retries a just-released room id 5× with backoff (`unavailable-id`) instead
  of silently minting a random room.
- Guests whose host link drops show **host lost — reconnecting…** and keep dialing
  the room with capped backoff until it answers.
- **If the host is really gone, the table moves instead of dying.** The lowest-id
  survivor claims the same room id (staggered 3s + 4s per rank, standing down the
  moment any host answers — the room id itself is the mutex, so only one host
  can win). Its game keeps the exact table it already holds (LOTR/Blast Off
  broadcast full state to every guest) and re-broadcasts; everyone else's
  reconnect loop lands on the same id and play continues. A returning host
  whose id is taken is offered **"Table moved to X — join them?"** and rejoins
  as a guest on its old seat. If nobody can take over, the room may start a
  fresh game instead — never silently.
- Clicks with no host link are answered **"host gone — waiting"** instead of
  vanishing. After ~60s of silence the pill says so explicitly (it keeps trying).

## Game chrome conventions

- **Hide**: the hub owns this — every game is closed from the hub's `✕ Stage`
  bar, which really hides the frame
  (`#game-stage iframe.hidden { display:none !important }`) and sends the
  game a `hide` message (stop music, suspend your loop). Games must NOT ship
  their own Hide/Close buttons.
- **Room number**: always visible in the focus bar (`Room <id> · N players`, click to copy).
- **Chat drawer**: dismissible via the 💬 pill toggle, the drawer ✕, or tapping the
  backdrop — never Esc-only.
- **LOTR choices are player choices**: a new card always opens a fit prompt
  (Equip / Stow / Discard, each naming its cost) instead of auto-equipping or
  auto-discarding; a full spare (`swap`), a full gear set (`stash`), a gear
  swap from a full set (`place`), an illegal weapon after a level drop
  (`illegal`), and a lost fight (`lose`) each open a tap-the-card decision;
  the engine never silently picks your cards (Narsil/K is excluded unless it
  is your only weapon). Explore and Fight are equal-weight buttons with the
  real trade-off spelled out (safe card vs risky Levels, with exact odds in
  words — no card is ever previewed).
- **Goldberg touch**: press a part, then drag it out on the stage (tap = default
  size) — the drag sets length + angle. Placed parts show canvas handles: end
  dots reshape, the ring turns, ✛ moves the pendulum anchor / lever pivot /
  catapult hinge. Tap a part twice for the lock/delete pill (⇄ flips
  conveyor / turntable / fan / spawner-what, FIRE shoots a cocked catapult,
  🎈 pops a balloon, 🔗 welds two parts into one rigid unit, 📋 copies).
  No spawn marker — balls are placed by tap like everything else. 🔔 bell rings
  its tuned chime when struck (tune root + scale + per-bell degrees in the 🎵
  drawer; G major out of the box). The catapult cocks by dragging its arm back
  past ~45° (or aim it with the ring), then fires on tap / F / knock — the arm
  is centred on its body with a real cup and a torsion spring that throws.
  Balloons pop on a hard hit and drop their bob as a ball. The spawner drops
  a ball/domino/block every 2s, oldest children culled past 8 alive. Clear
  needs every player in the room to approve (25s, one No cancels). 💾 Machines
  saves named tables to this browser (plus export/import text).
  The host auto-saves the table to localStorage; Clear wipes it. World is a
  fixed 1920×1200 so every screen shares coordinates. Opened with no room
  (lobby Play button), Goldberg runs a private local table — hosting a room
  later shares that same table, joining someone's room starts from theirs.

## Run it

1. Open `index.html` in a browser (double-click works — the registry loads via `<script>`, not `fetch`).
2. Host a room → share the Room ID (click it to copy).
3. Guests paste the ID → Connect → host launches a game → guests tap **Show table**.

> If two players see different things, both hard-reload (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>)
> — game files are cached aggressively by the browser.

## BubHub Record

Every finished game writes one line (e.g. `6 Oct 2026 Harry beat John at LOTR Cards`)
to the shared Google Sheet behind `BUB_API` in `index.html` — the same sheet as the
DalTadka leaderboard. BubHub rows carry `kind=bub` and the sentence in the `text`
column, so DalTadka's board never shows them. The card at the bottom of the lobby
(and room drawer) lists them newest-first, 5 then expandable.

Games announce their ending over the bridge as `Hub.up('result', {...})` with player
**ids**; the hub resolves names from its own roster and builds the sentence in one
place (`Rec.sentence` in `index.html`). Only the host writes (solo games write from
the local machine). Goldberg has no end state, so the hub notes everyone who sends
a Goldberg intent and records the line when the panel closes.

## Files

| File | Touch? | Purpose |
|---|---|---|
| `index.html` | Rarely | Hub shell: stage, lobby/room UI, PeerJS room, game broker. |
| `games.js` | ✅ to add games | The registry. The only file you edit for a new game. |
| `bub-record.js` | Rarely | Modular BubHub Record (loaded via script tag). Generic `played X` lines mean even a brand-new game with no `result` logic leaves a line on open/close. |
| `warpfront.html`, `lotr.html` | Reference | Multiplayer examples (host + guests, like-for-like pattern to copy). |
| `goldberg.html` | Playable | Chain-reaction sandbox (host-authoritative physics, everyone builds). Parts: ball, plank, block, domino, peg, bucket, bouncer, turntable, conveyor, fan, balloon, lever, pendulum, bell (tunable), catapult (cocks + throws), spawner + drawn tracks. Weld parts rigidly, copy/paste groups, save named machines, clear by unanimous vote. |
| `DrawDrive.html` | Playable | Draw and Drive (multiplayer: maze turn-taking drawer/driver + versus battle + off-rails). Tiny laser crumbs dissolve; cookie mode deleted. |
| `eggs.html` | Playable | eggs sandbox in a night-time chicken coop (plank walls, wire, bulb, straw floor, wooden perches, hens). Random worlds, tiered splats (BIG → HUGE → TITAN: smash harder, die easier), legs pickup for lift & throw (mash jump to wiggle free), one rotating reachable power-up at a time (star/bean/legs). |
| `LobbyWaltzEngine.html` | Reference | Solo example (`solo` + `lobby` + fixed `height`). |
| `horse.jpg` | – | Mascot 🐴 |
