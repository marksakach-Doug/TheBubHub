// BubHub v10 — game registry.
// New modules in games/*/index.js are auto-registered via import.meta.glob
// (Vite). Old iframe games from window.BUB_GAMES stay playable through
// src/compat.js and are flagged compat:'iframe'.
export async function loadRegistry() {
  const fresh = [];
  try {
    if (typeof import.meta !== 'undefined' && typeof import.meta.glob === 'function') {
      const mods = import.meta.glob('../games/*/index.js');
      const entries = Object.entries(mods);
      for (let i = 0; i < entries.length; i++) {
        try {
          const m = await entries[i][1]();
          if (m && m.meta) fresh.push({ kind: 'module', path: entries[i][0], module: m, meta: m.meta });
        } catch (e) {
          console.warn('game module failed:', entries[i][0], e);
        }
      }
    }
  } catch (e) {
    // plain http.server without Vite: import.meta.glob unavailable — fall through
  }
  const legacy = (window.BUB_GAMES || [])
    .filter(function (g) { return !g.disabled; })
    .map(function (g) {
      return {
        kind: 'iframe',
        meta: {
          id: g.id, title: g.title, icon: g.icon || '', color: g.color || '#334155',
          file: g.file, players: g.players, compat: 'iframe',
          solo: !!g.solo, soloable: !!g.soloable, lobby: !!g.lobby,
          fill: !!g.fill, grow: !!g.grow, height: g.height || 0,
          noRecord: !!g.noRecord, menuLabel: g.menuLabel || null
        },
        entry: g
      };
    });
  // New modules win over legacy entries with the same id.
  const seen = new Set(fresh.map(function (f) { return f.meta.id; }));
  return fresh.concat(legacy.filter(function (l) { return !seen.has(l.meta.id); }));
}

export function soloCorner(reg) {
  return reg.filter(function (g) {
    return g.meta.solo || g.meta.soloable || g.meta.lobby;
  });
}

export function roomLists(reg) {
  return {
    multi: reg.filter(function (g) { return !g.meta.solo; }),
    solo: reg.filter(function (g) { return !!g.meta.solo; })
  };
}
