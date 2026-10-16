// BubHub v10 — record plugin. The hub calls game.summarize(), appends a
// date, dedupes, and writes to the sheet. Game-specific string formatting
// was removed from bub-record.js: legacy compat payloads with .text are
// passed through, but new modules only implement summarize().
// Always on: this hub is for friends, no consent gate.
const BUB_API = 'https://script.google.com/macros/s/AKfycbwhy40Gk_QPoVz-jEwe-I72_rqbudw_QeLxZcGz7e2BMH3kIYS0AWkBiRulJl-CfU5jyA/exec';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A pending line survives a reload. The sheet write is a bare GET to Apps
// Script with no retry and no queue, so before this a failed write was shown
// optimistically, then silently vanished on the next load — which read as
// "the game didn't record anything".
const OUTBOX_KEY = 'bubhub.record.outbox.v1';
const MAX_OUTBOX = 250;
const RETRY_MIN = 4000;
const RETRY_MAX = 60000;
// Only used when a game told us nothing about which round this is. See
// recordLine(): with a round id we can tell two identical scores apart, and
// this window would throw the second one away.
const TEXT_THROTTLE = 30000;

function todayISO() {
  const d = new Date();
  const p2 = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return parseInt(m[3], 10) + ' ' + (MONTHS[parseInt(m[2], 10) - 1] || '?') + ' ' + m[1];
}

export function createRecord(opts) {
  const store = opts.store;
  const getNet = opts.getNet || function () { return opts.net || null; };
  const entries = [];
  let expanded = false;
  const lastKeys = {};
  const outbox = readOutbox();
  let flushing = false;
  let retryDelay = RETRY_MIN;
  let retryTimer = null;

  // Two different keys, deliberately. `textKey` identifies a *row in the
  // sheet*, so ingest() can recognise the echo of a line we just wrote and not
  // show it twice. `entryKey` identifies a *round on this device*, which is
  // what stops the same round being written once per reduce() — summarize()
  // keeps succeeding after the phase ends, so the hub calls it again and
  // again, and keying that on the sentence is what made the sheet fill with
  // duplicates while the list on screen looked correctly deduped.
  function textKey(e) { const n = norm(e); return n.date + '|' + n.game + '|' + n.text; }
  function entryKey(e) { return (e && e.k) || textKey(e); }

  function norm(e) {
    return {
      date: String((e && e.date) || '').slice(0, 10),
      game: String((e && e.game) || ''),
      text: String((e && e.text) || '').trim().replace(/\s+/g, ' ')
    };
  }

  function nameOf(id) {
    const s = store.state;
    if (id === s.me.id) return s.me.name;
    const m = s.roster.find(function (x) { return x.id === id; });
    return (m && m.name) || 'Someone';
  }

  function status(m) {
    ['record-status-lobby', 'record-status-room'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = m || '';
    });
  }

  function render() {
    [['record-list-lobby', 'record-more-lobby'], ['record-list-room', 'record-more-room']].forEach(function (pair) {
      const ul = document.getElementById(pair[0]);
      if (!ul) return;
      ul.innerHTML = '';
      if (!entries.length) {
        const li = document.createElement('li');
        li.className = 'text-slate-500 text-xs italic';
        li.textContent = 'No games recorded yet — play something!';
        ul.appendChild(li);
      }
      (expanded ? entries : entries.slice(0, 5)).forEach(function (e) {
        const li = document.createElement('li');
        li.className = 'text-slate-200 text-xs leading-relaxed';
        const b = document.createElement('span');
        b.className = 'text-slate-500 font-mono mr-1';
        b.textContent = fmtDate(e.date);
        li.appendChild(b);
        li.appendChild(document.createTextNode(e.text));
        ul.appendChild(li);
      });
      const more = document.getElementById(pair[1]);
      if (more) {
        more.classList.toggle('hidden', entries.length <= 5);
        more.textContent = expanded ? 'Show less' : 'Show all (' + entries.length + ')';
      }
    });
  }

  function addLocal(entry) {
    if (!entry || !entry.text) return;
    const e = norm(entry);
    // norm() builds a fresh {date,game,text}, so the round id has to be copied
    // across by hand. Missed once: without it every entry fell back to the
    // sentence key and two identical scores collapsed into one row.
    if (entry.k) e.k = entry.k;
    const k = entryKey(e);
    if (entries.some(function (x) { return entryKey(x) === k; })) return;
    entries.unshift(e);
    render();
  }

  // ---- the outbox -------------------------------------------------------
  //
  // enqueue() is synchronous and persists before the network is touched, so a
  // line is safe the instant it appears on screen. flush() then drains it one
  // at a time; a failure backs off and waits for any of: the next attempt,
  // the connection coming back, or the tab being looked at again.

  function readOutbox() {
    try {
      const raw = localStorage.getItem(OUTBOX_KEY);
      const a = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(a)) return [];
      return a.filter(function (e) { return e && e.text && e.game && e.date; });
    } catch (e) { return []; }
  }

  function saveOutbox() {
    try {
      if (outbox.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
      else localStorage.removeItem(OUTBOX_KEY);
    } catch (e) { /* private mode: still shown on screen, just not durable */ }
  }

  function clearRetry() {
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
  }

  function scheduleRetry() {
    clearRetry();
    if (!outbox.length) return;
    status('Saved on this device — the sheet will catch up.');
    retryTimer = setTimeout(function () { retryTimer = null; flush(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX);
  }

  function flush() {
    if (flushing || !outbox.length) return;
    flushing = true;
    const item = outbox[0];
    status('Saving…');
    const settle = function (ok) {
      flushing = false;
      if (ok) {
        outbox.shift();
        saveOutbox();
        retryDelay = RETRY_MIN;
      }
      if (!outbox.length) { clearRetry(); settleStatus(''); return; }
      // Space successful writes out a little: Apps Script serialises them, and
      // a burst of them is exactly what fails.
      if (ok) setTimeout(function () { flush(); }, 150);
      else scheduleRetry();
    };
    try {
      const q = 'kind=bub&game=' + encodeURIComponent(item.game) +
        '&text=' + encodeURIComponent(item.text) +
        '&date=' + encodeURIComponent(item.date);
      fetch(BUB_API + '?' + q, { cache: 'no-store', keepalive: true })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) { if (j && j.entries) ingest(j.entries); settle(true); })
        .catch(function () { settle(false); });
    } catch (e) {
      settle(false);
    }
  }

  function enqueue(entry) {
    // Deduped on the round, NOT on the sentence. Two real games that happen to
    // score the same share date, game and text, so a text key here would queue
    // the first and silently drop the second — which is the bug this whole
    // change exists to fix, one layer down.
    const k = entryKey(entry);
    if (!outbox.some(function (x) { return x.k === k; })) {
      outbox.push({ game: entry.game, text: entry.text, date: entry.date, k: k });
      if (outbox.length > MAX_OUTBOX) outbox.splice(0, outbox.length - MAX_OUTBOX);
      saveOutbox();
    }
    flush();
  }

function ingest(all) {
    // Keyed on the sheet row, not on entryKey: a line we recorded locally
    // carries a round id the server has no way of knowing, so comparing on
    // entryKey would let our own write come back as a second entry.
    const have = {};
    entries.forEach(function (e) { have[textKey(e)] = 1; });
    (all || []).filter(function (r) {
      return String((r && r.kind) || '') === 'bub' && r.text;
    }).forEach(function (r) {
      const e = norm(r);
      const k = textKey(e);
      if (!have[k]) { have[k] = 1; entries.push(e); }
    });
    entries.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
    render();
  }

  // New module path: hub calls summarize(state, nameOf).
  function recordModule(meta, state) {
    const s = store.state;
    if (meta.noRecord) return;
    if (!s.isHost && s.inRoom) return; // host records multiplayer
    let text = null, roundKey = null;
    try {
      const mod = opts.getModule && opts.getModule(meta.id);
      if (mod && typeof mod.summarize === 'function') text = mod.summarize(state, nameOf);
      // Optional: a game's stable id for the round `state` is in. Without one
      // the best we can do is dedupe on the sentence, which cannot tell two
      // identical scores apart.
      if (mod && typeof mod.roundId === 'function') roundKey = mod.roundId(state) || null;
    } catch (e) { text = null; }
    if (!text) return;
    recordLine(meta.id, text, roundKey);
  }

  function joinNames(names) {
    const n = (names || []).filter(Boolean);
    if (!n.length) return 'someone';
    if (n.length === 1) return n[0];
    if (n.length === 2) return n[0] + ' and ' + n[1];
    return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  }

  // Legacy ids resolve against the roster, falling back to the local player's
  // name (not "Someone") so a game that posts an id the hub never saw still
  // writes a sensible line. Matches bub-record.js's nameOf().
  function nameOrMe(id) {
    const s = store.state;
    if (id === s.me.id) return s.me.name;
    const m = s.roster.find(function (x) { return x.id === id; });
    if (m && m.name) return m.name;
    return s.me.name || 'Someone';
  }

  // p.players -> resolved names, deduped. Falls back to the whole roster, then
  // to just me, so a solo game (waltz, daltadka) that sends no players at all
  // still gets a line.
  function namesFor(p) {
    let n = (p.players || []).map(nameOrMe);
    n = n.filter(function (x, i) { return n.indexOf(x) === i; });
    if (!n.length) n = store.state.roster.map(function (m) { return m.name; }).filter(Boolean);
    if (!n.length) n = [store.state.me.name || 'Someone'];
    return n;
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // "<names> played [N rounds|laps] at <title>" — the count is dropped entirely
  // when it is absent or zero, so the line never reads "played  at Title".
  function playedAt(names, n, word, title) {
    return joinNames(names) + ' played ' + (n ? plural(n, word) + ' at ' : '') + title;
  }

  // Legacy iframe games post structured payloads ({players, laps} and friends)
  // that used to be turned into a sentence by bub-record.js. The v10 shell no
  // longer loads that file, so a game that did not send a pre-formatted `text`
  // was recording nothing at all — silently. These rules are a direct port of
  // bub-record.js's `sentence()`; the title now comes from the registry's
  // `meta.title` instead of a hardcoded map, which also fixes Warp Front
  // recording itself as "warp".
  function describeLegacy(meta, p) {
    const title = meta.title || meta.id;
    const names = namesFor(p);

    if (meta.id === 'chess') {
      // players is [whiteId, blackId?]; `bot` says black wasn't a person.
      // `won` is which colour won ('w'/'b'/'draw'), so we never guess an id and
      // the bot never needs a fake roster entry.
      const white = names[0] || 'Someone';
      const black = p.bot ? 'the bot' : (names[1] || 'an opponent');
      if (p.won === 'b') return black + ' beat ' + white + ' at ' + title;
      if (p.won === 'draw' || !p.won) return white + ' drew with ' + black + ' at ' + title;
      return white + ' beat ' + black + ' at ' + title;
    }

    if (meta.id === 'lotr') {
      // `win` is the winner's id; everyone else gets listed as beaten.
      const w = p.win ? nameOrMe(p.win) : names[0];
      const rest = names.filter(function (n) { return n !== w; });
      return (w || 'Someone') + (rest.length ? ' beat ' + joinNames(rest) : ' played') + ' at ' + title;
    }

    if (meta.id === 'warp') {
      const who = joinNames(names);
      if (p.win) return who + ' beat the Borg ' + p.ps + '–' + p.bs + ' at ' + title;
      return who + ' lost to the Borg ' + p.bs + '–' + p.ps + ' at ' + title;
    }

    if (meta.id === 'blastoff') {
      // `win` is the winning pilot's id, `score` the red cards they took.
      const w = p.win ? nameOrMe(p.win) : names[0];
      const n = (p.score === undefined || p.score === null) ? null : p.score;
      return w + ' won ' + title + (n !== null ? ' with ' + plural(n, 'red card') : '');
    }

    if (meta.id === 'grammar') return joinNames(names) + ' lost at ' + title;

    if (meta.id === 'wordbridge') {
      // Round-based: the line records how far the table got.
      return playedAt(names, p.rounds, 'round', title);
    }

    if (meta.id === 'the96game') {
      // Lap-based: the line records how many times the sentence went round.
      return playedAt(names, p.laps, 'lap', title);
    }

    if (meta.id === 'daltadka') {
      // Solo: the local player is the cook.
      const me = store.state.me.name || 'Someone';
      if (p.dish && p.score !== undefined && p.score !== null) {
        return me + ' cooked ' + p.dish + ' scoring ' + p.score + ' at ' + title;
      }
      return me + ' played ' + title;
    }

    if (meta.id === 'waltz') return (store.state.me.name || 'Someone') + ' scored ' + (p.score || 0) + ' at ' + title;

    // Unknown legacy game: still leave a line rather than silently dropping the
    // result. New module games use summarize() and never reach this.
    return joinNames(names) + ' played ' + title;
  }

  // Legacy path: compat payloads. `text` wins; otherwise describeLegacy()
  // reconstructs the sentence from the game's own payload shape.
  function recordLegacy(meta, p) {
    if (!p) return;
    if (p.entry) { addLocal(p.entry); return; } // relay from host
    const text = p.text || describeLegacy(meta, p);
    if (!text) return; // generic "played X" lines are no longer auto-written
    // Most legacy games already send an instance id for the game they just
    // finished; it is the only thing that distinguishes two identical results.
    recordLine(meta.id, text, p.inst || p.roundId || null);
  }

  function recordLine(game, text, roundKey) {
    if (!text) return;
    const entry = norm({ date: todayISO(), game: game, text: text });
    const k = roundKey || textKey(entry);
    entry.k = k;
    // This round is already on the list. The hub calls recordModule on every
    // reduce(), and summarize() keeps returning the same line for the rest of
    // the round, so this is the check that actually stops duplicates — it used
    // to be a 30s timer on the sentence, which also threw away a real second
    // game that happened to score the same.
    if (entries.some(function (x) { return entryKey(x) === k; })) return;
    // Only games that told us nothing about which round this is fall back to
    // throttling identical sentences: with no round id the sentence is all we
    // have, and two real rounds could otherwise be written twice.
    if (!roundKey) {
      const now = Date.now();
      if (lastKeys[k] && now - lastKeys[k] < TEXT_THROTTLE) return;
      lastKeys[k] = now;
    }
    addLocal(entry);
    const net = getNet();
    if (store.state.inRoom && store.state.isHost && net) {
      try { net.broadcast({ type: 'result', p: { entry: entry } }); } catch (e) {}
    }
    enqueue(entry);
  }

  // The status line has two owners — the loader and the outbox — so both end
// here rather than clearing it out from under each other.
  function settleStatus(msg) {
    status(outbox.length ? 'Saved on this device — the sheet will catch up.' : (msg || ''));
  }

  function load() {
    status('Loading…');
    // Anything left over from a session that could not reach the sheet gets
    // another go before we go and read the sheet.
    flush();
    try {
      fetch(BUB_API, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        ingest((j && j.entries) || []);
        settleStatus('');
      }).catch(function () { settleStatus('Record unavailable offline.'); });
    } catch (e) { settleStatus('Record unavailable offline.'); }
    render();
  }

  function wire() {
    ['record-more-lobby', 'record-more-room'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', function () { expanded = !expanded; render(); });
    });
    // Three ways back in without waiting out the backoff: the network came
    // back, the tab was looked at again, or the page is going away and this is
    // the last chance to try.
    window.addEventListener('online', function () { retryDelay = RETRY_MIN; flush(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { retryDelay = RETRY_MIN; flush(); }
    });
    window.addEventListener('pagehide', flush);
  }

  return {
    recordModule: recordModule, recordLegacy: recordLegacy, recordLine: recordLine,
    describeLegacy: describeLegacy, joinNames: joinNames,
    addLocal: addLocal, ingest: ingest, load: load, wire: wire, render: render,
    nameOf: nameOf, status: status, flush: flush,
    // Test seams: what is still waiting to be written, and what the list holds.
    pending: function () { return outbox.slice(); },
    listed: function () { return entries.slice(); }
  };
}
