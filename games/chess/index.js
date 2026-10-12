// BubHub v10 — Chess module stub. Full rules port (Group A baseline) is
// deferred; this stub proves the meta/init/reduce/project/bot/summarize/mount
// contract loads through import.meta.glob and the Shadow DOM stage.
export const meta = {
  id: 'chess',
  title: 'Chess',
  icon: '♞',
  color: '#c89b6d',
  players: { min: 2, max: 2 },
  bots: true,
  onLeave: 'end',
  record: true
};

export const init = function (opts) {
  const seats = (opts && opts.seats) || [];
  return { seats: seats, turn: 'w', moves: [], over: null };
};

export const reduce = function (state, action, ctx) {
  if (!action || action.t === 'reset') return init({ seats: state.seats });
  // full move validation lands with the Group A port
  return state;
};

export const project = function (state) { return state; };

export const bot = function (state, seatId) {
  return null; // 1-ply bot lands with the Group A port
};

export const summarize = function (state, nameOf) {
  if (!state || !state.over) return null;
  return 'Finished a game of Chess';
};

export function mount(el, api) {
  const d = document.createElement('div');
  d.style.cssText = 'padding:24px;color:#e2e8f0';
  d.innerHTML = '<h2 style="font-weight:800">♞ Chess</h2>' +
    '<p style="color:#94a3b8;font-size:13px">Full board arrives with the Group A port. ' +
    'Play the classic <b>chess.html</b> from the room list for now.</p>';
  el.appendChild(d);
  return {
    update: function () {},
    destroy: function () { el.innerHTML = ''; }
  };
}
