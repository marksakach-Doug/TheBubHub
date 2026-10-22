// Cầu nối một người chơi cho Chém Từ.
//
// Game gốc là một module của Bub Hub và chỉ biết nói chuyện qua send/reduce/
// project. Ở đây không có phòng, không có mạng: mọi hành động được giảm ngay
// trên máy này rồi vẽ lại. Nhờ vậy luật chơi trong game.js giữ nguyên.

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

  send: function (action) {
    if (!action || action.a === 'join') return;

    const next = reduce(state, action, {
      from: { id: PLAYER_ID, name: PLAYER_NAME, host: true },
      rng: Math.random
    });

    if (next && next.error) {
      game.denied(next.error);
      return;
    }

    state = next;
    view = project(state, PLAYER_ID);
    game.update(view);
  },

  raf: function (cb) { return window.requestAnimationFrame(cb); },
  cancelRaf: function (id) { window.cancelAnimationFrame(id); },
  setTimeout: function (fn, ms) { return window.setTimeout(fn, ms); }
});

game.update(view);
