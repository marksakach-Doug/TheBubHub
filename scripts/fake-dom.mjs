// A DOM small enough to be obviously correct, big enough to run a game's
// mount() under node.
//
// Why this exists: `mount` is the one part of a module game the offline gate
// cannot otherwise judge, so for a long time the only thing that could catch a
// broken mount was a Playwright run against the built hub — slow, and only run
// by the full suite. This runs in milliseconds and covers the class of failure
// that matters most: mount() throwing, or update() throwing on the shapes the
// hub actually sends it.
//
// It is NOT a browser. It models element creation, the parent/child tree, the
// attributes a game sets in the first second of its life (style, textContent,
// innerHTML, dataset, className, id, disabled, hidden), listeners, and enough
// of querySelector to let a game find its own buttons again. It deliberately
// does NOT implement innerHTML parsing (the gate bans it anyway), focus,
// layout, or events bubbling — a game that needs those has outgrown it, and
// the Playwright smoke is the right place for it.

// Selector support is deliberately narrow: `#id`, `.cls`, `tag`, and
// `tag.cls`. That is everything a game's own update() plausibly reaches for.
function matches(el, sel) {
  sel = sel.trim();
  const tag = sel.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tag && el.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
  for (const m of sel.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
    if (!String(el.className || '').split(/\s+/).includes(m[1])) return false;
  }
  for (const m of sel.matchAll(/#([a-zA-Z0-9_-]+)/g)) {
    if (el.id !== m[1]) return false;
  }
  return true;
}

class FakeClassList {
  constructor(el) { this.el = el; }
  add(...names) {
    const cur = String(this.el.className || '').split(/\s+/).filter(Boolean);
    for (const n of names) if (!cur.includes(n)) cur.push(n);
    this.el.className = cur.join(' ');
  }
  remove(...names) {
    this.el.className = String(this.el.className || '').split(/\s+/).filter(Boolean)
      .filter((c) => !names.includes(c)).join(' ');
  }
  toggle(name, on) { (on === undefined ? !this.el.className.split(/\s+/).includes(name) : on) ? this.add(name) : this.remove(name); }
  contains(name) { return String(this.el.className || '').split(/\s+/).includes(name); }
}

class FakeElement {
  constructor(tagName, doc) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.style = new Proxy({}, {
      // Reading an unset property gives the empty string, like a real element.
      get: (t, k) => (typeof t[k] === 'undefined' && typeof k === 'string' ? '' : t[k]),
      set: (t, k, v) => { t[k] = v; return true; }
    });
    this.dataset = {};
    this.classList = new FakeClassList(this);
    this.className = '';
    this.id = '';
    this.textContent = '';
    this.listeners = {};
    // A real element has no .innerHTML until someone writes to it, and writing
    // one is banned by the gate. Present, so a stray read returns '' rather
    // than undefined, and so the ban check has something to find.
    this.innerHTML = '';
    this.disabled = false;
    this.hidden = false;
    this.value = '';
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...kids) { kids.forEach((k) => this.appendChild(typeof k === 'string' ? this.ownerDocument.createTextNode(k) : k)); }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith(node) {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) { this.parentNode.children[i] = node; node.parentNode = this.parentNode; }
    this.parentNode = null;
  }
  cloneNode() {
    const c = new FakeElement(this.tagName, this.ownerDocument);
    c.className = this.className;
    c.id = this.id;
    c.textContent = this.textContent;
    c.innerHTML = this.innerHTML;
    c.style = Object.assign({}, this.style);
    c.dataset = Object.assign({}, this.dataset);
    c.listeners = Object.assign({}, this.listeners);
    return c;
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    const a = this.listeners[type];
    if (a) this.listeners[type] = a.filter((f) => f !== fn);
  }
  // Fire one listener. `bubbles` is accepted and ignored: nothing in the gate
  // depends on bubbling, and pretending would be a lie.
  dispatchEvent(ev) {
    const a = this.listeners[ev && ev.type];
    if (a) a.slice().forEach((fn) => fn.call(this, ev));
    return true;
  }
  // The gate's way of saying "a player touched this".
  tap(init = {}) {
    this.dispatchEvent({ type: 'pointerdown', button: 0, target: this, preventDefault() {}, ...init });
    this.dispatchEvent({ type: 'click', button: 0, target: this, preventDefault() {}, ...init });
  }

  get text() { return this.textContent; }
  set text(v) { this.textContent = String(v); }

  *walk() {
    yield this;
    for (const c of this.children) if (c.walk) yield* c.walk();
  }
  querySelectorAll(sel) {
    const out = [];
    const sels = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    for (const el of this.walk()) {
      if (el === this) continue;
      if (sels.some((s) => matches(el, s))) out.push(el);
    }
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  get children_() { return this.children; }
}

class FakeText extends FakeElement {
  constructor(text, doc) { super('#text', doc); this.textContent = String(text); }
  get tagName() { return '#text'; }
  set tagName(_v) {}
}

class FakeDocument {
  constructor() { this.body = new FakeElement('body', this); this.documentElement = this.body; }
  createElement(tag) { return new FakeElement(tag, this); }
  createTextNode(t) { return new FakeText(t, this); }
  createDocumentFragment() { return new FakeElement('#fragment', this); }
  getElementById(id) { return this.body.querySelector('#' + id); }
  querySelector(sel) { return this.body.querySelector(sel); }
  querySelectorAll(sel) { return this.body.querySelectorAll(sel); }
}

// A hub `api`, reduced to what a game may legally touch. Anything not on this
// object is not part of the contract, and a game reaching for it is a bug the
// rules file already told it not to commit.
//
// `document` is deliberately ABSENT from api — the hub never hands a game one,
// and mount() gets its document implicitly through `root.ownerDocument`.
export function fakeApi(me = 'p1') {
  const timers = { timeout: 0, interval: 0, raf: 0, running: false, pending: [] };
  return {
    me: { id: me, name: me === 'p1' ? 'Alice' : 'Bo' },
    seats: { 0: me, 1: me === 'p1' ? 'p2' : 'p1' },
    roster: [
      { id: 'p1', name: 'Alice', host: true, game: null, spectator: false },
      { id: 'p2', name: 'Bo', host: false, game: null, spectator: false }
    ],
    atTable: [
      { id: 'p1', name: 'Alice', host: true, game: null },
      { id: 'p2', name: 'Bo', host: false, game: null }
    ],
    isSpectator: false,
    isHost: true,
    isInRoom: true,
    send(action) { this.sent.push(action); },
    sent: [],
    root: null,
    // Tracked timers, exactly as the hub provides them: synchronous, so a
    // game that schedules work gets it without a real clock and without the
    // gate hanging on an interval.
    //
    // EXCEPT a timer scheduled from inside a timer. A real browser never runs
    // one before the task that scheduled it has finished, and a game with a
    // clock - one that reschedules itself - would otherwise recurse until the
    // stack gives out. That would be a failure of this harness, not of the
    // game, so those callbacks wait instead of running.
    raf(fn) { timers.raf++; if (typeof fn === 'function') fn(0); return timers.raf; },
    cancelRaf() {},
    setTimeout(fn) {
      timers.timeout++;
      if (typeof fn !== 'function') return timers.timeout;
      if (timers.running) { timers.pending.push(fn); return timers.timeout; }
      timers.running = true;
      try { fn(); } finally { timers.running = false; }
      return timers.timeout;
    },
    clearTimeout() {},
    setInterval() { return ++timers.interval; },
    clearInterval() {}
  };
}

export function fakeRoot(api) {
  const doc = new FakeDocument();
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  api.root = root;
  return root;
}

// mount() runs in a browser, so `document` is a global it can use without
// being handed one. Give it the same thing: install `document` and a minimal
// `window` on globalThis for the duration of a check, so game code written the
// browser way works unchanged under node.
export function withGlobals(fn) {
  const doc = new FakeDocument();
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = doc;
  globalThis.window = { document: doc, location: { href: 'http://localhost/' } };
  try {
    return fn(doc);
  } finally {
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
  }
}

// A deterministic Math.random stand-in. Games must use ctx.rng, but if one
// calls Math.random directly the gate's determinism check catches it — not
// this object.
export function seeded(seed = 1) {
  let s = seed >>> 0 || 1;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export { FakeElement, FakeDocument };