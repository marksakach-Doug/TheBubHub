// BubHub v10 — ghost-cleanup helpers (pure, no DOM, no PeerJS).
// A browser refresh mints a new player id while the host still lists the old
// one, so the room ends up with a ghost that blocks games. These two helpers
// are the automatic half of the fix (the manual half is the host boot button
// in src/main.js): rejoin reclaim + game-state prune. Kept dependency-free so
// tests/kick_ghost_test.py can import them in node with no browser.
export const HEARTBEAT_MS = 5000;
export const DEAD_MS = 15000;

function normName(n) {
  return String(n || '').trim().toLowerCase();
}

// A guest rejoining after a refresh usually arrives with a NEW id but the
// SAME name while the old roster entry's connection is dead. Reclaim that
// slot instead of seating a duplicate (which claimName would number `sam1`).
// Returns the old roster id to reuse, or null to take the normal join path.
// Never reclaims: a known id, the host's own slot, or an ambiguous case
// (two dead ghosts with the same name fall back to dedupe).
export function findReclaimId(roster, isAlive, hello) {
  const hid = hello && hello.id ? String(hello.id) : '';
  const want = normName(hello && hello.name);
  if (!hid || !want) return null;
  const list = roster || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].id === hid) return null;
  }
  const dead = list.filter(function (m) {
    return m && !m.host && normName(m.name) === want && !isAlive(m.id);
  });
  return dead.length === 1 ? dead[0].id : null;
}

// Drop one player from a module game's state: players, dots and table seats.
// History is untouched (`over` stays, so a finished round still records).
// Host ownership passes to the first remaining player. Returns the same
// object when there is nothing to remove, so callers can skip rebroadcast.
// Silent by design: no epoch bump, so running clients do not re-anchor.
export function prunePlayerState(state, goneId) {
  if (!state || typeof state !== 'object' || !goneId) return state;
  const players = Array.isArray(state.players) ? state.players : null;
  const table = Array.isArray(state.table) ? state.table : null;
  const inPlayers = players ? players.indexOf(goneId) >= 0 : false;
  const inTable = table ? table.indexOf(goneId) >= 0 : false;
  const hasDot = !!(state.dots && typeof state.dots === 'object' &&
    Object.prototype.hasOwnProperty.call(state.dots, goneId));
  const isHost = state.hostId === goneId;
  if (!inPlayers && !inTable && !hasDot && !isHost) return state;
  const next = Object.assign({}, state);
  if (inPlayers) next.players = players.filter(function (id) { return id !== goneId; });
  if (inTable) next.table = table.filter(function (id) { return id !== goneId; });
  if (hasDot) {
    const dots = Object.assign({}, state.dots);
    delete dots[goneId];
    next.dots = dots;
  }
  if (isHost) next.hostId = (next.players && next.players[0]) || '';
  return next;
}
