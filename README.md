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

## Run it

1. Open `index.html` in a browser (double-click works — the registry loads via `<script>`, not `fetch`).
2. Host a room → share the Room ID (click it to copy).
3. Guests paste the ID → Connect → host launches a game → guests tap **Show table**.

> If two players see different things, both hard-reload (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>)
> — game files are cached aggressively by the browser.

## Files

| File | Touch? | Purpose |
|---|---|---|
| `index.html` | Rarely | Hub shell: stage, lobby/room UI, PeerJS room, game broker. |
| `games.js` | ✅ to add games | The registry. The only file you edit for a new game. |
| `warpfront.html`, `lotr.html` | Reference | Multiplayer examples (host + guests, like-for-like pattern to copy). |
| `LobbyWaltzEngine.html` | Reference | Solo example (`solo` + `lobby` + fixed `height`). |
| `horse.jpg` | – | Mascot 🐴 |
