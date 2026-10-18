// BubHub v10 orchestrator: identity -> lobby/room -> net -> stage/compat -> plugins.
// Solo = a room of one. The hub roster is the source of truth; games never
// implement their own seating.
import { createStore, randomAnimalName } from '../room/store.js';
import { createGrace, GRACE_MS } from '../room/grace.js';
import { findReclaimId, prunePlayerState, HEARTBEAT_MS, DEAD_MS } from '../room/presence.js';
import { createNet } from '../net/peer.js';
import { T, msg } from '../net/protocol.js';
import { createStage } from './stage.js';
import { createCompat, legacyRoster } from './compat.js';
import { loadRegistry, soloCorner, roomLists, multiplayerSections, playerLabel } from './registry.js';
import { createChat } from '../plugins/chat.js';
import { createInvite, parseInvite } from '../plugins/invite.js';
import { createRecord } from '../plugins/record.js';

const SKEY = 'bubhub.session.v2';
const NAME_KEY = 'bubhub.name';

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch (e) { return null; }
}
function saveSession(s) {
  try {
    sessionStorage.setItem(SKEY, JSON.stringify({
      room: s.roomId, host: s.isHost, id: s.me.id, name: s.me.name, game: s.openGame
    }));
  } catch (e) {}
}
function clearSession() { try { sessionStorage.removeItem(SKEY); } catch (e) {} }

function loadSavedName() {
  try { return (localStorage.getItem(NAME_KEY) || '').trim().slice(0, 24); } catch (e) { return ''; }
}

function errBox(e) {
  const el = document.getElementById('hub-err');
  if (!el) return;
  if (!e) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.classList.remove('hidden');
  el.textContent = String((e && e.message) || e);
}

export async function boot() {
  const store = createStore();
  const sess = loadSession();
  if (sess && sess.id) store.setMe(sess.id, sess.name || '');
  if (!store.state.me.name) store.setName(loadSavedName() || '');

  const registry = await loadRegistry();
  const byId = new Map(registry.map(function (g) { return [g.meta.id, g]; }));
  const getModule = function (id) {
    const g = byId.get(id);
    return (g && g.kind === 'module') ? g.module : null;
  };

  // module runtime state (host-side): gameId -> { mod, state }
  //
  // This map used to live for the whole page load, which meant init() ran at
  // most once per game per tab: seat whoever was in the room the FIRST time
  // anybody opened that game, forever. Leave a room and host a new one in the
  // same tab and the new room inherited the old table — old ids, old round,
  // nothing repairable without a reload. That is the "I have to make a new
  // room (or reload)" bug. Room transitions now call resetTables().
  const modState = new Map();

  // Drop every game table AND the cached host views that go with them. Called
  // whenever the room underneath us changes: leaving, being kicked, host grace
  // running out, hosting a new room, or being accepted into one as a guest.
  function resetTables() {
    modState.clear();
    store.clearStates();
    store.state.seatsByGame = {};
    store.state.seats = {};
  }

  const stageRoot = document.getElementById('game-stage');
  const stage = createStage(stageRoot);
  const compat = createCompat(stageRoot);

  let net = null;
  const getNet = function () { return net; };
  const chat = createChat({ store: store, getNet: getNet });
  const invite = createInvite({ store: store });
  const record = createRecord({ store: store, getNet: getNet, getModule: getModule });
  let recentAnimals = [];
  let nameConfirmed = !!loadSavedName();
  let redialTimer = null;
  let redialDelay = 1500;

  const grace = createGrace(
    function (secs, frac) {
      const b = document.getElementById('host-banner');
      const t = document.getElementById('host-banner-text');
      const bar = document.getElementById('host-banner-bar');
      if (b) b.classList.add('show');
      if (t) t.textContent = 'Host reconnecting… ' + secs + 's left. Keep this tab open.';
      if (bar) bar.style.width = Math.max(0, Math.min(100, frac * 100)) + '%';
    },
    function () {
      // grace expired: close the room, keep usernames for a fresh room
      const keepName = store.state.me.name;
      const keepId = store.state.me.id;
      // closeRoom BEFORE teardownNet: tearing down the host connection fires
      // its 'close' event, which — while inRoom is still true — looks exactly
      // like the host dropping us and starts the grace countdown again, from
      // inside the thing that was supposed to stop it.
      store.closeRoom();
      resetTables();
      teardownNet();
      store.setMe(keepId, keepName);
      showLobby();
      setStatus('join-status', 'Host is gone — room closed. Start a new room below; your name was kept.');
      histReplace({});
    }
  );

  function ensureNet() {
    if (net) return net;
    net = createNet(onNetEvent);
    return net;
  }

  function teardownNet() {
    grace.stop();
    stopHeartbeat();
    hideBanner();
    if (redialTimer) { clearTimeout(redialTimer); redialTimer = null; }
    redialDelay = 1500;
    const old = net;
    // Null it out. ensureNet used to hand back the closed object forever after
    // a teardown, so anything reading net.peer or net.guests in between was
    // looking at a destroyed Peer.
    net = null;
    if (old) { try { old.close(); } catch (e) {} }
  }

  function hideBanner() {
    const b = document.getElementById('host-banner');
    if (b) b.classList.remove('show');
  }

  // ---------- roster helpers ----------
  function pushRosterToGames() {
    const lr = legacyRoster(store);
    registry.forEach(function (g) {
      if (g.kind === 'iframe') compat.pushRoster(g.meta.id, lr);
    });
  }

  // Tables: everyone present at the same game, derived from presence.
  // No protocol change — tables are a view over the hub roster.
  function tables() {
    const s = store.state;
    const groups = {}; // gameId -> [members]
    const lobby = [];
    s.roster.forEach(function (m) {
      if (m.game && byId.get(m.game)) {
        if (!groups[m.game]) groups[m.game] = [];
        groups[m.game].push(m);
      } else {
        lobby.push(m);
      }
    });
    return { groups: groups, lobby: lobby };
  }

  // Seats are per table now, so the label asks each table separately — a flat
  // map printed whichever game happened to be open when the roster rendered.
  function memberLabel(m) {
    const s = store.state;
    let seat = '';
    Object.keys(s.seatsByGame).forEach(function (gid) {
      const map = s.seatsByGame[gid];
      Object.keys(map).forEach(function (k) {
        if (map[k] === m.id) seat = ' (seat ' + k + ' · ' + gameTitle(gid) + ')';
      });
    });
    return (m.host ? '👑 ' : '') + m.name + (m.id === s.me.id ? ' (you)' : '') + seat +
      (m.bot ? ' [bot]' : '') + (m.spectator ? ' [watching]' : '');
  }

  function renderRoster() {
    const s = store.state;
    const ul = document.getElementById('roster-list');
    const ps = document.getElementById('peer-status');
    if (ul) {
      ul.innerHTML = '';
      if (!s.inRoom) {
        const li = document.createElement('li');
        li.className = 'text-slate-500 text-xs italic';
        li.textContent = 'Solo — not in a room.';
        ul.appendChild(li);
      } else {
        const t = tables();
        // lobby first, then one group per table
        if (t.lobby.length) {
          ul.appendChild(groupHeader('In lobby (' + t.lobby.length + ')'));
          t.lobby.forEach(function (m) { ul.appendChild(memberItem(m)); });
        }
        Object.keys(t.groups).forEach(function (gid) {
          const g = byId.get(gid);
          const title = (g.meta.icon ? g.meta.icon + ' ' : '') + g.meta.title;
          ul.appendChild(groupHeader(title + ' (' + t.groups[gid].length + ')'));
          t.groups[gid].forEach(function (m) { ul.appendChild(memberItem(m)); });
        });
        if (!s.roster.length) {
          const li = document.createElement('li');
          li.className = 'text-slate-500 text-xs italic';
          li.textContent = 'Nobody else here yet — send an invite.';
          ul.appendChild(li);
        }
      }
    }
    if (ps) {
      ps.textContent = s.inRoom
        ? (s.isHost ? 'You host ' + s.roster.length + ' player(s).' : 'Connected to ' + s.roomId + ' (' + s.roster.length + ').')
        : 'Not in a room.';
    }
    renderTables();
  }

  function groupHeader(text) {
    const li = document.createElement('li');
    li.className = 'text-teal-300 text-xs font-extrabold uppercase tracking-wide mt-1';
    li.textContent = text;
    return li;
  }

  function memberItem(m) {
    const li = document.createElement('li');
    li.className = 'text-slate-200 text-sm pl-2 flex items-center gap-2';
    const span = document.createElement('span');
    span.textContent = memberLabel(m);
    li.appendChild(span);
    // Host moderation: boot anyone except yourself. Guests never see this.
    const s = store.state;
    if (s.inRoom && s.isHost && m.id !== s.me.id) {
      const b = document.createElement('button');
      b.className = 'ml-auto text-xs bg-red-900/70 border border-red-500 rounded px-2 py-0.5 font-bold shrink-0';
      b.textContent = '⛔ boot';
      b.title = 'Remove ' + m.name + ' from the room';
      b.addEventListener('click', function () { doKick(m.id); });
      li.appendChild(b);
    }
    return li;
  }

  // Passive table bars: who opened what, with a Join button.
  // Opening a game NEVER mounts it for anyone else — no yank, by design.
  function renderTables() {
    const box = document.getElementById('game-invites');
    if (!box) return;
    box.innerHTML = '';
    const s = store.state;
    if (!s.inRoom) return;
    const t = tables();
    Object.keys(t.groups).forEach(function (gid) {
      if (gid === s.openGame) return; // already at this table
      const g = byId.get(gid);
      const names = t.groups[gid].map(function (m) { return m.name; }).join(', ');
      const div = document.createElement('div');
      div.className = 'bg-slate-900 rounded p-2 text-xs flex items-center gap-2';
      const span = document.createElement('span');
      span.className = 'text-slate-300 truncate';
      span.textContent = 'Table: ' + g.meta.title + ' — ' + names;
      span.title = names;
      const btn = document.createElement('button');
      btn.className = 'btn-bouncy rounded px-2 py-1 text-xs font-bold ml-auto';
      btn.style.background = g.meta.color || '#334155';
      btn.textContent = 'Join table';
      // Leave the current table properly first. Calling openGame directly left
      // the old seat held and the old table waiting on a player who had gone.
      btn.addEventListener('click', function () {
        leaveOpenGame();
        openGame(gid);
      });
      div.appendChild(span);
      div.appendChild(btn);
      box.appendChild(div);
    });
  }

  function gameTitle(id) {
    const g = byId.get(id);
    return (g && g.meta.title) || id;
  }

  // ---------- lobby / room visibility ----------
  function showLobby() {
    document.getElementById('lobby-ui').classList.remove('hidden');
    const r = document.getElementById('room-ui');
    r.classList.add('hidden'); r.classList.remove('flex');
    document.body.classList.remove('in-room');
    renderHeaderRoom();
    saveSession(store.state);
  }

  function showRoom() {
    document.getElementById('lobby-ui').classList.add('hidden');
    const r = document.getElementById('room-ui');
    r.classList.remove('hidden'); r.classList.add('flex');
    document.body.classList.add('in-room');
    renderHeaderRoom();
    saveSession(store.state);
  }

  function renderHeaderRoom() {
    const s = store.state;
    const wrap = document.getElementById('header-room');
    const btn = document.getElementById('btn-header-room');
    if (!wrap || !btn) return;
    if (s.inRoom) { wrap.classList.remove('hidden'); btn.textContent = s.roomId; }
    else { wrap.classList.add('hidden'); btn.textContent = ''; }
    const dr = document.getElementById('drawer-room');
    if (dr) dr.textContent = s.roomId || '';
    const fr = document.getElementById('focus-room');
    if (fr) fr.textContent = s.roomId ? 'room: ' + s.roomId : '';
  }

  function setStatus(id, t) {
    const el = document.getElementById(id);
    if (el) el.textContent = t || '';
  }

  function histReplace(q) {
    try {
      const u = new URL(location.href);
      Object.keys(q).forEach(function (k) {
        if (q[k]) u.searchParams.set(k, q[k]);
        else u.searchParams.delete(k);
      });
      history.replaceState(null, '', u.toString());
    } catch (e) {}
  }

  // ---------- game buttons ----------
  function gameButton(g, prefix) {
    const b = document.createElement('button');
    b.id = 'btn-' + prefix + '-' + g.meta.id;
    b.className = 'btn-bouncy rounded-xl px-3 py-2 text-sm font-bold';
    b.style.background = g.meta.color || '#334155';
    b.textContent = (g.meta.icon ? g.meta.icon + ' ' : '') + (g.meta.menuLabel || g.meta.title);
    try {
      const c = (g.meta.color || '#334155').replace('#', '');
      const r = parseInt(c.slice(0, 2), 16), gg = parseInt(c.slice(2, 4), 16), bb = parseInt(c.slice(4, 6), 16);
      const lum = (0.299 * r + 0.587 * gg + 0.114 * bb) / 255;
      b.style.color = lum > 0.6 ? '#0f172a' : '#fff';
    } catch (e) {}
    const count = playerLabel(g.meta);
    b.title = [count, g.meta.desc, g.kind === 'module' ? 'New module.' : 'Classic.']
      .filter(Boolean).join(' ');
    // The count is the thing people read first when choosing a table, and a
    // phone never shows a tooltip, so it goes on the button in small type.
    if (count) {
      const tag = document.createElement('small');
      tag.className = 'block text-[10px] font-normal opacity-80';
      tag.textContent = count;
      b.appendChild(document.createElement('br'));
      b.appendChild(tag);
    }
    b.addEventListener('click', function () { openGame(g.meta.id); });
    return b;
  }

  function renderButtons() {
    const lobby = document.getElementById('lobby-game-buttons');
    if (lobby) {
      lobby.innerHTML = '';
      soloCorner(registry).forEach(function (g) { lobby.appendChild(gameButton(g, 'lobby')); });
    }
    // Multiplayer is grouped by how many people a table takes, so nobody has to
    // open six games to find out which ones a third person can join.
    const mb = document.getElementById('game-buttons');
    if (mb) {
      mb.innerHTML = '';
      multiplayerSections(registry).forEach(function (sec) {
        const wrap = document.createElement('div');
        const h = document.createElement('h3');
        h.className = 'text-teal-300 text-xs font-extrabold uppercase tracking-wide mb-1';
        h.textContent = sec.title;
        wrap.appendChild(h);
        const row = document.createElement('div');
        row.className = 'flex flex-wrap gap-2';
        sec.games.forEach(function (g) { row.appendChild(gameButton(g, 'room')); });
        wrap.appendChild(row);
        mb.appendChild(wrap);
      });
    }
    const sb = document.getElementById('solo-game-buttons');
    if (sb) {
      sb.innerHTML = '';
      roomLists(registry).solo.forEach(function (g) { sb.appendChild(gameButton(g, 'solo')); });
    }
  }

  // ---------- opening games ----------
  // `roster` is a snapshot taken when the game opens. Anything that must stay
  // live belongs in the game's projected state instead — `state.players` is
  // re-sent on every reduce(), so a lobby should count dots from there, not
  // from this array.
  function apiFor(meta) {
    const s = store.state;
    return {
      me: { id: s.me.id, name: s.me.name },
      seats: Object.assign({}, s.seats),
      roster: store.rosterList(),
      isSpectator: store.isSpectator(),
      // Who is actually at this table: opened the same game, not watching.
      // This is what init() should seat, not the room roster — a room holds
      // everyone in the lobby and every other table too.
      atTable: store.rosterList().filter(function (m) {
        return m.game === meta.id && !m.spectator;
      }),
      isHost: s.isHost,
      // Solo Corner is a room of one: inRoom false, isHost true.
      isInRoom: s.inRoom,
      send: function (action) { sendAction(meta.id, action); }
    };
  }

  // The context init() gets. Same table list apiFor hands the client, so a
  // game seats the same people on open that its own lobby will later count.
  function initCtx(meta) {
    const api = apiFor(meta);
    return { seats: api.roster, atTable: api.atTable, options: {} };
  }

  function openGame(id) {
    const g = byId.get(id);
    if (!g) return;
    const s = store.state;
    // solo (room of one): no net needed
    if (!s.inRoom) {
      if (!(g.meta.solo || g.meta.soloable || g.meta.lobby)) {
        setStatus('host-status', 'Join or host a room to play ' + g.meta.title + '.');
        return;
      }
      // A room of one still has a host. Without this the flag stays false and
      // every legacy iframe is told it is a guest in its own solo table.
      store.openSolo();
      store.setOpenGame(id);
      // hub seats you immediately in solo (room of one)
      if (store.mySeat() === null) store.claimSeat(0, s.me.id);
      store.upsertMember({ id: s.me.id, name: s.me.name, host: true, game: id });
      mountGame(g);
      saveSession(store.state);
      return;
    }
    // Switching tables in place. openGame used to set presence for the game
    // being ENTERED and never for the one being left, so a host who moved to
    // another table stayed seated in the first one's state and any round
    // waiting on the whole table could never finish. Say where we were, prune
    // it, then claim the new seat — in that order, so the seat index is free.
    const was = (s.roster.find(function (r) { return r.id === s.me.id; }) || {}).game || null;
    if (was && was !== id && pruneOneGame(was, s.me.id)) pushRosterToGames();
    store.setOpenGame(id);
    // hub-owned seating: whoever opens the game takes the lowest free seat.
    // A guest's claim stays local (broadcastRoster only sends for the host),
    // but that is all isSpectator() needs to stop lying.
    if (store.mySeat(id) === null) store.claimFreeSeat(s.me.id, id);
    store.setPresence(s.me.id, id);
    broadcastRoster();
    // A guest's roster entry only leaves their own machine, so the host would otherwise hand
    // the game an empty table and never learn anyone was playing. PRESENCE is how a guest says
    // "I am at this table" — without it, games see nobody and seat nobody.
    if (!s.isHost) { logWire('out', msg(T.PRESENCE, { id: s.me.id, game: id })); sendToHostOrExplain(msg(T.PRESENCE, { id: s.me.id, game: id }), id); }
    mountGame(g);
    saveSession(store.state);
  }

  // Leaving the game you have open. Presence has to go too: setOpenGame(null) only clears
  // the local pointer, so the roster kept saying "at What's the Hook?" forever, and the host
  // never learned the seat was empty.
  function leaveOpenGame() {
    const s = store.state;
    const was = s.openGame;
    closeStageOnly();
    store.setOpenGame(null);
    if (s.inRoom) {
      store.setPresence(s.me.id, null);
      // Give the seat back. store.freeSeat had no call sites anywhere, so seats
      // were only ever reclaimed when a connection dropped: the map grew for
      // the life of the room, seat numbers climbed across games, and
      // isSpectator() went on calling leavers "seated" at a table they had left.
      if (was) store.freePlayerSeats(s.me.id, was);
      // Host: prune the table I was holding, or it waits on me forever.
      if (s.isHost && was && pruneOneGame(was, s.me.id)) pushRosterToGames();
      if (s.isHost) broadcastRoster();
      else { logWire('out', msg(T.PRESENCE, { id: s.me.id, game: null })); sendToHostOrExplain(msg(T.PRESENCE, { id: s.me.id, game: null }), was || ''); }
    }
    renderRoster();
    saveSession(store.state);
  }

  // handle for the currently mounted Shadow DOM module (null for iframe games)
  let moduleHandle = null;

  function mountGame(g) {
    closeStageOnly();
    const ft = document.getElementById('focus-title');
    if (ft) ft.textContent = (g.meta.icon ? g.meta.icon + ' ' : '') + g.meta.title;
    renderHeaderRoom();
    if (g.kind === 'module' && g.module) {
      const mod = g.module;
      const s = store.state;
      const cached = store.getCached(g.meta.id);
      let view = cached;
      if (s.isHost || !s.inRoom) {
        // Authoritative side (host, or a solo room of one): we own the table.
        let st = modState.get(g.meta.id);
        if (!st) {
          try {
            st = { mod: mod, state: mod.init(initCtx(g.meta)) };
          } catch (e) {
            console.error(e);
            st = { mod: mod, state: {} };
          }
          modState.set(g.meta.id, st);
        }
        if (view === undefined) view = st.state;
      }
      // A guest used to run mod.init() here too, on its own local roster, and
      // that fiction won over the host's real state because `cached` was
      // usually empty. There was no way to ask: the host only sent T.STATE
      // after somebody reduced, so a guest opening a game nobody was playing
      // sat on a table made of its own imagination until the host happened to
      // move. Ask instead, and render the waiting state until the answer lands.
      if (view === undefined) {
        view = waitingView(g);
        requestSnapshot(g.meta.id);
      }
      moduleHandle = stage.mount(g.meta, mod, apiFor(g.meta));
      if (moduleHandle) { try { moduleHandle.update(view); } catch (e) {} }
    } else {
      // legacy iframe path
      compat.open(g.meta, g.meta.file || (g.entry && g.entry.file));
      pushRosterToGames();
      const cached = store.getCached(g.meta.id);
      if (cached !== undefined) compat.down(g.meta.id, 'state', cached);
      try {
        compat.down(g.meta.id, 'show', {});
      } catch (e) {}
    }
    histReplace({ game: store.state.openGame || '' });
  }

  // A guest's placeholder view, shaped like a fresh host table so a game's
  // update() does not walk into undefined fields while the snapshot lands.
  function waitingView(g) {
    try { return g.module.project(g.module.init({ seats: [], atTable: [], options: {} }), store.state.me.id); }
    catch (e) { return {}; }
  }

  // "I just opened this game — send me the table." Cheap, idempotent, and it
  // means a guest never has to invent one.
  function requestSnapshot(gameId) {
    const s = store.state;
    if (!s.inRoom || s.isHost || !net) return;
    try { ensureNet().sendToHost(msg(T.SNAPSHOT, { game: gameId, id: s.me.id })); }
    catch (e) { console.warn('snapshot request failed:', e); }
  }

  function sendSnapshotTo(gameId, toId) {
    const g = byId.get(gameId);
    if (!g || g.kind !== 'module') return false;
    let st = modState.get(gameId);
    if (!st) {
      // Nobody has played here yet, so there is no table to describe. Create
      // one from the live roster, then answer — an empty game the host has not
      // opened is still a real table once a guest sits down.
      try { st = { mod: g.module, state: g.module.init(initCtx(g.meta)) }; }
      catch (e) { st = { mod: g.module, state: {} }; }
      modState.set(gameId, st);
    }
    const view = safeProject(g.module, st.state, toId);
    store.cacheState(gameId, safeProject(g.module, st.state, store.state.me.id));
    try { ensureNet().sendTo(toId, msg(T.STATE, { game: gameId, view: view })); }
    catch (e) { return false; }
    return true;
  }

  function stageUpdate(gameId, view) {
    if (stage.current && stage.current.id === gameId && moduleHandle) {
      try { moduleHandle.update(view); } catch (e) {}
    }
  }

  function closeStageOnly() {
    moduleHandle = null;
    stage.clear();
    compat.closeAll();
  }

  function sendAction(gameId, action) {
    const s = store.state;
    const g = byId.get(gameId);
    const intent = msg(T.INTENT, { game: gameId, action: action, from: { id: s.me.id, name: s.me.name, host: !!s.isHost } });
    const local = (s.isHost || !s.inRoom);
    if (!local) logWire('out', intent);
    if (g && g.kind === 'module' && g.module) {
      if (local) {
        hostReduce(gameId, action, { id: s.me.id, name: s.me.name, host: !!s.isHost });
      } else if (!sendToHostOrExplain(intent, gameId)) { /* already logged */ }
    } else {
      // compat: guest intents go to host iframe; host applies + broadcasts
      if (local) {
        compat.down(gameId, 'intent', action);
        // solo: nothing to broadcast
      } else if (!sendToHostOrExplain(intent, gameId)) { /* already logged */ }
    }
  }

  // net.sendToHost returns false when the connection is not open. Every call
  // site threw that boolean away, so an action taken during a wobble vanished
  // with nothing on screen — a frozen game and no clue why.
  function sendToHostOrExplain(m, gameId) {
    let ok = false;
    try { ok = ensureNet().sendToHost(m); } catch (e) {
      logNote('send to host threw: ' + ((e && e.message) || e));
      return false;
    }
    if (!ok) {
      logNote('could not reach the host — "' + gameId + '" did not get your move. Reconnecting…');
      onHostLost();
    }
    return ok;
  }

  function hostReduce(gameId, action, from) {
    const g = byId.get(gameId);
    if (!g || !g.module) return;
    const mod = g.module;
    let st = modState.get(gameId);
    if (!st) {
      st = { mod: mod, state: mod.init(initCtx(g.meta)) };
      modState.set(gameId, st);
    }
    let next = st.state;
    try {
      const rng = Math.random;
      next = mod.reduce(st.state, action, { from: from, rng: rng });
    } catch (e) {
      console.error('reduce() threw:', e);
      return;
    }
    if (next && next.error) {
      // route denial to sender when possible
      if (from && from.id !== store.state.me.id) {
        ensureNet().sendTo(from.id, msg(T.INTENT, { game: gameId, denied: true, text: next.error }));
      } else if (stage.current && stage.current.id === gameId && moduleHandle &&
          typeof moduleHandle.denied === 'function') {
        // local refusal (host or solo): without this the sender's action
        // silently vanishes, which reads as a frozen game.
        try { moduleHandle.denied(next.error); } catch (e) {}
      }
      return;
    }
    st.state = next;
    // project once per player, cache host view for late joiners
    const s = store.state;
    const targets = [{ id: s.me.id }].concat(s.roster.filter(function (m) { return m.id !== s.me.id; }));
    const hostView = safeProject(mod, next, s.me.id);
    store.cacheState(gameId, hostView);
    stageUpdate(gameId, hostView);
    if (s.inRoom && s.isHost) {
      targets.forEach(function (t) {
        if (t.id === s.me.id) return;
        const view = safeProject(mod, next, t.id);
        ensureNet().sendTo(t.id, msg(T.STATE, { game: gameId, view: view }));
      });
    }
    // record hook
    try { record.recordModule(g.meta, next); } catch (e) {}
  }

  function safeProject(mod, state, playerId) {
    try {
      // api is the third argument so a game can read the live hub (the roster
      // is the only place player names live) when it projects.
      if (typeof mod.project === 'function') return mod.project(state, playerId, apiFor(currentMeta(playerId)));
    } catch (e) { console.error('project() threw:', e); }
    return state;
  }

  // The meta of the game a given view belongs to — always the open one, since
  // a view is only projected for a game somebody is looking at.
  function currentMeta() {
    const g = byId.get(store.state.openGame);
    return g ? g.meta : { id: store.state.openGame || '' };
  }

  // ---------- net events ----------
  function onNetEvent(kind, p) {
    const s = store.state;
    logWire('net', { type: kind, p: (p && p.room) || (p && p.state) || '' });
    if (kind === 'open') {
      // we are host now
      // Hosting is a new room: anything left from solo play or a previous room
      // is not this room's table.
      resetTables();
      grace.stop();
      hideBanner();
      if (redialTimer) { clearTimeout(redialTimer); redialTimer = null; }
      redialDelay = 1500;
      store.openRoom(p.room, true);
      store.upsertMember({ id: s.me.id, name: s.me.name, host: true, game: s.openGame });
      noteSeen(s.me.id);
      startHeartbeat();
      showRoom();
      renderRoster();
      pushRosterToGames();
      saveSession(store.state);
      setStatus('host-status', 'Room live: ' + p.room);
    } else if (kind === 'guest-open') {
      // guest peer ready: say hello (also re-hello on redial)
      ensureNet().sendHello(p.conn, { id: s.me.id, name: s.me.name });
    } else if (kind === 'message') {
      onMessage(p.fromConn, p.msg);
    } else if (kind === 'guest-left') {
      if (p.id) dropGuest(p.id);
    } else if (kind === 'host-conn') {
      if (p.state === 'closed' && s.inRoom && !s.isHost) onHostLost();
    } else if (kind === 'peer-error') {
      errBox(p.err);
    }
  }

  // Rolling transcript of wire traffic. There was no message logging anywhere in
  // the hub, which is why "it just won't work" was unfollowable: an intent
  // that went out, one that came back, and one that was dropped all looked
  // identical from the outside. Read it with BubHub.log() in the console.
  const wireLog = [];
  function logWire(direction, m) {
    const line = {
      at: Date.now(),
      dir: direction,
      type: m && m.type,
      p: m && m.p
    };
    wireLog.push(line);
    if (wireLog.length > 200) wireLog.shift();
    try { console.log('[bubhub ' + direction + ']', m && m.type, m && m.p); } catch (e) {}
    return line;
  }
  function logNote(text) {
    wireLog.push({ at: Date.now(), dir: 'note', type: 'note', p: text });
    if (wireLog.length > 200) wireLog.shift();
    try { console.warn('[bubhub]', text); } catch (e) {}
  }

  function onMessage(fromConn, m) {
    const s = store.state;
    logWire('in', m);
    if (s.isHost) noteSeen(senderOf(m));
    if (s.isHost && m && m.type === T.INTENT && !(m.p && m.p.denied)) {
      logWire('out', msg(T.STATE, { game: m.p.game, view: '(projected)' }));
    }
    if (m.type === T.HELLO) {
      if (!s.isHost) return;
      const want = String(m.p.name || 'Player').slice(0, 24);
      const helloId = String(m.p.id || 'p-unknown');
      // Refresh rejoin: same name, new id, old conn dead — hand back the old
      // slot instead of seating a numbered duplicate next to the ghost.
      const slotId = findReclaimId(store.state.roster, function (rid) {
        return !!(net && net.isOpen(rid));
      }, { id: helloId, name: want }) || helloId;
      const name = store.claimName(want, slotId);
      ensureNet().bindGuest(slotId, fromConn);
      noteSeen(slotId);
      store.upsertMember({ id: slotId, name: name, host: false, game: null });
      // tell newcomer + everyone
      ensureNet().sendTo(slotId, msg(T.WELCOME, {
        you: { id: slotId, name: name, isHost: false },
        room: s.roomId,
        roster: store.rosterList(),
        seats: Object.assign({}, s.seats),
        // Every table's seat map, so a guest's local mirror matches the host's
        // for all of them and not just whichever game is open right now.
        seatMaps: store.seatMaps(),
        states: s.lastState
      }));
      if (name !== want) ensureNet().sendTo(slotId, msg(T.RENAME, { id: slotId, name: name }));
      broadcastRoster();
      renderRoster();
      pushRosterToGames();
    } else if (m.type === T.WELCOME) {
      // guest accepted (first join or redial)
      grace.stop();
      hideBanner();
      if (redialTimer) { clearTimeout(redialTimer); redialTimer = null; }
      redialDelay = 1500;
      store.openRoom(m.p.room, false);
      store.setHostId(null);
      store.setRoster(m.p.roster || []);
      // A guest never holds authoritative tables of its own — anything it
      // built by running init() itself is a fiction that beats the host's real
      // state in mountGame. Drop it and take the host's word for everything.
      resetTables();
      if (m.p.seatMaps) store.state.seatsByGame = Object.assign({}, m.p.seatMaps);
      else if (m.p.seats) Object.keys(m.p.seats).forEach(function (k) { store.claimSeat(k, m.p.seats[k]); });
      if (m.p.you) store.setMe(m.p.you.id, m.p.you.name);
      if (m.p.states) Object.keys(m.p.states).forEach(function (g) { store.cacheState(g, m.p.states[g]); });
      showRoom();
      renderRoster();
      pushRosterToGames();
      // open pending invite game once
      if (pendingGame) {
        const g = pendingGame;
        pendingGame = null;
        openGame(g);
      } else if (s.openGame) {
        const g2 = byId.get(s.openGame);
        if (g2) mountGame(g2);
      }
      saveSession(store.state);
    } else if (m.type === T.ROSTER) {
      if (s.isHost) return;
      store.setRoster(m.p.roster || []);
      if (m.p.seatMaps) {
        store.state.seatsByGame = Object.assign({}, m.p.seatMaps);
        if (s.openGame) store.state.seats = store.seatMap(s.openGame);
      }
      renderRoster();
      pushRosterToGames();
    } else if (m.type === T.CHAT) {
      chat.onNetMessage(m);
    } else if (m.type === T.RENAME) {
      store.setName(m.p.name);
      renderNameGate();
      saveName();
    } else if (m.type === T.PRESENCE) {
      if (s.isHost) {
        // Someone who was at one table and is now at another (or at none) must stop
        // holding a seat there, or the table they left waits on them forever.
        const was = (s.roster.find(function (r) { return r.id === m.p.id; }) || {}).game || null;
        const now = m.p.game || null;
        store.setPresence(m.p.id, now);
        if (was && was !== now && pruneOneGame(was, m.p.id)) pushRosterToGames();
        broadcastRoster();
        renderRoster();
      }
    } else if (m.type === T.SNAPSHOT) {
      // A guest just opened a game. Answer with the real table, projected for
      // them. Only module games have a host-side table to send; legacy frames
      // are pushed their state by pushRosterToGames / the onHello handler.
      if (!s.isHost) return;
      const gid = m.p && m.p.game;
      const want = (m.p && m.p.id) || senderOf(m);
      if (!gid || !byId.get(gid)) return;
      if (!sendSnapshotTo(gid, want)) {
        console.warn('could not send a snapshot of "' + gid + '" to ' + want);
      }
    } else if (m.type === T.INTENT) {
      if (s.isHost) {
        const g = byId.get(m.p.game);
        if (g && g.kind === 'module') {
          hostReduce(m.p.game, m.p.action, m.p.from);
        } else {
          // compat: feed into host iframe; legacy onDown reads (p, from)
          compat.down(m.p.game, 'intent', m.p.action, m.p.from);
        }
      } else if (m.p && m.p.denied) {
        // The host refused one of our intents. This used to vanish, which is
        // why a refused action looked like nothing happening. Route it to the
        // mounted module if it wants it; legacy games use compat.down.
        const g = byId.get(m.p.game);
        if (g && g.kind === 'module' && moduleHandle && typeof moduleHandle.denied === 'function') {
          try { moduleHandle.denied(m.p.text); } catch (e) {}
        } else {
          compat.down(m.p.game, 'denied', { text: m.p.text });
        }
      }
    } else if (m.type === T.STATE) {
      const g = byId.get(m.p.game);
      store.cacheState(m.p.game, m.p.view);
      if (g && g.kind === 'module') stageUpdate(m.p.game, m.p.view);
      else compat.down(m.p.game, 'state', m.p.view);
    } else if (m.type === 'result' || m.type === T.RESULT) {
      if (m.p && m.p.entry) record.addLocal(m.p.entry);
    } else if (m.type === T.PING) {
      // Heartbeat: the host's sweep in startHeartbeat() drops guests that go
      // silent (refresh killed the socket but 'close' never fired). Guests
      // answer with their id so the host can stamp them alive.
      if (s.isHost) {
        if (senderOf(m)) noteSeen(senderOf(m));
      } else {
        ensureNet().sendToHost(msg(T.PING, { id: store.state.me.id }));
      }
    } else if (m.type === T.KICK) {
      if (s.isHost) return; // hosts never take kick orders
      const keepName = store.state.me.name;
      const keepId = store.state.me.id;
      // closeRoom FIRST: teardownNet severs the host conn, whose 'close'
      // event would otherwise look like host loss and start the grace
      // countdown + redial back into the room we were just removed from.
      closeStageOnly();
      store.closeRoom();
      resetTables();
      store.setMe(keepId, keepName);
      teardownNet();
      showLobby();
      setStatus('join-status', 'Removed by the host.');
      histReplace({ room: '', game: '' });
    }
  }

  // ---------- ghost cleanup + host kick ----------
  // A refresh leaves the old id in the roster while the player rejoins with a
  // new one, and conn 'close' often never fires. So: guests heartbeat, the
  // host sweeps the silent ones, and every removal prunes game state too
  // (the roster alone was never enough — modState kept the ghost seated).
  const lastSeen = new Map();
  let hbTimer = null;

  function senderOf(m) {
    const p = (m && m.p) || {};
    if (p.from && p.from.id) return String(p.from.id);
    if (p.id) return String(p.id);
    return '';
  }

  function noteSeen(id) { if (id) lastSeen.set(id, Date.now()); }

  function startHeartbeat() {
    stopHeartbeat();
    hbTimer = setInterval(function () {
      const s = store.state;
      if (!s.inRoom || !s.isHost || !net) return;
      try { net.broadcast(msg(T.PING, {})); } catch (e) {}
      const now = Date.now();
      Array.from(net.guests.keys()).forEach(function (id) {
        const c = net.guests.get(id);
        if (!(c && c.open) || now - (lastSeen.get(id) || 0) > DEAD_MS) dropGuest(id);
      });
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  }

  // Re-project one module game and push it to everyone still here.
  function rebroadcastGame(gameId) {
    const entry = modState.get(gameId);
    if (!entry) return;
    const s = store.state;
    const hostView = safeProject(entry.mod, entry.state, s.me.id);
    store.cacheState(gameId, hostView);
    stageUpdate(gameId, hostView);
    if (s.inRoom && s.isHost && net) {
      s.roster.forEach(function (m) {
        if (m.id === s.me.id) return;
        try {
          net.sendTo(m.id, msg(T.STATE, { game: gameId, view: safeProject(entry.mod, entry.state, m.id) }));
        } catch (e) {}
      });
    }
  }

  // Take one player out of one module game's state. A game may know its own shape better than
  // the shared helper does (Hook keeps an order/names/scores table, which prunePlayerState
  // cannot see), so a game's own prune wins. Returns whether anything moved.
  function pruneOneGame(gameId, goneId) {
    const st = modState.get(gameId);
    if (!st || !st.state) return false;
    const own = (st.mod && typeof st.mod.prune === 'function') ? st.mod.prune : null;
    let next = own ? own(st.state, goneId) : prunePlayerState(st.state, goneId);
    if (!next || next.error) return false;        // a game that does not know leave: ignore it
    if (next === st.state) return false;
    st.state = next;
    rebroadcastGame(gameId);
    return true;
  }

  // Remove one player from every live game table (module) and refresh legacy
  // frames with the corrected roster + snapshots. Finished-round history is
  // kept — only live membership is pruned.
  function pruneGames(goneId) {
    let changed = false;
    modState.forEach(function (st, gameId) {
      if (!st || !st.state) return;
      if (pruneOneGame(gameId, goneId)) changed = true;
    });
    pushRosterToGames();
    const s = store.state;
    if (changed && s.inRoom && s.isHost && net) {
      Object.keys(s.lastState).forEach(function (gid) {
        if (modState.has(gid)) return; // already pushed above
        try { net.broadcast(msg(T.STATE, { game: gid, view: s.lastState[gid] })); } catch (e) {}
      });
    }
  }

  // Shared removal path: clean conn close, heartbeat timeout, and host kick.
  function dropGuest(id) {
    if (!id || !store.state.isHost) return;
    if (net) { try { net.closeConn(id); } catch (e) {} }
    lastSeen.delete(id);
    store.removeMember(id);
    pruneGames(id);
    broadcastRoster();
    renderRoster();
  }

  function doKick(id) {
    const s = store.state;
    if (!s.inRoom || !s.isHost || id === s.me.id) return;
    const m = s.roster.find(function (x) { return x.id === id; });
    const name = (m && m.name) || 'this player';
    if (!window.confirm('Remove ' + name + ' from the room?')) return;
    if (net) { try { net.sendTo(id, msg(T.KICK, { text: 'Removed by the host.' })); } catch (e) {} }
    dropGuest(id);
  }

  function broadcastRoster() {
    const s = store.state;
    if (!s.isHost) return;
    ensureNet().broadcast(msg(T.ROSTER, {
      roster: store.rosterList(),
      seats: Object.assign({}, s.seats),
      seatMaps: store.seatMaps()
    }));
  }

  // ---------- host loss / grace ----------
  function onHostLost() {
    const s = store.state;
    if (!s.inRoom || s.isHost || grace.active) return;
    grace.start();
    scheduleRedial();
  }

  function scheduleRedial() {
    if (redialTimer) return;
    const attempt = function () {
      const s = store.state;
      if (!s.inRoom || s.isHost || !grace.active) return;
      try {
        ensureNet().redial(s.roomId, function (conn) {
          ensureNet().sendHello(conn, { id: s.me.id, name: s.me.name });
        });
      } catch (e) {}
      redialDelay = Math.min(redialDelay * 1.5, 5000);
      redialTimer = setTimeout(function () {
        redialTimer = null;
        if (grace.active) scheduleRedial();
      }, redialDelay);
    };
    redialTimer = setTimeout(attempt, redialDelay);
  }

  // ---------- compat wiring (legacy iframe -> hub) ----------
  let pendingGame = null;

  function wireCompat() {
    compat.hooks.onTouched = function (game) {
      // compat fires onTouched for every intent from every iframe game, so this
      // has to be opt-in per game. Goldberg is the only one: a machine is built
      // part by part and then simply runs, with no round to report a result
      // from. Every other game posts a real result.
      const g = byId.get(game);
      if (!g || !g.meta.activityRecord) return;
      const me = store.state.me.name || 'Someone';
      const title = g.meta.title || game;
      // Time-bucketed: one line per half hour of building, not one per part.
      try {
        record.recordLine(game, me + ' had a go at ' + title,
          'touch-' + Math.floor(Date.now() / 1800000));
      } catch (e) {}
    };
    compat.hooks.onResult = function (game, p) {
      const s = store.state;
      const g = byId.get(game);
      if (g && g.meta.noRecord) return;
      if (s.inRoom && !s.isHost) return; // host records multiplayer
      const meta = (g && g.meta) || { id: game, title: game };
      try { record.recordLegacy(meta, p); } catch (e) {}
    };
    window.addEventListener('message', function (e) {
      compat.onMessage(e, {
        onHello: function (game) {
          pushRosterToGames();
          const cached = store.getCached(game);
          if (cached !== undefined && (store.state.isHost || !store.state.inRoom)) {
            compat.down(game, 'state', cached);
          }
        },
        routeIntent: function (game, action) {
          const s = store.state;
          const from = { id: s.me.id, name: s.me.name, host: !!s.isHost };
          if (s.isHost || !s.inRoom) {
            // host (or solo local host): feed to own frame with sender attached
            compat.down(game, 'intent', action, from);
          } else {
            ensureNet().sendToHost(msg(T.INTENT, {
              game: game, action: action, from: { id: s.me.id, name: s.me.name, host: !!s.isHost }
            }));
          }
        },
        routeState: function (game, state) {
          const s = store.state;
          if (!s.inRoom || s.isHost) {
            store.cacheState(game, state);
            if (s.isHost) ensureNet().broadcast(msg(T.STATE, { game: game, view: state }));
          }
        },
        routeDenied: function (game, p) {
          const to = p && p.to;
          if (to && store.state.isHost) ensureNet().sendTo(to, msg(T.INTENT, { game: game, denied: true, text: p.text }));
          else if (!store.state.isHost) compat.down(game, 'denied', p);
        },
        onInvite: function () {}
      });
    });
  }

  // ---------- identity / names ----------
  function getName() { return store.state.me.name; }
  function saveName() { try { localStorage.setItem(NAME_KEY, getName()); } catch (e) {} }

  function renderNameGate() {
    const st = document.getElementById('name-state');
    if (st) {
      st.textContent = nameConfirmed ? ('✓ ' + getName()) : 'tap ✓ to confirm';
      st.className = 'text-[11px] font-mono ' + (nameConfirmed ? 'text-emerald-300' : 'text-amber-300');
    }
    const gate = !nameConfirmed && !store.state.inRoom;
    ['btn-host', 'btn-join'].forEach(function (id) {
      const b = document.getElementById(id);
      if (b) { b.disabled = gate; }
    });
  }

  function confirmName(v) {
    const clean = String(v || '').trim().slice(0, 24) || randomPick();
    store.setName(store.claimName(clean));
    nameConfirmed = true;
    saveName();
    renderNameGate();
    saveSession(store.state);
  }

  function randomPick() {
    const pool = ['Fox', 'Otter', 'Badger', 'Hawk', 'Wolf', 'Bear'];
    const pick = pool[Math.floor(Math.random() * pool.length)] + Math.floor(Math.random() * 90 + 10);
    recentAnimals.push(pick);
    return pick;
  }

  // ---------- host / join flows ----------
  function randomRoom() { return 'bubbies' + Math.floor(100 + Math.random() * 900); }

  async function hostRoom() {
    errBox(null);
    if (!nameConfirmed) { setStatus('host-status', 'Confirm your name first (✓).'); return; }
    if (store.state.inRoom) { setStatus('host-status', 'You are already in room ' + store.state.roomId + ' — leave it first.'); return; }
    const want = (document.getElementById('host-id-input').value || '').trim() || randomRoom();
    const keepGame = store.state.openGame;
    setStatus('host-status', 'Creating ' + want + '…');
    try {
      await ensureNet().host(want, 0);
      // onNetEvent('open') finishes the job; re-open solo game under the room
      if (keepGame) openGame(keepGame);
      histReplace({ room: want });
    } catch (e) {
      setStatus('host-status', String((e && e.message) || e));
    }
  }

  // Start a fresh room from wherever you are. Deliberately not confirm-gated:
  // "new room" is the button you press when the current one is dead, so
  // asking "are you sure?" about it is a question nobody wants answered.
  // Leaving the old room is still confirm-gated — that is the one that leaves.
  async function newRoom() {
    if (store.state.inRoom) {
      const keepName = store.state.me.name;
      const keepId = store.state.me.id;
      const want = randomRoom();
      // closeRoom FIRST: teardownNet severs the host connection, and while
      // inRoom is still true its 'close' event looks like host loss — which
      // starts a 30s grace timer that then kills the room we are about to
      // create, a minute later, with a message blaming a host who is there.
      closeStageOnly();
      store.closeRoom();
      resetTables();
      teardownNet();
      store.setMe(keepId, keepName);
      document.getElementById('host-id-input').value = want;
      showLobby();
      histReplace({ room: '', game: '' });
      await hostRoom();
      return;
    }
    // Not in a room: just leave the game and show the lobby.
    leaveOpenGame();
    showLobby();
    setStatus('join-status', 'Press Host to make a room, or join one you were sent.');
  }

  async function joinRoom(roomId, game) {
    errBox(null);
    if (!nameConfirmed) { setStatus('join-status', 'Confirm your name first (✓).'); return; }
    if (store.state.inRoom) { setStatus('join-status', 'You are already in room ' + store.state.roomId + ' — leave it first.'); return; }
    const room = (roomId || document.getElementById('join-id-input').value || '').trim();
    if (!room) { setStatus('join-status', 'Enter a room id.'); return; }
    pendingGame = game || null;
    setStatus('join-status', 'Connecting to ' + room + '…');
    try {
      const conn = await ensureNet().join(room);
      ensureNet().sendHello(conn, { id: store.state.me.id, name: store.state.me.name });
      histReplace({ room: room });
    } catch (e) {
      setStatus('join-status', String((e && e.message) || e));
    }
  }

  function leaveRoom() {
    const s = store.state;
    const others = s.roster.filter(function (m) { return m.id !== s.me.id; }).length;
    const label = s.inRoom ? ('room ' + s.roomId + ' (' + (others ? others + ' friend' + (others === 1 ? '' : 's') + ' here' : 'just you') + ')') : 'solo play';
    if (!window.confirm('Leave ' + label + '?')) return;
    const keepName = s.me.name;
    const keepId = s.me.id;
    // closeRoom before teardownNet — see newRoom(): severing the host
    // connection while still inRoom reads as host loss and re-arms grace.
    closeStageOnly();
    store.closeRoom();
    resetTables();
    teardownNet();
    store.setMe(keepId, keepName);
    clearSession();
    histReplace({ room: '', game: '' });
    showLobby();
    setStatus('join-status', '');
    setStatus('host-status', '');
  }

  // ---------- wire UI ----------
  function wireUI() {
    document.getElementById('host-id-input').value = randomRoom();
    const saved = loadSavedName();
    if (saved) { store.setName(saved); }
    else { store.setName(randomAnimalName(recentAnimals)); }
    document.getElementById('player-name').value = getName();

    renderButtons();
    renderNameGate();
    renderRoster();

    document.getElementById('btn-name-shuffle').addEventListener('click', function () {
      const n = randomAnimalName(recentAnimals);
      recentAnimals.push(n);
      document.getElementById('player-name').value = n;
      nameConfirmed = false;
      renderNameGate();
    });
    document.getElementById('btn-name-ok').addEventListener('click', function () {
      confirmName(document.getElementById('player-name').value);
    });
    document.getElementById('player-name').addEventListener('input', function (e) {
      nameConfirmed = false;
      store.setName(String(e.target.value || '').slice(0, 24));
      renderNameGate();
    });
    document.getElementById('btn-shuffle').addEventListener('click', function () {
      document.getElementById('host-id-input').value = randomRoom();
    });
    document.getElementById('btn-host').addEventListener('click', hostRoom);
    document.getElementById('btn-join').addEventListener('click', function () { joinRoom(); });
    document.getElementById('btn-disconnect').addEventListener('click', leaveRoom);
    document.getElementById('btn-new-room').addEventListener('click', function () { newRoom(); });

    chat.wire();
    // chat needs live net access: patch send path
    const origSend = chat.send;
    chat.send = function (t) {
      const text = String(t || '').trim().slice(0, 500);
      if (!text) return;
      const s = store.state;
      if (!s.inRoom) { chat.logChat(s.me.name, text); return; }
      origSend(text);
    };
    invite.wire();
    record.wire();

    document.getElementById('btn-focus-exit').addEventListener('click', function () {
      leaveOpenGame();
    });
    document.getElementById('drawer-close').addEventListener('click', function () {
      document.body.classList.remove('drawer-open');
      chat.markSeen();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (document.body.classList.contains('drawer-open')) document.body.classList.remove('drawer-open');
        else if (stageRoot && !stageRoot.classList.contains('stage-idle')) {
          leaveOpenGame();
        }
      }
    });
    window.addEventListener('pagehide', function () { saveSession(store.state); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) saveSession(store.state);
    });

    // store -> UI
    store.subscribe(function () {
      renderRoster();
      renderHeaderRoom();
    });

    // NOTE: no resume bar by design — rejoining is an explicit act
    // (paste an invite link or host anew), not a one-click habit.

    // invite link landing (?room=&game=)
    const inv = parseInvite();
    if (inv.room) {
      const w = loadSavedName();
      if (w) {
        joinRoom(inv.room, inv.game || null);
      } else {
        const land = document.getElementById('invite-landing');
        land.classList.remove('hidden');
        document.getElementById('invite-room-line').textContent = 'room: ' + inv.room;
        const gt = document.getElementById('invite-game-title');
        if (gt && inv.game) gt.textContent = gameTitle(inv.game);
        document.getElementById('btn-invite-join').addEventListener('click', function () {
          confirmName(document.getElementById('invite-name').value || randomPick());
          land.classList.add('hidden');
          joinRoom(inv.room, inv.game || null);
        });
      }
    } else if (inv.game && byId.get(inv.game)) {
      openGame(inv.game);
    } else if (!loadSavedName()) {
      // first visit: blocking name modal
      const w2 = document.getElementById('welcome-landing');
      w2.classList.remove('hidden');
      document.getElementById('welcome-name').value = getName();
      document.getElementById('btn-welcome-shuffle').addEventListener('click', function () {
        document.getElementById('welcome-name').value = randomAnimalName(recentAnimals);
      });
      document.getElementById('btn-welcome-go').addEventListener('click', function () {
        confirmName(document.getElementById('welcome-name').value);
        w2.classList.add('hidden');
      });
    }

    showLobby();
    record.load();
  }

  // chat/record net patch: give them broadcast fns now net exists lazily

  wireCompat();
  wireUI();
  pushRosterToGames();

  // expose for debugging + play tests. leaveOpenGame/newRoom/modState were
  // unreachable from the console, which made a game switch impossible to
  // reproduce or recover without a reload.
  window.BubHub = {
    store: store,
    registry: registry,
    openGame: openGame,
    leaveRoom: leaveRoom,
    leaveOpenGame: leaveOpenGame,
    newRoom: newRoom,
    hostRoom: hostRoom,
    joinRoom: joinRoom,
    getNet: getNet,
    modState: modState,
    log: function () { return wireLog.slice(); },
    stage: stage
  };
}
