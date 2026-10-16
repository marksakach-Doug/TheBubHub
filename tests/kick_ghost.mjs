// BubHub kick/ghost checks — node harness, no browser needed.
// Imports the SHIPPED modules (not a re-implementation) and prints
// [label, ok] pairs as JSON for tests/kick_ghost_test.py to judge.
import { T } from '../net/protocol.js';
import { createStore } from '../room/store.js';
import { findReclaimId, prunePlayerState, HEARTBEAT_MS, DEAD_MS } from '../room/presence.js';

const out = [];
const t = (label, ok) => out.push([label, !!ok]);

// ---- wire type ----
t('protocol has KICK', T.KICK === 'kick');

// ---- store: removal frees the seat (what kick/dropGuest rely on) ----
{
  const st = createStore();
  st.setMe('h', 'Host');
  st.upsertMember({ id: 'h', name: 'Host', host: true });
  st.upsertMember({ id: 'g', name: 'Guest' });
  st.claimSeat(0, 'h');
  st.claimSeat(1, 'g');
  st.removeMember('g');
  const seats = st.state.seats;
  t('removeMember frees the ghost seat',
    seats[0] === 'h' && !Object.values(seats).includes('g'));
  t('removeMember drops the roster entry',
    st.state.roster.every((m) => m.id !== 'g'));
}

// ---- reclaim: refresh with a new id but the same name takes the old slot ----
{
  const roster = [{ id: 'old1', name: 'Sam', host: false }];
  const dead = () => false;
  const live = () => true;
  t('dead same-name ghost is reclaimed',
    findReclaimId(roster, dead, { id: 'new9', name: 'sam' }) === 'old1');
  t('live same-name player is NOT reclaimed (real name clash)',
    findReclaimId(roster, live, { id: 'new9', name: 'sam' }) === null);
  t('known id is NOT a reclaim (normal rebind)',
    findReclaimId(roster, dead, { id: 'old1', name: 'Sam' }) === null);
  t('host slot is NEVER reclaimed',
    findReclaimId([{ id: 'h', name: 'Sam', host: true }], dead, { id: 'new9', name: 'Sam' }) === null);
  t('two dead ghosts stay ambiguous (falls back to dedupe)',
    findReclaimId([{ id: 'a', name: 'Sam' }, { id: 'b', name: 'Sam' }], dead,
      { id: 'n', name: 'Sam' }) === null);
  t('empty hello reclaims nothing',
    findReclaimId(roster, dead, { id: '', name: '' }) === null);
}

// ---- prune: the ghost leaves the game table, history stays ----
{
  const gs = {
    players: ['h', 'g'], hostId: 'h', table: ['h', 'g'],
    dots: { h: { a: 1 }, g: { a: 2 } }, phase: 'play'
  };
  const pr = prunePlayerState(gs, 'g');
  t('prune drops player, dot and table seat',
    pr.players.join() === 'h' && !('g' in pr.dots) && pr.table.join() === 'h');
  t('prune does not mutate the input', gs.players.length === 2 && !!gs.dots.g);
  t('prune reassigns host to first remaining player',
    prunePlayerState({ players: ['h'], hostId: 'g', dots: {} }, 'g').hostId === 'h');
  t('prune misses return the same object (callers can skip rebroadcast)',
    prunePlayerState({ players: ['h'] }, 'z') !== null &&
    (() => { const s = { players: ['h'] }; return prunePlayerState(s, 'z') === s; })());
  const over = { players: ['h', 'g'], over: { winner: 'h' }, phase: 'over' };
  t('prune keeps finished-round history',
    prunePlayerState(over, 'g').over.winner === 'h');
}

// ---- heartbeat constants ----
t('heartbeat pings faster than the death timeout', HEARTBEAT_MS < DEAD_MS);
t('death timeout is 15s', DEAD_MS === 15000);

console.log(JSON.stringify(out));
