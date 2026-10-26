// Local one-player harness for public/vietgames/caupha/ (follows the VietGames contract in README.md).
import * as game from './game.js';

const host = document.getElementById('stage');
const root = host.attachShadow({ mode: 'open' });
const me = { id: 'solo', name: 'Bé', host: true, game: game.meta.id, spectator: false };

let state = game.init({ seats: [me], atTable: [me], options: {} });
let mounted = null;

const api = {
  me: { id: me.id, name: me.name },
  seats: { 0: me.id },
  roster: [me],
  atTable: [me],
  isSpectator: false,
  isHost: true,
  isInRoom: false,
  root,
  raf: (fn) => requestAnimationFrame(fn),
  cancelRaf: (id) => cancelAnimationFrame(id),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  send(action) {
    const next = game.reduce(state, action, { from: me, rng: Math.random });
    if (next && !next.error) {
      state = next;
      if (mounted) mounted.update(game.project(state, me.id));
    }
  }
};

mounted = game.mount(root, api);
mounted.update(game.project(state, me.id));