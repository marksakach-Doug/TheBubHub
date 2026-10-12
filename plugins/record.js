// BubHub v10 — record plugin. The hub calls game.summarize(), appends a
// date, dedupes, and writes to the sheet. Game-specific string formatting
// was removed from bub-record.js: legacy compat payloads with .text are
// passed through, but new modules only implement summarize().
// Always on: this hub is for friends, no consent gate.
const BUB_API = 'https://script.google.com/macros/s/AKfycbwhy40Gk_QPoVz-jEwe-I72_rqbudw_QeLxZcGz7e2BMH3kIYS0AWkBiRulJl-CfU5jyA/exec';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

  function norm(e) {
    return {
      date: String((e && e.date) || '').slice(0, 10),
      game: String((e && e.game) || ''),
      text: String((e && e.text) || '').trim().replace(/\s+/g, ' ')
    };
  }
  function keyOf(e) { const n = norm(e); return n.date + '|' + n.game + '|' + n.text; }

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
    const k = keyOf(e);
    if (entries.some(function (x) { return keyOf(x) === k; })) return;
    entries.unshift(e);
    render();
  }

  function write(entry) {
    status('Saving…');
    try {
      const q = 'kind=bub&game=' + encodeURIComponent(entry.game) +
        '&text=' + encodeURIComponent(entry.text) +
        '&date=' + encodeURIComponent(entry.date);
      fetch(BUB_API + '?' + q, { cache: 'no-store', keepalive: true }).then(function (r) {
        return r.json();
      }).then(function (j) {
        if (j && j.entries) ingest(j.entries);
        status('');
      }).catch(function () {
        status('Could not save — check connection; the line above is kept for now.');
      });
    } catch (e) {
      status('Could not save — check connection; the line above is kept for now.');
    }
  }

  function ingest(all) {
    const have = {};
    entries.forEach(function (e) { have[keyOf(e)] = 1; });
    (all || []).filter(function (r) {
      return String((r && r.kind) || '') === 'bub' && r.text;
    }).forEach(function (r) {
      const e = norm(r);
      const k = keyOf(e);
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
    let text = null;
    try {
      const mod = opts.getModule && opts.getModule(meta.id);
      if (mod && typeof mod.summarize === 'function') text = mod.summarize(state, nameOf);
    } catch (e) { text = null; }
    if (!text) return;
    recordLine(meta.id, text);
  }

  // Legacy path: compat payloads (already-formatted .text passthrough).
  function recordLegacy(game, p) {
    if (!p) return;
    if (p.entry) { addLocal(p.entry); return; } // relay from host
    const text = p.text || null;
    if (!text) return; // generic "played X" lines are no longer auto-written
    recordLine(game, text);
  }

  function recordLine(game, text) {
    const entry = norm({ date: todayISO(), game: game, text: text });
    const k = keyOf(entry);
    const now = Date.now();
    if (lastKeys[k] && now - lastKeys[k] < 30000) return;
    lastKeys[k] = now;
    addLocal(entry);
    const net = getNet();
    if (store.state.isHost && net) {
      try { net.broadcast({ type: 'result', p: { entry: entry } }); } catch (e) {}
    }
    write(entry);
  }

  function load() {
    status('Loading…');
    try {
      fetch(BUB_API, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        ingest((j && j.entries) || []);
        status('');
      }).catch(function () { status('Record unavailable offline.'); });
    } catch (e) { status('Record unavailable offline.'); }
    render();
  }

  function wire() {
    ['record-more-lobby', 'record-more-room'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', function () { expanded = !expanded; render(); });
    });
  }

  return {
    recordModule: recordModule, recordLegacy: recordLegacy, recordLine: recordLine,
    addLocal: addLocal, ingest: ingest, load: load, wire: wire, render: render,
    nameOf: nameOf, status: status
  };
}
