// Smoke test for the table UI of The Story & the Story.
// Mounts the module's mount() for four clients against a minimal fake DOM,
// simulates the hub (reduce on send, project per client), and clicks the buttons
// the UI renders, through a whole game. It catches ReferenceErrors and bad
// property names in the rendering code. It does not check layout; that needs a
// browser. Run: node tests/storyandstory_dom_smoke.mjs

import assert from 'node:assert/strict';
import * as game from '../games/storyandstory/index.js';

// ---------- minimal fake DOM ----------

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.placeholder = '';
    this.maxLength = 0;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  click() {
    if (this.disabled) throw new Error(`clicked a disabled button: ${this.textContent}`);
    (this.listeners.click || []).forEach((fn) => fn({}));
  }
  // Text of this element and all descendants, for finding buttons by label.
  allText() { return [this.textContent, ...this.children.map((c) => c.allText?.() ?? '')].join(' '); }
  find(pred) {
    if (pred(this)) return this;
    for (const c of this.children) {
      if (c.find) { const hit = c.find(pred); if (hit) return hit; }
    }
    return null;
  }
}

globalThis.document = { createElement: (tag) => new El(tag) };

// A root whose innerHTML creates named elements for every class and tag it names.
// The module's markup is static, so this is enough to resolve its selectors.
function fakeRoot() {
  const named = {};
  const root = {
    _html: '',
    set innerHTML(html) {
      this._html = html;
      named.h2 = named.h2 || new El('h2');
      for (const m of html.matchAll(/class="([a-z0-9-]+)"/g)) {
        const cls = m[1];
        if (cls === 'sas' || cls === 'how') continue;
        if (!named['.' + cls]) {
          const el = new El(cls === 'idea-send' ? 'button' : 'div');
          el.className = cls;
          named['.' + cls] = el;
        }
      }
      // Inputs and textareas the module queries; the static markup gives them classes.
      named['.idea-input'] = named['.idea-input'] || new El('input');
      named['.idea-send'].textContent = 'Suggest';
    },
    get innerHTML() { return this._html; },
    querySelector(sel) {
        if (named[sel]) return named[sel];
        if (sel.startsWith('.panel ')) {
          const tag = sel.slice('.panel '.length).trim().toUpperCase();
          return named['.panel']?.find((el) => el.tagName === tag) || null;
        }
        return null;
      },
  };
  return root;
}

// ---------- hub simulation ----------

const NAMES = { p1: 'Ann', p2: 'Bo', p3: 'Cy', p4: 'Di' };
let state = null;
const clients = {};       // id -> { root, instance, api }
const denials = [];

function rosterFor() {
  return Object.keys(NAMES).map((id, i) => ({ id, name: NAMES[id], host: i === 0 }));
}

function publish() {
  for (const [id, c] of Object.entries(clients)) {
    c.instance.update(game.project(state, id));
  }
}

function makeClient(id) {
  const root = fakeRoot();
  const api = {
    me: { id, name: NAMES[id] },
    roster: rosterFor(),
    isHost: id === 'p1',
    isSpectator: false,
    send(action) {
      const ctx = { from: { id, name: NAMES[id], host: id === 'p1' }, rng: Math.random };
      const out = game.reduce(state, action, ctx);
      if (out && out.error) { denials.push(`${id}: ${out.error}`); return; }
      state = out;
      publish();
    },
    setInterval: () => 0,
    setTimeout: () => 0,
  };
  const instance = game.mount(root, api);
  clients[id] = { root, instance, api };
}

// Find and click a button by its label, as the player at `id` sees it.
function press(id, label) {
  const root = clients[id].root;
  const panel = root.querySelector('.panel');
  const hit = panel.find((el) => el.tagName === 'BUTTON' && el.textContent === label);
  assert.ok(hit, `${id} has no button “${label}” (panel says: ${panel.allText()})`);
  hit.click();
}

function type(id, selector, text) {
  const el = clients[id].root.querySelector(selector);
  assert.ok(el, `${id} has no ${selector}`);
  el.value = text;
  el.listeners.input?.forEach((fn) => fn({}));
}

function panelText(id) { return clients[id].root.querySelector('.panel').allText(); }

// ---------- scenario ----------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a four-player game plays through the table UI and the stories are filed per team', () => {
  globalThis.BUB_STORY_ARCHIVE = '';            // archive off: no judging, no network
  state = game.init({ atTable: rosterFor().map((p) => ({ id: p.id, name: p.name, host: p.host })) });
  denials.length = 0;
  for (const id of Object.keys(NAMES)) makeClient(id);
  publish();

  assert.match(panelText('p1'), /Start \(4 at the table\)/);
  press('p1', 'Start (4 at the table)');
  assert.equal(state.phase, 'setup');

  // Setup: each team's writer writes the opener; each team seals a theme.
  type('p1', '.panel textarea', 'The door creaked open.');
  press('p1', 'Write the opening sentence');
  type('p2', '.panel textarea', 'A bell rang far away.');
  press('p2', 'Write the opening sentence');
  type('p1', '.panel input', 'Trust');
  press('p1', 'Seal theme');
  type('p2', '.panel input', 'Betrayal');
  press('p2', 'Seal theme');
  assert.equal(state.phase, 'writing');

  // The theme of team 0 never reaches team 1's panel.
  assert.match(panelText('p1'), /Trust/);
  assert.ok(!panelText('p2').includes('Trust'), 'team 1 must not see team 0’s theme');
  assert.ok(panelText('p3').includes('Trust'), 'the second member of team 0 sees it, but p2 must not');

  // Play out the remaining rounds through the buttons.
  while (state.phase === 'writing') {
    const [w0, w1] = game.project(state, 'p1').writers;
    type(w0, '.panel textarea', `Line ${state.round} from team zero.`);
    press(w0, 'Submit sentence');
    type(w1, '.panel textarea', `Line ${state.round} from team one.`);
    press(w1, 'Submit sentence');
  }
  assert.equal(state.phase, 'over');
  assert.equal(state.stories[0].length, 8);
  assert.equal(state.stories[1].length, 8);
  assert.match(panelText('p1'), /Play again/);
  assert.match(panelText('p2'), /Waiting for the host/);
  assert.deepEqual(denials, [], `no denials expected, got: ${denials.join(' | ')}`);
});

test('a denied action leaves the UI in a sane state and is not applied', () => {
  globalThis.BUB_STORY_ARCHIVE = '';
  state = game.init({ atTable: rosterFor().map((p) => ({ id: p.id, name: p.name, host: p.host })) });
  denials.length = 0;
  for (const id of Object.keys(NAMES)) makeClient(id);
  publish();
  press('p1', 'Start (4 at the table)');
  // Bo is not the writer for team 0; the send is refused and nothing changes.
  clients.p3.api.send({ a: 'write', text: 'Out of turn.' });
  assert.equal(state.stories[0].length, 0);
  assert.ok(denials.some((d) => /Only Ann/.test(d)));
});

// ---------- runner ----------

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`ok    ${t.name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${t.name}\n      ${err.stack.split('\n').slice(0, 4).join('\n      ')}`);
  }
}
console.log(`\n${tests.length - failed} of ${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
