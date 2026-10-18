// BubHub v10 — room store. The hub roster is the absolute source of truth.
// Solo = a room of one (with optional bot seats). Games never implement
// their own mySeat(): the hub passes api { me, seats, send, isSpectator }.
const ANIMAL_NAMES = ['Fox', 'Otter', 'Badger', 'Hawk', 'Wolf', 'Bear', 'Lynx', 'Mole',
  'Frog', 'Rabbit', 'Deer', 'Owl', 'Seal', 'Crab', 'Falcon', 'Newt', 'Bat', 'Goat',
  'Boar', 'Wren', 'Panda', 'Koala', 'Tiger', 'Whale'];

export function randomAnimalName(recent) {
  let pool = ANIMAL_NAMES.filter(function (n) { return recent.indexOf(n) < 0; });
  if (!pool.length) pool = ANIMAL_NAMES.slice();
  return pool[Math.floor(Math.random() * pool.length)];
}

export function createStore() {
  const listeners = new Set();
  const s = {
    roomId: '',
    hostId: '',
    inRoom: false,
    isHost: false,
    me: { id: 'p-' + Math.random().toString(36).slice(2, 10), name: '' },
    // roster: [{ id, name, host, game, spectator, bot }]
    roster: [],
    seats: {}, // seatIndex -> playerId (hub-owned, legacy flat view)
    // gameId -> { seatIndex -> playerId }. Seats are per table: one flat map
    // meant the seat you held at one game counted as taken at the next one, so
    // numbers climbed forever and games saw a "seated" viewer they had no slot
    // for. s.seats mirrors the currently open game's map for old callers.
    seatsByGame: {},
    lastState: {}, // gameId -> latest host state/view (for late joiners)
    openGame: null
  };

  function emit() { listeners.forEach(function (fn) { try { fn(s); } catch (e) {} }); }

  function rosterList() { return s.roster.slice(); }

  function nameTaken(want, exceptId) {
    const w = String(want || '').trim().toLowerCase();
    if (!w) return false;
    return s.roster.some(function (m) {
      return m.id !== exceptId && String(m.name || '').trim().toLowerCase() === w;
    });
  }

  function claimName(want, exceptId) {
    const skip = exceptId === undefined ? s.me.id : exceptId;
    const base = String(want || '').trim().slice(0, 24) || 'Player';
    if (!nameTaken(base, skip)) return base;
    for (let n = 1; n < 1000; n++) {
      const suffix = String(n);
      const cand = base.slice(0, Math.max(1, 24 - suffix.length)) + suffix;
      if (!nameTaken(cand, skip)) return cand;
    }
    return base;
  }

  return {
    state: s,
    subscribe(fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
    emit: emit,
    rosterList: rosterList,
    claimName: claimName,

    setMe(id, name) { s.me.id = id; s.me.name = name; emit(); },
    setName(name) { s.me.name = name; emit(); },

    openRoom(roomId, isHost) {
      s.roomId = roomId; s.inRoom = true; s.isHost = isHost;
      s.hostId = isHost ? s.me.id : '';
      emit();
    },
    // Solo is a room of one: not in a room, but still the host. This has to be
    // said out loud rather than left to `!inRoom` checks scattered around,
    // because api.isHost is what legacy iframes are told they are
    // (see compat.js legacyRoster) — and chess and Word Bridge decide their
    // whole solo table from it. Without this, a solo player opened a game with
    // isHost:false and the bot never moved, the rematch button never appeared,
    // and reportResult() returned early: nothing was recorded.
    openSolo() {
      s.roomId = ''; s.inRoom = false; s.isHost = true; s.hostId = s.me.id;
      emit();
    },
    closeRoom() {
      s.roomId = ''; s.inRoom = false; s.isHost = false; s.hostId = '';
      s.roster = []; s.seats = {}; s.seatsByGame = {}; s.openGame = null;
      // lastState is a cache of HOST state and must not outlive the room it
      // came from: mountGame prefers a cached view over a freshly created
      // table, so a stale entry from the previous room is what a player got
      // when they made a new room in the same tab.
      s.lastState = {};
      emit();
    },
    setHostId(id) { s.hostId = id; emit(); },

    upsertMember(m) {
      const i = s.roster.findIndex(function (x) { return x.id === m.id; });
      if (i < 0) s.roster.push(Object.assign({ game: null, spectator: false, bot: false }, m));
      else s.roster[i] = Object.assign({}, s.roster[i], m);
      emit();
    },
    removeMember(id) {
      s.roster = s.roster.filter(function (x) { return x.id !== id; });
      // free any seat they held, in every table they were sitting at
      Object.keys(s.seatsByGame).forEach(function (g) {
        const m = s.seatsByGame[g];
        Object.keys(m).forEach(function (k) { if (m[k] === id) delete m[k]; });
      });
      Object.keys(s.seats).forEach(function (k) { if (s.seats[k] === id) delete s.seats[k]; });
      emit();
    },
    setRoster(list) { s.roster = list.slice(); emit(); },
    setPresence(id, game) {
      const m = s.roster.find(function (x) { return x.id === id; });
      if (m) { m.game = game || null; emit(); }
    },

    // ---------- hub-owned seating ----------
    // Seat 0..n, per table. Whoever opens a game takes the lowest free seat —
    // not only seat 0. Only seat 0 was ever claimed, so every guest in a room
    // resolved to isSpectator() === true and could never join a table.
    // `gameId` defaults to the open game so pre-per-game callers keep working.
    seatMap(gameId) {
      const g = gameId || s.openGame || '_';
      if (!s.seatsByGame[g]) s.seatsByGame[g] = {};
      return s.seatsByGame[g];
    },
    seatMaps() { return Object.assign({}, s.seatsByGame); },
    claimSeat(seat, playerId, gameId) { this.seatMap(gameId)[seat] = playerId; emit(); },
    claimFreeSeat(playerId, gameId) {
      const m = this.seatMap(gameId);
      const taken = Object.keys(m).map(Number);
      let seat = 0;
      while (taken.indexOf(seat) >= 0) seat++;
      m[seat] = playerId;
      emit();
      return seat;
    },
    freeSeat(seat, gameId) { delete this.seatMap(gameId)[seat]; emit(); },
    // Give back every seat a player holds at a table. Leaving a game has to
    // free the seat, or the next game to open in this room hands out higher
    // and higher numbers and games think the leaver is still seated.
    freePlayerSeats(playerId, gameId) {
      const m = this.seatMap(gameId);
      let freed = null;
      Object.keys(m).forEach(function (k) { if (m[k] === playerId) { freed = Number(k); delete m[k]; } });
      emit();
      return freed;
    },
    mySeat(gameId) {
      const m = this.seatMap(gameId);
      const ids = Object.keys(m);
      for (let i = 0; i < ids.length; i++) {
        if (m[ids[i]] === s.me.id) return Number(ids[i]);
      }
      return null;
    },
    seatCount(gameId) { return Object.keys(this.seatMap(gameId)).length; },
    isSpectator() {
      if (!s.inRoom) return false;
      if (s.isHost) return false;
      return this.mySeat(s.openGame) === null;
    },

    cacheState(game, view) { s.lastState[game] = view; },
    getCached(game) { return s.lastState[game]; },
    clearStates() { s.lastState = {}; },

    // Opening a different table re-points the flat `seats` mirror at that
    // table's map, so roster labels and api.seats describe the game on screen.
    setOpenGame(g) {
      s.openGame = g;
      s.seats = g ? this.seatMap(g) : {};
      emit();
    }
  };
}
