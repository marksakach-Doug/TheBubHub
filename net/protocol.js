// BubHub v10 — wire protocol.
// Hub-and-spoke through the host. Guests talk only to the host;
// the host relays. No host migration: if the host is gone for more
// than the grace period the room closes (see room/grace.js).
export const T = {
  HELLO: 'hello',       // guest -> host: { id, name }
  WELCOME: 'welcome',   // host -> guest: { you, room, roster, state }
  ROSTER: 'roster',     // host -> all: { roster, seats }
  CHAT: 'chat',         // all -> host -> all: { id, name, text }
  RENAME: 'rename',     // host -> all: { id, name } (dedupe result)
  PRESENCE: 'presence', // all -> host -> all: { id, game }
  INTENT: 'intent',     // guest -> host: { game, action, from }
  STATE: 'state',       // host -> guests: { game, view, from? }
  RESULT: 'result',     // host -> all: { entry }
  KICK: 'kick',         // host -> one guest: booted, leave the room
  PING: 'ping'          // host -> all heartbeat; guests reply with { id }
};

export function msg(type, p) {
  return { type: type, p: p || {} };
}

export function isValid(m) {
  return !!(m && typeof m.type === 'string' && m.p && typeof m.p === 'object');
}
