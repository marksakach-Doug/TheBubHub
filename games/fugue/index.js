// Fugue — a module game for Bub Hub.
//
// Three or more players. Every round one player is the CONNECTIONIST and the
// rest are STREAMERS. Each streamer has their own secret prompt and must lock
// a word every 3 seconds (type it, hit space — like an email address turning
// into a bubble). The connectionist sees every locked word and forges links,
// one word from each of two or more streams, that fit a relation which snaps
// to a new one after every link. Straight vertical links and links reaching
// more streams score more. Afterwards the streamers vote on every link. Only
// the connectionist scores; everyone takes a turn, then the set is compared.
//
// Contract notes (see README "The module contract"):
//  * Only reduce() changes state. The streamer's half-typed draft never leaves
//    their device: a word exists for the table only once it is locked.
//  * project() is where the hiding happens. A streamer sees only their own
//    stream and prompt; the connectionist sees every locked word but not the
//    prompts (REVEAL_PROMPTS_TO_CONNECTIONIST); votes stay private until tally.
//  * Nothing is sent from mount(); `join` goes out from the first update().
//  * The loops are one `running` flag, not a null rafId, so an intent sent from
//    inside a frame (a forced lock) cannot start a second loop.
//  * Written in the same plain style as the other modules (no spread, no
//    optional chaining) so the esprima syntax check in tests/jscheck.py parses it.

export const meta = {
  id: 'fugue',
  title: 'Fugue',
  players: { min: 1, max: 8 },
  color: '#fde047',
  icon: '⚡',
  desc: 'Streamers lock a word every 3 seconds; play multiplayer or solo streamer mode.',
  soloable: true
};

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const WORD_MS = 5000;          // a streamer must lock a word this often
const INTRO_MS = 6000;         // role + prompt screen, ends in a 3-2-1
const LIVE_MS = 60000;         // one round of streaming
const VOTE_BASE = 8000;        // vote window = base + per link, capped
const VOTE_PER = 2500;
const VOTE_MAX = 60000;
const TALLY_MS = 14000;        // results screen before the next round starts itself
const GRACE = 800;             // clock-skew allowance on every timed intent
const MAX_WORDS = 40;
const MAX_LEN = 24;
const STREAK_MS = 7000;        // links closer together than this build a chain
// The connectionist reads the streams cold by default: the prompts are the
// reveal at the vote. Flip to true for an easier game.
const REVEAL_PROMPTS_TO_CONNECTIONIST = false;

const COLORS = ['#fb7185', '#38bdf8', '#fde047', '#a78bfa', '#4ade80', '#f472b6', '#fb923c', '#2dd4bf'];

const PROMPTS = [
  'words to describe enemies', 'words that sound delicious', 'words that bring you down to earth',
  'things in a kitchen at 3am', 'words that feel like Tuesday', 'words that creak',
  'words that glow', 'words for how a lie feels', 'things heavier than they look',
  'words a storm would use', 'words that taste like metal', 'words for being small',
  'words with sharp edges', 'things you lose without noticing', 'words for a cathedral',
  'things that rise', 'words your grandmother says', 'things that are better cold',
  'words that smell like smoke', 'words for what is left after', 'things at the bottom of a pocket',
  'weather inside a person', 'words that hum', 'things with a lid', 'words for waiting',
  'things you hold with two hands', 'words that bounce', 'words for the edge of something',
  'what a river would whisper', 'things older than you', 'words that sound like a lie',
  'words for morning', 'things that get tangled', 'words that wobble', 'words that keep coming back',
  'things you can only do once', 'words the color of rust', 'things with an echo',
  'words for getting lost', 'words that sound fast', 'words that sound slow',
  'things that burn quietly', 'words for a very good day', 'things inside a clock',
  'things a tide takes', 'what a crowd does', 'words for what is hidden',
  'words that sound official', 'words that cross over'
];

const RELATIONS = [
  { k: 'opposite', name: 'OPPOSITES', hint: 'they pull against each other', ex: 'hot · cold' },
  { k: 'synonym', name: 'SYNONYMS', hint: 'they mean nearly the same', ex: 'big · huge' },
  { k: 'kind', name: 'SAME KIND', hint: 'both are kinds of one thing', ex: 'oak · pine' },
  { k: 'part', name: 'PART OF', hint: 'one is a part of the other', ex: 'wheel · car' },
  { k: 'together', name: 'FOUND TOGETHER', hint: 'they turn up in the same place', ex: 'salt · sea' },
  { k: 'feeling', name: 'SAME FEELING', hint: 'they make you feel alike', ex: 'dusk · sigh' }
];

function relOf(k) {
  for (let i = 0; i < RELATIONS.length; i++) if (RELATIONS[i].k === k) return RELATIONS[i];
  return RELATIONS[0];
}

// ---------------------------------------------------------------- state ----

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function cleanWord(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[\s,]+/g, '').slice(0, MAX_LEN);
}

function same(st, extra) { return Object.assign({}, st, extra); }

function freshState() {
  return {
    epoch: 0,            // bumped per round; the record dedupes on setNo, clients re-anchor on this
    setNo: 0,
    phase: 'lobby',      // lobby | intro | live | vote | tally | over
    players: [],         // the table, in seat order
    late: [],            // opened the table mid-set; they sit in at the next set
    hostId: '',
    order: [],           // connectionist rotation for this set
    roundIdx: -1,
    scores: {},
    history: [],
    usedPrompts: [],
    round: null,
    soloRound: null,
    over: null,
    mode: null
  };
}

function tableOf(ctx) {
  const c = ctx || {};
  const list = c.atTable || c.seats || [];
  const ids = [];
  list.forEach(function (m) {
    if (!m || !m.id || m.spectator) return;
    if (ids.indexOf(m.id) < 0 && ids.length < MAX_PLAYERS) ids.push(m.id);
  });
  return ids;
}

export function init(ctx) {
  const st = freshState();
  st.players = tableOf(ctx);
  st.hostId = st.players[0] || '';
  if (st.players.length === 1) {
    st.mode = 'solo-streamer';
  }
  return st;
}

function advanceRel(round, rng) {
  let deck = round.deck.slice();
  // A refilled deck leaves out the relation on screen, so two in a row never repeat.
  if (!deck.length) deck = shuffle(RELATIONS.map(function (r) { return r.k; }), rng)
    .filter(function (k) { return k !== round.rel; });
  const next = deck.shift();
  return { rel: next, deck: deck };
}

function startRound(st, now, rng) {
  let idx = st.roundIdx + 1;
  while (idx < st.order.length && st.players.indexOf(st.order[idx]) < 0) idx++;
  if (idx >= st.order.length || st.players.length < MIN_PLAYERS) return endSet(st);
  const conn = st.order[idx];
  const streamers = st.players.filter(function (id) { return id !== conn; });
  let pool = PROMPTS.filter(function (p) { return st.usedPrompts.indexOf(p) < 0; });
  let used = st.usedPrompts;
  if (pool.length < streamers.length) { pool = PROMPTS.slice(); used = []; }
  const picked = shuffle(pool, rng).slice(0, streamers.length);
  const prompts = {};
  const words = {};
  streamers.forEach(function (id, i) { prompts[id] = picked[i]; words[id] = []; });
  const deck = shuffle(RELATIONS.map(function (r) { return r.k; }), rng);
  return same(st, {
    epoch: st.epoch + 1,
    phase: 'intro',
    roundIdx: idx,
    usedPrompts: used.concat(picked),
    round: {
      conn: conn, streamers: streamers, prompts: prompts, words: words,
      links: [], used: {}, deck: deck.slice(1), rel: deck[0], votes: {},
      introEndsAt: now + INTRO_MS, endsAt: now + INTRO_MS + LIVE_MS,
      voteEndsAt: 0, tallyEndsAt: 0, result: null, aborted: false
    }
  });
}

function startSet(st, rng) {
  const players = st.players.concat(st.late.filter(function (id) { return st.players.indexOf(id) < 0; }))
    .slice(0, MAX_PLAYERS);
  const scores = {};
  players.forEach(function (id) { scores[id] = 0; });
  return startRound(same(st, {
    players: players, late: [], order: shuffle(players, rng), roundIdx: -1,
    scores: scores, history: [], usedPrompts: [], over: null, round: null, setNo: st.setNo + 1
  }), Date.now(), rng);
}

function endSet(st) {
  const rows = st.order.map(function (id) { return { id: id, pts: st.scores[id] || 0 }; })
    .sort(function (a, b) { return b.pts - a.pts; });
  const top = rows.length ? rows[0].pts : 0;
  return same(st, {
    phase: 'over',
    over: { rows: rows, top: top, winners: rows.filter(function (r) { return r.pts === top; }).map(function (r) { return r.id; }) }
  });
}

function allVoted(r) {
  if (!r.links.length) return false;
  return r.links.every(function (l) {
    const v = r.votes[l.n] || {};
    return r.streamers.every(function (id) { return typeof v[id] === 'boolean'; });
  });
}

// A link stands when more streamers say yes than no. Silence is not a vote.
function tally(st, now) {
  const r = st.round;
  let points = 0;
  const rows = r.links.map(function (l) {
    const v = r.votes[l.n] || {};
    let yes = 0, no = 0;
    r.streamers.forEach(function (id) { if (v[id] === true) yes++; else if (v[id] === false) no++; });
    const stands = yes > no;
    const pts = stands ? l.weight * (l.vertical ? 2 : 1) : 0;
    points += pts;
    return { n: l.n, yes: yes, no: no, stands: stands, pts: pts };
  });
  const scores = Object.assign({}, st.scores);
  scores[r.conn] = (scores[r.conn] || 0) + points;
  return same(st, {
    phase: 'tally',
    scores: scores,
    history: st.history.concat([{ conn: r.conn, pts: points, links: r.links.length, stood: rows.filter(function (x) { return x.stands; }).length }]),
    round: Object.assign({}, r, { result: { points: points, rows: rows }, tallyEndsAt: now + TALLY_MS })
  });
}

// --------------------------------------------------------------- reduce ----

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const rng = (ctx && ctx.rng) || Math.random;
  const id = from.id || '';
  const kind = (action && action.a) || '';
  const now = Date.now();
  const r = state.round;
  const noop = function () { return same(state, {}); };

  if (!id) return { error: 'No identity — reopen the game.' };
  const host = !!from.host || id === state.hostId;

  if (state.mode === 'solo-streamer') {
    if (kind === 'join') {
      if (state.players.indexOf(id) >= 0) return noop();
      return same(state, { players: state.players.concat([id]) });
    }
    if (state.players.indexOf(id) < 0) return { error: 'You are watching — not seated.' };
    if (kind === 'start') {
      if (state.phase !== 'lobby' && state.phase !== 'over') return { error: 'A set is already running.' };
      const prompt = PROMPTS[Math.floor(rng() * PROMPTS.length)];
      return same(state, {
        phase: 'live',
        epoch: state.epoch + 1,
        soloRound: {
          prompt: prompt,
          words: [],
          endsAt: now + LIVE_MS,
          startedAt: now
        }
      });
    }
    if (kind === 'word') {
      if (state.phase !== 'live' || !state.soloRound) return noop();
      if (now > state.soloRound.endsAt + GRACE) return noop();
      const list = state.soloRound.words || [];
      if (list.length >= MAX_WORDS) return noop();
      const words = list.concat([cleanWord(action.w)]);
      return same(state, {
        soloRound: Object.assign({}, state.soloRound, { words: words })
      });
    }
    if (kind === 'finish') {
      if (state.phase !== 'live' || !state.soloRound) return noop();
      const count = (state.soloRound.words || []).length;
      return same(state, {
        phase: 'over',
        over: {
          count: count,
          winner: id
        }
      });
    }
    if (kind === 'reset') {
      const st = freshState();
      st.players = state.players;
      st.hostId = state.players[0] || '';
      st.mode = 'solo-streamer';
      st.epoch = state.epoch + 1;
      return st;
    }
    return { error: 'Unknown action: ' + kind };
  }

  if (kind === 'join') {
    if (state.players.indexOf(id) >= 0 || state.late.indexOf(id) >= 0) return noop();
    if (state.players.length + state.late.length >= MAX_PLAYERS) return { error: 'Fugue holds ' + MAX_PLAYERS + ' players.' };
    if (state.phase === 'lobby' || state.phase === 'over') return same(state, { players: state.players.concat([id]) });
    return same(state, { late: state.late.concat([id]) });   // mid-set: sits in next set
  }

  if (state.players.indexOf(id) < 0) return { error: 'You are watching — not seated.' };

  if (kind === 'start') {
    if (state.phase !== 'lobby' && state.phase !== 'over') return { error: 'A set is already running.' };
    if (!host) return { error: 'Waiting for the host to start.' };
    if (state.players.length + state.late.length < MIN_PLAYERS) return { error: 'Fugue needs ' + MIN_PLAYERS + ' players.' };
    return startSet(state, rng);
  }

  if (kind === 'go') {
    if (state.phase !== 'intro' || now < r.introEndsAt - 400) return noop();
    return same(state, { phase: 'live' });
  }

  if (kind === 'word') {
    if (state.phase !== 'live' || !r) return noop();
    if (r.streamers.indexOf(id) < 0) return { error: 'Only streamers type words.' };
    if (now > r.endsAt + GRACE) return noop();
    const list = r.words[id] || [];
    if (list.length >= MAX_WORDS) return noop();
    const words = Object.assign({}, r.words);
    words[id] = list.concat([cleanWord(action.w)]);
    return same(state, { round: Object.assign({}, r, { words: words }) });
  }

  if (kind === 'link') {
    if (state.phase !== 'live' || !r) return noop();
    if (id !== r.conn) return { error: 'Only the Connectionist links words.' };
    if (now > r.endsAt + GRACE) return noop();
    const picks = Array.isArray(action.picks) ? action.picks : [];
    if (picks.length < 2) return { error: 'A link needs words from two streams.' };
    const seen = {};
    const clean = [];
    for (let k = 0; k < picks.length; k++) {
      const p = picks[k] || {};
      const s = String(p.s);
      const i = Number(p.i);
      if (r.streamers.indexOf(s) < 0 || seen[s]) return { error: 'One word from each stream.' };
      const list = r.words[s] || [];
      if (!(i >= 0 && i < list.length) || Math.floor(i) !== i || !list[i]) return { error: 'That word is not there.' };
      if (r.used[s + '|' + i]) return { error: 'That word is already linked.' };
      seen[s] = true;
      clean.push({ s: s, i: i });
    }
    clean.sort(function (a, b) { return r.streamers.indexOf(a.s) - r.streamers.indexOf(b.s); });
    const link = {
      n: r.links.length + 1, picks: clean, rel: r.rel, t: now,
      vertical: clean.every(function (p) { return p.i === clean[0].i; }),
      weight: clean.length - 1
    };
    const used = Object.assign({}, r.used);
    clean.forEach(function (p) { used[p.s + '|' + p.i] = link.n; });
    const nx = advanceRel(r, rng);
    return same(state, { round: Object.assign({}, r, { links: r.links.concat([link]), used: used, rel: nx.rel, deck: nx.deck }) });
  }

  if (kind === 'finish') {
    if (state.phase !== 'live' || now < r.endsAt - GRACE) return noop();
    if (!r.links.length) return tally(state, now);
    const ms = Math.min(VOTE_MAX, VOTE_BASE + VOTE_PER * r.links.length);
    return same(state, { phase: 'vote', round: Object.assign({}, r, { voteEndsAt: now + ms }) });
  }

  if (kind === 'vote') {
    if (state.phase !== 'vote') return noop();
    if (r.streamers.indexOf(id) < 0) return { error: 'Only streamers vote.' };
    const n = Number(action.n);
    if (!r.links.some(function (l) { return l.n === n; })) return { error: 'No such link.' };
    const votes = Object.assign({}, r.votes);
    votes[n] = Object.assign({}, votes[n]);
    votes[n][id] = !!action.yes;
    const nr = Object.assign({}, r, { votes: votes });
    const st = same(state, { round: nr });
    return allVoted(nr) ? tally(st, now) : st;
  }

  if (kind === 'close') {
    if (state.phase !== 'vote' || now < r.voteEndsAt - GRACE) return noop();
    return tally(state, now);
  }

  if (kind === 'next') {
    if (state.phase !== 'tally') return noop();
    if (!host && now < r.tallyEndsAt - GRACE) return { error: 'The next round starts on its own.' };
    return startRound(state, now, rng);
  }

  return { error: 'Unknown action: ' + kind };
}

// Someone left. Their seat goes; a round that cannot be played any more is
// called off rather than left waiting on a stream that will never come.
export function prune(state, goneId) {
  if (state.mode === 'solo-streamer') {
    if (state.players.indexOf(goneId) >= 0) {
      return same(state, { players: state.players.filter(function (id) { return id !== goneId; }), phase: 'over' });
    }
    return state;
  }
  const inP = state.players.indexOf(goneId) >= 0;
  const inL = state.late.indexOf(goneId) >= 0;
  if (!inP && !inL) return state;
  const keep = function (id) { return id !== goneId; };
  let st = same(state, { players: state.players.filter(keep), late: state.late.filter(keep) });
  if (st.hostId === goneId) st.hostId = st.players[0] || '';
  const r = state.round;
  const ph = state.phase;
  if (inP && r && (ph === 'intro' || ph === 'live' || ph === 'vote')) {
    const streamers = r.streamers.filter(keep);
    if (goneId === r.conn || streamers.length < 2) {
      st = same(st, {
        phase: 'tally',
        history: st.history.concat([{ conn: r.conn, pts: 0, links: r.links.length, stood: 0 }]),
        round: Object.assign({}, r, { streamers: streamers, aborted: true, result: { points: 0, rows: [] }, tallyEndsAt: Date.now() + TALLY_MS })
      });
    } else {
      const votes = {};
      Object.keys(r.votes).forEach(function (n) {
        const v = Object.assign({}, r.votes[n]);
        delete v[goneId];
        votes[n] = v;
      });
      const nr = Object.assign({}, r, { streamers: streamers, votes: votes });
      st = same(st, { round: nr });
      if (ph === 'vote' && allVoted(nr)) st = tally(st, Date.now());
    }
  }
  return st;
}

// -------------------------------------------------------------- project ----

export function project(state, playerId, api) {
  if (state.mode === 'solo-streamer') {
    const ph = state.phase;
    const r = state.soloRound ? {
      prompts: { [playerId]: state.soloRound.prompt },
      words: { [playerId]: state.soloRound.words },
      endsAt: state.soloRound.endsAt,
      linkCount: 0
    } : null;
    return {
      epoch: state.epoch,
      setNo: state.setNo,
      phase: ph,
      players: state.players,
      hostId: state.hostId,
      mode: 'solo-streamer',
      soloRound: state.soloRound,
      round: r,
      over: state.over,
      role: 'stream',
      you: playerId || '',
      roster: (api && api.roster) || null,
      at: Date.now()
    };
  }
  const me = playerId || '';
  const r = state.round;
  const ph = state.phase;
  const open = ph === 'vote' || ph === 'tally' || ph === 'over';
  const role = !r ? 'none' : (me === r.conn ? 'conn' : (r.streamers.indexOf(me) >= 0 ? 'stream' : 'watch'));
  let rv = null;
  if (r) {
    // A streamer never sees another stream before the vote; that is the game.
    const seesAll = open || role !== 'stream';
    const words = {};
    const prompts = {};
    r.streamers.forEach(function (id) {
      if (seesAll || id === me) words[id] = r.words[id];
      if (open || id === me || (role !== 'stream' && REVEAL_PROMPTS_TO_CONNECTIONIST)) prompts[id] = r.prompts[id];
    });
    const mineUsed = [];
    if (role === 'stream') {
      (r.words[me] || []).forEach(function (w, i) { if (r.used[me + '|' + i]) mineUsed.push(i); });
    }
    let votes = {};
    if (ph === 'tally' || ph === 'over') votes = r.votes;
    else if (ph === 'vote' && role === 'stream') {
      r.links.forEach(function (l) {
        const v = r.votes[l.n];
        if (v && typeof v[me] === 'boolean') { votes[l.n] = {}; votes[l.n][me] = v[me]; }
      });
    }
    let cast = 0;
    r.links.forEach(function (l) {
      const v = r.votes[l.n] || {};
      r.streamers.forEach(function (id) { if (typeof v[id] === 'boolean') cast++; });
    });
    rv = {
      conn: r.conn, streamers: r.streamers, words: words, prompts: prompts,
      links: (open || role !== 'stream') ? r.links : [],
      linkCount: r.links.length, mineUsed: mineUsed,
      votes: votes, cast: cast, castTotal: r.links.length * r.streamers.length,
      rel: ((ph === 'intro' || ph === 'live') && role !== 'stream') ? r.rel : '',
      introEndsAt: r.introEndsAt, endsAt: r.endsAt, voteEndsAt: r.voteEndsAt, tallyEndsAt: r.tallyEndsAt,
      result: (ph === 'tally' || ph === 'over') ? r.result : null,
      aborted: r.aborted
    };
  }
  return {
    epoch: state.epoch, setNo: state.setNo, phase: ph, players: state.players, late: state.late,
    hostId: state.hostId, roundIdx: state.roundIdx, roundsTotal: state.order.length,
    scores: state.scores, history: state.history, over: state.over,
    round: rv, role: role, you: me,
    roster: (api && api.roster) || null,
    at: Date.now()          // host clock, so every client can run on host time
  };
}

// ------------------------------------------------------------ record -------

export function roundId(state) {
  return 's' + ((state && state.setNo) || 0);
}

export function summarize(state, nameOf) {
  if (state.mode === 'solo-streamer' && state.phase === 'over' && state.over) {
    const name = nameOf(state.over.winner) || 'You';
    const count = state.over.count;
    return name + ' locked ' + count + (count === 1 ? ' word' : ' words') + ' in Fugue Solo Streamer';
  }
  if (state.phase !== 'over' || !state.over || !state.over.rows.length) return null;
  const o = state.over;
  const nm = function (id) { return nameOf(id) || 'A player'; };
  const pts = function (n) { return n + (n === 1 ? ' point' : ' points'); };
  const list = function (a) {
    return a.length === 2 ? a[0] + ' and ' + a[1]
      : (a.length > 2 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : (a[0] || ''));
  };
  const rest = o.rows.filter(function (x) { return o.winners.indexOf(x.id) < 0; })
    .map(function (x) { return nm(x.id) + ' ' + x.pts; });
  const tail = rest.length ? ' (' + rest.join(', ') + ')' : '';
  if (o.winners.length > 1) return list(o.winners.map(nm)) + ' tied Fugue on ' + pts(o.top) + tail;
  return nm(o.winners[0]) + ' won Fugue with ' + pts(o.top) + tail;
}

// ----------------------------------------------------------------- mount ---

const CSS = [
  '.f{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;background:#090b12;color:#cbd5e1;',
  'font:15px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;user-select:none;-webkit-user-select:none;',
  '-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}',
  '.f input{user-select:text;-webkit-user-select:text}',
  '.f button{font:inherit;cursor:pointer}',
  '.top{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 14px;flex:0 0 auto;',
  'font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7c8799}',
  '.who{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.clock{font-size:22px;font-weight:800;color:#fde047;font-variant-numeric:tabular-nums;letter-spacing:0}',
  '.clock.hot{color:#f87171}',
  '.stage{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}',
  '.vig,.flash{position:absolute;inset:0;pointer-events:none;z-index:20}',
  '.flash{background:#e0f2fe;opacity:0}',
  '.toast{position:absolute;top:44px;left:50%;transform:translateX(-50%);z-index:30;background:#1e293b;color:#fde047;',
  'padding:6px 14px;border-radius:999px;font-size:13px;opacity:0;transition:opacity .15s;pointer-events:none;white-space:nowrap}',
  '.toast.show{opacity:1}',
  '.mute{background:transparent;border:0;font-size:16px;opacity:.6;padding:2px 4px;color:inherit}',
  '.shk{animation:shk .28s linear}',
  '@keyframes shk{0%{transform:translate(var(--sh),calc(var(--sh)*-1))}25%{transform:translate(calc(var(--sh)*-1),var(--sh))}',
  '50%{transform:translate(var(--sh),var(--sh))}75%{transform:translate(calc(var(--sh)*-.5),calc(var(--sh)*-.5))}100%{transform:none}}',
  '@keyframes pop{0%{transform:scale(.3);opacity:0}70%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}',
  '@keyframes jit{0%{transform:translate(0,0)}25%{transform:translate(2px,-1px)}50%{transform:translate(-2px,1px)}75%{transform:translate(1px,2px)}100%{transform:translate(0,0)}}',
  '@keyframes snap{0%{transform:translateY(-14px) scale(1.25);opacity:0;filter:brightness(3)}100%{transform:none;opacity:1;filter:none}}',
  '@keyframes bolt{0%{opacity:1}30%{opacity:.9}100%{opacity:0}}',
  // centered screens
  '.center{flex:1;overflow:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:18px;text-align:center}',
  '.center h1{margin:0;font-size:34px;color:#fde047;letter-spacing:.04em}',
  '.center h2{margin:0;font-size:13px;letter-spacing:.18em;color:#7c8799;text-transform:uppercase;font-weight:600}',
  '.big{font-size:30px;font-weight:800;color:#fff;max-width:22rem;line-height:1.15}',
  '.count{font-size:64px;font-weight:900;color:#fde047;line-height:1}',
  '.rules{max-width:25rem;color:#94a3b8;font-size:14px;margin:0}',
  '.rules b{color:#e2e8f0}',
  '.names{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:26rem}',
  '.nm{padding:5px 12px;border-radius:999px;background:var(--c,#334155);color:#0b0d14;font-weight:700;font-size:14px}',
  '.nm.you{box-shadow:0 0 0 2px #090b12,0 0 0 4px #fff}',
  '.btn{background:#fde047;color:#0b0d14;border:0;border-radius:10px;padding:12px 30px;font-weight:800;font-size:16px;min-height:44px}',
  '.btn:disabled{opacity:.35;cursor:default}',
  '.note{color:#7c8799;font-size:13px;margin:0}',
  // streamer screen
  '.prompt{padding:6px 16px 2px;text-align:center;flex:0 0 auto}',
  '.prompt small{display:block;font-size:11px;letter-spacing:.16em;color:#7c8799;text-transform:uppercase}',
  '.prompt b{display:block;font-size:24px;color:#fff;margin-top:2px;line-height:1.15}',
  '.field{flex:1;min-height:0;margin:8px 12px;border:2px solid var(--c);border-radius:14px;padding:10px;overflow-y:auto;',
  'display:flex;flex-wrap:wrap;align-content:flex-start;align-items:center;gap:8px;background:#0e1220;box-shadow:0 0 18px -6px var(--c);cursor:text}',
  '.field.jit{animation:jit .09s linear infinite}',
  '.chip{background:var(--c);color:#0b0d14;font-weight:700;font-size:17px;padding:5px 13px;border-radius:999px;animation:pop .2s;',
  'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.chip.blank{background:transparent;border:1px dashed #475569;color:#475569;padding:5px 11px}',
  '.chip.used{box-shadow:0 0 0 2px #fde047,0 0 14px #fde047}',
  '.field input{flex:1 1 110px;min-width:90px;min-height:36px;background:transparent;border:0;outline:0;color:#fff;font-size:18px}',
  '.bar{height:12px;margin:0 12px;background:#1b2133;border-radius:6px;overflow:hidden;flex:0 0 auto}',
  '.bar i{display:block;height:100%;width:100%;transform-origin:left;background:#4ade80}',
  '.foot{display:flex;justify-content:space-between;padding:6px 16px 10px;font-size:12px;color:#7c8799;flex:0 0 auto}',
  // connectionist
  '.lanes{flex:1;min-height:0;overflow:auto;position:relative;display:flex}',
  '.cols{position:relative;display:flex;flex:none;width:max-content;min-width:100%;margin:auto 0}',
  '.col{display:flex;flex-direction:column;flex:0 0 auto;min-width:76px}',
  '.col.hot{background:rgba(253,224,71,.05)}',
  '.cell{height:64px;display:flex;align-items:center;justify-content:center;padding:0 5px;box-sizing:border-box}',
  '.col.lab{position:sticky;left:0;z-index:3;background:#090b12;min-width:78px;max-width:78px;border-right:1px solid #1b2133}',
  '.cell.lab{justify-content:flex-start;padding-left:8px;font-size:12px;font-weight:800;color:var(--c);overflow:hidden;white-space:nowrap}',
  '.cell.lab span{overflow:hidden;text-overflow:ellipsis}',
  '.b{background:var(--c);color:#0b0d14;border:0;border-radius:999px;padding:6px 13px;min-height:40px;font-weight:800;font-size:15px;',
  'max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;animation:pop .22s}',
  '.b.sel{outline:3px solid #fff;box-shadow:0 0 20px var(--c);transform:scale(1.08)}',
  '.b.used{opacity:.28;filter:saturate(.3);cursor:default}',
  '.b.blank{background:transparent;border:1px dashed #334155;color:#475569;cursor:default}',
  '.ghost{width:10px;height:10px;border-radius:50%;background:#1b2133}',
  '.bolts{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:2}',
  '.bolts .bolt{animation:bolt .75s ease-out forwards}',
  '.bolts path,.bolts line{fill:none;stroke-linecap:round;stroke-linejoin:round}',
  '.rel{flex:0 0 auto;padding:10px 14px;background:linear-gradient(#10152a,#0b0f1f);border-top:1px solid #1e2740;display:flex;align-items:center;gap:12px}',
  '.rel .nameb{flex:1;min-width:0}',
  '.rel small{display:block;font-size:10px;letter-spacing:.18em;color:#7c8799}',
  '.rel b{display:block;font-size:26px;color:#fde047;letter-spacing:.04em;line-height:1.1}',
  '.rel b.snap{animation:snap .28s ease-out;transform-origin:left center}',
  '.rel span.h{display:block;font-size:12px;color:#94a3b8}',
  '.chain{font-size:22px;font-weight:900;color:#7dd3fc;text-shadow:0 0 12px #38bdf8;min-width:2.2em;text-align:right}',
  '.act{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:8px 14px 12px;background:#0b0f1f}',
  '.selinfo{flex:1;min-width:0;font-size:14px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.zap{background:#fde047;color:#0b0d14;border:0;border-radius:10px;padding:10px 20px;font-weight:900;min-height:44px}',
  '.zap:disabled{opacity:.3}',
  '.watch{justify-content:center;color:#94a3b8;font-size:13px}',
  // vote / tally
  '.scroll{flex:1;min-height:0;overflow:auto;padding:6px 12px 16px}',
  '.vhead{text-align:center;padding:6px 0 10px}',
  '.vhead b{display:block;font-size:20px;color:#fff}',
  '.vhead small{color:#7c8799;font-size:12px}',
  '.plist{display:flex;flex-direction:column;gap:4px;margin:8px 0 12px;font-size:13px}',
  '.plist div{display:flex;gap:8px;align-items:baseline}',
  '.plist i{font-style:normal;font-weight:800;color:var(--c);min-width:5.5em;text-align:right}',
  '.card{background:#10152a;border:1px solid #1e2740;border-radius:12px;padding:10px;margin-bottom:10px}',
  '.card.no{opacity:.55}',
  '.pair{display:flex;flex-wrap:wrap;align-items:center;gap:6px;justify-content:center;margin-bottom:6px}',
  '.pair .chip{animation:none;font-size:16px}',
  '.pair em{color:#7dd3fc;font-style:normal;font-weight:800}',
  '.meta{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#94a3b8;margin-bottom:8px}',
  '.meta .r{color:#fde047;font-weight:800;letter-spacing:.06em}',
  '.vb{display:flex;gap:8px}',
  '.vb button{flex:1;border-radius:10px;border:2px solid #334155;background:transparent;color:#cbd5e1;font-weight:800;padding:10px;min-height:44px}',
  '.vb .y.on{background:#4ade80;border-color:#4ade80;color:#052e16}',
  '.vb .n.on{background:#f87171;border-color:#f87171;color:#450a0a}',
  '.stamp{font-weight:900;font-size:13px}',
  '.stamp.ok{color:#4ade80}.stamp.bad{color:#f87171}',
  '.board{display:flex;flex-direction:column;gap:6px;width:100%;max-width:22rem;margin:4px auto}',
  '.board div{display:flex;justify-content:space-between;padding:8px 14px;border-radius:10px;background:#10152a;font-weight:700}',
  '.board div.win{background:#fde047;color:#0b0d14}',
  '.round-pts{font-size:42px;font-weight:900;color:#fde047;line-height:1}'
].join('');

const SVGNS = 'http://www.w3.org/2000/svg';

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Midpoint displacement: the jagged path a bolt takes between two points.
function jag(x1, y1, x2, y2, depth, spread) {
  let pts = [[x1, y1], [x2, y2]];
  for (let d = 0; d < depth; d++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const off = (Math.random() - 0.5) * spread / (d + 1);
      next.push([(a[0] + b[0]) / 2 - dy / len * off, (a[1] + b[1]) / 2 + dx / len * off]);
      next.push(b);
    }
    pts = next;
  }
  return pts;
}

function pathOf(pts) {
  return 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L');
}

export function mount(root, api) {
  root.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'f';
  wrap.innerHTML = '<div class="top"><span class="who"></span><span class="clock"></span>' +
    '<button class="mute" type="button" aria-label="sound">🔊</button></div>' +
    '<div class="stage"></div><div class="vig"></div><div class="flash"></div><div class="toast"></div>';
  root.appendChild(wrap);

  const whoEl = wrap.querySelector('.who');
  const clockEl = wrap.querySelector('.clock');
  const stage = wrap.querySelector('.stage');
  const vig = wrap.querySelector('.vig');
  const flashEl = wrap.querySelector('.flash');
  const toastEl = wrap.querySelector('.toast');
  const muteBtn = wrap.querySelector('.mute');

  let view = null;
  let myId = (api.me && api.me.id) || '';
  let skew = 0;                 // host clock minus ours; every timer runs on host time
  let skewEpoch = -1;
  let dead = false;
  let running = false;
  let rafId = null;
  let joined = false;
  let curKey = '';
  let cur = null;
  let muted = false;
  let ac = null;
  let toastTimer = null;
  let pumpTimer = null;
  const asked = {};
  const setT = api.setTimeout || setTimeout;
  const setI = api.setInterval || setInterval;

  function hostNow() { return Date.now() + skew; }

  function rosterName(id) {
    const list = (view && view.roster) || api.roster || [];
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i].name;
    if (id === myId) return (api.me && api.me.name) || 'You';
    return 'A player';
  }
  function colorOf(id) {
    const s = (view && view.round && view.round.streamers) || [];
    const i = s.indexOf(id);
    return COLORS[(i < 0 ? 0 : i) % COLORS.length];
  }
  function seated() { return !!view && view.players.indexOf(myId) >= 0; }

  // ---- sound: a few synthesized blips, started from the player's own taps ----
  function audio() {
    if (muted) return null;
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      return ac;
    } catch (e) { return null; }
  }
  function tone(freq, dur, type, vol, to) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, a.currentTime);
    if (to) o.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur + 0.02);
  }
  function crack(dur, vol) {
    const a = audio(); if (!a) return;
    const n = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const s = a.createBufferSource(); s.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(7000, a.currentTime);
    f.frequency.exponentialRampToValueAtTime(300, a.currentTime + dur);
    const g = a.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(a.destination); s.start();
  }
  function sndTick() { tone(920, 0.05, 'square', 0.035); }
  function sndBuzz() { tone(120, 0.2, 'sawtooth', 0.07, 70); }
  function sndZap(p) { crack(0.35 + 0.1 * p, Math.min(0.5, 0.22 * p)); tone(70, 0.45, 'sine', 0.25, 28); }

  muteBtn.addEventListener('click', function () {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });

  // ---- screen effects ----
  function flash(p) {
    flashEl.style.transition = 'none';
    flashEl.style.opacity = String(Math.min(0.8, 0.3 * p));
    void flashEl.offsetWidth;
    flashEl.style.transition = 'opacity .45s ease-out';
    flashEl.style.opacity = '0';
  }
  function shake(p) {
    wrap.style.setProperty('--sh', (3 * p) + 'px');
    wrap.classList.remove('shk');
    void wrap.offsetWidth;
    wrap.classList.add('shk');
  }
  function toast(text) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = text;
    toastEl.classList.add('show');
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); toastTimer = null; }, 1500);
  }
  function ask(kind) {
    const n = Date.now();
    if (n - (asked[kind] || 0) < 700) return;
    asked[kind] = n;
    if (seated()) api.send({ a: kind });
  }

  // ---- simple screens: re-rendered from the view on every update ----
  function simple(render) {
    return {
      update: function (v) {
        const sc = stage.querySelector('.scroll');
        const top = sc ? sc.scrollTop : 0;
        stage.innerHTML = render(v);
        const sc2 = stage.querySelector('.scroll');
        if (sc2) sc2.scrollTop = top;
      }
    };
  }

  stage.addEventListener('click', function (e) {
    const t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t || !view || dead) return;
    const act = t.getAttribute('data-act');
    if (act === 'start') api.send({ a: 'start' });
    else if (act === 'next') api.send({ a: 'next' });
    else if (act === 'vote') api.send({ a: 'vote', n: Number(t.getAttribute('data-n')), yes: t.getAttribute('data-yes') === '1' });
  });

  function namesHtml(ids) {
    return '<div class="names">' + ids.map(function (id) {
      return '<span class="nm' + (id === myId ? ' you' : '') + '">' + esc(rosterName(id)) + '</span>';
    }).join('') + '</div>';
  }

  function lobbyScreen() {
    return simple(function (v) {
      if (v.mode === 'solo-streamer') {
        return '<div class="center"><h1>FUGUE: SOLO</h1>' +
          '<p class="rules"><b>Timed Streaming</b>: Get a secret prompt and lock a word every <b>3 seconds</b> — type it, hit space. ' +
          'Practice your streaming solo against the clock.</p>' +
          namesHtml(v.players) +
          '<button class="btn" data-act="start">Start solo game</button></div>';
      }
      const n = v.players.length;
      const host = v.hostId === myId;
      const can = host && n >= MIN_PLAYERS;
      return '<div class="center"><h1>FUGUE</h1>' +
        '<p class="rules"><b>Streamers</b> each get a secret prompt and must lock a word every <b>3 seconds</b> — type it, hit space. ' +
        'The <b>Connectionist</b> sees every word and strikes <b>lightning</b> between streams: links that fit a relation which changes after every strike. ' +
        'Straight-down links and links across more streams score more. Streamers then vote on each link. ' +
        'Everyone takes a turn connecting.</p>' +
        namesHtml(v.players) +
        (v.late.length ? '<p class="note">' + v.late.length + ' joining next set</p>' : '') +
        '<button class="btn" data-act="start"' + (can ? '' : ' disabled') + '>Start set</button>' +
        '<p class="note">' + (n < MIN_PLAYERS ? 'Needs ' + MIN_PLAYERS + ' players — ' + n + ' here.' : (host ? n + ' at the table — everyone connects once.' : 'Waiting for the host to start.')) + '</p></div>';
    });
  }

  function introScreen() {
    return simple(function (v) {
      const r = v.round;
      let body;
      if (v.role === 'stream') {
        body = '<h2>you are a streamer</h2><div class="big" style="color:' + colorOf(myId) + '">' + esc(r.prompts[myId]) + '</div>' +
          '<p class="rules">Type a word, press <b>space</b> to lock it. A new word is due every 3 seconds — if you stall, whatever you have typed locks anyway. ' +
          'Tap the box to bring up your keyboard.</p>';
      } else if (v.role === 'conn') {
        body = '<h2>you are the connectionist</h2><div class="big">Find what the streams share</div>' +
          '<p class="rules">Tap one word in each stream, then it strikes. The relation changes after every strike. Words can be used once. ' +
          'Straight down counts double.</p>' + namesHtml(r.streamers);
      } else {
        body = '<h2>watching</h2><div class="big">' + esc(rosterName(r.conn)) + ' connects</div>';
      }
      return '<div class="center">' + body + '<div class="count">&nbsp;</div></div>';
    });
  }

  function chipHtml(link, i) {
    const p = link.picks[i];
    const w = ((view.round.words[p.s] || [])[p.i]) || '';
    return '<span class="chip" style="--c:' + colorOf(p.s) + '">' + esc(w) + '</span>';
  }
  function pairHtml(link) {
    const parts = [];
    for (let i = 0; i < link.picks.length; i++) parts.push(chipHtml(link, i));
    return '<div class="pair">' + parts.join('<em>⟷</em>') + '</div>';
  }
  function ptsOf(l) { return l.weight * (l.vertical ? 2 : 1); }
  function promptList(v) {
    const r = v.round;
    return '<div class="plist">' + r.streamers.map(function (id) {
      return '<div style="--c:' + colorOf(id) + '"><i>' + esc(rosterName(id)) + '</i><span>' + esc(r.prompts[id] || '') + '</span></div>';
    }).join('') + '</div>';
  }

  function voteScreen() {
    return simple(function (v) {
      const r = v.round;
      const isS = v.role === 'stream';
      const cards = r.links.map(function (l) {
        const mine = r.votes[l.n] ? r.votes[l.n][myId] : undefined;
        const btns = isS
          ? '<div class="vb"><button class="y' + (mine === true ? ' on' : '') + '" data-act="vote" data-n="' + l.n + '" data-yes="1">✓ fits</button>' +
            '<button class="n' + (mine === false ? ' on' : '') + '" data-act="vote" data-n="' + l.n + '" data-yes="0">✗ no</button></div>' : '';
        return '<div class="card">' + pairHtml(l) + '<div class="meta"><span class="r">' + esc(relOf(l.rel).name) + '</span>' +
          '<span>+' + ptsOf(l) + (l.vertical ? ' · straight down' : '') + (l.weight > 1 ? ' · ' + (l.weight + 1) + ' streams' : '') + '</span></div>' + btns + '</div>';
      }).join('');
      return '<div class="scroll"><div class="vhead"><b>' + (isS ? 'Does each link fit its relation?' : 'The streamers are voting') + '</b>' +
        '<small>' + esc(rosterName(r.conn)) + ' struck ' + r.links.length + (r.links.length === 1 ? ' link' : ' links') + ' · ' + r.cast + '/' + r.castTotal + ' votes in</small></div>' +
        promptList(v) + cards + '</div>';
    });
  }

  function scoreBoard(v) {
    const ids = v.players.slice().sort(function (a, b) { return (v.scores[b] || 0) - (v.scores[a] || 0); });
    const top = ids.length ? (v.scores[ids[0]] || 0) : 0;
    return '<div class="board">' + ids.map(function (id) {
      return '<div' + ((v.scores[id] || 0) === top && top > 0 ? ' class="win"' : '') + '><span>' + esc(rosterName(id)) + (id === myId ? ' (you)' : '') + '</span><span>' + (v.scores[id] || 0) + '</span></div>';
    }).join('') + '</div>';
  }

  function tallyScreen() {
    return simple(function (v) {
      const r = v.round;
      const res = r.result || { points: 0, rows: [] };
      const cards = res.rows.map(function (row) {
        let link = null;
        r.links.forEach(function (l) { if (l.n === row.n) link = l; });
        if (!link) return '';
        return '<div class="card' + (row.stands ? '' : ' no') + '">' + pairHtml(link) + '<div class="meta"><span class="r">' + esc(relOf(link.rel).name) +
          '</span><span class="stamp ' + (row.stands ? 'ok' : 'bad') + '">' + (row.stands ? '+' + row.pts : 'no') + ' · ' + row.yes + '–' + row.no + '</span></div></div>';
      }).join('');
      const host = v.hostId === myId;
      return '<div class="scroll"><div class="vhead"><small>' + esc(rosterName(r.conn)) + ' connected</small>' +
        '<div class="round-pts">+' + res.points + '</div>' +
        (r.aborted ? '<small>round called off — someone left</small>' : '') + '</div>' + cards + scoreBoard(v) +
        '<div style="text-align:center;margin-top:10px">' +
        (host ? '<button class="btn" data-act="next">Next round</button>' : '<p class="note">Next round starts on its own.</p>') +
        '</div></div>';
    });
  }

  function overScreen() {
    return simple(function (v) {
      if (v.mode === 'solo-streamer') {
        const count = v.over ? v.over.count : 0;
        return '<div class="center"><h2>round complete</h2><div class="big">You locked ' + count + (count === 1 ? ' word' : ' words') + '</div>' +
          '<button class="btn" data-act="start">Play again</button></div>';
      }
      const o = v.over || { winners: [], top: 0 };
      const host = v.hostId === myId;
      const heading = o.winners.length > 1 ? 'tied' : 'wins';
      return '<div class="center"><h2>set complete</h2><div class="big">' + o.winners.map(function (id) { return esc(rosterName(id)); }).join(' & ') +
        ' ' + heading + '</div>' + scoreBoard(v) +
        '<button class="btn" data-act="start"' + (host ? '' : ' disabled') + '>' + (host ? 'Play again' : 'Waiting for host') + '</button></div>';
    });
  }

  // ---- streamer screen: the email-address field ----
  function streamScreen(v0) {
    const color = colorOf(myId);
    stage.innerHTML = '<div class="prompt"><small>your stream</small><b></b></div>' +
      '<div class="field" style="--c:' + color + '"></div><div class="bar"><i></i></div>' +
      '<div class="foot"><span class="cnt"></span><span class="zaps"></span></div>';
    stage.querySelector('.prompt b').textContent = v0.round.prompts[myId] || '';
    const field = stage.querySelector('.field');
    const bar = stage.querySelector('.bar i');
    const cnt = stage.querySelector('.cnt');
    const zaps = stage.querySelector('.zaps');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.autocomplete = 'off';
    inp.autocapitalize = 'off';
    inp.spellcheck = false;
    inp.maxLength = MAX_LEN + 2;
    inp.placeholder = 'type a word, then space';
    inp.setAttribute('autocorrect', 'off');
    inp.setAttribute('enterkeyhint', 'send');
    field.appendChild(inp);
    field.addEventListener('pointerdown', function () { setT(function () { inp.focus(); }, 0); });

    let sent = [];                // words we locked, shown at once; the view confirms them
    let deadline = v0.round.introEndsAt + WORD_MS;
    let chips = [];
    let lastLinks = v0.round.linkCount;
    setT(function () { inp.focus(); }, 0);

    function lock(raw, forced) {
      if (dead || !view || view.phase !== 'live') return;
      if (hostNow() >= view.round.endsAt) return;
      const w = cleanWord(raw);
      sent.push(w);
      deadline = hostNow() + WORD_MS;
      api.send({ a: 'word', w: w });
      if (forced && !w) sndBuzz(); else sndTick();
      drawChips();
    }

    function onInput() {
      for (let guard = 0; guard < 6; guard++) {
        const v = inp.value;
        const m = v.search(/[\s,]/);
        if (m < 0) return;
        const rest = v.slice(m + 1).replace(/^[\s,]+/, '');
        const w = v.slice(0, m);
        inp.value = rest;
        if (w) lock(w, false);          // a space on an empty box does nothing
      }
    }
    inp.addEventListener('input', onInput);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (inp.value.trim()) { const w = inp.value; inp.value = ''; lock(w, false); } }
    });

    function drawChips() {
      const mine = (view && view.round.words[myId]) || [];
      if (mine.length > sent.length) sent = mine.slice();
      const show = mine.concat(sent.slice(mine.length));
      const usedSet = {};
      ((view && view.round.mineUsed) || []).forEach(function (i) { usedSet[i] = true; });
      let grew = false;
      while (chips.length < show.length) {
        const el = document.createElement('span');
        el.className = 'chip';
        field.insertBefore(el, inp);
        chips.push(el);
        grew = true;
      }
      for (let i = 0; i < show.length; i++) {
        const w = show[i];
        if (chips[i].textContent !== (w || '·')) chips[i].textContent = w || '·';
        chips[i].classList.toggle('blank', !w);
        chips[i].classList.toggle('used', !!usedSet[i]);
      }
      cnt.textContent = show.length + (show.length === 1 ? ' word' : ' words');
      if (grew) field.scrollTop = field.scrollHeight;
    }

    return {
      update: function (v) {
        drawChips();
        zaps.textContent = v.round.linkCount ? '⚡ ' + v.round.linkCount : '';
        if (v.round.linkCount > lastLinks) { flash(0.4); sndZap(0.5); }
        lastLinks = v.round.linkCount;
      },
      // A stall locks whatever is typed — even half a word, even nothing.
      force: function () {
        if (!view || view.phase !== 'live' || hostNow() < deadline) return;
        const w = inp.value;
        inp.value = '';
        lock(w, true);
      },
      frame: function () {
        const left = deadline - hostNow();
        const frac = Math.max(0, Math.min(1, left / WORD_MS));
        bar.style.transform = 'scaleX(' + frac + ')';
        bar.style.background = 'hsl(' + Math.round(130 * frac) + ',85%,52%)';
        const heat = Math.pow(1 - frac, 2);
        vig.style.boxShadow = 'inset 0 0 ' + Math.round(40 + heat * 110) + 'px ' + Math.round(heat * 24) + 'px rgba(248,113,113,' + (heat * 0.6).toFixed(2) + ')';
        field.classList.toggle('jit', left < 900);
      },
      denied: function () { const mine = (view && view.round.words[myId]) || []; sent = mine.slice(); drawChips(); },
      destroy: function () { vig.style.boxShadow = 'none'; }
    };
  }

  // ---- connectionist screen: the lanes, the lightning, the relation ----
  function connScreen(v0) {
    const canAct = v0.role === 'conn';
    const S = v0.round.streamers.slice();
    stage.innerHTML = '<div class="lanes"><div class="cols"><svg class="bolts"><g class="scars"></g><g class="strikes"></g></svg></div></div>' +
      (canAct
        ? '<div class="rel"><div class="nameb"><small>RELATION</small><b></b><span class="h"></span></div><div class="chain"></div></div>' +
          '<div class="act"><div class="selinfo"></div>' + (S.length > 2 ? '<button class="zap" type="button">⚡ LINK</button>' : '') + '</div>'
        : '<div class="rel watch">👁 watching — ' + esc(rosterName(v0.round.conn)) + ' is connecting</div>');
    const lanes = stage.querySelector('.lanes');
    const cols = stage.querySelector('.cols');
    const svg = stage.querySelector('.bolts');
    const scars = svg.querySelector('.scars');
    const strikes = svg.querySelector('.strikes');
    const relB = stage.querySelector('.rel b');
    const relH = stage.querySelector('.rel .h');
    const chainEl = stage.querySelector('.chain');
    const selInfo = stage.querySelector('.selinfo');
    const zapBtn = stage.querySelector('.zap');

    // label column
    const lab = document.createElement('div');
    lab.className = 'col lab';
    S.forEach(function (s) {
      const c = document.createElement('div');
      c.className = 'cell lab';
      c.style.setProperty('--c', colorOf(s));
      c.innerHTML = '<span>' + esc(rosterName(s)) + '</span>';
      lab.appendChild(c);
    });
    cols.insertBefore(lab, svg);

    const cells = {};            // streamer id -> [cell elements by word index]
    S.forEach(function (s) { cells[s] = []; });
    const colEls = [];
    const sel = {};              // streamer id -> chosen word index
    const pend = {};             // words sent in a link the host has not confirmed yet
    let lastLinks = -1;
    let streak = 0;
    let streakUntil = 0;
    let lastRel = '';

    function addCol() {
      const col = document.createElement('div');
      col.className = 'col';
      S.forEach(function (s) {
        const c = document.createElement('div');
        c.className = 'cell';
        c.innerHTML = '<span class="ghost"></span>';
        col.appendChild(c);
        cells[s].push(c);
      });
      cols.insertBefore(col, svg);
      colEls.push(col);
    }

    function usedMap(r) {
      const u = {};
      r.links.forEach(function (l) { l.picks.forEach(function (p) { u[p.s + '|' + p.i] = true; }); });
      return u;
    }

    function drawSel() {
      let n = 0;
      const words = [];
      S.forEach(function (s) {
        const b = cells[s].map(function (c) { return c.firstChild; });
        b.forEach(function (el, i) {
          if (el && el.classList && el.classList.contains('b')) el.classList.toggle('sel', sel[s] === i);
        });
        if (sel[s] !== undefined) { n++; words.push(view.round.words[s][sel[s]]); }
      });
      colEls.forEach(function (col, k) {
        let hot = false;
        S.forEach(function (s) { if (sel[s] === k) hot = true; });
        col.classList.toggle('hot', hot);
      });
      if (selInfo) selInfo.textContent = n ? words.join(' ⟷ ') : 'tap a word in each stream';
      if (zapBtn) zapBtn.disabled = n < 2;
      return n;
    }

    function fire() {
      const picks = [];
      S.forEach(function (s) { if (sel[s] !== undefined) picks.push({ s: s, i: sel[s] }); });
      if (picks.length < 2) return;
      picks.forEach(function (p) { pend[p.s + '|' + p.i] = true; sel[p.s] = undefined; });
      api.send({ a: 'link', picks: picks });
      drawSel();
      paint();
    }

    if (canAct) {
      lanes.addEventListener('click', function (e) {
        const b = e.target.closest ? e.target.closest('.b') : null;
        if (!b || !view || view.phase !== 'live') return;
        if (b.classList.contains('used') || b.classList.contains('blank')) return;
        const s = b.getAttribute('data-s');
        const i = Number(b.getAttribute('data-i'));
        if (pend[s + '|' + i]) return;
        sel[s] = sel[s] === i ? undefined : i;
        sndTick();
        const n = drawSel();
        if (n >= 2 && n === S.length) fire();
      });
      if (zapBtn) zapBtn.addEventListener('click', fire);
    }

    function paint() {
      const r = view.round;
      const used = usedMap(r);
      S.forEach(function (s) {
        const list = r.words[s] || [];
        for (let i = 0; i < list.length; i++) {
          const cell = cells[s][i];
          if (!cell) continue;
          let b = cell.querySelector('.b');
          if (!b) {
            cell.innerHTML = '';
            b = document.createElement('button');
            b.type = 'button';
            b.className = 'b' + (list[i] ? '' : ' blank');
            b.style.setProperty('--c', colorOf(s));
            b.setAttribute('data-s', s);
            b.setAttribute('data-i', String(i));
            b.textContent = list[i] || '·';
            cell.appendChild(b);
          }
          b.classList.toggle('used', !!(used[s + '|' + i] || pend[s + '|' + i]));
        }
      });
    }

    function center(el) {
      if (!el) return null;
      const a = el.getBoundingClientRect(), c = cols.getBoundingClientRect();
      return [a.left - c.left + a.width / 2, a.top - c.top + a.height / 2];
    }

    function redrawScars() {
      while (scars.firstChild) scars.removeChild(scars.firstChild);
      view.round.links.forEach(function (l) {
        for (let i = 0; i < l.picks.length - 1; i++) {
          const a = center(cells[l.picks[i].s][l.picks[i].i]);
          const b = center(cells[l.picks[i + 1].s][l.picks[i + 1].i]);
          if (!a || !b) continue;
          const ln = document.createElementNS(SVGNS, 'line');
          ln.setAttribute('x1', a[0]); ln.setAttribute('y1', a[1]);
          ln.setAttribute('x2', b[0]); ln.setAttribute('y2', b[1]);
          ln.setAttribute('stroke', l.vertical ? '#fde047' : '#7dd3fc');
          ln.setAttribute('stroke-opacity', l.vertical ? '.55' : '.3');
          ln.setAttribute('stroke-width', l.vertical ? '2' : '1.2');
          ln.setAttribute('stroke-dasharray', '3 4');
          scars.appendChild(ln);
        }
      });
    }

    function addPath(g, pts, w, op, col) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', pathOf(pts));
      p.setAttribute('stroke-width', w);
      p.setAttribute('stroke-opacity', op);
      p.setAttribute('stroke', col);
      g.appendChild(p);
    }

    // Each strike gets thicker, branchier and louder while links keep coming.
    function strike(link) {
      const pts = [];
      link.picks.forEach(function (p) { const c = center(cells[p.s][p.i]); if (c) pts.push(c); });
      if (pts.length < 2) return;
      const power = 1 + Math.min(streak, 5) * 0.35;
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'bolt');
      let main = [];
      for (let i = 0; i < pts.length - 1; i++) main = main.concat(jag(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 5, 50 * power));
      addPath(g, main, 10 * power, 0.28, '#38bdf8');
      addPath(g, main, 4, 0.85, '#bae6fd');
      addPath(g, main, 1.6, 1, '#ffffff');
      const forks = 2 + Math.round(power * 2);
      for (let f = 0; f < forks; f++) {
        const base = main[Math.floor(Math.random() * main.length)];
        const ang = Math.random() * Math.PI * 2;
        const len = 40 + Math.random() * 70 * power;
        const seg = jag(base[0], base[1], base[0] + Math.cos(ang) * len, base[1] + Math.sin(ang) * len, 4, 30);
        addPath(g, seg, 3, 0.55, '#7dd3fc');
        addPath(g, seg, 1, 0.9, '#ffffff');
      }
      strikes.appendChild(g);
      setT(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 800);
      flash(power * (link.vertical ? 1.3 : 1));
      shake(power * (link.vertical ? 1.4 : 1));
      sndZap(power);
      try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) { /* no haptics */ }
    }

    function drawRel(rel, snapIt) {
      if (!relB) return;
      const r = relOf(rel);
      relB.textContent = r.name;
      relH.textContent = r.hint + ' · ' + r.ex;
      if (snapIt) { relB.classList.remove('snap'); void relB.offsetWidth; relB.classList.add('snap'); }
    }

    return {
      update: function (v) {
        const r = v.round;
        let K = 0;
        S.forEach(function (s) { K = Math.max(K, (r.words[s] || []).length); });
        const atEnd = lanes.scrollLeft + lanes.clientWidth >= lanes.scrollWidth - 160;
        const grew = K > colEls.length;
        while (colEls.length < K) addCol();
        // Confirmed links release their pending marks.
        if (lastLinks >= 0 && r.links.length > lastLinks) { Object.keys(pend).forEach(function (k) { delete pend[k]; }); }
        paint();
        if (grew && atEnd) lanes.scrollLeft = lanes.scrollWidth;
        if (canAct) drawSel();
        redrawScars();
        if (lastLinks >= 0 && r.links.length > lastLinks) {
          r.links.slice(lastLinks).forEach(function (l) {
            streak = (hostNow() < streakUntil) ? streak + 1 : 0;
            streakUntil = hostNow() + STREAK_MS;
            strike(l);
          });
          if (canAct && r.rel) drawRel(r.rel, true);
        } else if (canAct && r.rel && r.rel !== lastRel) drawRel(r.rel, false);
        lastRel = r.rel;
        lastLinks = r.links.length;
      },
      frame: function () {
        if (!chainEl) return;
        if (streak && hostNow() > streakUntil) streak = 0;
        chainEl.textContent = streak ? '×' + (streak + 1) : '';
      },
      denied: function () { Object.keys(pend).forEach(function (k) { delete pend[k]; }); if (view) paint(); },
      destroy: function () {}
    };
  }

  // ---- routing ----
  function screenName(v) {
    if (v.mode === 'solo-streamer') {
      const ph = v.phase;
      if (ph === 'lobby') return 'lobby';
      if (ph === 'over') return 'over';
      return 'stream';
    }
    const ph = v.phase;
    if (ph === 'lobby') return 'lobby';
    if (ph === 'over') return 'over';
    if (ph === 'intro') return 'intro';
    if (ph === 'live') return v.role === 'stream' ? 'stream' : 'conn';
    if (ph === 'vote') return 'vote';
    return 'tally';
  }

  function route() {
    const name = screenName(view);
    const key = name + ':' + view.epoch + ':' + view.setNo + ':' + view.role;
    if (key !== curKey) {
      if (cur && cur.destroy) cur.destroy();
      vig.style.boxShadow = 'none';
      curKey = key;
      if (name === 'lobby') cur = lobbyScreen();
      else if (name === 'over') cur = overScreen();
      else if (name === 'intro') cur = introScreen();
      else if (name === 'stream') cur = streamScreen(view);
      else if (name === 'conn') cur = connScreen(view);
      else if (name === 'vote') cur = voteScreen();
      else cur = tallyScreen();
    }
    cur.update(view);
  }

  function topbar() {
    const v = view;
    if (v.mode === 'solo-streamer') {
      whoEl.textContent = 'Fugue Solo · Streamer';
      clockEl.textContent = '';
      return;
    }
    if (v.phase === 'lobby' || v.phase === 'over') { whoEl.textContent = 'Fugue'; clockEl.textContent = ''; return; }
    const r = v.round;
    const rd = 'Round ' + (v.roundIdx + 1) + '/' + v.roundsTotal;
    let who;
    if (v.role === 'conn') who = 'you connect';
    else if (v.role === 'stream') who = 'you stream · ' + rosterName(r.conn) + ' connects';
    else who = rosterName(r.conn) + ' connects';
    whoEl.textContent = rd + ' · ' + who;
  }

  function clockTick() {
    if (!view) return;
    if (view.mode === 'solo-streamer') {
      if (view.phase !== 'live' || !view.round) { clockEl.textContent = ''; clockEl.classList.remove('hot'); return; }
      const t = hostNow();
      const left = Math.max(0, Math.ceil((view.round.endsAt - t) / 1000));
      clockEl.textContent = left + 's';
      clockEl.classList.toggle('hot', left <= 10);
      return;
    }
    if (!view.round) return;
    const r = view.round;
    const t = hostNow();
    let end = 0;
    if (view.phase === 'live') end = r.endsAt;
    else if (view.phase === 'vote') end = r.voteEndsAt;
    else if (view.phase === 'tally') end = r.tallyEndsAt;
    if (!end) { clockEl.textContent = ''; clockEl.classList.remove('hot'); return; }
    const left = Math.max(0, Math.ceil((end - t) / 1000));
    clockEl.textContent = left + 's';
    clockEl.classList.toggle('hot', view.phase === 'live' && left <= 10);
    if (view.phase === 'intro') {
      const c = stage.querySelector('.count');
      if (c) { const n = Math.ceil((r.introEndsAt - t) / 1000); c.textContent = n <= 3 && n > 0 ? String(n) : '\u00a0'; }
    }
  }

  function frame() {
    rafId = null;
    if (dead || !view) return;
    if (view.phase === 'intro') {
      const c = stage.querySelector('.count');
      if (c) { const n = Math.ceil((view.round.introEndsAt - hostNow()) / 1000); c.textContent = n <= 3 && n > 0 ? String(n) : '\u00a0'; }
    }
    clockTick();
    if (cur && cur.frame) cur.frame();
    if (cur && cur.force) cur.force();
    if (running && view.phase !== 'lobby' && view.phase !== 'over') rafId = api.raf(frame);
    else running = false;
  }

  function startLoop() {
    if (dead || running) return;
    running = true;
    rafId = api.raf(frame);
  }
  function stopLoop() {
    running = false;
    if (rafId !== null) { api.cancelRaf(rafId); rafId = null; }
  }

  // Phase changes are asked for by every seated client against the host's
  // clock; reduce() is idempotent, so the first ask wins and the rest no-op.
  // This runs on a timer, not a frame, so a hidden tab still moves the game on.
  function pump() {
    if (dead || !view) return;
    if (view.mode === 'solo-streamer') {
      const t = hostNow();
      if (view.phase === 'live' && view.round && t >= view.round.endsAt) ask('finish');
      return;
    }
    if (!view.round) return;
    const r = view.round;
    const t = hostNow();
    if (view.phase === 'intro' && t >= r.introEndsAt) ask('go');
    else if (view.phase === 'live' && t >= r.endsAt) ask('finish');
    else if (view.phase === 'vote' && t >= r.voteEndsAt) ask('close');
    else if (view.phase === 'tally' && t >= r.tallyEndsAt) ask('next');
    if (cur && cur.force) cur.force();
  }
  pumpTimer = setI(pump, 250);

  function syncSkew(next) {
    if (typeof next.at !== 'number') return;
    const s = next.at - Date.now();
    // Latency only ever makes a snapshot look older, so the largest offset seen is the truest.
    if (next.epoch !== skewEpoch) { skewEpoch = next.epoch; skew = s; }
    else if (s > skew) skew = s;
  }

  return {
    update: function (next) {
      if (dead || !next) return;
      view = next;
      if (typeof next.you === 'string' && next.you) myId = next.you;
      syncSkew(next);
      route();
      topbar();
      clockTick();
      if (next.phase === 'lobby' || next.phase === 'over') stopLoop(); else startLoop();
      if (!joined && !api.isSpectator) { joined = true; api.send({ a: 'join' }); }
    },
    denied: function (text) {
      if (dead) return;
      toast(String(text || 'The host refused that.'));
      if (cur && cur.denied) cur.denied();
    },
    destroy: function () {
      dead = true;
      stopLoop();
      if (pumpTimer !== null) clearInterval(pumpTimer);
      if (cur && cur.destroy) cur.destroy();
      try { if (ac && ac.close) ac.close(); } catch (e) { /* already closed */ }
    }
  };
}
