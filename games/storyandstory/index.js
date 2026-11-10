// games/storyandstory/index.js
//
// The Story & the Story. Two teams write two stories in alternation, each team
// steering both stories toward its own secret theme. When a game is finished,
// its stories and themes are filed to an archive (a Google Doc behind an Apps
// Script web app). At the start of a game, the table reads the stories from two
// games ago, votes blind on which theme each story serves better, and records
// the verdict.
//
// Module contract: meta, init, reduce, project, mount, summarize, roundId, prune.
// Every state change goes through reduce(). The network is used only for the
// archive, and only by the client that holds the data it files: the host fetches
// the old stories and posts verdicts; each team's own members file their team's
// theme, which no other team's client ever receives.

import content from './content.mjs';

const STARTERS = (content && Array.isArray(content.starterSentences)) ? content.starterSentences : [];
const THEMES = (content && Array.isArray(content.themes)) ? content.themes : [];

function pickPair(list, rnd) {
  if (!list.length) return ['', ''];
  if (list.length === 1) return [list[0], list[0]];
  const i = Math.floor(rnd() * list.length);
  let j = Math.floor(rnd() * (list.length - 1));
  if (j >= i) j += 1;
  return [list[i], list[j]];
}

const SENTENCES = 8;        // per story, opening sentence included
const SETUP_SECONDS = 180;  // the table's clock: displayed, not enforced
const WRITE_SECONDS = 90;   // per sentence: displayed, not enforced
const MAX_SENTENCE = 300;
const MAX_THEME = 120;
const MAX_IDEA = 200;
const MAX_IDEAS = 12;
const MAX_PLAYERS = 8;
const FETCH_MS = 8000;

export const meta = {
  id: 'storyandstory',
  title: 'The Story & the Story',
  players: '2-8',
  color: '#f4d35e',
  icon: '📜',
  desc: 'Two teams write two stories, each steering them toward a secret theme. Two games later, a table judges them.',
};

// ---------- pure helpers ----------

function archiveUrl() {
  return (typeof globalThis !== 'undefined' && globalThis.BUB_STORY_ARCHIVE) || '';
}

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

const isStoryId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 80;

// One sentence per turn: an internal sentence break followed by more text is refused.
function oneSentence(raw) {
  const text = clean(raw);
  if (!text) return { error: 'Write a sentence first.' };
  if (text.length > MAX_SENTENCE) return { error: `Keep it under ${MAX_SENTENCE} characters.` };
  if (!/\p{L}/u.test(text)) return { error: 'That does not look like a sentence.' };
  if (/[.!?…]["'”’)\]]*\s+\S/.test(text)) return { error: 'One sentence per turn.' };
  return { text };
}

// Seats alternate between the two teams, so the table splits as evenly as it can.
function teamsFor(players) {
  const teams = [[], []];
  players.forEach((id, i) => teams[i % 2].push(id));
  return teams;
}

function teamOf(state, id) {
  if (!state.teams || !id) return -1;
  if (state.teams[0].indexOf(id) >= 0) return 0;
  if (state.teams[1].indexOf(id) >= 0) return 1;
  return -1;
}

// Team t writes sentence k (1-based) into this story. Team 0 opens story 0 and
// team 1 opens story 1; after that the stories alternate, so each round both
// teams write once, into the story they were just handed.
const storyFor = (t, k) => (((t - (k - 1)) % 2) + 2) % 2;

// The designated writer for team t and sentence k rotates through the team in seat order.
function writerOf(state, t, k) {
  const team = state.teams[t];
  return team.length ? team[(k - 1) % team.length] : null;
}

function validEntry(e) {
  return !!e && typeof e.id === 'string' && Array.isArray(e.stories) && e.stories.length === 2
    && e.stories.every((s) => Array.isArray(s) && s.length === SENTENCES
      && s.every((x) => typeof x === 'string'))
    && Array.isArray(e.themes) && e.themes.length === 2
    && e.themes.every((t) => typeof t === 'string' && t.length > 0);
}

function fullyVoted(state, id) {
  const v = state.judge.votes[id];
  return !!v && v[0] != null && v[1] != null;
}

// Each story goes to the theme with more votes for it. Points decide; if the
// points are level, total votes across both stories decide; if that is level
// too, the previous game is a draw (winner null).
function tally(state) {
  const counts = [[0, 0], [0, 0]];
  state.players.forEach((p) => {
    const v = state.judge.votes[p] || [null, null];
    for (let s = 0; s < 2; s += 1) {
      if (v[s] === 0 || v[s] === 1) counts[s][v[s]] += 1;
    }
  });
  const points = [0, 0];
  for (let s = 0; s < 2; s += 1) {
    if (counts[s][0] > counts[s][1]) points[0] += 1;
    else if (counts[s][1] > counts[s][0]) points[1] += 1;
  }
  const totals = [counts[0][0] + counts[1][0], counts[0][1] + counts[1][1]];
  let winner = null;
  if (points[0] !== points[1]) winner = points[0] > points[1] ? 0 : 1;
  else if (totals[0] !== totals[1]) winner = totals[0] > totals[1] ? 0 : 1;
  return { counts, points, totals, winner };
}

function reveal(state) {
  return {
    ...state,
    phase: 'verdict',
    verdict: { judgedId: state.judge.id, themes: state.judge.themes.slice(), ...tally(state) },
  };
}

// Called after every sentence and every theme seal. Moves the table on once
// both stories have reached the current round.
function advance(st) {
  const k = st.round;
  if (!st.stories.every((s) => s.length >= k)) return st;
  if (st.phase === 'setup') {
    if (!st.themes.every(Boolean)) return st;
    return { ...st, phase: 'writing', round: 2 };
  }
  if (k >= SENTENCES) return { ...st, phase: 'over' };
  return { ...st, round: k + 1 };
}

function fresh(players, names, archive) {
  return {
    phase: 'lobby', gid: null, round: 1, archive,
    players: players.slice(), names: { ...names }, teams: null,
    themes: [null, null],
      defaultThemes: [THEMES[0] || '', THEMES[1] || ''],
      starters: [STARTERS[0] || '', STARTERS[1] || ''],
      stories: [[], []], ideas: [[], []],
    judge: null, verdict: null, notice: '',
  };
}

// ---------- contract ----------

export function init(ctx) {
  const players = [];
  const names = {};
  ((ctx && ctx.atTable) || []).forEach((p) => {
    if (!p || !isStoryId(p.id) || players.indexOf(p.id) >= 0 || players.length >= MAX_PLAYERS) return;
    players.push(p.id);
    names[p.id] = p.name || 'player';
  });
  return fresh(players, names, !!archiveUrl());
}

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const id = from.id || '';
  const host = !!from.host;
  const seated = state.players.indexOf(id) >= 0;
  const rnd = ctx && typeof ctx.rng === 'function' ? ctx.rng : Math.random;
  const a = action && action.a;

  switch (a) {
    case 'join': {
      if (state.phase !== 'lobby') return { error: 'A game is under way. Join when the next one starts.' };
      if (!id) return { error: 'Who are you?' };
      if (seated) return state;
      if (state.players.length >= MAX_PLAYERS) return { error: 'The table is full (8 players).' };
      return {
        ...state,
        players: [...state.players, id],
        names: { ...state.names, [id]: from.name || 'player' },
      };
    }

    case 'start': {
      if (!host) return { error: 'Only the host can start a game.' };
      if (!['lobby', 'over', 'abandoned'].includes(state.phase)) return { error: 'A game is already under way.' };
      if (state.players.length < 2) return { error: 'Two to eight players are needed.' };
      const gid = `g${Date.now().toString(36)}${Math.floor(rnd() * 1e9).toString(36)}`;
      return {
        ...fresh(state.players, state.names, state.archive),
        gid,
          teams: teamsFor(state.players),
          defaultThemes: pickPair(THEMES, rnd),
          starters: pickPair(STARTERS, rnd),
        phase: state.archive ? 'loading' : 'setup',
      };
    }

    case 'archive': {
      if (!host) return { error: 'Only the host loads the archive.' };
      if (state.phase !== 'loading') return state;
      if (validEntry(action.entry)) {
        const e = action.entry;
        return {
          ...state,
          phase: 'judging',
          judge: {
            id: e.id,
            stories: e.stories.map((s) => s.slice()),
            themes: e.themes.slice(),
            votes: {},
          },
        };
      }
      return {
        ...state,
        phase: 'setup',
        notice: action.error ? 'The stories from two games ago are not judged this time.' : '',
      };
    }

    case 'vote': {
      if (state.phase !== 'judging') return { error: 'There is nothing to vote on right now.' };
      if (!seated) return { error: 'Only seated players vote.' };
      const s = action.story;
      const t = action.theme;
      if (![0, 1].includes(s) || ![0, 1].includes(t)) return { error: 'That is not a valid vote.' };
      const cur = (state.judge.votes[id] || [null, null]).slice();
      cur[s] = t;
      const next = {
        ...state,
        judge: { ...state.judge, votes: { ...state.judge.votes, [id]: cur } },
      };
      return state.players.every((p) => fullyVoted(next, p)) ? reveal(next) : next;
    }

    case 'reveal': {
      if (!host) return { error: 'Only the host can reveal early.' };
      if (state.phase !== 'judging') return { error: 'There is nothing to reveal.' };
      return reveal(state);
    }

    case 'beginSetup': {
      if (!host) return { error: 'Only the host can begin the next stage.' };
      if (state.phase !== 'verdict') return { error: 'Nothing to begin right now.' };
      return { ...state, phase: 'setup', judge: null, verdict: null };
    }

    case 'theme': {
      if (state.phase !== 'setup') return { error: 'Themes are sealed during setup.' };
      const t = teamOf(state, id);
      if (t < 0) return { error: 'Only team members can seal a theme.' };
      const text = clean(action.text).slice(0, MAX_THEME);
      if (!text) return { error: 'Write a few words for the theme.' };
      const themes = state.themes.slice();
      themes[t] = text;
      return advance({ ...state, themes });
    }

    case 'write': {
      if (state.phase !== 'setup' && state.phase !== 'writing') return { error: 'Nothing is being written right now.' };
      const t = teamOf(state, id);
      if (t < 0) return { error: 'Only team members write.' };
      const k = state.round;
      const writer = writerOf(state, t, k);
      if (writer !== id) {
        return { error: `Only ${state.names[writer] || 'your designated writer'} writes for your team this sentence.` };
      }
      const s = storyFor(t, k);
      if (state.stories[s].length !== k - 1) return { error: 'The table is out of step. Try again in a moment.' };
      const r = oneSentence(action.text);
      if (r.error) return { error: r.error };
      const stories = state.stories.map((st, i) => (i === s ? [...st, r.text] : st));
      const ideas = state.ideas.map((l, i) => (i === t ? [] : l));
      return advance({ ...state, stories, ideas });
    }

    case 'suggest': {
      if (state.phase !== 'setup' && state.phase !== 'writing') return { error: 'Ideas are for the writing.' };
      const t = teamOf(state, id);
      if (t < 0) return { error: 'Only team members can suggest ideas.' };
      const text = clean(action.text).slice(0, MAX_IDEA);
      if (!text) return { error: 'Type an idea first.' };
      const ideas = state.ideas.map((l, i) => (i === t ? [...l, { by: id, text }].slice(-MAX_IDEAS) : l));
      return { ...state, ideas };
    }

    case 'toLobby': {
      if (!host) return { error: 'Only the host can go back to the lobby.' };
      return fresh(state.players, state.names, state.archive);
    }

    default:
      return { error: 'Unknown move.' };
  }
}

// What one player is allowed to see. Each team's theme goes only to that team.
// Vote tallies stay hidden until the verdict.
export function project(state, playerId) {
  const me = playerId || '';
  const team = teamOf(state, me);
  const writing = state.phase === 'setup' || state.phase === 'writing';
  const writers = writing && state.teams
    ? [writerOf(state, 0, state.round), writerOf(state, 1, state.round)]
    : null;
  const view = {
    phase: state.phase,
    gid: state.gid,
    round: state.round,
    rounds: SENTENCES,
    archive: state.archive,
    players: state.players.slice(),
    names: { ...state.names },
    seated: state.players.indexOf(me) >= 0,
    team,
    teams: state.teams ? state.teams.map((t) => t.slice()) : null,
    writers,
    isWriter: !!writers && team >= 0 && writers[team] === me,
    myStory: writing && team >= 0 ? storyFor(team, state.round) : null,
    themeSet: state.themes.map((t) => !!t),
    ownTheme: team >= 0 ? state.themes[team] : null,
      defaultTheme: state.phase === 'setup' && team >= 0 && !state.themes[team]
        ? ((state.defaultThemes && state.defaultThemes[team]) || '')
        : '',
      starter: state.phase === 'setup' && state.round === 1 && team >= 0
        ? ((state.starters && state.starters[storyFor(team, 1)]) || '')
        : '',
    stories: state.stories.map((s) => s.slice()),
    ideas: team >= 0 ? state.ideas[team].map((i) => ({ by: i.by, text: i.text })) : [],
    notice: state.notice || '',
    judge: null,
    verdict: null,
    filing: null,
  };
  if (state.judge && (state.phase === 'judging' || state.phase === 'verdict')) {
    const j = state.judge;
    view.judge = {
      id: j.id,
      stories: j.stories.map((s) => s.slice()),
      themes: j.themes.slice(),
      myVotes: (j.votes[me] || [null, null]).slice(),
      voted: state.players.filter((p) => fullyVoted(state, p)),
    };
  }
  if (state.phase === 'verdict' && state.verdict) {
    const r = state.verdict;
    view.verdict = {
      judgedId: r.judgedId,
      themes: r.themes.slice(),
      counts: r.counts.map((c) => c.slice()),
      points: r.points.slice(),
      totals: r.totals.slice(),
      winner: r.winner,
    };
  }
  if (state.phase === 'over' && team >= 0) {
    view.filing = {
      id: state.gid,
      team,
      theme: state.themes[team],
      stories: state.stories.map((s) => s.slice()),
    };
  }
  return view;
}

// The BubHub Record line. Each record has a key, so the hub writes it once.
function recordable(state) {
  if (state.phase === 'verdict' && state.verdict) {
    const { judgedId, themes, winner } = state.verdict;
    const text = winner === null
      ? `The judges called “${themes[0]}” and “${themes[1]}” a draw in ${meta.title}.`
      : `The judges preferred “${themes[winner]}” over “${themes[1 - winner]}” in ${meta.title}.`;
    return { key: `verdict:${judgedId}`, text };
  }
  if (state.phase === 'over' && state.gid) {
    const text = state.archive
      ? `${meta.title}: a table finished its stories; they will be judged two games from now.`
      : `${meta.title}: a table finished its stories (not filed; no archive is set).`;
    return { key: state.gid, text };
  }
  return null;
}

export function summarize(state) {
  const r = recordable(state);
  return r ? r.text : null;
}

export function roundId(state) {
  const r = recordable(state);
  return r ? r.key : '';
}

export function prune(state, goneId) {
  const inPlayers = state.players.indexOf(goneId) >= 0;
  const inTeams = !!state.teams
    && (state.teams[0].indexOf(goneId) >= 0 || state.teams[1].indexOf(goneId) >= 0);
  if (!inPlayers && !inTeams) return state;
  const drop = (list) => list.filter((p) => p !== goneId);
  let next = {
    ...state,
    players: drop(state.players),
    teams: state.teams ? [drop(state.teams[0]), drop(state.teams[1])] : null,
  };
  if (next.judge) {
    const votes = { ...next.judge.votes };
    delete votes[goneId];
    next = { ...next, judge: { ...next.judge, votes } };
    if (next.phase === 'judging' && next.players.length
        && next.players.every((p) => fullyVoted(next, p))) {
      next = reveal(next);
    }
  }
  if (next.teams && (next.phase === 'setup' || next.phase === 'writing')
      && (!next.teams[0].length || !next.teams[1].length)) {
    next = {
      ...next,
      phase: 'abandoned',
      notice: 'A team ran out of players, so this game ended early. Nothing was filed.',
    };
  }
  return next;
}

// ---------- the table (DOM) ----------

const PHASE_LABEL = {
  lobby: 'Lobby',
  loading: 'Fetching the archive',
  judging: 'Judging the stories from two games ago',
  verdict: 'Verdict',
  over: 'Finished',
  abandoned: 'Abandoned',
};

function phaseLabel(v) {
  if (v.phase === 'writing') return `Writing · sentence ${v.round} of ${v.rounds}`;
  if (v.phase === 'setup') return 'Setup · the opening sentences';
  return PHASE_LABEL[v.phase] || v.phase;
}

const STYLE = `
  .sas { font: 15px/1.45 system-ui, sans-serif; color: inherit; padding: 12px; max-width: 760px; margin: 0 auto; }
  .sas [hidden] { display: none !important; }
  .sas h2 { margin: 0 0 4px; font-size: 20px; }
  .sas .how { margin: 0 0 10px; opacity: .8; font-size: 14px; }
  .sas .bar { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 6px; font-weight: 600; flex-wrap: wrap; }
  .sas .clock { font-variant-numeric: tabular-nums; }
  .sas .clock.over { color: #d1495b; }
  .sas .notice { color: #d1495b; min-height: 1em; margin: 0 0 6px; }
  .sas .stories { display: grid; gap: 10px; grid-template-columns: 1fr; }
  @media (min-width: 640px) { .sas .stories { grid-template-columns: 1fr 1fr; } }
  .sas .story { border: 1px solid rgba(127,127,127,.4); border-radius: 10px; padding: 10px 12px; }
  .sas .story h3 { margin: 0 0 6px; font-size: 15px; }
  .sas .sent { margin: 0 0 6px; padding-left: 8px; border-left: 4px solid transparent; }
  .sas .sent.t0 { border-color: #e76f51; }
  .sas .sent.t1 { border-color: #2a9d8f; }
  .sas .panel, .sas .ideas { border: 1px solid rgba(127,127,127,.4); border-radius: 10px; padding: 10px 12px; margin-top: 10px; }
  .sas p { margin: 0 0 8px; }
  .sas .muted { opacity: .7; font-size: 14px; }
  .sas .secret { font-weight: 600; }
  .sas .theme { font-style: italic; }
  .sas .verdict { font-weight: 700; font-size: 16px; }
  .sas .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
  .sas button { min-height: 40px; min-width: 40px; padding: 0 14px; border-radius: 8px; border: 1px solid currentColor; background: transparent; color: inherit; font: inherit; cursor: pointer; margin: 2px 6px 2px 0; }
  .sas button.primary { background: #f4d35e; color: #222; border-color: #f4d35e; }
  .sas button.on { background: rgba(127,127,127,.3); font-weight: 700; }
  .sas button:disabled { opacity: .45; cursor: not-allowed; }
  .sas input, .sas textarea { flex: 1 1 200px; box-sizing: border-box; min-height: 40px; font: inherit; color: inherit; background: transparent; border: 1px solid rgba(127,127,127,.5); border-radius: 8px; padding: 8px; }
  .sas textarea { width: 100%; min-height: 70px; margin-bottom: 6px; }
  .sas .idea { margin: 4px 0; font-size: 14px; }
  .sas .status { opacity: .75; font-size: 13px; min-height: 1.2em; }
`;

export function mount(root, api) {
  let dead = false;
  let view = null;
  let timing = false;
  let remain = 0;
  let timerKey = '';
  let filingStatus = '';
  let loadingFor = null;
  let panelKey = '';
  let lastStep = '';
  let lastMine = '';
    let lastGid = '';
    const draft = { theme: '', write: '' };
  const filed = new Set();
  const posted = new Set();

  root.innerHTML = `<style>${STYLE}</style>
    <div class="sas">
      <h2></h2>
      <p class="how">Two teams write two stories, one sentence at a time. Each team steers both stories toward its own secret theme. Two games later, another table judges the stories without knowing who wrote them.</p>
      <div class="bar"><span class="phase"></span><span class="clock"></span></div>
      <p class="notice"></p>
      <div class="stories" hidden></div>
      <div class="panel"></div>
      <div class="ideas" hidden>
        <p class="muted">Ideas for your team. Only your team sees these. The writer decides.</p>
        <div class="ideas-list"></div>
        <div class="row">
          <input class="idea-input" maxlength="${MAX_IDEA}" placeholder="Suggest an idea">
          <button class="idea-send">Suggest</button>
        </div>
      </div>
      <p class="status"></p>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const ui = {
    title: $('h2'),
    phase: $('.phase'),
    clock: $('.clock'),
    notice: $('.notice'),
    stories: $('.stories'),
    panel: $('.panel'),
    ideas: $('.ideas'),
    ideasList: $('.ideas-list'),
    ideaInput: $('.idea-input'),
    status: $('.status'),
  };
  ui.title.textContent = `${meta.icon} ${meta.title}`;
  $('.idea-send').addEventListener('click', () => {
    const text = ui.ideaInput.value;
    ui.ideaInput.value = '';
    api.send({ a: 'suggest', text });
  });

  const para = (text, cls) => {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    p.textContent = text;
    return p;
  };

  const nameOf = (id) => {
    const r = (api.roster || []).find((p) => p.id === id);
    return (r && r.name) || (view && view.names && view.names[id]) || 'a player';
  };

  function statusLine(v) {
    const bits = [];
    if (v.phase === 'lobby') bits.push(`${v.players.length} at the table`);
    if (!v.seated && v.phase !== 'lobby') bits.push('👁 watching');
    if (v.phase === 'over' && !v.archive) bits.push('not filed: no archive is set');
    if (filingStatus) bits.push(filingStatus);
    return bits.join(' · ');
  }

  function setFiling(msg) {
    filingStatus = msg;
    if (view) ui.status.textContent = statusLine(view);
  }

  // Requests to the archive time out, so a dead connection cannot leave the table waiting forever.
  function withTimeout(url, init) {
    const ctl = new AbortController();
    api.setTimeout(() => ctl.abort(), FETCH_MS);
    return fetch(url, { ...init, signal: ctl.signal });
  }

  // Host: read the stories from two games ago, then tell the table what came back.
  function fetchJudge() {
    const url = archiveUrl();
    const give = (entry, error) => { if (!dead) api.send({ a: 'archive', entry, error }); };
    if (!url) { give(null, 'no archive'); return; }
    withTimeout(`${url}${url.indexOf('?') >= 0 ? '&' : '?'}action=judge`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!j || j.ok !== true) throw new Error((j && j.error) || 'refused');
        give(j.entry || null, '');
      })
      .catch(() => give(null, 'unreachable'));
  }

  // File a record to the archive. Retries a few times; the archive ignores repeats.
  function file(body, label) {
    const url = archiveUrl();
    if (!url) return;
    let tries = 0;
    const attempt = () => {
      tries += 1;
      withTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((j) => {
          if (!j || j.ok !== true) throw new Error((j && j.error) || 'refused');
          if (!dead) setFiling(`${label} filed.`);
        })
        .catch(() => {
          if (dead) return;
          if (tries < 4) {
            setFiling(`${label} not filed yet; retrying.`);
            api.setTimeout(attempt, 4000 * tries);
          } else {
            setFiling(`${label} could not be filed. The archive may be offline.`);
          }
        });
    };
    attempt();
  }

  // ----- clock (displayed only; the table keeps the time) -----
  function syncTimer(v) {
    const key = `${v.phase}:${v.round}`;
    if (key === timerKey) return;
    timerKey = key;
    timing = v.phase === 'setup' || v.phase === 'writing';
    remain = v.phase === 'setup' ? SETUP_SECONDS : WRITE_SECONDS;
  }

  function drawClock() {
    if (!timing) {
      ui.clock.textContent = '';
      ui.clock.className = 'clock';
      return;
    }
    if (remain <= 0) {
      ui.clock.textContent = 'Time is up. The writer should submit now.';
      ui.clock.className = 'clock over';
      return;
    }
    const m = Math.floor(remain / 60);
    const s = String(remain % 60).padStart(2, '0');
    ui.clock.textContent = `⏱ ${m}:${s}`;
    ui.clock.className = 'clock';
  }

  // ----- stories and ideas -----
  function renderStories(v) {
    const judging = !!v.judge && (v.phase === 'judging' || v.phase === 'verdict');
    const show = judging || ['setup', 'writing', 'over'].includes(v.phase);
    ui.stories.hidden = !show;
    if (!show) return;
    const data = judging ? v.judge.stories : v.stories;
    const labels = judging ? ['Story A', 'Story B'] : ['Story 1', 'Story 2'];
    ui.stories.replaceChildren(...data.map((sents, s) => {
      const card = document.createElement('article');
      card.className = 'story';
      const h = document.createElement('h3');
      h.textContent = labels[s];
      card.append(h);
      if (!sents.length) card.append(para('(nothing written yet)', 'muted'));
      // Judges must not see who wrote what, so judging shows no team colours.
      sents.forEach((text, k) => card.append(para(text, judging ? 'sent' : `sent t${(s + k) % 2}`)));
      return card;
    }));
  }

  function renderIdeas(v) {
    const show = v.team >= 0 && (v.phase === 'setup' || v.phase === 'writing');
    ui.ideas.hidden = !show;
    if (!show) return;
    ui.ideasList.replaceChildren(...v.ideas.map((i) => para(`${nameOf(i.by)}: ${i.text}`, 'idea')));
  }

  // ----- the panel: rebuilt only when what the player can do changes -----
  function renderPanel(v) {
    const step = `${v.phase}:${v.round}`;
    const mine = v.myStory === null ? '' : String(v.stories[v.myStory].length);
    if (v.gid && v.gid !== lastGid) {
        draft.theme = '';
        draft.write = '';
        lastGid = v.gid;
      }
      if (step !== lastStep || mine !== lastMine) {
      draft.write = '';
      lastStep = step;
      lastMine = mine;
    }
    const judgeState = v.judge ? `${v.judge.myVotes.join(',')}/${v.judge.voted.length}` : '';
    const key = [
      v.phase, v.round, v.team, v.isWriter, v.seated, v.themeSet.join(','), !!v.ownTheme,
      mine, judgeState, v.players.length, !!api.isHost, (v.writers || []).join(','),
    ].join('|');
    if (key === panelKey) return;
    panelKey = key;

    const box = ui.panel;
    box.replaceChildren();
    const add = (node) => { box.append(node); return node; };
    const text = (t, cls) => add(para(t, cls));
    const button = (label, onClick, cls, disabled) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.disabled = !!disabled;
      b.addEventListener('click', onClick);
      return add(b);
    };
    const row = () => {
      const r = document.createElement('div');
      r.className = 'row';
      return add(r);
    };
    const writeBox = (placeholder, label, initial) => {
        const ta = document.createElement('textarea');
        ta.placeholder = placeholder;
        ta.maxLength = MAX_SENTENCE;
        if (!draft.write && initial) draft.write = initial;
        ta.value = draft.write;
        ta.addEventListener('input', () => { draft.write = ta.value; });
        add(ta);
        button(label, () => api.send({ a: 'write', text: ta.value }), 'primary');
      };
    const teamLine = (t) => `Team ${t + 1}: ${v.teams[t].map(nameOf).join(', ')}`;

    if (v.phase === 'lobby') {
      text(`${v.players.length} at the table${v.players.length ? `: ${v.players.map(nameOf).join(', ')}` : ''}.`);
      text('Seats alternate between Team 1 and Team 2. Needs two to eight players.', 'muted');
      if (!v.seated) button('Join the table', () => api.send({ a: 'join' }), 'primary');
      if (api.isHost) {
        button(`Start (${v.players.length} at the table)`, () => api.send({ a: 'start' }), 'primary', v.players.length < 2);
      } else {
        text('Waiting for the host to start.', 'muted');
      }
    } else if (v.phase === 'loading') {
      text('Fetching the stories from two games ago…');
      if (api.isHost) button('Skip judging', () => api.send({ a: 'archive', entry: null, error: 'skipped' }));
      else text('Waiting for the archive.', 'muted');
    } else if (v.phase === 'judging' && v.judge) {
      const j = v.judge;
      text('Judging. Read both stories, then vote for the theme each one serves better. Judge the stories, not the teams.');
      j.themes.forEach((t, i) => text(`Theme ${i + 1}: “${t}”`, 'theme'));
      [0, 1].forEach((s) => {
        const r = row();
        const label = document.createElement('span');
        label.textContent = `Story ${s === 0 ? 'A' : 'B'} serves:`;
        r.append(label);
        [0, 1].forEach((t) => {
          const b = document.createElement('button');
          b.textContent = `Theme ${t + 1}`;
          if (j.myVotes[s] === t) b.className = 'on';
          b.disabled = !v.seated;
          b.addEventListener('click', () => api.send({ a: 'vote', story: s, theme: t }));
          r.append(b);
        });
      });
      text(`${j.voted.length} of ${v.players.length} have voted.`, 'muted');
      if (!v.seated) text('👁 watching the vote.', 'muted');
      if (api.isHost) button('Reveal now', () => api.send({ a: 'reveal' }));
    } else if (v.phase === 'verdict' && v.verdict) {
      const r = v.verdict;
      text(r.winner === null ? 'The verdict is a draw.' : `“${r.themes[r.winner]}” wins.`, 'verdict');
      r.themes.forEach((t, i) => {
        text(`Theme ${i + 1}, “${t}”: ${r.points[i]} of 2 stories, ${r.totals[i]} votes in all.`);
      });
      text('Each story goes to the theme it drew more votes for. If the stories split evenly, total votes decide. If that is level too, it is a draw.', 'muted');
      if (api.isHost) button('Continue to setup', () => api.send({ a: 'beginSetup' }), 'primary');
      else text('Waiting for the host.', 'muted');
    } else if (v.phase === 'setup') {
      text('Setup, three minutes. Each team seals a secret theme of a few words. Each team’s writer then writes the opening sentence of one story.');
      text(teamLine(0));
      text(teamLine(1));
      if (v.team >= 0) {
        text(v.ownTheme ? `Your team’s secret theme: “${v.ownTheme}”` : 'Your team has no theme yet.', 'secret');
        text(`The other team ${v.themeSet[1 - v.team] ? 'has sealed its theme.' : 'has not sealed its theme yet.'}`, 'muted');
        const r = row();
        const input = document.createElement('input');
        input.placeholder = 'a few words';
        input.maxLength = MAX_THEME;
        if (!draft.theme && (v.ownTheme || v.defaultTheme)) {
            draft.theme = v.ownTheme || v.defaultTheme;
          }
          input.value = draft.theme;
        input.addEventListener('input', () => { draft.theme = input.value; });
        r.append(input);
        const seal = document.createElement('button');
        seal.textContent = v.ownTheme ? 'Change theme' : 'Seal theme';
        seal.className = 'primary';
        seal.addEventListener('click', () => api.send({ a: 'theme', text: input.value }));
        r.append(seal);
        if (v.isWriter) {
          text('You write your team’s opening sentence.', 'muted');
          writeBox('The first sentence of the story', 'Write the opening sentence', v.starter);
        } else {
          text(`${nameOf(v.writers[v.team])} writes your team’s opening sentence.`, 'muted');
        }
      } else {
        text('👁 watching the setup.', 'muted');
      }
    } else if (v.phase === 'writing') {
      text(`Sentence ${v.round} of ${v.rounds}. Each team adds one sentence this round, to the story it was just handed.`);
      if (v.team >= 0) text(`Your team’s secret theme: “${v.ownTheme}”`, 'secret');
      text(`Writing this round: Team 1, ${nameOf(v.writers[0])}; Team 2, ${nameOf(v.writers[1])}.`, 'muted');
      if (v.isWriter) {
        writeBox('One sentence that continues the story and bends it your way', 'Submit sentence');
      } else if (v.team >= 0) {
        text(`Waiting for ${nameOf(v.writers[v.team])} to write for your team. Suggest ideas below.`, 'muted');
      } else {
        text('👁 watching the story.', 'muted');
      }
    } else if (v.phase === 'over') {
      text('The stories are finished. Both teams keep their theme slips and do not show them to each other. The stories are filed to the archive. Two games from now, another table will judge them.');
      if (v.team >= 0) text(`Your team’s secret theme: “${v.ownTheme}”`, 'secret');
      if (api.isHost) {
        button('Play again', () => api.send({ a: 'start' }), 'primary');
        button('Back to lobby', () => api.send({ a: 'toLobby' }));
      } else {
        text('Waiting for the host.', 'muted');
      }
    } else if (v.phase === 'abandoned') {
      text('This game ended early, so nothing was filed.');
      if (api.isHost) {
        button('Play again', () => api.send({ a: 'start' }), 'primary');
        button('Back to lobby', () => api.send({ a: 'toLobby' }));
      }
    }
  }

  function syncFiling(v) {
    if (api.isHost && v.phase === 'loading' && loadingFor !== v.gid) {
      loadingFor = v.gid;
      fetchJudge();
    }
    if (api.isHost && v.phase === 'verdict' && v.verdict) {
      const key = `verdict:${v.verdict.judgedId}`;
      if (!posted.has(key)) {
        posted.add(key);
        const r = v.verdict;
        file({
          action: 'verdict',
          id: r.judgedId,
          winner: r.winner,
          points: r.points,
          totals: r.totals,
          themes: r.themes,
        }, 'Verdict');
      }
    }
    if (v.filing) {
      const key = `save:${v.filing.id}:${v.filing.team}`;
      if (!filed.has(key)) {
        filed.add(key);
        file({
          action: 'save',
          id: v.filing.id,
          team: v.filing.team,
          theme: v.filing.theme,
          stories: v.filing.stories,
          createdAt: new Date().toISOString(),
        }, 'Stories');
      }
    }
  }

  function update(v) {
    if (dead || !v) return;
    view = v;
    syncTimer(v);
    ui.phase.textContent = phaseLabel(v);
    ui.notice.textContent = v.notice || '';
    renderStories(v);
    renderIdeas(v);
    renderPanel(v);
    drawClock();
    ui.status.textContent = statusLine(v);
    syncFiling(v);
  }

  api.setInterval(() => {
    if (timing && remain > 0) {
      remain -= 1;
      drawClock();
    }
  }, 1000);

  return {
    update,
    destroy() { dead = true; },
  };
}
