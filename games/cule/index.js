// Cule — a v10 module game built on the Mucking Around sprite/canvas engine.
//
// Flow:
// 1. hallway: All sprites hang out in a lit hallway at the top of the canvas.
//    Requires 4+ players. One player secretly knows they are the Murderer (🔪).
// 2. dark: Everyone enters the pitch-black main floor for 8 seconds. Only
//    floating eyeballs render as players run around.
// 3. alibi: Lights snap on! An improbable L/Z-shaped drywall room wraps around
//    two randomly paired players (ignoring where they walked). Each gets an
//    emoji object (or 🔪 + a decoy picker if the Murderer is inside). They get
//    90s in a private chat box to invent an alibi while outsiders heckle on
//    the canvas using Mucking Around speech bubbles and Q-M tricks.
// 4. vote: The pair's claimed emojis and alibi are revealed with speech-paced
//    timing. Outside players vote TRUE or LIE.
// 5. reveal: True objects (and the Murderer) are revealed and recorded.

const W = 400;
const H = 640;
const HALL_Y = 150;
const ROOM_R = 32;
const WALL_R = 44;
const DARK_MS = 8000;
const ALIBI_MS = 90000;
const VOTE_MS = 30000;

const EMOJI_POOL = [
  '🎷', '🪗', '🪕', '🎺', '🎻', '🎹', '🪘', '🪇',
  '🦞', '🦩', '🐢', '🐙', '🦜', '🦔', '🐸', '🦑',
  '🌵', '🍄', '🍍', '🥐', '🧀', '🥨', '🥥', '🍆',
  '🏮', '🔮', '🧭', '⏳', '🧲', '🔭', '🔬', '📡',
  '🪜', '🪣', '🧹', '🪠', '🪤', '🧰', '🪚', '🪛',
  '🎩', '👑', '🕶️', '🥾', '🧤', '🧣', '🎒', '☂️',
  '🏺', '🗿', '🪩', '🖼️', '🪆', '🧸', '🪁', '🪀',
  '🕯️', '🔦', '📻', '☎️', '⏰', '⚖️', '🗝️', '🪙'
];

const ROOM_NAMES = [
  'The Gerrymandered Pantry',
  'Load-Bearing Broom Annex',
  'Corridor 3½',
  'The Acoustics Closet',
  'The Unlabeled Utility Bend',
  'The Diagonal Mudroom',
  'Sub-Hallway B',
  'The Fire-Code Violation'
];

const ACT = {
  wave: '👋', bounce: '🤗', fall: '💫', flip: '🔄', wide: '↔️', thin: '↕️',
  jump: '⬆️', legs: '🦵', beep: '🎵', hat: '🎩', mouth: '😮', color: '🎨',
  horse: '🐴', arp: '🎶', ears: '🐰', mini: '🔍', roll: '🌀', axe: '🪓',
  frown: '☹️', jut: '💨', confetti: '🎉'
};

const FXKEY = {
  q: 'frown', w: 'flip', e: 'wide', r: 'thin', t: 'bounce', y: 'jut',
  u: 'legs', i: 'beep', p: 'hat', a: 'jump', s: 'mouth', h: 'color',
  k: 'horse', l: 'arp', x: 'ears', c: 'mini', v: 'roll', m: 'axe'
};

const FXD = {
  frown: 900, flip: 2000, bounce: 900, jut: 400, jump: 600,
  confetti: 1000, fall: 900
};

const ARPS = [
  [0, 4, 7, 12],
  [0, 3, 7, 10, 12],
  [0, 5, 9, 12, 17],
  [12, 7, 4, 0]
];

export const meta = {
  id: 'cule',
  title: 'Cule',
  players: { min: 4, max: 10 },
  color: '#312e81',
  icon: '👀',
  desc: 'Wander in the dark, get trapped in an improbable room with one partner and two objects, and talk your way out.',
  soloable: false
};

// ---------------------------------------------------------------- helpers ----

function cl(v, a, b) {
  return v < a ? a : (v > b ? b : v);
}

function hue(id) {
  let h = 7;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = cl(t, 0, 1);
  }
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), cx: cx, cy: cy };
}

function distToPoly(px, py, poly) {
  if (!poly || poly.length < 2) return { dist: 1e9, cx: px, cy: py };
  let best = { dist: 1e9, cx: px, cy: py };
  for (let i = 0; i < poly.length - 1; i++) {
    const cur = distToSeg(px, py, poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y);
    if (cur.dist < best.dist) best = cur;
  }
  return best;
}

function makeSprite(idx) {
  return {
    x: 60 + ((idx * 55) % 280),
    y: 55 + ((idx % 2) * 45),
    f: 1,
    sq: 0,
    as: 0,
    ak: '',
    tp: 1,
    z: 0,
    a: 0,
    hu: 0,
    wd: 1,
    lg: 0,
    th: 0,
    mo: 0,
    hz: 0,
    ea: 0,
    mi: 0,
    rl: 0,
    ax: 0,
    say: ''
  };
}

function tableOf(ctx) {
  const c = ctx || {};
  const list = c.atTable || c.seats || [];
  const ids = [];
  list.forEach(function (m) {
    if (!m || !m.id || m.spectator) return;
    if (ids.indexOf(m.id) < 0 && ids.length < 10) ids.push(m.id);
  });
  return ids;
}

function pickUniqueEmojis(rng, count, exclude) {
  const ex = exclude || [];
  const pool = EMOJI_POOL.filter(function (e) { return ex.indexOf(e) < 0; });
  const out = [];
  while (out.length < count && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

// ------------------------------------------------------------------ state ----

export function init(ctx) {
  const rng = (ctx && ctx.rng) || Math.random;
  const players = tableOf(ctx);
  const sprites = {};
  players.forEach(function (id, idx) {
    sprites[id] = makeSprite(idx);
  });
  const murdererId = players.length >= 4
    ? players[Math.floor(rng() * players.length)]
    : null;
  return {
    round: 1,
    phase: 'hallway', // 'hallway' | 'dark' | 'alibi' | 'vote' | 'reveal'
    phaseEndsAt: 0,
    players: players,
    sprites: sprites,
    murdererId: murdererId,
    spotlightPair: [],
    roomPoly: [],
    roomName: '',
    trueEmojis: {},
    claimedEmojis: {},
    decoyOptions: [],
    privateChat: [],
    typingTick: 0,
    alibiText: '',
    votes: {},
    outcome: null
  };
}

function tallyOutcome(state, votes) {
  const pair = state.spotlightPair || [];
  const outside = state.players.filter(function (p) { return pair.indexOf(p) < 0; });
  let trueVotes = 0;
  let lieVotes = 0;
  outside.forEach(function (p) {
    if (votes[p] === 'true') trueVotes++;
    else if (votes[p] === 'lie') lieVotes++;
  });
  const crowdCalledLie = lieVotes > trueVotes;
  const hasMurderer = pair.indexOf(state.murdererId) >= 0;
  return {
    hasMurderer: hasMurderer,
    crowdCalledLie: crowdCalledLie,
    trueVotes: trueVotes,
    lieVotes: lieVotes
  };
}

// ----------------------------------------------------------------- reduce ----

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const rng = (ctx && ctx.rng) || Math.random;
  const id = from.id || '';
  const isHost = !!from.host;
  const kind = (action && action.a) || '';
  const now = Date.now();

  const same = function (extra) { return Object.assign({}, state, extra); };
  const bad = function (why) { return { error: why }; };

  if (!id) return bad('No identity — reopen the game.');

  // Late joiners can join during hallway (or get seated on mount).
  if (kind === 'join') {
    if (state.players.indexOf(id) >= 0) {
      if (state.players.length >= 4 && !state.murdererId) {
        const m = state.players[Math.floor(rng() * state.players.length)];
        return same({ murdererId: m });
      }
      return state;
    }
    if (state.players.length >= 10) return bad('Cule holds at most 10 suspects.');
    const players = state.players.concat([id]);
    const sprites = Object.assign({}, state.sprites);
    sprites[id] = makeSprite(players.length - 1);
    let murdererId = state.murdererId;
    if (players.length >= 4 && !murdererId) {
      murdererId = players[Math.floor(rng() * players.length)];
    }
    return same({
      players: players,
      sprites: sprites,
      murdererId: murdererId
    });
  }

  if (state.players.indexOf(id) < 0) return bad('You are watching — not seated.');

  // Sprite movement, speech bubbles, and Mucking Around tricks
  if (kind === 'pos') {
    const p = state.sprites[id];
    if (!p) return state;
    const sprites = Object.assign({}, state.sprites);
    const minY = state.phase === 'hallway' ? 36 : HALL_Y + 24;
    const maxY = state.phase === 'hallway' ? HALL_Y - 14 : H - 28;
    sprites[id] = Object.assign({}, p, {
      x: cl(Number(action.x) || p.x, 20, W - 20),
      y: cl(Number(action.y) || p.y, minY, maxY),
      f: Number(action.f) < 0 ? -1 : 1,
      z: cl(Number(action.z) | 0, 0, 2)
    });
    return same({ sprites: sprites });
  }

  if (kind === 'say') {
    if (state.phase === 'dark') return bad('Too dark to speak!');
    const p = state.sprites[id];
    if (!p) return state;
    const text = String(action.t || '').trim().slice(0, 90);
    if (!text) return state;
    const sprites = Object.assign({}, state.sprites);
    sprites[id] = Object.assign({}, p, {
      say: text,
      sq: (p.sq || 0) + 1
    });
    return same({ sprites: sprites });
  }

  if (kind === 'fx') {
    if (state.phase === 'dark') return state;
    const p = state.sprites[id];
    if (!p) return state;
    const k = String(action.k || '');
    const nextP = Object.assign({}, p, { ak: k, as: (p.as || 0) + 1 });
    if (k === 'ears') nextP.ea = nextP.ea ? 0 : 1;
    else if (k === 'wide') nextP.wd = cl((nextP.wd || 1) + 0.15, 0.6, 1.6);
    else if (k === 'thin') nextP.wd = cl((nextP.wd || 1) - 0.15, 0.6, 1.6);
    else if (k === 'legs') nextP.lg = nextP.lg ? 0 : 1;
    else if (k === 'hat') nextP.th = nextP.th ? 0 : 1;
    else if (k === 'mouth') nextP.mo = nextP.mo ? 0 : 1;
    else if (k === 'horse') nextP.hz = nextP.hz ? 0 : 1;
    else if (k === 'color') nextP.hu = ((nextP.hu || 0) + 45) % 360;
    else if (k === 'mini') nextP.mi = nextP.mi ? 0 : 1;
    else if (k === 'roll') nextP.rl = nextP.rl ? 0 : 1;
    else if (k === 'axe') nextP.ax = nextP.ax ? 0 : 1;
    const sprites = Object.assign({}, state.sprites);
    sprites[id] = nextP;
    return same({ sprites: sprites });
  }

  // Phase 1 -> Phase 2: Cut the Lights
  if (kind === 'startDark') {
    if (!isHost) return bad('Only the host can cut the lights.');
    if (state.phase !== 'hallway') return bad('Round is already underway.');
    if (state.players.length < 4) return bad('Need at least 4 suspects to cut the lights.');

    const murdererId = state.murdererId || state.players[Math.floor(rng() * state.players.length)];
    const sprites = {};
    state.players.forEach(function (pid) {
      const old = state.sprites[pid] || makeSprite(0);
      sprites[pid] = Object.assign({}, old, {
        x: Math.round(50 + rng() * (W - 100)),
        y: Math.round(HALL_Y + 60 + rng() * (H - HALL_Y - 120)),
        tp: (old.tp || 0) + 1,
        z: 0,
        say: ''
      });
    });

    return same({
      phase: 'dark',
      phaseEndsAt: now + DARK_MS,
      murdererId: murdererId,
      sprites: sprites,
      spotlightPair: [],
      roomPoly: [],
      roomName: '',
      trueEmojis: {},
      claimedEmojis: {},
      decoyOptions: [],
      privateChat: [],
      typingTick: 0,
      alibiText: '',
      votes: {},
      outcome: null
    });
  }

  // Phase 2 -> Phase 3: Lights On & Improbable Room Generation
  if (kind === 'lightsOn') {
    if (state.phase !== 'dark') return state;
    if (!isHost && now < state.phaseEndsAt) return bad('Still in the dark.');

    const murdererId = state.murdererId || state.players[0];
    const innocents = state.players.filter(function (p) { return p !== murdererId; });
    const trapMurderer = innocents.length > 0 && rng() < 0.5;

    let idA = '';
    let idB = '';
    if (trapMurderer) {
      idA = murdererId;
      idB = innocents[Math.floor(rng() * innocents.length)];
    } else {
      const pool = innocents.slice();
      const i1 = Math.floor(rng() * pool.length);
      idA = pool[i1];
      pool.splice(i1, 1);
      idB = pool[Math.floor(rng() * pool.length)];
    }

    const pair = rng() < 0.5 ? [idA, idB] : [idB, idA];
    const sprites = Object.assign({}, state.sprites);
    const spA = Object.assign({}, sprites[pair[0]] || makeSprite(0));
    const spB = Object.assign({}, sprites[pair[1]] || makeSprite(1));

    spA.x = cl(spA.x, 52, W - 52);
    spA.y = cl(spA.y, HALL_Y + 50, H - 64);
    spB.x = cl(spB.x, 52, W - 52);
    spB.y = cl(spB.y, HALL_Y + 50, H - 64);
    if (Math.hypot(spA.x - spB.x, spA.y - spB.y) < 36) {
      spB.x = cl(spA.x + 64, 52, W - 52);
    }
    sprites[pair[0]] = spA;
    sprites[pair[1]] = spB;

    const bend = (rng() < 0.5 ? 1 : -1) * (45 + Math.floor(rng() * 65));
    const e1x = cl(spA.x + bend, 52, W - 52);
    const roomPoly = [
      { x: spA.x, y: spA.y },
      { x: e1x, y: spA.y },
      { x: e1x, y: spB.y },
      { x: spB.x, y: spB.y }
    ];

    // Push outside players clear of the improbable room walls
    state.players.forEach(function (pid) {
      if (pair.indexOf(pid) >= 0) return;
      const sp = Object.assign({}, sprites[pid] || makeSprite(2));
      const check = distToPoly(sp.x, sp.y, roomPoly);
      if (check.dist < WALL_R) {
        let dx = sp.x - check.cx;
        let dy = sp.y - check.cy;
        const d = Math.hypot(dx, dy);
        if (d < 0.001) {
          const ang = rng() * Math.PI * 2;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
        } else {
          dx /= d;
          dy /= d;
        }
        sp.x = cl(Math.round(check.cx + dx * (WALL_R + 14)), 24, W - 24);
        sp.y = cl(Math.round(check.cy + dy * (WALL_R + 14)), HALL_Y + 24, H - 28);
        sp.tp = (sp.tp || 0) + 1;
        sp.ak = 'bounce';
        sp.as = (sp.as || 0) + 1;
      }
      sprites[pid] = sp;
    });

    const dealt = pickUniqueEmojis(rng, 2, []);
    const trueEmojis = {};
    const claimedEmojis = {};
    let decoyOptions = [];

    if (pair.indexOf(murdererId) >= 0) {
      const partnerId = pair[0] === murdererId ? pair[1] : pair[0];
      trueEmojis[partnerId] = dealt[0];
      trueEmojis[murdererId] = '🔪';
      decoyOptions = pickUniqueEmojis(rng, 8, [dealt[0], '🔪']);
      claimedEmojis[partnerId] = dealt[0];
      claimedEmojis[murdererId] = decoyOptions[0];
    } else {
      trueEmojis[pair[0]] = dealt[0];
      trueEmojis[pair[1]] = dealt[1];
      claimedEmojis[pair[0]] = dealt[0];
      claimedEmojis[pair[1]] = dealt[1];
    }

    const roomName = ROOM_NAMES[Math.floor(rng() * ROOM_NAMES.length)];

    return same({
      phase: 'alibi',
      phaseEndsAt: now + ALIBI_MS,
      spotlightPair: pair,
      roomPoly: roomPoly,
      roomName: roomName,
      trueEmojis: trueEmojis,
      claimedEmojis: claimedEmojis,
      decoyOptions: decoyOptions,
      privateChat: [],
      typingTick: 0,
      alibiText: '',
      votes: {},
      outcome: null,
      sprites: sprites
    });
  }

  // Phase 3: Spotlight Room Private Chat, Decoy Emoji Selection, Alibi Submission
  if (kind === 'pairChat') {
    if (state.phase !== 'alibi') return bad('Private chat is closed.');
    if (state.spotlightPair.indexOf(id) < 0) return bad('Only the two players in the room can whisper.');
    const t = String(action.t || '').trim().slice(0, 100);
    if (!t) return state;
    const chat = state.privateChat.concat([{ from: id, text: t }]);
    return same({
      privateChat: chat,
      typingTick: (state.typingTick || 0) + 1
    });
  }

  if (kind === 'pickDecoy') {
    if (state.phase !== 'alibi') return bad('Cannot change object now.');
    if (state.spotlightPair.indexOf(id) < 0) return bad('You are not in the room.');
    if (state.spotlightPair.indexOf(state.murdererId) < 0) return bad('Neither of you has the knife.');
    const emoji = String(action.emoji || '');
    if (state.decoyOptions.indexOf(emoji) < 0) return bad('Pick one of the decoy objects.');
    const claimed = Object.assign({}, state.claimedEmojis);
    claimed[state.murdererId] = emoji;
    return same({ claimedEmojis: claimed });
  }

  if (kind === 'draftAlibi') {
    if (state.phase !== 'alibi') return state;
    if (state.spotlightPair.indexOf(id) < 0) return bad('Only the trapped pair can draft the alibi.');
    const t = String(action.t || '').slice(0, 140);
    return same({ alibiText: t });
  }

  if (kind === 'submitAlibi' || kind === 'timeUpAlibi') {
    if (state.phase !== 'alibi') return state;
    if (kind === 'submitAlibi' && state.spotlightPair.indexOf(id) < 0) {
      return bad('Only the trapped pair can submit the alibi.');
    }
    if (kind === 'timeUpAlibi' && !isHost && now < state.phaseEndsAt) {
      return bad('Alibi timer is still running.');
    }
    const raw = kind === 'submitAlibi' && typeof action.t === 'string'
      ? action.t
      : state.alibiText;
    const finalAlibi = String(raw || '').trim().slice(0, 140) || 'We were just standing here in the dark!';
    return same({
      phase: 'vote',
      phaseEndsAt: now + VOTE_MS,
      alibiText: finalAlibi,
      votes: {}
    });
  }

  // Phase 4: Group Vote
  if (kind === 'vote') {
    if (state.phase !== 'vote') return bad('Voting is not open.');
    if (state.spotlightPair.indexOf(id) >= 0) return bad('Suspects in the spotlight room cannot vote.');
    const v = action.v === 'true' ? 'true' : (action.v === 'lie' ? 'lie' : '');
    if (!v) return bad('Vote true or lie.');

    const votes = Object.assign({}, state.votes);
    votes[id] = v;

    const outside = state.players.filter(function (p) {
      return state.spotlightPair.indexOf(p) < 0;
    });
    const allIn = outside.every(function (p) { return !!votes[p]; });

    if (allIn) {
      return same({
        phase: 'reveal',
        phaseEndsAt: 0,
        votes: votes,
        outcome: tallyOutcome(state, votes)
      });
    }
    return same({ votes: votes });
  }

  if (kind === 'timeUpVote') {
    if (state.phase !== 'vote') return state;
    if (!isHost && now < state.phaseEndsAt) return bad('Voting timer is still running.');
    return same({
      phase: 'reveal',
      phaseEndsAt: 0,
      outcome: tallyOutcome(state, state.votes)
    });
  }

  // Phase 5 -> Next Round
  if (kind === 'nextRound') {
    if (!isHost) return bad('Only the host can start the next round.');
    if (state.phase !== 'reveal') return bad('Round is not over yet.');
    const sprites = {};
    state.players.forEach(function (pid, idx) {
      sprites[pid] = makeSprite(idx);
    });
    const murdererId = state.players.length >= 4
      ? state.players[Math.floor(rng() * state.players.length)]
      : null;
    return same({
      round: state.round + 1,
      phase: 'hallway',
      phaseEndsAt: 0,
      sprites: sprites,
      murdererId: murdererId,
      spotlightPair: [],
      roomPoly: [],
      roomName: '',
      trueEmojis: {},
      claimedEmojis: {},
      decoyOptions: [],
      privateChat: [],
      typingTick: 0,
      alibiText: '',
      votes: {},
      outcome: null
    });
  }

  return bad('Unknown action: ' + kind);
}

// -------------------------------------------------------------- project ----

export function project(state, playerId, api) {
  const you = playerId || '';
  const isReveal = state.phase === 'reveal';
  const isDark = state.phase === 'dark';
  const inSpotlight = state.spotlightPair.indexOf(you) >= 0;

  const sprites = {};
  Object.keys(state.sprites || {}).forEach(function (id) {
    const s = state.sprites[id];
    if (isDark && id !== you) {
      sprites[id] = { x: s.x, y: s.y, f: s.f, tp: s.tp, anon: true };
    } else {
      sprites[id] = Object.assign({}, s, { anon: false });
    }
  });

  return Object.assign({}, state, {
    you: you,
    sprites: sprites,
    murdererId: (you === state.murdererId || isReveal) ? state.murdererId : null,
    trueEmojis: (inSpotlight || isReveal) ? state.trueEmojis : null,
    decoyOptions: inSpotlight ? state.decoyOptions : [],
    privateChat: (inSpotlight || isReveal) ? state.privateChat : null,
    alibiText: (inSpotlight || state.phase === 'vote' || isReveal) ? state.alibiText : '',
    claimedEmojis: (inSpotlight || state.phase === 'vote' || isReveal) ? state.claimedEmojis : null,
    roster: (api && api.roster) || null
  });
}

// ------------------------------------------------------------ summarize ----

export function roundId(state) {
  return 'r' + ((state && state.round) || 1);
}

export function summarize(state, nameOf) {
  if (!state || state.phase !== 'reveal' || !state.outcome) return null;
  const pair = state.spotlightPair || [];
  const a = pair[0] || '';
  const b = pair[1] || '';
  const m = state.murdererId || '';
  if (state.outcome.hasMurderer) {
    return state.outcome.crowdCalledLie
      ? 'The crowd caught ' + nameOf(m) + ' hiding the 🔪 in Cule'
      : nameOf(a) + ' & ' + nameOf(b) + ' got away with the 🔪 in Cule';
  }
  return state.outcome.crowdCalledLie
    ? nameOf(m) + ' framed ' + nameOf(a) + ' & ' + nameOf(b) + ' from outside in Cule'
    : nameOf(a) + ' & ' + nameOf(b) + '\'s alibi held up in Cule';
}

export function prune(state, goneId) {
  if (!state || state.players.indexOf(goneId) < 0) return state;
  const players = state.players.filter(function (id) { return id !== goneId; });
  const sprites = Object.assign({}, state.sprites);
  delete sprites[goneId];
  const votes = Object.assign({}, state.votes);
  delete votes[goneId];

  const needReset = state.phase !== 'hallway' && (
    players.length < 4 ||
    state.spotlightPair.indexOf(goneId) >= 0 ||
    goneId === state.murdererId
  );

  if (needReset) {
    const resetSprites = {};
    players.forEach(function (pid, idx) {
      resetSprites[pid] = makeSprite(idx);
    });
    return Object.assign({}, state, {
      players: players,
      sprites: resetSprites,
      phase: 'hallway',
      phaseEndsAt: 0,
      murdererId: players.length >= 4 ? players[0] : null,
      spotlightPair: [],
      roomPoly: [],
      roomName: '',
      trueEmojis: {},
      claimedEmojis: {},
      decoyOptions: [],
      privateChat: [],
      typingTick: 0,
      alibiText: '',
      votes: {},
      outcome: null
    });
  }

  return Object.assign({}, state, {
    players: players,
    sprites: sprites,
    votes: votes
  });
}

// ----------------------------------------------------------------- mount ----

const CSS = [
  '.cu-wrap{max-width:520px;height:100dvh;max-height:860px;margin:0 auto;padding:6px;',
  'box-sizing:border-box;display:flex;flex-direction:column;gap:6px;',
  'font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;color:#e2e8f0;',
  'background:#0f172a;user-select:none;-webkit-user-select:none}',
  '.cu-top{display:flex;align-items:center;justify-content:space-between;gap:6px;',
  'padding:6px 10px;background:#1e293b;border:1px solid #334155;border-radius:10px}',
  '.cu-badge{font-weight:700;padding:3px 8px;border-radius:6px;background:#334155;color:#f8fafc}',
  '.cu-badge.murderer{background:#7f1d1d;color:#fecaca}',
  '.cu-clock{font-variant-numeric:tabular-nums;font-weight:700;color:#fde68a}',
  '.cu-stage{position:relative;flex:1 1 0;min-height:180px;display:flex;justify-content:center;background:#090d16;border-radius:14px;overflow:hidden}',
  'canvas{width:100%;height:100%;object-fit:contain;touch-action:none;display:block}',
  '.cu-card{background:#1e293b;border:1px solid #475569;border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px}',
  '.cu-card[hidden]{display:none!important}',
  '.cu-chat{max-height:76px;overflow-y:auto;background:#0f172a;border-radius:6px;padding:6px;font-size:12px;display:flex;flex-direction:column;gap:3px}',
  '.cu-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
  '.cu-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}',
  'button,input{font:inherit;border-radius:8px;border:0;min-height:40px;padding:6px 10px;box-sizing:border-box}',
  'button{background:#334155;color:#fff;font-weight:600;cursor:pointer}',
  'button:hover:not([disabled]){background:#475569}',
  'button[disabled]{opacity:.45;cursor:default}',
  'button.pri{background:#4f46e5;color:#fff}',
  'button.good{background:#15803d;color:#fff;flex:1}',
  'button.bad{background:#b91c1c;color:#fff;flex:1}',
  'button.decoy{min-height:36px;padding:4px 8px;font-size:18px;background:#0f172a;border:1px solid #334155}',
  'button.decoy.on{border:2px solid #fbbf24;background:#312e81}',
  'input{flex:1 1 auto;min-width:0;background:#0f172a;color:#fff;border:1px solid #334155}',
  '.cu-alibi{font-family:"Courier New",monospace;font-size:14px;background:#0f172a;padding:8px;border-radius:6px;color:#fef08a;min-height:22px}',
  '.cu-hint{font-size:11px;color:#94a3b8;margin:0 2px}'
].join('');

export function mount(root, api) {
  root.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'cu-wrap';
  wrap.innerHTML = [
    '<div class="cu-top">',
    '  <span class="cu-badge" id="cu-role">🕯️ Suspect</span>',
    '  <span id="cu-status">Waiting in the Lit Hallway…</span>',
    '  <span class="cu-clock" id="cu-clock"></span>',
    '</div>',
    '<div class="cu-stage"><canvas id="cu-cv" width="800" height="1280"></canvas></div>',
    '<div class="cu-card" id="cu-drawer" hidden></div>',
    '<div class="cu-grid4" id="cu-tricks">',
    '  <button type="button" data-fx="wave">👋 Wave</button>',
    '  <button type="button" data-fx="bounce">🤗 Bounce</button>',
    '  <button type="button" data-fx="hat">🎩 Top Hat</button>',
    '  <button type="button" id="cu-sit">🪑 Sit</button>',
    '</div>',
    '<div class="cu-row" id="cu-sayrow">',
    '  <input id="cu-say" maxlength="90" placeholder="heckle or say something..." autocomplete="off">',
    '  <button type="button" id="cu-saybtn">Say</button>',
    '</div>',
    '<details class="cu-hint"><summary>Keys & Tricks (Q–M)</summary>',
    'Walk: tap canvas or Arrow keys · Q frown · W flip · E wider · R thinner · T bounce · Y jut · U legs · I A440 beep · P top hat · A jump · S big mouth · H colour · K horse · L arpeggio · X rabbit ears · C mini · V roll · M axe',
    '</details>'
  ].join('');
  root.appendChild(wrap);

  const roleEl = wrap.querySelector('#cu-role');
  const statusEl = wrap.querySelector('#cu-status');
  const clockEl = wrap.querySelector('#cu-clock');
  const cv = wrap.querySelector('#cu-cv');
  const ctx = cv.getContext('2d');
  ctx.scale(2, 2);
  const drawer = wrap.querySelector('#cu-drawer');
  const sayInput = wrap.querySelector('#cu-say');
  const sayBtn = wrap.querySelector('#cu-saybtn');
  const sitBtn = wrap.querySelector('#cu-sit');

  let view = null;
  let myId = (api && api.me && api.me.id) || '';
  let joined = false;
  let running = false;
  let rafId = null;
  let dead = false;
  let last = 0;
  let dt = 0.016;
  let lastSent = '';
  let lastPhaseAsk = 0;
  let drawerKey = '';
  let revealTimer = null;
  let revealedAlibi = '';

  const me = { x: 140, y: 80, f: 1, tx: null, ty: null, z: 0, tp: -1 };
  const vw = {};
  const seen = {};
  const keys = {};
  const sprCache = {};
  let AC = null;

  function tone(f, t0, dur, vol, f1) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!AC) AC = new Ctx();
      if (AC.state === 'suspended') AC.resume();
      const t = AC.currentTime + t0;
      const o = AC.createOscillator();
      const g = AC.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(AC.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch (e) {}
  }

  function playSfx(k, n) {
    if (k === 'beep') tone(440, 0, 0.8, 0.15);
    else if (k === 'arp') {
      const rootF = 220 * Math.pow(2, ((n * 7) % 12) / 12);
      const pat = ARPS[n % ARPS.length];
      pat.forEach(function (st, i) {
        tone(rootF * Math.pow(2, st / 12), i * 0.1, 0.25, 0.14);
      });
    } else if (k === 'jump' || k === 'bounce') tone(523.25, 0, 0.25, 0.15, 784);
    else if (k === 'frown') tone(330, 0, 0.5, 0.14, 220);
    else if (k === 'flip') tone(240, 0, 0.4, 0.14, 880);
    else if (k === 'horse') { tone(600, 0, 0.2, 0.12, 900); tone(900, 0.2, 0.2, 0.12, 600); }
  }

  function nameOf(id) {
    const r = (view && view.roster) || (api && api.roster) || [];
    for (let i = 0; i < r.length; i++) {
      if (r[i] && r[i].id === id) return r[i].name;
    }
    if (id === myId && api && api.me && api.me.name) return api.me.name;
    return 'Suspect';
  }

  function emoji(s, x, y, size) {
    if (!s) return;
    const k = s + ':' + size;
    let c = sprCache[k];
    if (!c) {
      const n = Math.ceil(size * 1.6);
      c = document.createElement('canvas');
      c.width = n * 2;
      c.height = n * 2;
      c.n = n;
      const q = c.getContext('2d');
      q.scale(2, 2);
      q.font = size + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      q.textAlign = 'center';
      q.textBaseline = 'middle';
      q.fillText(s, n / 2, n / 2);
      sprCache[k] = c;
    }
    ctx.drawImage(c, x - c.n / 2, y - c.n / 2, c.n, c.n);
  }

  function bubble(txt, x, y) {
    ctx.font = '14px system-ui';
    ctx.textBaseline = 'alphabetic';
    const maxW = 165;
    const words = String(txt || '').split(' ');
    const ls = [];
    let cur = '';
    words.forEach(function (w) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { ls.push(cur); cur = w; }
      else cur = t;
    });
    if (cur) ls.push(cur);
    const lines = ls.slice(0, 3);
    let maxLineW = 0;
    lines.forEach(function (q) {
      const w = ctx.measureText(q).width;
      if (w > maxLineW) maxLineW = w;
    });
    const bw = Math.min(185, maxLineW + 16);
    const bh = lines.length * 15 + 10;
    const bx0 = cl(x - bw / 2, 4, W - bw - 4);
    const by = cl(y - bh, 4, H - bh - 8);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx0, by, bw, bh, 8);
    else ctx.rect(bx0, by, bw, bh);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'left';
    lines.forEach(function (q, i) {
      ctx.fillText(q, bx0 + 8, by + 14 + i * 15);
    });
  }

  function drawScene() {
    if (view && view.phase === 'dark') {
      ctx.fillStyle = '#050811';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    // Lit Hallway (top)
    ctx.fillStyle = '#3b1d0a';
    ctx.fillRect(0, 0, W, HALL_Y);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let y = 25; y < HALL_Y; y += 25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // Warm sconces
    for (let x = 50; x <= 350; x += 100) {
      ctx.fillStyle = 'rgba(251,191,36,0.18)';
      ctx.beginPath();
      ctx.arc(x, 22, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(x, 14, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Velvet rope divider
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(16, HALL_Y);
    ctx.lineTo(W - 16, HALL_Y);
    ctx.stroke();

    // Main Floor
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, HALL_Y, W, H - HALL_Y);
    ctx.strokeStyle = 'rgba(148,163,184,0.08)';
    ctx.lineWidth = 1;
    for (let gx = 40; gx < W; gx += 40) {
      ctx.beginPath();
      ctx.moveTo(gx, HALL_Y);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }
    for (let gy = HALL_Y + 40; gy < H; gy += 40) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(W, gy);
      ctx.stroke();
    }

    // Improbable Spotlight Room
    if (view && view.roomPoly && view.roomPoly.length >= 2) {
      const poly = view.roomPoly;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const trace = function () {
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.stroke();
      };

      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = (ROOM_R + 10) * 2;
      trace();

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = (ROOM_R + 5) * 2;
      trace();

      ctx.strokeStyle = '#312e81';
      ctx.lineWidth = ROOM_R * 2;
      trace();

      if (view.roomName) {
        ctx.fillStyle = '#c7d2fe';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(view.roomName, poly[1].x, cl(poly[1].y - ROOM_R - 8, HALL_Y + 14, H - 10));
      }
      ctx.restore();
    }
  }

  function drawEyesOnly(x, y, f, mv, now) {
    const bob = mv ? Math.abs(Math.sin(now / 110)) * 2.5 : 0;
    const by = y - bob;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - 4, by - 3, 4.2, 0, Math.PI * 2);
    ctx.arc(x + 4, by - 3, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#050811';
    ctx.beginPath();
    ctx.arc(x - 4 + f * 1.4, by - 3, 2, 0, Math.PI * 2);
    ctx.arc(x + 4 + f * 1.4, by - 3, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawP(id, p, x, y, f, mv, z, now) {
    if (view && view.phase === 'dark') {
      drawEyesOnly(x, y, f, mv, now);
      return;
    }
    const s = seen[id];
    let fx = null;
    if (s && s.k && FXD[s.k] && now - s.at < FXD[s.k]) {
      fx = { k: s.k, t: now - s.at, d: FXD[s.k] };
    }
    const fe = fx ? fx.t / fx.d : 0;
    let ox = 0;
    let ang = 0;
    const sx = p.wd || 1;
    const sc = p.mi ? 0.6 : 1;
    const bob = (mv && !p.rl && !z) ? Math.abs(Math.sin(now / 110)) * 3 : 0;
    let by = y - bob + (z === 1 ? 5 : 0);

    if (fx) {
      if (fx.k === 'bounce') by -= Math.abs(Math.sin(fx.t / 110)) * 16 * (1 - fe);
      else if (fx.k === 'jump') by -= Math.sin(fe * Math.PI) * 34;
      else if (fx.k === 'jut') ox = f * 14 * Math.sin(fe * Math.PI);
      else if (fx.k === 'flip') ang = fe * Math.PI * 2;
    }
    if (p.rl && !z) ang += x / 14;

    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(x, y + 14, 12, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x + ox, by);
    ctx.rotate(ang);
    ctx.scale(sx * sc, sc);
    ctx.translate(-x, -by);

    ctx.fillStyle = 'hsl(' + ((hue(id) + (p.hu || 0)) % 360) + ',62%,68%)';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;

    if (p.lg && !z) {
      const st = mv ? Math.sin(now / 110) * 5 : 0;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 5, by + 10);
      ctx.lineTo(x - 5 + st, by + 24);
      ctx.moveTo(x + 5, by + 10);
      ctx.lineTo(x + 5 - st, by + 24);
      ctx.stroke();
      ctx.lineWidth = 1.5;
    }
    if (p.ea) {
      ctx.beginPath();
      ctx.ellipse(x - 7, by - 19, 3.5, 9, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x + 7, by - 19, 3.5, 9, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (p.hz) {
      emoji('🐴', x, by, 28);
    } else {
      ctx.beginPath();
      ctx.arc(x, by, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(x + f * 4 - 3, by - 3, 2, 0, Math.PI * 2);
      ctx.arc(x + f * 4 + 4, by - 3, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      if (p.mo) ctx.ellipse(x + f * 4, by + 6, 3, 4.5, 0, 0, Math.PI * 2), ctx.fill();
      else if (fx && fx.k === 'frown') ctx.arc(x + f * 4, by + 8, 4, Math.PI + 0.5, Math.PI * 2 - 0.5), ctx.stroke();
      else ctx.arc(x + f * 4, by + 1, 4, 0.2, 2.9), ctx.stroke();
    }
    if (p.ax) emoji('🪓', x + f * 16, by - 18, 22);
    if (p.th) emoji('🎩', x + f * 2, by - 21, 24);
    ctx.restore();

    // Held or revealed emoji above sprite
    let badge = '';
    if (view.phase === 'reveal') {
      if (view.trueEmojis && view.trueEmojis[id]) badge = view.trueEmojis[id];
      else if (id === view.murdererId) badge = '🔪';
    } else if (view.phase === 'vote' && view.claimedEmojis && view.claimedEmojis[id]) {
      badge = view.claimedEmojis[id];
    } else if (view.phase === 'alibi' && view.trueEmojis && view.trueEmojis[id]) {
      badge = view.trueEmojis[id];
    }
    if (badge) emoji(badge, x, by - 28, 24);

    // Player name
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    const nm = nameOf(id);
    ctx.strokeText(nm, x, by + 28);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(nm, x, by + 28);
  }

  function topFx(id, p, x, y, now) {
    if (view && view.phase === 'dark') return;
    let s = seen[id];
    if (!s) s = seen[id] = { sq: p.sq, as: p.as, t: -1e9, at: -1e9, tt: 0 };
    if (p.sq !== s.sq) { s.sq = p.sq; s.t = now; }
    if (p.as !== s.as) {
      s.as = p.as;
      s.at = now;
      s.k = p.ak;
      playSfx(s.k, p.as);
    }
    if (ACT[s.k] && now - s.at < 1400) {
      const k = (now - s.at) / 1400;
      ctx.globalAlpha = 1 - k * k;
      emoji(ACT[s.k], x, Math.max(16, y - 38 - k * 20), 22);
      ctx.globalAlpha = 1;
    }
    if (p.say && now - s.t < 6500) {
      bubble(p.say, x, y - 34);
    }
  }

  function moveLocal() {
    if (!view || !view.sprites || !view.sprites[myId]) return;
    const up = keys.arrowup;
    const dn = keys.arrowdown;
    const rt = keys.arrowright;
    const lf = keys.arrowleft;
    let dx = (rt ? 1 : 0) - (lf ? 1 : 0);
    let dy = (dn ? 1 : 0) - (up ? 1 : 0);
    if (dx || dy) me.tx = null;
    else if (me.tx !== null && me.ty !== null) {
      const ex = me.tx - me.x;
      const ey = me.ty - me.y;
      const dd = Math.hypot(ex, ey);
      if (dd < 4) { me.tx = null; me.ty = null; }
      else { dx = ex / dd; dy = ey / dd; }
    }
    if (!dx && !dy) return;

    me.z = 0;
    const len = Math.hypot(dx, dy) || 1;
    const sp = (view.sprites[myId].mi ? 175 : 110);
    const minY = view.phase === 'hallway' ? 36 : HALL_Y + 24;
    const maxY = view.phase === 'hallway' ? HALL_Y - 14 : H - 28;
    let nx = cl(me.x + (dx / len) * sp * dt, 20, W - 20);
    let ny = cl(me.y + (dy / len) * sp * dt, minY, maxY);

    // Keep Spotlight Pair inside roomPoly and outsiders outside during alibi/vote
    if ((view.phase === 'alibi' || view.phase === 'vote') && view.roomPoly && view.roomPoly.length >= 2) {
      const inSpot = view.spotlightPair.indexOf(myId) >= 0;
      const check = distToPoly(nx, ny, view.roomPoly);
      if (inSpot && check.dist > ROOM_R - 8) {
        const vx = nx - check.cx;
        const vy = ny - check.cy;
        const vd = Math.hypot(vx, vy) || 1;
        nx = check.cx + (vx / vd) * (ROOM_R - 8);
        ny = check.cy + (vy / vd) * (ROOM_R - 8);
      } else if (!inSpot && check.dist < WALL_R) {
        const vx = nx - check.cx;
        const vy = ny - check.cy;
        const vd = Math.hypot(vx, vy) || 1;
        nx = cl(check.cx + (vx / vd) * WALL_R, 20, W - 20);
        ny = cl(check.cy + (vy / vd) * WALL_R, minY, maxY);
      }
    }

    me.x = nx;
    me.y = ny;
    if (dx) me.f = dx > 0 ? 1 : -1;
  }

  function checkPhaseTimers(now) {
    if (!view || !view.phaseEndsAt || api.isSpectator) return;
    if (now < view.phaseEndsAt) return;
    if (now - lastPhaseAsk < 1200) return;
    lastPhaseAsk = now;
    if (view.phase === 'dark') api.send({ a: 'lightsOn' });
    else if (view.phase === 'alibi') api.send({ a: 'timeUpAlibi' });
    else if (view.phase === 'vote') api.send({ a: 'timeUpVote' });
  }

  function renderCanvas(now) {
    drawScene();
    if (!view || !view.sprites) return;
    const ids = Object.keys(view.sprites);
    const list = [];
    const tops = [];

    ids.forEach(function (id) {
      const p = view.sprites[id];
      const self = id === myId;
      const tx = self ? me.x : p.x;
      const ty = self ? me.y : p.y;
      let v = vw[id];
      if (!v) v = vw[id] = { x: tx, y: ty, tp: p.tp };
      if (p.tp !== v.tp) {
        v.tp = p.tp;
        v.x = tx;
        v.y = ty;
      } else if (self) {
        v.x = tx;
        v.y = ty;
      } else {
        const kk = Math.min(1, dt * 10);
        v.x += (tx - v.x) * kk;
        v.y += (ty - v.y) * kk;
      }
      const mv = Math.hypot(tx - v.x, ty - v.y) > 0.4 || (self && (keys.arrowup || keys.arrowdown || keys.arrowleft || keys.arrowright || me.tx !== null));
      const f = self ? me.f : (p.f || 1);
      const z = self ? me.z : (p.z | 0);
      list.push({
        y: v.y,
        fn: function () { drawP(id, p, v.x, v.y, f, mv, z, now); }
      });
      tops.push(function () { topFx(id, p, v.x, v.y, now); });
    });

    list.sort(function (a, b) { return a.y - b.y; }).forEach(function (o) { o.fn(); });
    tops.forEach(function (fn) { fn(); });

    // Muffled whisper indicator for outsiders when the spotlight pair chats
    if (view.phase === 'alibi' && view.typingTick > 0 && view.spotlightPair.indexOf(myId) < 0 && view.roomPoly.length >= 2) {
      bubble('💭 whispering...', view.roomPoly[1].x, view.roomPoly[1].y - 24);
    }
  }

  function updateHUD(now) {
    if (!view) return;
    const seated = view.players.indexOf(myId) >= 0;
    const isMurderer = view.murdererId && view.murdererId === myId;
    if (!seated || api.isSpectator) {
      roleEl.textContent = '👁 Watching';
      roleEl.className = 'cu-badge';
    } else if (isMurderer) {
      roleEl.textContent = '🔪 MURDERER';
      roleEl.className = 'cu-badge murderer';
    } else {
      roleEl.textContent = '🕯️ Innocent';
      roleEl.className = 'cu-badge';
    }

    if (view.phaseEndsAt && (view.phase === 'dark' || view.phase === 'alibi' || view.phase === 'vote')) {
      const rem = Math.max(0, Math.ceil((view.phaseEndsAt - now) / 1000));
      clockEl.textContent = rem + 's';
    } else {
      clockEl.textContent = 'Round ' + view.round;
    }

    if (view.phase === 'hallway') {
      statusEl.textContent = view.players.length < 4
        ? 'Lit Hallway — need ' + (4 - view.players.length) + ' more (' + view.players.length + '/4)'
        : 'Lit Hallway — ' + view.players.length + ' suspects ready';
    } else if (view.phase === 'dark') {
      statusEl.textContent = 'Pitch Dark — only eyeballs visible!';
    } else if (view.phase === 'alibi') {
      const pA = nameOf(view.spotlightPair[0]);
      const pB = nameOf(view.spotlightPair[1]);
      statusEl.textContent = pA + ' & ' + pB + ' trapped in ' + view.roomName;
    } else if (view.phase === 'vote') {
      statusEl.textContent = 'Interrogation — True alibi or counterfeit object?';
    } else if (view.phase === 'reveal') {
      statusEl.textContent = 'Case Closed!';
    }
  }

  function startSpeechReveal(text) {
    if (revealTimer) clearTimeout(revealTimer);
    revealedAlibi = '';
    const words = String(text || '').split(/\s+/).filter(Boolean);
    let idx = 0;
    function step() {
      if (dead || idx >= words.length) return;
      const w = words[idx++];
      revealedAlibi = revealedAlibi ? revealedAlibi + ' ' + w : w;
      const box = drawer.querySelector('#cu-alibi-out');
      if (box) box.textContent = '"' + revealedAlibi + '"';
      let delay = 110;
      if (/[,;—]$/.test(w)) delay += 260;
      else if (/[.!?]$/.test(w)) delay += 420;
      revealTimer = (api.setTimeout || setTimeout)(step, delay);
    }
    step();
  }

  function renderDrawer() {
    if (!view) return;
    const inSpot = view.spotlightPair.indexOf(myId) >= 0;
    const seated = view.players.indexOf(myId) >= 0 && !api.isSpectator;
    const key = [
      view.round,
      view.phase,
      inSpot ? 'spot' : 'out',
      seated ? 'seat' : 'watch',
      view.players.length,
      (view.privateChat ? view.privateChat.length : 0),
      (view.claimedEmojis ? JSON.stringify(view.claimedEmojis) : ''),
      (view.votes ? Object.keys(view.votes).length : 0)
    ].join('|');

    if (key === drawerKey) {
      const draftEl = drawer.querySelector('#cu-alibi-in');
      if (draftEl && document.activeElement !== draftEl && draftEl.value !== view.alibiText) {
        draftEl.value = view.alibiText || '';
      }
      return;
    }
    drawerKey = key;
    drawer.innerHTML = '';

    if (view.phase === 'hallway') {
      drawer.hidden = false;
      const row = document.createElement('div');
      row.className = 'cu-row';
      if (!seated && !api.isSpectator) {
        const jBtn = document.createElement('button');
        jBtn.className = 'pri';
        jBtn.textContent = 'Join Suspects';
        jBtn.onclick = function () { api.send({ a: 'join' }); };
        row.appendChild(jBtn);
      }
      if (api.isHost) {
        const sBtn = document.createElement('button');
        sBtn.className = 'pri';
        sBtn.disabled = view.players.length < 4;
        sBtn.textContent = view.players.length < 4
          ? 'Need 4 Suspects (' + view.players.length + '/4)'
          : '💡 Cut the Lights';
        sBtn.onclick = function () { api.send({ a: 'startDark' }); };
        row.appendChild(sBtn);
      } else {
        const info = document.createElement('span');
        info.textContent = view.players.length < 4
          ? 'Waiting for at least 4 suspects to join…'
          : 'Waiting for the host to cut the lights…';
        row.appendChild(info);
      }
      drawer.appendChild(row);
      return;
    }

    if (view.phase === 'dark') {
      drawer.hidden = true;
      return;
    }

    if (view.phase === 'alibi') {
      drawer.hidden = false;
      if (inSpot) {
        const [a, b] = view.spotlightPair;
        const myObj = (view.trueEmojis && view.trueEmojis[myId]) || '';
        const partnerId = a === myId ? b : a;
        const partnerObj = (view.trueEmojis && view.trueEmojis[partnerId]) || '';

        const head = document.createElement('div');
        head.innerHTML = '<b>🔒 Trapped with ' + nameOf(partnerId) + '!</b> Your object: ' + myObj + ' · Partner: ' + partnerObj;
        drawer.appendChild(head);

        if (view.decoyOptions && view.decoyOptions.length > 0) {
          const dLabel = document.createElement('div');
          dLabel.className = 'cu-hint';
          dLabel.textContent = '🔪 Cover-up! Pick a fake emoji to claim instead of the knife:';
          drawer.appendChild(dLabel);

          const dRow = document.createElement('div');
          dRow.className = 'cu-row';
          view.decoyOptions.forEach(function (emo) {
            const bBtn = document.createElement('button');
            const active = view.claimedEmojis && view.claimedEmojis[view.murdererId] === emo;
            bBtn.className = 'decoy' + (active ? ' on' : '');
            bBtn.textContent = emo;
            bBtn.onclick = function () { api.send({ a: 'pickDecoy', emoji: emo }); };
            dRow.appendChild(bBtn);
          });
          drawer.appendChild(dRow);
        }

        const chatBox = document.createElement('div');
        chatBox.className = 'cu-chat';
        (view.privateChat || []).forEach(function (m) {
          const line = document.createElement('div');
          line.textContent = nameOf(m.from) + ': ' + m.text;
          chatBox.appendChild(line);
        });
        if (!view.privateChat || !view.privateChat.length) {
          chatBox.textContent = 'Private room chat — outsiders cannot read this…';
        }
        drawer.appendChild(chatBox);
        chatBox.scrollTop = chatBox.scrollHeight;

        const cRow = document.createElement('div');
        cRow.className = 'cu-row';
        const cIn = document.createElement('input');
        cIn.maxLength = 100;
        cIn.placeholder = 'whisper to partner...';
        const cBtn = document.createElement('button');
        cBtn.textContent = 'Whisper';
        const sendChat = function () {
          if (cIn.value.trim()) {
            api.send({ a: 'pairChat', t: cIn.value });
            cIn.value = '';
          }
        };
        cBtn.onclick = sendChat;
        cIn.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } };
        cRow.appendChild(cIn);
        cRow.appendChild(cBtn);
        drawer.appendChild(cRow);

        const aRow = document.createElement('div');
        aRow.className = 'cu-row';
        const aIn = document.createElement('input');
        aIn.id = 'cu-alibi-in';
        aIn.maxLength = 140;
        aIn.placeholder = 'Final shared alibi bridging both emojis...';
        aIn.value = view.alibiText || '';
        aIn.oninput = function () { api.send({ a: 'draftAlibi', t: aIn.value }); };
        const subBtn = document.createElement('button');
        subBtn.className = 'pri';
        subBtn.textContent = 'Submit Alibi';
        subBtn.onclick = function () { api.send({ a: 'submitAlibi', t: aIn.value }); };
        aRow.appendChild(aIn);
        aRow.appendChild(subBtn);
        drawer.appendChild(aRow);
      } else {
        const info = document.createElement('div');
        info.textContent = nameOf(view.spotlightPair[0]) + ' and ' + nameOf(view.spotlightPair[1]) +
          ' are whispering inside ' + view.roomName + '. Walk around and heckle them using Say!';
        drawer.appendChild(info);
      }
      return;
    }

    if (view.phase === 'vote') {
      drawer.hidden = false;
      const [a, b] = view.spotlightPair;
      const eA = (view.claimedEmojis && view.claimedEmojis[a]) || '❓';
      const eB = (view.claimedEmojis && view.claimedEmojis[b]) || '❓';

      const head = document.createElement('div');
      head.innerHTML = '<b>' + nameOf(a) + ' (' + eA + ') & ' + nameOf(b) + ' (' + eB + ') claim:</b>';
      drawer.appendChild(head);

      const alibiBox = document.createElement('div');
      alibiBox.className = 'cu-alibi';
      alibiBox.id = 'cu-alibi-out';
      drawer.appendChild(alibiBox);
      startSpeechReveal(view.alibiText);

      if (!inSpot && seated) {
        const myVote = view.votes && view.votes[myId];
        const vRow = document.createElement('div');
        vRow.className = 'cu-row';
        const tBtn = document.createElement('button');
        tBtn.className = 'good';
        tBtn.textContent = myVote === 'true' ? '✅ Voted TRUE' : '✅ TRUE (Real Objects)';
        tBtn.onclick = function () { api.send({ a: 'vote', v: 'true' }); };
        const lBtn = document.createElement('button');
        lBtn.className = 'bad';
        lBtn.textContent = myVote === 'lie' ? '🚨 Voted LIE' : '🚨 LIE (Counterfeit / 🔪)';
        lBtn.onclick = function () { api.send({ a: 'vote', v: 'lie' }); };
        vRow.appendChild(tBtn);
        vRow.appendChild(lBtn);
        drawer.appendChild(vRow);
      } else {
        const wait = document.createElement('div');
        wait.className = 'cu-hint';
        wait.textContent = 'The crowd outside is voting on your story…';
        drawer.appendChild(wait);
      }
      return;
    }

    if (view.phase === 'reveal') {
      drawer.hidden = false;
      const [a, b] = view.spotlightPair;
      const tA = (view.trueEmojis && view.trueEmojis[a]) || '';
      const tB = (view.trueEmojis && view.trueEmojis[b]) || '';
      const line = summarize(view, nameOf) || 'Round complete!';

      const res = document.createElement('div');
      res.innerHTML = '<b>' + line + '</b><br>True objects in room: ' +
        nameOf(a) + ' held ' + tA + ' · ' + nameOf(b) + ' held ' + tB +
        ' · Murderer: <b>' + nameOf(view.murdererId) + '</b>';
      drawer.appendChild(res);

      if (api.isHost) {
        const nBtn = document.createElement('button');
        nBtn.className = 'pri';
        nBtn.textContent = '🕯️ Next Round';
        nBtn.onclick = function () { api.send({ a: 'nextRound' }); };
        drawer.appendChild(nBtn);
      }
    }
  }

  function frame(t) {
    rafId = null;
    if (dead || !running) return;
    dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    const now = Date.now();
    moveLocal();
    checkPhaseTimers(now);
    renderCanvas(now);
    updateHUD(now);
    if (running && !dead) rafId = api.raf(frame);
  }

  // Input bindings
  cv.addEventListener('pointerdown', function (e) {
    if (!view || api.isSpectator) return;
    const r = cv.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H);
    const x = (e.clientX - r.left - (r.width - W * s) / 2) / s;
    const y = (e.clientY - r.top - (r.height - H * s) / 2) / s;
    const minY = view.phase === 'hallway' ? 36 : HALL_Y + 24;
    const maxY = view.phase === 'hallway' ? HALL_Y - 14 : H - 28;
    me.tx = cl(x, 20, W - 20);
    me.ty = cl(y, minY, maxY);
  });

  wrap.querySelectorAll('[data-fx]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      api.send({ a: 'fx', k: btn.getAttribute('data-fx') });
    });
  });

  sitBtn.addEventListener('click', function () {
    me.z = (me.z + 1) % 3;
    me.tx = null;
  });

  function sendSay() {
    const t = sayInput.value.trim();
    if (t) api.send({ a: 'say', t: t });
    sayInput.value = '';
  }
  sayBtn.addEventListener('click', sendSay);
  sayInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); sendSay(); }
  });

  function onKeyDown(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (FXKEY[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (!e.repeat) api.send({ a: 'fx', k: FXKEY[k] });
      return;
    }
    if (k.indexOf('arrow') === 0) e.preventDefault();
    keys[k] = 1;
  }
  function onKeyUp(e) { keys[e.key.toLowerCase()] = 0; }
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // Sync local sprite position every 130ms
  const setI = api.setInterval || setInterval;
  const syncTimer = setI(function () {
    if (dead || !view || api.isSpectator || !view.sprites || !view.sprites[myId]) return;
    const sig = [Math.round(me.x), Math.round(me.y), me.f, me.z].join(',');
    if (sig !== lastSent) {
      lastSent = sig;
      api.send({ a: 'pos', x: Math.round(me.x), y: Math.round(me.y), f: me.f, z: me.z });
    }
  }, 130);

  return {
    update: function (next) {
      if (dead || !next) return;
      view = next;
      if (typeof next.you === 'string' && next.you) myId = next.you;
      const sp = next.sprites && next.sprites[myId];
      if (sp && sp.tp !== me.tp) {
        me.tp = sp.tp;
        me.x = sp.x;
        me.y = sp.y;
        me.f = sp.f || 1;
        me.z = sp.z || 0;
        me.tx = null;
        me.ty = null;
      }
      renderDrawer();
      if (!running) {
        running = true;
        last = performance.now();
        rafId = api.raf(frame);
      }
      if (!joined && !api.isSpectator) {
        joined = true;
        api.send({ a: 'join' });
      }
    },
    denied: function (text) {
      if (dead) return;
      statusEl.textContent = text || 'Action refused.';
    },
    destroy: function () {
      dead = true;
      running = false;
      if (rafId !== null) { api.cancelRaf(rafId); rafId = null; }
      if (syncTimer) clearInterval(syncTimer);
      if (revealTimer) clearTimeout(revealTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      if (AC && typeof AC.close === 'function') {
        try { AC.close(); } catch (e) {}
      }
    }
  };
}