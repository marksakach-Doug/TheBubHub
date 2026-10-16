// games/hook/index.js: What's the Hook? (fill the gap in a dealt intro-outro pair; the table votes on the best hook)
import { SCALES, SIZE, label, pickPair, fillCount, fillDurations, bridgeSteps, fmt, schedule } from './library.js';

const PLAY_MS = 60000, VOTE_MS = 30000, KEYS = Object.keys(SCALES);

export const meta = { id: 'hook', title: "What's the Hook?", players: { min: 1, max: 8 }, color: '#ff00ff',
  icon: '🌉', desc: 'Fill the gap in a matched intro-outro pair. The table votes.', soloable: true };

// A fresh round: one matched pair (never a random intro + random outro), a scale ('any' pairs get a random one), a new clock.
function deal(s, rng, now) {
  const pair = pickPair(rng);
  return { ...s, round: s.round + 1, phase: 'play', pair,
    scale: pair.scale === 'any' ? KEYS[Math.floor(rng() * KEYS.length)] : pair.scale || 'major',
    deadline: now + PLAY_MS, locked: {}, subs: {}, votes: {} };
}

export function init(ctx) {
  const list = (ctx && (ctx.atTable || ctx.seats)) || [{ id: 'solo', name: 'Player' }];
  const at = list.filter((m) => m && m.id && !m.spectator);
  const seated = at.length ? at : [{ id: 'solo', name: 'Player' }];
  return deal({ round: 0, order: seated.map((m) => m.id), names: Object.fromEntries(seated.map((m) => [m.id, m.name])),
    scores: {}, miss: {}, last: '', lastWin: [], lastTop: 0 }, (ctx && ctx.rng) || Math.random, Date.now());
}

// Composing is over (all locked in, or time ran out). Whoever locked in competes; a player who misses two clocks in a row is dropped.
function toVote(s, rng, now) {
  const miss = {};
  s.order.forEach((p) => { miss[p] = s.locked[p] ? 0 : (s.miss[p] || 0) + 1; });
  const kept = s.order.filter((p) => miss[p] < 2), base = { ...s, miss, order: kept.length ? kept : s.order };
  return Object.keys(s.subs).length ? { ...base, phase: 'vote', deadline: now + VOTE_MS } : deal({ ...base, last: 'Nobody locked in.', lastWin: [], lastTop: 0 }, rng, now);
}

// Voting is over: most votes wins a point (ties share it), then the next round starts.
function tally(s, rng, now) {
  const n = {};
  Object.values(s.votes).forEach((p) => { n[p] = (n[p] || 0) + 1; });
  const top = Math.max(0, ...Object.values(n)), win = Object.keys(n).filter((p) => n[p] === top), scores = { ...s.scores };
  win.forEach((p) => { scores[p] = (scores[p] || 0) + 1; });
  return deal({ ...s, scores, lastWin: win, lastTop: top,
    last: win.length ? `${win.map((p) => s.names[p] || p).join(' & ')} won with ${top} vote${top > 1 ? 's' : ''}.` : 'No votes were cast.' }, rng, now);
}

export function reduce(s, a, ctx) {
  const rng = (ctx && ctx.rng) || Math.random, now = (ctx && ctx.now) || Date.now(), id = (ctx && ctx.from && ctx.from.id) || '';
  // Clients send 'tick' when their clock hits zero; it only counts once the shared deadline has really passed.
  if (a.a === 'tick') return now < s.deadline ? s : s.phase === 'play' ? toVote(s, rng, now) : tally(s, rng, now);
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
  return { error: 'Unknown action.' };
}

// Hooks stay hidden while composing; during the vote you see who has voted, but only your own choice.
export function project(s, you) {
  return { ...s, you, subs: s.phase === 'play' ? {} : s.subs,
    votes: Object.fromEntries(Object.keys(s.votes).map((p) => [p, p === you ? s.votes[p] : true])) };
}

export function mount(root, api) {
  let view = null, draft = [], round = 0, ac, timer, joined = false;
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

  // Intro, then the bridge, then the outro, each at the pair's tempo and sound, all in the round's scale.
  const play = (bridge) => {
    const { pair } = view;
    let t = ac.currentTime + 0.02;
    t = schedule(ac, pair.intro.steps, o(), t);
    t = schedule(ac, bridgeSteps(pair, bridge), o(), t);
    schedule(ac, pair.outro.steps, o(), t);
  };

  root.innerHTML = `<style>
    .k{background:#000080;color:#ff0;font:16px 'Times New Roman',serif;padding:10px;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;box-sizing:border-box}
    h1{color:#0ff;font:bold 22px Georgia;text-shadow:3px 3px #f0f}
    pre{font:16px/1.4 'Courier New',monospace;color:#0f0;margin:6px 0;white-space:pre-wrap}
    #bubble{background:#fff;color:#000;border:3px solid #000;padding:8px;font:bold 15px Arial}
    button{font:bold 16px Arial;min-width:44px;min-height:44px;margin:3px}
    .box{border:2px solid #0f0;padding:6px;margin:6px 0}
    #grid{display:grid;gap:4px;margin:6px 0}
    #grid button{background:#fff;color:#000;min-width:48px;min-height:48px;margin:0;padding:4px}
    #grid button.on{background:#ff0;color:#000;outline:3px solid #0ff}
    #grid .ghead{color:#0ff;font:bold 12px Arial;text-align:center}
  </style>
  <div class="k"><h1>What's the Hook?</h1><div id="bubble"></div><div id="game"></div></div>`;

  const gridHtml = (n) => {
    let h = `<div id="grid" style="grid-template-columns:repeat(${n},minmax(48px,1fr))">`;
    for (let r = SIZE - 1; r >= 0; r--) {
      for (let c = 0; c < n; c++) {
        h += `<button data-col="${c}" data-row="${r}" class="${draft[c] === r ? 'on' : ''}" aria-label="slot ${c + 1} ${label(view.scale, r)}">${draft[c] === r ? label(view.scale, r) : '·'}</button>`;
      }
    }
    return h + '</div>';
  };

  const render = () => {
    const v = view, n = fillCount(v.pair), seated = seatedNow(), cands = Object.keys(v.subs);
    if (!Array.isArray(draft) || draft.length !== n) draft = Array(n).fill(null);
    talk(`Round ${v.round} · ${v.pair.name} · ${SCALES[v.scale][0]}${seated ? '' : ' · 👁 watching'}`);
    const ends = `intro  ${fmt(v.pair.intro.steps, v.scale)}\noutro  ${fmt(v.pair.outro.steps, v.scale)}`;
    const filled = draft.filter((x) => Number.isInteger(x)).length;
    const head = `<p>${v.last ? `Last round: ${esc(v.last)}<br>` : ''}Score: ${v.order.map((p) => `${esc(v.names[p])} ${v.scores[p] || 0}`).join(' · ')} · <b id="clock"></b></p>`
      + (!api.isSpectator && !v.order.includes(v.you) ? '<button data-a="join">Rejoin the table</button>' : '');
    $('#game').innerHTML = head + (v.phase === 'play'
      ? `<div class="box"><pre>intro  ${fmt(v.pair.intro.steps, v.scale)}\nbridge ${fmt(bridgeSteps(v.pair, draft), v.scale)}\noutro  ${fmt(v.pair.outro.steps, v.scale)}</pre>
          <p>${filled}/${n} slots filled — tap a column to set its note, tap again to clear it.</p><button data-p="${draft.map((x) => (Number.isInteger(x) ? x : -1)).join(',')}">▶ Hear it</button></div>
        ${seated && !v.locked[v.you] ? `${gridHtml(n)}
          <button data-a="clear">Clear</button> <button data-a="lock">Lock in</button>` : ''}
        <p>${Object.keys(v.locked).length}/${v.order.length} locked in${v.locked[v.you] ? ' (including you)' : ''}</p>`
      : `<div class="box"><pre>${ends}</pre></div><p>Vote for the best hook${cands.length > 1 ? ' (not your own)' : ''}. ${Object.keys(v.votes).length}/${v.order.length} voted.</p>`
        + cands.map((p) => `<p>${esc(v.names[p])}: <tt>${fmt(bridgeSteps(v.pair, v.subs[p]), v.scale)}</tt> <button data-p="${v.subs[p]}">▶</button> `
          + (seated && (p !== v.you || cands.length === 1) ? `<button data-a="vote" data-id="${esc(p)}">${v.votes[v.you] === p ? 'Voted ✓' : 'Vote'}</button>` : '') + '</p>').join(''));
    showClock();
  };

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-p],[data-col],[data-a]');
    if (!t || !view) return;
    if (!audio()) return;
    const d = t.dataset, n = fillCount(view.pair);
    if (d.p !== undefined) return play(d.p ? d.p.split(',').map(Number) : []);
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

  return {
    update(v) {
      if (!v) return;
      view = v; if (v.round !== round) { round = v.round; draft = Array(fillCount(v.pair)).fill(null); } render();
      // Seating is hub-owned, but the table roster lives in state: a player who
      // opened a live table asks to join from the first update (never from
      // mount — the hub has not assigned the handle yet). Spectators stay out.
      if (!joined && !api.isSpectator) { joined = true; api.send({ a: 'join' }); }
    },
    denied(t) { talk(String(t || 'Move rejected.')); },
    destroy() { clearInterval(timer); if (ac) ac.close(); },
  };
}

export function summarize(s, nameOf) {
  const win = (s && s.lastWin) || [];
  if (!win.length) return null;
  const resolve = (id) => { try { return (nameOf && nameOf(id)) || s.names[id] || id; } catch (e) { return (s.names && s.names[id]) || id; } };
  const top = s.lastTop || 0;
  return `What's the Hook?: ${win.map(resolve).join(' & ')} won with ${top} vote${top > 1 ? 's' : ''}.`;
}
