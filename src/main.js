// BubHub v10 orchestrator: identity -> lobby/room -> net -> stage/compat -> plugins.
// Solo = a room of one. The hub roster is the source of truth; games never
// implement their own seating.
import { createStore, randomAnimalName } from '../room/store.js';
import { createGrace, GRACE_MS } from '../room/grace.js';
import { createNet } from '../net/peer.js';
import { T, msg } from '../net/protocol.js';
import { createStage } from './stage.js';
import { createCompat, legacyRoster } from './compat.js';
import { loadRegistry, soloCorner, roomLists } from './registry.js';
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
  const modState = new Map();

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
      teardownNet();
      store.closeRoom();
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
    hideBanner();
    if (redialTimer) { clearTimeout(redialTimer); redialTimer = null; }
    redialDelay = 1500;
    if (net) { try { net.close(); } catch (e) {} }
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

  function memberLabel(m) {
    const s = store.state;
    let seat = '';
    Object.keys(s.seats).forEach(function (k) { if (s.seats[k] === m.id) seat = ' (seat ' + k + ')'; });
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
    li.className = 'text-slate-200 text-sm pl-2';
    li.textContent = memberLabel(m);
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
      btn.addEventListener('click', function () { openGame(gid); });
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
    const count = g.meta.players && g.meta.players.min !== undefined
      ? g.meta.players.min + '-' + g.meta.players.max + ' players'
      : (g.meta.players || '');
    b.title = [count, g.meta.desc, g.kind === 'module' ? 'New module.' : 'Classic.']
      .filter(Boolean).join(' ');
    b.addEventListener('click', function () { openGame(g.meta.id); });
    return b;
  }

  function renderButtons() {
    const lobby = document.getElementById('lobby-game-buttons');
    if (lobby) {
      lobby.innerHTML = '';
      soloCorner(registry).forEach(function (g) { lobby.appendChild(gameButton(g, 'lobby')); });
    }
    const lists = roomLists(registry);
    const mb = document.getElementById('game-buttons');
    if (mb) {
      mb.innerHTML = '';
      lists.multi.forEach(function (g) { mb.appendChild(gameButton(g, 'room')); });
    }
    const sb = document.getElementById('solo-game-buttons');
    if (sb) {
      sb.innerHTML = '';
      lists.solo.forEach(function (g) { sb.appendChild(gameButton(g, 'solo')); });
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
      store.setOpenGame(id);
      // hub seats you immediately in solo (room of one)
      if (store.mySeat() === null) store.claimSeat(0, s.me.id);
      store.upsertMember({ id: s.me.id, name: s.me.name, host: true, game: id });
      mountGame(g);
      saveSession(store.state);
      return;
    }
    store.setOpenGame(id);
    // hub-owned seating: first open claims seat 0 for opener if free
    if (s.seats[0] === undefined && !store.isSpectator()) store.claimSeat(0, s.me.id);
    store.setPresence(s.me.id, id);
    broadcastRoster();
    mountGame(g);
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
      // late joiners / re-opens get the cached state first
      const cached = store.getCached(g.meta.id);
      const view = cached !== undefined ? cached : st.state;
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
    if (g && g.kind === 'module' && g.module) {
      if (s.isHost || !s.inRoom) {
        hostReduce(gameId, action, { id: s.me.id, name: s.me.name });
      } else {
        ensureNet().sendToHost(msg(T.INTENT, { game: gameId, action: action, from: { id: s.me.id, name: s.me.name } }));
      }
    } else {
      // compat: guest intents go to host iframe; host applies + broadcasts
      if (s.isHost || !s.inRoom) {
        compat.down(gameId, 'intent', action);
        // solo: nothing to broadcast
      } else {
        ensureNet().sendToHost(msg(T.INTENT, { game: gameId, action: action, from: { id: s.me.id, name: s.me.name } }));
      }
    }
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
      if (typeof mod.project === 'function') return mod.project(state, playerId);
    } catch (e) { console.error('project() threw:', e); }
    return state;
  }

  // ---------- net events ----------
  function onNetEvent(kind, p) {
    const s = store.state;
    if (kind === 'open') {
      // we are host now
      store.openRoom(p.room, true);
      store.upsertMember({ id: s.me.id, name: s.me.name, host: true, game: s.openGame });
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
      if (p.id) {
        store.removeMember(p.id);
        broadcastRoster();
        renderRoster();
      }
    } else if (kind === 'host-conn') {
      if (p.state === 'closed' && s.inRoom && !s.isHost) onHostLost();
    } else if (kind === 'peer-error') {
      errBox(p.err);
    }
  }

  function onMessage(fromConn, m) {
    const s = store.state;
    if (m.type === T.HELLO) {
      if (!s.isHost) return;
      const want = String(m.p.name || 'Player').slice(0, 24);
      const id = String(m.p.id || 'p-unknown');
      const name = store.claimName(want, id);
      ensureNet().bindGuest(id, fromConn);
      store.upsertMember({ id: id, name: name, host: false, game: null });
      // tell newcomer + everyone
      ensureNet().sendTo(id, msg(T.WELCOME, {
        you: { id: id, name: name, isHost: false },
        room: s.roomId,
        roster: store.rosterList(),
        seats: Object.assign({}, s.seats),
        states: s.lastState
      }));
      if (name !== want) ensureNet().sendTo(id, msg(T.RENAME, { id: id, name: name }));
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
      if (m.p.seats) Object.keys(m.p.seats).forEach(function (k) { store.claimSeat(k, m.p.seats[k]); });
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
        store.setPresence(m.p.id, m.p.game || null);
        broadcastRoster();
        renderRoster();
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
      }
    } else if (m.type === T.STATE) {
      const g = byId.get(m.p.game);
      store.cacheState(m.p.game, m.p.view);
      if (g && g.kind === 'module') stageUpdate(m.p.game, m.p.view);
      else compat.down(m.p.game, 'state', m.p.view);
    } else if (m.type === 'result' || m.type === T.RESULT) {
      if (m.p && m.p.entry) record.addLocal(m.p.entry);
    }
  }

  function broadcastRoster() {
    const s = store.state;
    if (!s.isHost) return;
    ensureNet().broadcast(msg(T.ROSTER, { roster: store.rosterList(), seats: Object.assign({}, s.seats) }));
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
    compat.hooks.onTouched = function () {};
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
          const from = { id: s.me.id, name: s.me.name };
          if (s.isHost || !s.inRoom) {
            // host (or solo local host): feed to own frame with sender attached
            compat.down(game, 'intent', action, from);
          } else {
            ensureNet().sendToHost(msg(T.INTENT, {
              game: game, action: action, from: { id: s.me.id, name: s.me.name }
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
    teardownNet();
    closeStageOnly();
    store.closeRoom();
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
      closeStageOnly();
      store.setOpenGame(null);
      saveSession(store.state);
    });
    document.getElementById('drawer-close').addEventListener('click', function () {
      document.body.classList.remove('drawer-open');
      chat.markSeen();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (document.body.classList.contains('drawer-open')) document.body.classList.remove('drawer-open');
        else if (stageRoot && !stageRoot.classList.contains('stage-idle')) {
          closeStageOnly();
          store.setOpenGame(null);
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

  // expose for debugging + play tests
  window.BubHub = { store: store, openGame: openGame, leaveRoom: leaveRoom, registry: registry };
}
