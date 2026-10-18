// BubHub v10 — game registry.
// New modules in games/*/index.js are auto-registered via import.meta.glob
// (Vite). Old iframe games from window.BUB_GAMES stay playable through
// src/compat.js and are flagged compat:'iframe'.
export async function loadRegistry() {
  const fresh = [];
  try {
    // NO `typeof import.meta.glob` guard here. Vite statically replaces the
    // call below at build time, so on a production bundle that guard is always
    // false and every module game silently vanishes — which is exactly what
    // happened: the live site served 15 iframe games and zero module games.
    // Without Vite the call itself throws, and the catch below is the fallback.
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
          file: g.file, players: g.players, compat: 'iframe', desc: g.desc || '',
          // A cap the game actually enforces, when it differs from `players`.
          // Goldberg's menu count is 2-3 but nothing in the game stops a
          // fourth, so it refuses at the door instead of quietly misbehaving.
          maxPlayers: g.maxPlayers || null,
          solo: !!g.solo, soloable: !!g.soloable, lobby: !!g.lobby,
          fill: !!g.fill, grow: !!g.grow, height: g.height || 0,
          noRecord: !!g.noRecord, activityRecord: !!g.activityRecord,
          menuLabel: g.menuLabel || null
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

// Menu order, by hand, because alphabetical-by-import-path is not a menu.
// Module games come first in the glob order; the legacy list follows in the
// order of public/games.js. This is the order people asked for.
const MENU_ORDER = [
  // Small tables first — the games that are only ever two or three people.
  'chess',
  'minigo',
  'goldberg',
  'warp',
  // Then the 2-8 crowd, in the order people use.
  'mucking',      // Mucking Around
  'eggs',         // Eggs
  'hook',         // What's the Hook?
  'dotreturn',    // Focus
  'the96game',    // The 96 Game
  'lotr',         // LOTR Cards
  'wordbridge',   // Word Bridge
  'blastoff',     // Blast Off!
  'grammar'       // Discover the Grammar
];

export function menuOrder(reg) {
  return reg.slice().sort(function (a, b) {
    const ia = MENU_ORDER.indexOf(a.meta.id), ib = MENU_ORDER.indexOf(b.meta.id);
    // Anything not named above keeps its registry position and sorts after the
    // list — a new game shows up without having to be remembered here.
    if (ia < 0 && ib < 0) return 0;
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
}

// How many players a game takes, as a real range. Legacy games declare a string
// ('2-6', 'solo', '2') and modules declare {min,max}; nothing normalised them,
// so every caller had to guess. This is the one place that knows both shapes.
export function playerRange(meta) {
  const p = meta && meta.players;
  if (!p) return null;
  if (typeof p === 'object') {
    return { min: Number(p.min), max: Number(p.max) };
  }
  const s = String(p).trim().toLowerCase();
  if (s === 'solo' || s === '1') return { min: 1, max: 1 };
  const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const one = s.match(/^(\d+)$/);
  if (one) return { min: Number(one[1]), max: Number(one[1]) };
  return null;
}

export function playerLabel(meta) {
  const r = playerRange(meta);
  if (!r) return '';
  if (r.min === r.max) return r.min + (r.min === 1 ? ' player' : ' players');
  return r.min + '-' + r.max + ' players';
}

// The multiplayer menu, grouped. Small tables first — the two-player games
// with nothing else — then the 2-8 crowd, in the order above. Games whose
// range fits neither (or that are not really multiplayer) land in their own
// trailing section rather than being dropped.
export function multiplayerSections(reg) {
  const small = [], wide = [], other = [];
  menuOrder(reg.filter(function (g) { return !g.meta.solo; })).forEach(function (g) {
    const r = playerRange(g.meta);
    if (r && r.max <= 3) small.push(g);
    else if (r && r.min <= 2 && r.max >= 6) wide.push(g);
    else other.push(g);
  });
  const out = [];
  if (small.length) out.push({ title: 'Two or three players', games: small });
  if (wide.length) out.push({ title: 'Two to eight players', games: wide });
  if (other.length) out.push({ title: 'Other tables', games: other });
  return out;
}

export function roomLists(reg) {
  return {
    multi: menuOrder(reg.filter(function (g) { return !g.meta.solo; })),
    solo: reg.filter(function (g) { return !!g.meta.solo; })
  };
}
