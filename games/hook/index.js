// games/hook/index.js: What's the Hook? (fill the gap in a dealt intro-outro pair; the table votes on the best hook)
import { SCALES, SIZE, label, dealPair, fillCount, fillDurations, bridgeSteps, fmt, schedule } from './library.js';

const PLAY_MS = 60000, VOTE_MS = 30000, KEYS = Object.keys(SCALES);

export const meta = { id: 'hook', title: "What's the Hook?", players: { min: 1, max: 8 }, color: '#ff00ff',
  icon: '🌉', desc: 'Fill the gap in a matched intro-outro pair. The table votes.', soloable: true };

// A fresh round: one matched pair from the shuffled bag (never a random intro + random outro, never the same pair twice running), a scale ('any' pairs get a random one), a new clock.
function deal(s, rng, now) {
  const d = dealPair(rng, s.bag);
  const pair = d.pair;
  return { ...s, bag: d.bag, round: s.round + 1, phase: 'play', pair,
    scale: pair.scale === 'any' ? KEYS[Math.floor(rng() * KEYS.length)] : pair.scale || 'major',
    deadline: now + PLAY_MS, locked: {}, subs: {}, votes: {} };
}

// Nobody to out-vote: a table of one has a reveal and a Next button instead of a vote.
const soloish = (s) => s.order.length < 2;

export function init(ctx) {
  const list = (ctx && (ctx.atTable || ctx.seats)) || [{ id: 'solo', name: 'Player' }];
  const at = list.filter((m) => m && m.id && !m.spectator);
  const seated = at.length ? at : [{ id: 'solo', name: 'Player' }];
  return deal({ round: 0, order: seated.map((m) => m.id), names: Object.fromEntries(seated.map((m) => [m.id, m.name])),
    scores: {}, miss: {}, last: '', lastWin: [], lastTop: 0, lastSolo: false, bag: { left: [], last: -1 } }, (ctx && ctx.rng) || Math.random, Date.now());
}

// Composing is over (all locked in, or time ran out). Whoever locked in competes; a player who misses two clocks in a row is dropped.
// Alone at the table there is nothing to vote between, so it goes straight to the reveal.
function toVote(s, rng, now) {
  const miss = {};
  s.order.forEach((p) => { miss[p] = s.locked[p] ? 0 : (s.miss[p] || 0) + 1; });
  const kept = s.order.filter((p) => miss[p] < 2), base = { ...s, miss, order: kept.length ? kept : s.order };
  if (!Object.keys(s.subs).length) return deal({ ...base, last: 'Nobody locked in.', lastWin: [], lastTop: 0, lastSolo: false }, rng, now);
  return soloish(base) ? { ...base, phase: 'reveal', deadline: now + VOTE_MS } : { ...base, phase: 'vote', deadline: now + VOTE_MS };
}

// Voting is over: most votes wins a point (ties share it), then the next round starts.
function tally(s, rng, now) {
  const n = {};
  Object.values(s.votes).forEach((p) => { n[p] = (n[p] || 0) + 1; });
  const top = Math.max(0, ...Object.values(n)), win = Object.keys(n).filter((p) => n[p] === top), scores = { ...s.scores };
  win.forEach((p) => { scores[p] = (scores[p] || 0) + 1; });
  return deal({ ...s, scores, lastWin: win, lastTop: top, lastSolo: false,
    last: win.length ? `${win.map((p) => s.names[p] || p).join(' & ')} won with ${top} vote${top > 1 ? 's' : ''}.` : 'No votes were cast.' }, rng, now);
}

// Solo: the reveal is over and the player wants the next pair. Every hook locked in holds the hook.
function finish(s, rng, now) {
  const win = Object.keys(s.locked || {}).filter((p) => s.order.includes(p)), scores = { ...s.scores };
  win.forEach((p) => { scores[p] = (scores[p] || 0) + 1; });
  return deal({ ...s, scores, lastWin: win, lastTop: 0, lastSolo: true,
    last: win.length ? `${win.map((p) => s.names[p] || p).join(' & ')} held the hook.` : 'Nobody locked in.' }, rng, now);
}

export function reduce(s, a, ctx) {
  const rng = (ctx && ctx.rng) || Math.random, now = (ctx && ctx.now) || Date.now(), id = (ctx && ctx.from && ctx.from.id) || '';
  // Clients send 'tick' when their clock hits zero; it only counts once the shared deadline has really passed.
  if (a.a === 'tick') {
    if (now < s.deadline) return s;
    return s.phase === 'play' ? toVote(s, rng, now) : s.phase === 'reveal' ? finish(s, rng, now) : tally(s, rng, now);
  }
  if (a.a === 'join') {
    if (!id || s.order.includes(id)) return s;
    if (s.order.length >= 8) return { error: 'The table is full.' };
    return { ...s, order: [...s.order, id], names: { ...s.names, [id]: (ctx.from && ctx.from.name) || id } };
  }
  if (!s.order.includes(id)) return { error: 'You are watching, not seated.' };
  if (a.a === 'lock') {
    if (s.phase !== 'play') return { error: 'Not taking hooks right now.' };
    if (s.locked[id]) return { error: 'Already locked in.' };
    if (!Array.isArray(a.b) || a.b.length !== fillCount(s.pair) || a.b.some((n) => !Number.isInteger(n) || n < 0 || n >= SIZE))
      return { error: `Choose exactly ${fillCount(s.pair)} notes.` };
    const n = { ...s, locked: { ...s.locked, [id]: true }, subs: { ...s.subs, [id]: a.b } };
    return s.order.every((p) => n.locked[p]) ? toVote(n, rng, now) : n;
  }
  if (a.a === 'vote') {
    if (s.phase !== 'vote') return { error: 'Not voting right now.' };
    if (!s.subs[a.id] || (a.id === id && Object.keys(s.subs).length > 1)) return { error: "Pick another player's hook." };
    const n = { ...s, votes: { ...s.votes, [id]: a.id } };
    return s.order.every((p) => n.votes[p]) ? tally(n, rng, now) : n;
  }
  // Solo: the reveal is showing and you have heard enough.
  if (a.a === 'next') {
    if (s.phase !== 'reveal') return { error: 'Nothing to move on from.' };
    return finish(s, rng, now);
  }
  // Multiplayer: a table that is done voting should not have to sit out the clock.
  if (a.a === 'skip') {
    if (s.phase !== 'vote') return { error: 'Not voting right now.' };
    if (!Object.keys(s.votes).length) return { error: 'Nobody has voted yet.' };
    return tally(s, rng, now);
  }
  return { error: 'Unknown action.' };
}

// Hooks stay hidden while composing; during the vote you see who has voted, but only your own choice.
export function project(s, you) {
  return { ...s, you, subs: s.phase === 'play' ? {} : s.subs,
    votes: Object.fromEntries(Object.keys(s.votes).map((p) => [p, p === you ? s.votes[p] : true])) };
}

export function mount(root, api) {
  let view = null, draft = [], round = 0, ac, timer, ro, joined = false, page = 0;
  const CELL = 44, GAP = 4;                       // a note cell has to stay big enough to tap
  const $ = (q) => root.querySelector(q);
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const talk = (t) => { const b = $('#bubble'); if (b) b.textContent = t; };
  const o = () => ({ ...view.pair, scale: view.scale });
  const left = () => Math.max(0, Math.ceil((view.deadline - Date.now()) / 1000));
  const seatedNow = () => !!view && !api.isSpectator && view.order.includes(view.you);
  const showClock = () => { const el = $('#clock'); if (el) el.textContent = `⏱ ${left()}s`; };
  const audio = () => {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ac = ac || new C();                    // created inside the tap, so the browser allows sound
    if (ac.state === 'suspended') ac.resume();
    return ac;
  };

  // Any one part on its own, or the whole thing, each at the pair's tempo and sound, in the round's scale.
  const play = (part, bridge) => {
    const { pair } = view, t0 = ac.currentTime + 0.02, hook = bridgeSteps(pair, bridge);
    if (part === 'intro') return schedule(ac, pair.intro.steps, o(), t0);
    if (part === 'outro') return schedule(ac, pair.outro.steps, o(), t0);
    if (part === 'hook') return schedule(ac, hook, o(), t0);
    const t = schedule(ac, pair.intro.steps, o(), t0);      // all: intro, then the bridge, then the outro
    schedule(ac, hook, o(), schedule(ac, pair.outro.steps, o(), t));
  };

  // How many note columns fit the screen: a ShadowRoot has no width of its own, so the host element's is used.
  const avail = () => {
    const w = (root.host && root.host.clientWidth) || (typeof window !== 'undefined' ? window.innerWidth : 360);
    return Math.max(CELL, w - 26);                          // .k pads 10px a side
  };
  const perPage = (n) => Math.max(1, Math.min(n, Math.floor((avail() + GAP) / (CELL + GAP))));

  root.innerHTML = `<style>
    .k{background:#000080;color:#ff0;font:16px 'Times New Roman',serif;padding:10px;height:100%;max-width:100%;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-y;box-sizing:border-box;word-wrap:break-word}
    h1{color:#0ff;font:bold 22px Georgia;text-shadow:3px 3px #f0f}
    pre{font:16px/1.4 'Courier New',monospace;color:#0f0;margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}
    #bubble{background:#fff;color:#000;border:3px solid #000;padding:8px;font:bold 15px Arial}
    button{font:bold 16px Arial;min-width:44px;min-height:44px;margin:3px}
    .box{border:2px solid #0f0;padding:6px;margin:6px 0;max-width:100%;box-sizing:border-box}
    .plays{display:flex;flex-wrap:wrap;margin:4px 0}
    #grid{display:grid;gap:4px;margin:6px 0;justify-items:center}
    #grid button{background:#fff;color:#000;font:bold 13px Arial;min-width:0;width:100%;max-width:64px;min-height:38px;aspect-ratio:1/1;margin:0;padding:2px}
    #grid button.on{background:#ff0;color:#000;outline:3px solid #0ff}
    #pager{display:flex;align-items:center;justify-content:space-between;color:#0ff;font:bold 13px Arial;margin:4px 0}
  </style>
  <div class="k"><h1>What's the Hook?</h1><div id="bubble"></div><div id="game"></div></div>`;

  const csv = (notes) => (Array.isArray(notes) ? notes : []).map((x) => (Number.isInteger(x) ? x : -1)).join(',');

  const playsHtml = (notes) => `<div class="plays">
    <button data-part="hook" data-b="${csv(notes)}">▶ Hook</button>
    <button data-part="intro">▶ Intro</button>
    <button data-part="outro">▶ Outro</button>
    <button data-part="all" data-b="${csv(notes)}">▶ All</button></div>`;

  // Only the columns that fit; the rest wait behind the pager, so a 16-slot pair is still one screen wide.
  const gridHtml = (n, pp) => {
    const from = page * pp, to = Math.min(n, from + pp);
    // The pager sits above the grid: eight rows of keys is a screenful on its own.
    const head = pp >= n ? '' : `<div id="pager"><button data-pg="-1">‹ Prev</button><span>slots ${from + 1}–${to} of ${n}</span><button data-pg="1">Next ›</button></div>`;
    let h = `${head}<div id="grid" style="grid-template-columns:repeat(${Math.max(1, to - from)},minmax(0,1fr))">`;
    for (let r = SIZE - 1; r >= 0; r--) {
      for (let c = from; c < to; c++) {
        h += `<button data-col="${c}" data-row="${r}" class="${draft[c] === r ? 'on' : ''}" aria-label="slot ${c + 1} ${label(view.scale, r)}">${draft[c] === r ? label(view.scale, r) : '·'}</button>`;
      }
    }
    return h + '</div>';
  };

  const render = () => {
    const v = view, n = fillCount(v.pair), seated = seatedNow(), cands = Object.keys(v.subs);
    if (!Array.isArray(draft) || draft.length !== n) draft = Array(n).fill(null);
    const pp = perPage(n);
    page = Math.max(0, Math.min(page, Math.ceil(n / pp) - 1));
    talk(`Round ${v.round} · ${v.pair.name} · ${SCALES[v.scale][0]}${seated ? '' : ' · 👁 watching'}`);
    const ends = `intro  ${fmt(v.pair.intro.steps, v.scale)}\noutro  ${fmt(v.pair.outro.steps, v.scale)}`;
    const filled = draft.filter((x) => Number.isInteger(x)).length;
    const head = `<p>${v.last ? `Last round: ${esc(v.last)}<br>` : ''}Score: ${v.order.map((p) => `${esc(v.names[p])} ${v.scores[p] || 0}`).join(' · ')} · <b id="clock"></b></p>`
      + (!api.isSpectator && !v.order.includes(v.you) ? '<button data-a="join">Rejoin the table</button>' : '');
    const voted = Object.keys(v.votes).length;
    $('#game').innerHTML = head + (v.phase === 'play'
      ? `<div class="box"><pre>intro  ${fmt(v.pair.intro.steps, v.scale)}\nbridge ${fmt(bridgeSteps(v.pair, draft), v.scale)}\noutro  ${fmt(v.pair.outro.steps, v.scale)}</pre>
          <p>${filled}/${n} slots filled — tap a column to set its note, tap again to clear it.</p>${playsHtml(draft)}</div>
        ${seated && !v.locked[v.you] ? `${gridHtml(n, pp)}
          <button data-a="clear">Clear</button> <button data-a="lock">Lock in</button>` : ''}
        <p>${Object.keys(v.locked).length}/${v.order.length} locked in${v.locked[v.you] ? ' (including you)' : ''}</p>`
      : v.phase === 'reveal'
      ? `<div class="box"><pre>intro  ${fmt(v.pair.intro.steps, v.scale)}\nbridge ${fmt(bridgeSteps(v.pair, v.subs[v.you] || []), v.scale)}\noutro  ${fmt(v.pair.outro.steps, v.scale)}</pre>
          ${playsHtml(v.subs[v.you])}</div><p>Your hook${seated ? '' : ' (watching)'}. `
        + (seated ? '<button data-a="next">Next round</button>' : '') + `</p>`
      : `<div class="box"><pre>${ends}</pre></div><p>Vote for the best hook${cands.length > 1 ? ' (not your own)' : ''}. ${voted}/${v.order.length} voted.</p>`
        + cands.map((p) => `<p>${esc(v.names[p])}: <tt>${fmt(bridgeSteps(v.pair, v.subs[p]), v.scale)}</tt> <button data-part="hook" data-b="${csv(v.subs[p])}">▶</button> `
          + (seated && (p !== v.you || cands.length === 1) ? `<button data-a="vote" data-id="${esc(p)}">${v.votes[v.you] === p ? 'Voted ✓' : 'Vote'}</button>` : '') + '</p>').join('')
        // A table that is done voting should not have to sit out the clock.
        + (seated && voted ? '<button data-a="skip">Next round</button>' : ''));
    showClock();
  };

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-part],[data-pg],[data-col],[data-a]');
    if (!t || !view) return;
    const d = t.dataset, n = fillCount(view.pair);
    if (d.pg !== undefined) { page = Math.max(0, page + Number(d.pg)); return render(); }
    if (!audio()) return;
    if (d.part !== undefined) return play(d.part, d.b === undefined ? draft : (d.b ? d.b.split(',').map(Number) : []));
    if (d.col !== undefined) {
      const c = +d.col, r = +d.row;
      draft = draft.slice();
      while (draft.length < n) draft.push(null);
      draft[c] = draft[c] === r ? null : r;
      schedule(ac, [[draft[c] === null ? -1 : draft[c], (fillDurations(view.pair)[c] || 12)]], o(), ac.currentTime + 0.02);
      return render();
    }
    if (d.a === 'clear') { draft = Array(n).fill(null); return render(); }
    if (d.a === 'lock' && draft.some((x) => !Number.isInteger(x))) return talk(`Choose ${n} notes first.`);
    api.send({ a: d.a, b: draft, id: d.id });
  });

  // Every second: redraw the clock, and once it hits zero ask the game to move on (it checks the real deadline).
  // Tracked via api so the hub tears it down with the stage; destroy() clears it too.
  const tickFn = () => { if (!view) return; showClock(); if (!left() && seatedNow()) api.send({ a: 'tick' }); };
  timer = (api.setInterval || setInterval)(tickFn, 1000);

  // Turning the phone sideways, or resizing the window, changes how many columns fit.
  if (typeof ResizeObserver === 'function' && root.host) {
    let last = -1;
    ro = new ResizeObserver(() => {
      if (!view) return;
      const pp = perPage(fillCount(view.pair));
      if (pp === last) return;
      last = pp; render();
    });
    ro.observe(root.host);
  }

  return {
    update(v) {
      if (!v) return;
      view = v; if (v.round !== round) { round = v.round; page = 0; draft = Array(fillCount(v.pair)).fill(null); } render();
      // Seating is hub-owned, but the table roster lives in state: a player who
      // opened a live table asks to join from the first update (never from
      // mount — the hub has not assigned the handle yet). Spectators stay out.
      if (!joined && !api.isSpectator) { joined = true; api.send({ a: 'join' }); }
    },
    denied(t) { talk(String(t || 'Move rejected.')); },
    destroy() { clearInterval(timer); if (ro) ro.disconnect(); if (ac) ac.close(); },
  };
}

// A stable id for the round `s` is in. summarize() re-succeeds on every reduce()
// for the rest of the round once lastWin is set, so the hub dedupes on this
// rather than on the sentence.
export function roundId(s) {
  return 'r' + ((s && s.round) || 0);
}

export function summarize(s, nameOf) {
  const win = (s && s.lastWin) || [];
  if (!win.length) return null;
  const resolve = (id) => { try { return (nameOf && nameOf(id)) || s.names[id] || id; } catch (e) { return (s.names && s.names[id]) || id; } };
  const top = s.lastTop || 0;
  if (s.lastSolo) return `What's the Hook?: ${win.map(resolve).join(' & ')} held the hook.`;
  return `What's the Hook?: ${win.map(resolve).join(' & ')} won with ${top} vote${top > 1 ? 's' : ''}.`;
}
