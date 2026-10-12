// BubHub v10 — Goldberg module stub. The live physics sandbox (Group A
// drop-in validation, last-writer-wins) is deferred; this stub proves the
// contract. Play goldberg.html from the room list for now.
export const meta = {
  id: 'goldberg',
  title: 'Goldberg',
  icon: '🔔',
  color: '#e6c280',
  players: { min: 2, max: 6 },
  bots: false,
  onLeave: 'continue',
  record: false
};

export const init = function () { return { parts: [], playing: false }; };

export const reduce = function (state, action) {
  if (!action || action.t === 'reset') return init();
  return state; // sandbox merge lands with the Group A port
};

export const project = function (state) { return state; };

export const summarize = function () { return null; };

export function mount(el, api) {
  const d = document.createElement('div');
  d.style.cssText = 'padding:24px;color:#e2e8f0';
  d.innerHTML = '<h2 style="font-weight:800">🔔 Goldberg</h2>' +
    '<p style="color:#94a3b8;font-size:13px">Chain-reaction sandbox arrives with the Group A port.</p>';
  el.appendChild(d);
  return {
    update: function () {},
    destroy: function () { el.innerHTML = ''; }
  };
}
