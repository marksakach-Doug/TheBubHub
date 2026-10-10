# Bub Hub — Peer-to-Peer Arcade

Bub Hub is a tiny, modular arcade for HTML games. The **hub** (`index.html`) owns
rooms, chat, invites, and networking. **Games** are plain `.html` files that
render in a shared stage and talk to the hub through a small `postMessage`
bridge. Adding a game never touches `index.html` — you drop in a file and add one
line to `games.js`.

No build step. No server. No dependencies. Double-click `index.html` and play.
Multiplayer runs over [PeerJS](https://peerjs.com/) (peer-to-peer, no game
server).

---

## Contents

1. [Quick start](#quick-start) · 2. [Anatomy of a game file](#anatomy-of-a-game-file)
3. [The bridge](#the-bridge) · 4. [Pre-room vs in-room](#pre-room-vs-in-room)
5. [Seats and spectators](#seats-and-spectators) · 6. [Registry reference](#registry-reference)
7. [UX conventions](#ux-conventions) · 8. [Hub behaviours that affect you](#hub-behaviours-that-affect-you)
9. [Testing](#testing) · 10. [Networking model](#networking-model) · 11. [BubHub Record](#bubhub-record)
12. [File map](#file-map) · 13. [Engine notes](#engine-notes)

---

## Quick start

1. Copy an existing game as a starting point. `blastoff.html` is the smallest
   complete multiplayer game; `warpfront.html` shows minimal state sync;
   `chess.html` is a full game with solo + two-player + a bot + a proper rules
   engine.
2. Save your file next to `index.html`.
3. Add one line to `games.js`:

```js
{ id: 'mygame', file: 'my-game.html', title: 'My Game', players: '2-4',
  color: '#00ffcc', icon: '🎯', desc: 'One sentence for the button tooltip.' },
```

4. Reload `index.html`. Buttons, iframes, invites, tooltips, and the roster all
   derive from the registry — there is nothing else to wire up.

That's it for a multiplayer game. To also make it playable **alone**, see
[Pre-room vs in-room](#pre-room-vs-in-room).

---

## Anatomy of a game file

One self-contained `.html`. No imports, no bundler, no CDN. Convention:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My Game</title>
<style> /* all your CSS, scoped by id/class prefixes */ </style>
</head>
<body>
  <div id="app"> ... your UI ... </div>
  <script>
  (function(){
    'use strict';
    const GAME_ID = 'mygame';      // must equal the registry `id`
    // ... bridge, rules, render, input ...
  })();
  </script>
</body>
</html>
```

Rules of thumb that keep games working inside an iframe:

- **Wrap your code in an IIFE** so nothing leaks onto the shared `window` and
  nothing collides with another game.
- **Prefix your ids/classes** (`bo-`, `wf-`, `chess-`) — the page above you
  is the hub, but two frames never share a DOM, so this is just for humans.
- **No `fetch()` of local files.** `file://` blocks it (the registry itself is
  loaded with a `<script>` tag for exactly this reason). Inline your data.
- **No external CDN for anything essential** — the hub already loads Tailwind
  from a CDN, so the whole arcade degrades offline. Chess uses Unicode pieces and
  CSS wood tones rather than image files for this reason.
- **Own your own layout height** (see [UX conventions](#ux-conventions)).

---

## The bridge

Everything the hub can tell you and everything you can tell it. Copy this
pattern — it is the whole contract:

```js
const GAME_ID = 'mygame';
const Hub = {
  me: null, roster: [], room: '',
  up(k, p){ try { window.parent.postMessage({ t:'gu', game: GAME_ID, k, p }, '*'); } catch(e){} },
  init(){
    window.addEventListener('message', onDown);
    this.up('hello');                       // announce → hub replies with roster
  }
};
function onDown(e){
  const m = e.data;
  if (!m || m.t !== 'gd' || m.game !== GAME_ID) return;
  if (m.k === 'roster')  onRoster(m.p);     // { you, room, roster[] }
  if (m.k === 'state')   onState(m.p, m.from);
  if (m.k === 'intent')  onIntent(m.p, m.from);   // host only
  if (m.k === 'denied')  toast(m.p.text);
  if (m.k === 'hide')    pause();
  if (m.k === 'show')    resume();
  if (m.k === 'reset')   reset();
}
// Note: `say` is accepted for compatibility but dropped by the hub, so never
// rely on pushing game chatter into the chat log.
const myId   = () => Hub.me && Hub.me.id;
const myName = () => (Hub.me && Hub.me.name) || 'Player';
const isHost = () => !!(Hub.me && Hub.me.isHost);
const inRoom = () => !!Hub.room;
const others = () => (Hub.roster || []).filter(m => m.id !== myId());
```

### Messages you send (`gu` = game-up)

| `k` | `p` | What the hub does |
|---|---|---|
| `hello` | – | Marks the frame ready, flushes queued mail, pushes a `roster`. Send it on load **and** on the first click (covers slow frame startup). |
| `height` | number | Resizes the stage iframe, clamped to 4000px. Send on load and on resize. |
| `intent` | any JSON | Non-host → forwarded to the host. Host → fed to your own `onIntent`. |
| `state` | any JSON | Host only. Broadcast to every peer. Keep it small and JSON-serialisable. |
| `say` | string | **No-op.** Game chatter is dropped on purpose (notifications don't go in the chat log). Still on the wire for compatibility — don't rely on it. |
| `invite` | – | Host only. Tells the room a table is open (see [auto-open](#hub-behaviours-that-affect-you)). |
| `denied` | `{ to, text }` | Host only. Routes a rejection back to one player. |
| `result` | see [Record](#bubhub-record) | Logs "X beat Y at <game>" to the shared sheet. |
| `close` | – | Hides your own stage frame. |

### Messages you receive (`gd` = game-down)

| `k` | `p` / `from` | Meaning |
|---|---|---|
| `roster` | `{ you:{id,name,isHost}, room, roster:[{id,name,host}] }` | Who is here. Re-sent on **every** join/leave/rename — treat it as the source of truth for seats. |
| `state` | host state + `from` | Authoritative snapshot. Guests render it; they never simulate. |
| `intent` | guest action + `from` | Host only. Validate, apply, then broadcast `state`. |
| `denied` | `{ text }` | One of your intents was rejected. Show it. |
| `reset` | – | The room tore down — go back to a fresh table. |
| `hide` / `show` | – | Your frame was hidden/shown. Stop music, suspend your loop, then resume. |

**Dead message:** `say` is still accepted on the wire, but the hub discards game
chatter ("notifications don't go in the chat log anymore"). It survives only for
compatibility with older game files, so don't build on it.

### The golden rule

- **Guests never mutate shared state.** They `up('intent', …)` and render the
  next `state`.
- **The host is the only writer:** validate the intent → mutate → `up('state', snapshot)`.
- **Validate on the host, always.** The `handle()`-style function that decides
  legality should be the *same* function for local input and remote intents, so
  a client can't do something the host wouldn't allow. Chess does exactly this:
  `doMove(from, to, side)` is the only way a move happens.
- **A disabled button is not a check.** Disabling *Resign* for a watcher stops
  the honest path; it does nothing about `postMessage({k:'intent', p:{a:'resign'}})`
  from anyone at all. Every intent handler has to re-derive permission from
  state on the host, and reply `denied` when it fails:

  ```js
  if (d.a === 'resign'){
    if (from.id !== (S.seats && S.seats.b)) return notBlack();   // re-check!
    over = { result: WHITE, why: nameOf(from.id) + ' resigned — White wins' };
    send(); return;
  }
  ```

  Chess learned this the hard way: `draw`, `accept`, `decline` and `resign` were
  all unguarded, so a guest watching someone else's game could end it by sending
  one crafted message.
- **Never trust `from.name`** for logic — use `from.id`; resolve the display
  name from your roster (names can change mid-game, see
  [name dedupe](#hub-behaviours-that-affect-you)).

---

## Pre-room vs in-room

The hub tells you which world you're in with one field: `Hub.room`.

- `Hub.room === ''` → **pre-room**. You are alone (or have joined nobody's
  room). This is where solo play happens.
- `Hub.room === 'bubbies123'` → **in a room**, with peers.

This is the single most useful thing to know as a game author, because it lets
one file serve both.

### The local-host pattern

Pre-room you get `isHost: false` and no peers, so guest intents would go nowhere
and nothing would animate. Games solve this by **promoting themselves to local
host** when there is no room:

```js
let localSolo = false;
function onRoster(p){
  Hub.me = p.you; Hub.roster = p.roster || []; Hub.room = p.room || '';
  localSolo = !Hub.room;                    // derived, NOT latched
  render();
}
const isHost = () => localSolo || !!(Hub.me && Hub.me.isHost);
```

And a fallback for when the file is opened **directly** (double-clicked, no hub
answering) — every game has one:

```js
setTimeout(() => { if (!Hub.me) { localSolo = true; Hub.me = {id:'solo', name:'Player', isHost:true}; render(); } }, 1200);
```

**Derived, never latched.** Re-derive `localSolo` from `Hub.room` on *every*
roster. If a player opens a game pre-room and *then* creates a room, the next
roster has a real room id and the game must fall back to multiplayer. A latch
(`if (!localSolo) localSolo = true`) leaves the game stuck in solo forever.

**Solo is additive.** Only relax the *minimum*; never invent extra seats.
Keep the room path honest so a lone host can't strand later joiners:

```js
const minSeats = localSolo ? 1 : 2;      // grammar: 2-4 in a room, 1 alone
if (seats.length < minSeats || seats.length > 4) return say('Need 2–4 players');
```

### Two kinds of solo

| Flag | Means | Pre-room behaviour | Example |
|---|---|---|---|
| `solo: true` | The game never needed a hub at all | Ignores the bridge completely | Waltz Engine, Dal Tadka, Write Something True |
| `soloable: true` | A normal multiplayer game that *also* runs a one-seat table | Local host + bots/AI or a reduced board | Chess, Grammar, Warp Front, Blast Off!, eggs, Word Bridge |

`soloable` games appear in the pre-room **Solo Corner** (one flat list, no
headings). `solo: true` games skip the bridge and don't need a roster at all.

The Solo Corner is `g.lobby || g.soloable`. Prefer `soloable` for anything that
can actually be started alone — `lobby` is the escape hatch for a multiplayer-only
game that should still appear pre-room, and it is not the same thing.

### Solo tables and spectators (`soloOrigin`)

If someone **invites** from a solo table, the hub creates a room *underneath the
running game*. Your game keeps playing; the newcomer becomes a spectator. Two
small additions make that safe and clear:

```js
// in your fresh()/reset(): remember where this table was born
S.soloOrigin = localSolo;

// broadcast it with the snapshot, so guests know too
function pack(){ return { /* … */ seats: S.seats, soloOrigin: !!S.soloOrigin }; }
```

- **A solo-origin table is never re-seated.** Grammar simply refuses to add
  newcomers when `S.soloOrigin` (otherwise a guest joining a 1-player game
  silently becomes player 2 mid-round). Chess shows "👁 watching — this is the
  host's solo game".
- **Local bots belong to the table, not to the moment.** Blast Off's bots are
  gated on `S.soloOrigin`, not on "am I pre-room right now" — otherwise the bots
  freeze the instant a room appears. This is the single easiest bug to write
  here.

Switching from a solo game to a real shared game is deliberately a separate,
visible action (leave the stage, start a new one) rather than something that
happens under the player.

---

## Seats and spectators

Two people can be in the same room, so **"am I a guest" is not the same as "am I
the second player"**. Chess demonstrates the pattern:

```js
// which side am I? null means "watching, read-only"
function mySeat(){
  if (!S) return null;
  if (!inRoom() || isHost()) return WHITE;      // host (and pre-room solo) is White
  if (S.soloOrigin) return null;                // watching a solo game
  if (S.seats && S.seats.b === myId()) return BLACK;
  return null;                                  // no black seat yet
}
```

- Store seats **in the state** (`S.seats = { w, b }`) so they survive reconnects
  and reach every guest.
- Bind Black **once**, from an explicit claim (`intent {a:'claim'}`), and reject
  later claims with the holder's name. An auto-claim-on-first-move is fine too;
  what you must not do is let "any guest" own a shared seat.
- Derive your UI from `mySeat()`, and **make `null` mean read-only everywhere**:
  no move dots, no piece pick-up, and disable resign / draw. Use one predicate
  rather than scattering checks.
- Watchers who are also *players in the room* still get chat and can see the
  roster — they're just not seated at the table.

Every game gets seat handling for free if you gate on the roster
(`S.seats`, `S.claims`, `me() === null`) — Grammar, Warp Front, Blast Off! and
Word Bridge already refuse input from unseated people. Chess and eggs (a 4-player
cap) were the exceptions.

### Snapshots must carry the table, not just the position

If you keep an undo/takeback stack, the thing you push is usually a *position*
clone — board, turn, castling rights. Don't forget that seats and
`soloOrigin` describe the **table**, and a position-only snapshot silently drops
them. Chess did exactly this, and the symptom only appeared after a takeback:
`S.seats` became `undefined`, so the finished game couldn't be recorded — and,
more seriously, a guest watching a solo game was quietly offered "Take Black"
again, because the flag that says *this table was born solo* had evaporated.
Both live in `copy()` now:

```js
function copy(st){
  return { b: st.b.slice(), turn: st.turn, /* …rights, counters… */
    seats: st.seats ? { w: st.seats.w, b: st.seats.b } : null,
    soloOrigin: !!st.soloOrigin };
}
```

Rule of thumb: **anything that is true of the table rather than the position
must be in every snapshot, every serialisation, and every broadcast.** If you
find yourself writing a clone by hand, that list is where bugs hide.

Related: your own id can arrive *after* your table starts (the frame's solo
fallback timer beats the hub's roster on a slow load). If you capture `myId()`
into state at construction time, claim the seat again when the roster lands:

```js
if (S && !S.seats.w && myId() && (localSolo || isHost())) S.seats.w = myId();
```


---

## Registry reference

One line per game in `games.js`.

| Field | Required | Meaning |
|---|---|---|
| `id` | ✅ | Unique key. **Must** equal the `game` field your file sends in every bridge message. |
| `file` | ✅ | HTML file loaded into the stage iframe. |
| `title` | ✅ | Display name (buttons, invites, chat, record). |
| `players` | ✅ | Display string (`'2-4'`, `'solo'`). Informational — also the grouping key in-room. |
| `color` | – | Accent for the button + invite bar. Button text colour is computed from its brightness, so any hex works. |
| `icon` | – | Emoji before the button label. |
| `desc` | – | One sentence in the button tooltip, after the player count. |
| `solo` | – | `true` → Solo Corner; the game skips the bridge. |
| `soloable` | – | `true` → also runs a solo table, so it lists pre-room. Keeps its real `players` count in-room. |
| `lobby` | – | `true` → listed in the pre-room Solo Corner even if it can't be *played* alone. Only for "have a look while you wait". Prefer `soloable`. |
| `height` | – | Fixed stage height (px) for bridge-less solo games. |
| `fill` | – | `true` → viewport-fill game; the hub sizes the frame instead of trusting your reported height. Use for canvas worlds. |
| `menuLabel` | – | Button text only (title/invites/chat/record untouched). Replaces `Play <title>`; while the stage is open it reads `Hide <menuLabel>`. For things that aren't really "played". |
| `noRecord` | – | `true` → never write to BubHub Record. |

Sections are derived: an in-room section with zero games hides itself, and
multiplayer buttons are grouped by `players` (smallest first).

---

## UX conventions

These are the hub-owned behaviours a game must cooperate with.

- **You do not own the close button.** The hub closes games from the `✕ Stage`
  bar, which really hides the frame and sends you `hide` (stop music, suspend
  your loop). Never ship your own Hide/Close.
- **Report your height.** `Hub.up('height', h)` on load and resize, or the game
  scrolls inside its frame. Measure `Math.max(document.body.scrollHeight,
  document.documentElement.scrollHeight)`. `fill: true` games are exempt.
- **Respect `hide` / `show`.** Stop `requestAnimationFrame` loops, mute audio,
  clear timers. Goldberg fades its music out this way.
- **No hover-only UI.** The hub runs on phones and in an iframe; the game board
  fills the viewport and the room UI is a drawer. Use pointer events for
  drag/tap so touch works.
- **Tap targets ≥ ~40px** on small screens; test at 390px wide.
- **Read-only states should say so.** A frozen board with no explanation reads
  as broken — "👁 watching" or "waiting for the host" is much better.
- **Keyboard:** Esc closes the stage. Don't fight it.
- **Name the sides / pieces clearly** rather than relying on colour alone.

---

## Hub behaviours that affect you

Things the hub does around your game that are worth knowing.

- **Invite from a solo table creates a room.** With no room, the Invite button
  spins one up, reopens your game, and copies a link with `room=` + `game=`.
  Without this the link would be a dead `?game=` URL.
- **The Invite button hides** when the open game is `solo: true` — there is no
  shared table to invite anyone to.
- **Idle room members auto-open the host's game.** If the *room host* opens a
  game and you aren't already in one, it opens for you (no yank). If you're
  mid-game you keep the manual "Show table" bar. Send `invite` when a table is
  genuinely ready.
- **First visit shows a blocking name modal** in the centre of the screen. The
  hub always has a name for you (an animal suggestion), so games never need to
  handle "no name" — but do use `myName()` rather than assuming it changes.
- **Duplicate names get numbered.** Two "john"s in a room become `john` and
  `john1`, and the host renumbers a colliding newcomer on join and tells them.
  So **don't cache a name** — read `myName()` fresh when you render, and key
  seats on **id**, never on name.
- **Game buttons pick their own text colour** from the background brightness, so
  you don't need to worry about contrast in `games.js`.

---

## Testing

There is no test runner (no build step), but there are two scripts in `tests/`
that need only `pip install esprima playwright` (and `playwright install
chromium`):

| Script | What it does |
|---|---|
| `python3 tests/jscheck.py` | Parses every inline `<script>` in the folder with a real JS parser. This is the cheapest way to catch a typo before you reload the hub. |
| `python3 tests/chess_rules.py` | Extracts the **real** move generator out of `chess.html` and runs it against textbook positions (mate, castling, en passant, promotion, stalemate, pins, draws) plus 40 full bot games. |
| `python3 tests/chess_play.py` | Drives chess in a real browser: solo + bot, takeback, seat claims, spectators, watcher lockout, keep-solo-running, phone layout. |
| `python3 tests/record_test.py` | Runs the shipped `BubRecord.create()` against stub roster data and checks the exact sentence each payload produces. |

The chess tests work by **extracting the shipped function source** and running
it against assertions, rather than re-implementing the rules — so they test what
players actually play. That approach caught three real bugs during development
(a crashing bot, en passant generated on the wrong squares, and the wrong pawn
removed on capture). Copy that idea for a game with rules worth trusting.

For anything interactive, drive the page with Playwright and assert on the
**DOM**, not on private state:

```python
page.click("#board .sq[data-sq='52']")            # click a piece
page.wait_for_timeout(200)
dots = page.eval_on_selector_all("#board .dot", "els => els.length")
```

Watch for page errors the whole time — a silent `ReferenceError` in a game looks
exactly like "nothing happens".

---

## Networking model

- **Hosting a room** claims a PeerJS id (that *is* the room code). **Joining**
  connects to that id.
- Hub-and-spoke through the host: guests send to the host, the host relays.
  Chat, `say`, and game `intent` all follow the same path.
- **Presence**: the hub broadcasts `{type:'presence', id, name, game}` on
  open/close/hello, and the room drawer renders one chip per player showing
  `in <game>` or `in lobby`.

### Sessions, reconnects, host migration

- Your player id, display name, room and role live in `sessionStorage`
  (`bubhub.session`), so a reload offers **Rejoin `<room>` as host/guest** — and
  games that seat by id (LOTR, chess) keep your seat.
- Hosting retries a just-released room id with backoff instead of silently
  minting a new one.
- A guest whose host link drops shows "host lost — reconnecting…" and keeps
  dialing the room with capped backoff.
- **If the host is really gone, the table moves rather than dying.** The
  lowest-id survivor claims the same room id (the room id itself is the mutex, so
  only one host can win), keeps the table it already holds, and re-broadcasts.
  Everyone's reconnect loop lands on the same id. A returning host whose id is
  taken is offered "Table moved to X — join them?" and rejoins as a guest.

Practical consequence for your game: **the host can change mid-session.** Never
assume a fixed host id; re-read `isHost()` on every roster and be ready to adopt
a `state` snapshot from a new host.

---

## BubHub Record

Finished games can write one line to the shared sheet behind `BUB_API`:

```js
Hub.up('result', { players: ['p-id-1', 'p-id-2'], text: 'Sam beat Alex' });
```

- Send **player ids**, not names — the hub resolves them against its own roster
  and its own stored name for you (it also numbers duplicates). Don't compose a
  sentence from names a game can only partly see; you'll end up writing
  "your friend beat the bot" into a shared sheet nobody can edit.
- Per-game fields let the hub build a sensible line. Chess, for example:

  ```js
  Hub.up('result', { players: [whiteId, blackId].filter(Boolean),
                     bot: !blackId,          // black wasn't a person
                     won: 'w' | 'b' | 'draw' });
  // -> "Sam beat Zaphod at Chess" / "Sam beat the bot at Chess"
  ```

  Saying *which colour won* beats passing a winner id: the hub doesn't have to
  guess which id was which, and the bot never needs a fake roster entry.
- Send `text` only when the game has something specific to say (eggs: "Sam
  smashed Zaphod at eggs"). Otherwise the default is used.
- **Every game should send a real result.** The generic usage line is a safety
  net for a game that hasn't been wired up yet, not a finished feature — "Sam
  played Blast Off!" says nothing. If a game has no natural final round (Word
  Bridge), report it when the session ends: reset, rematch, or leave.
- Solo games record locally; multiplayer records on the host only.
- `noRecord: true` opts out entirely.
- Send it **once per game** — guard with a flag, because `render()` runs often
  and `record()` will happily write a duplicate line otherwise.

### Leaving the stage

There are two different "back" buttons, and games need only care about one:

- **Hub `☰ Games`** (focus bar, always visible) returns to the hub game list.
  Games post `Hub.up('close')` for this; `index.html` handles it and closes the
  frame.
- **Per-game `☰ Menu`** returns to *that game's own setup screen* so the rules
  can be changed (difficulty, level, Dread, seed). Without it a host can only
  change rules by leaving the stage entirely, because setup is gated on
  `S === null` and nothing inside the game clears `S`.

Games that render a Menu button should hide it unless `isHost()`.

---

## File map

| File | Touch? | Purpose |
|---|---|---|
| `index.html` | Rarely | Hub shell: stage, lobby/room UI, PeerJS room, game broker, invites. |
| `games.js` | ✅ to add games | The registry. The only file you edit for a new game. |
| `bub-record.js` | Rarely | BubHub Record: composes the sentence for each game from a small payload (loaded via script tag). |
| `tests/jscheck.py` | – | Parses every script in the folder; run after editing. |
| `tests/chess_rules.py` | – | Chess rules tests (extracts the real engine). |
| `tests/chess_play.py` | – | Chess browser tests (solo, seats, spectators, phone). |
| `tests/record_test.py` | – | BubHub Record sentence tests (runs the real `bub-record.js`). |
| `warpfront.html` | Reference | Minimal state-sync multiplayer example. |
| `goldberg.html` | Reference | Best example of the local-host ↔ room transitions, and of `hide`/`show`. |
| `chess.html` | Reference | Solo + two-player + bot + a real rules engine + seat claims. |
| `LobbyWaltzEngine.html` | Reference | Simplest `solo` game (no bridge at all). |
| `lotr.html`, `wordbridge.html`, `blastoff.html`, `eggs.html`, `daltadka.html`, `discover_the_grammar.html`, `wordwright.html`, `DrawDrive.html`, `truths.html` | Playable / WIP | The rest of the arcade. `wordwright` and `DrawDrive` are commented out of the registry. |

---

## Engine notes

Two games carry their own non-trivial logic; both are documented so they can be
copied or fixed.

### Chess (`chess.html`)

Own move generator, no library. Board is 64 slots with **index 0 = a8**, so
`sq = file + (8 - rank) * 8`; the renderer draws `row = vr` so White sits at the
bottom.

- `pseudo()` generates king-moves-legal moves (castling, en passant, all four
  promotion pieces); `legal()` runs each through `applyMove()` on a clone and
  drops any that leave your own king attacked.
- En passant lands on the square **directly ahead** (the one the double push
  skipped) and the captured pawn sits at `to - 16` — for both colours, because
  rank 8 is index 0. This is easy to get wrong and invisible in testing unless
  you test it.
- Promotions are generated queen-first, so "first match wins" = auto-queen.
- Draws: stalemate, fifty-move, threefold repetition, insufficient material.
- The bot is intentionally 1-ply (material swing, a "will this hang?" check, a
  check bonus, jitter). It can only ever pick from `legal()`, so it cannot cheat.

### eggs (`eggs.html`)

Damage-% knockback plus a Mario-style mushroom: the `bean` grows you
BIG → HUGE → TITAN with **no timer** — the size is *spent* by taking a hit
(`shrinkEgg`), and only the abyss or a star still kills you outright.

---

## Run it

1. Open `index.html` (double-click works — the registry loads via `<script>`).
2. Host a room → share the Room ID (click it to copy) or press **Invite**.
3. Guests open the link → they're dropped straight into the game.

If two players see different things, both hard-reload
(<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>) — game files are cached hard.

If a game behaves oddly after an edit, run `python3 tests/jscheck.py` first:
a syntax error in an iframe shows up as a blank box, not a message.
