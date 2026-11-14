import { init, reduce, project, mount } from './game.js';

const PLAYER_ID = 'local';
const PLAYER_NAME = 'Bạn';
const root = document.getElementById('vietgames-game');

if (!root) throw new Error('Thiếu #vietgames-game');

let state = init({ atTable: [{ id: PLAYER_ID, name: PLAYER_NAME }] });
let view = project(state, PLAYER_ID);

const game = mount(root, {
  me: { id: PLAYER_ID, name: PLAYER_NAME },
  isHost: true,
  isSpectator: false,
  roster: [{ id: PLAYER_ID, name: PLAYER_NAME }],
  atTable: [{ id: PLAYER_ID, name: PLAYER_NAME }],

  send: function (action) {
    if (!action) return;

    const next = reduce(state, action, {
      from: { id: PLAYER_ID, name: PLAYER_NAME, host: true },
      rng: Math.random
    });

    if (next && next.error) {
      if (typeof game.denied === 'function') game.denied(next.error);
      return;
    }

    state = next;
    view = project(state, PLAYER_ID);
    game.update(view);
  },

  raf: function (cb) { return window.requestAnimationFrame(cb); },
  cancelRaf: function (id) { window.cancelAnimationFrame(id); },
  setTimeout: function (fn, ms) { return window.setTimeout(fn, ms); },
  setInterval: function (fn, ms) { return window.setInterval(fn, ms); },
  clearInterval: function (id) { return window.clearInterval(id); }
});

game.update(view);
