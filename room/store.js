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
    seats: {}, // seatIndex -> playerId (hub-owned)
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
    closeRoom() {
      s.roomId = ''; s.inRoom = false; s.isHost = false; s.hostId = '';
      s.roster = []; s.seats = {}; s.openGame = null;
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
      // free any seat they held
      Object.keys(s.seats).forEach(function (k) { if (s.seats[k] === id) delete s.seats[k]; });
      emit();
    },
    setRoster(list) { s.roster = list.slice(); emit(); },
    setPresence(id, game) {
      const m = s.roster.find(function (x) { return x.id === id; });
      if (m) { m.game = game || null; emit(); }
    },

    // Hub-owned seating: seat 0..n. Spectators are roster members with no seat.
    // Whoever opens a game takes the lowest free seat — not only seat 0. Only
    // seat 0 was ever claimed, so every guest in a room resolved to
    // isSpectator() === true and could never join a table.
    claimSeat(seat, playerId) { s.seats[seat] = playerId; emit(); },
    claimFreeSeat(playerId) {
      const taken = Object.keys(s.seats).map(Number);
      let seat = 0;
      while (taken.indexOf(seat) >= 0) seat++;
      s.seats[seat] = playerId;
      emit();
      return seat;
    },
    freeSeat(seat) { delete s.seats[seat]; emit(); },
    mySeat() {
      const ids = Object.keys(s.seats);
      for (let i = 0; i < ids.length; i++) {
        if (s.seats[ids[i]] === s.me.id) return Number(ids[i]);
      }
      return null;
    },
    isSpectator() {
      if (!s.inRoom) return false;
      if (s.isHost) return false;
      return this.mySeat() === null;
    },

    cacheState(game, view) { s.lastState[game] = view; },
    getCached(game) { return s.lastState[game]; },

    setOpenGame(g) { s.openGame = g; emit(); }
  };
}
