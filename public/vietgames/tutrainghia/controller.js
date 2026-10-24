// External USB controller bridge for Từ Trái Nghĩa.
//
// Non-invasive by design: game.js and harness.js are untouched. This file
// polls the Gamepad API and sends synthetic KeyboardEvents on the game's
// wrapper div (.w), where the game's own keyboard handler picks them up
// (game.js, "===== input ====="). The game never knows a controller exists.
//
// Direction decoding mirrors eggs_Standalone.html, for generic N64-style
// USB pads that report "non-standard" layouts:
//   - analog stick on axes 0/1, minus a sloppy resting offset
//   - D-pad as buttons 12–15 when mapping === 'standard'
//   - packed 8-way hat on axis 9 (Chrome) or ±1 axis pairs (Linux hats)
//   - ±1 axis pairs only count if that axis rested near 0, so analog
//     triggers parked at -1 cannot pin a held direction.
//
// Button bindings: reuses the mapping you already saved for this controller
// in eggs_Standalone.html (localStorage 'eggs.profiles', per controller
// model). This game's own bindings, if ever set here, live under
// 'tutrainghia.profiles' and win over the eggs ones. Without any saved
// profile the defaults are: A jump, B act, Start act/start (Enter).

void (() => {
  'use strict';

  if (typeof window !== 'object' || typeof window.requestAnimationFrame !== 'function') return;

  const ROOT = '#vietgames-game';
  const OWN = 'tutrainghia.profiles';
  const EGGS = 'eggs.profiles';
  const HATV = [-1, -0.7142857, -0.4285714, -0.1428571, 0.1428571, 0.4285714, 0.7142857, 1];
  const CODE = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', jump: 'Space', act: 'KeyX', start: 'Enter' };
  const LABEL = { jump: 'NHẢY', act: 'HÀNH ĐỘNG', start: 'BẮT ĐẦU' };
  // Directional input is decoded directly from d-pad buttons/hat axes/stick axes
  // in decodeDir. Asking for it here only works for pads that expose the d-pad
  // as ordinary buttons, and traps the wizard on “D-PAD TRÁI” for the others.
  const SEQ = ['jump', 'act', 'start'];

  let wrapEl = null, wrapAt = 0;
  let ownP = null, ownAt = 0, eggP = null, eggAt = 0;
  const pads = {};

  function sget(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function norm(p) {
    if (!p) return null;
    const n = { jump: p.jump ?? 0, act: p.dash ?? p.item ?? 1, start: p.pause ?? 9, dir: null };
    if (p.dir) n.dir = { l: p.dir.l, r: p.dir.r, u: p.dir.u, d: p.dir.d };
    return n;
  }
  function profFor(id) {
    const t = performance.now();
    if (!ownP || t - ownAt > 500) { ownP = sget(OWN) || {}; ownAt = t; }
    if (!eggP || t - eggAt > 500) { eggP = sget(EGGS) || {}; eggAt = t; }
    return norm(ownP[id]) || norm(eggP[id]);
  }

  // The game's wrapper div appears after mount; find it lazily and cache briefly.
  function wrap() {
    const t = performance.now();
    if (!wrapEl || !wrapEl.isConnected || t - wrapAt > 1000) { wrapAt = t; wrapEl = document.querySelector(ROOT + ' .w'); }
    return wrapEl ? wrapEl : null;
  }
  function keyEv(type, k) {
    return new KeyboardEvent(type, { code: CODE[k], key: CODE[k], bubbles: true, cancelable: true });
  }
  function setKey(sta, k, on) {
    const want = on ? 1 : 0;
    if ((sta.cur[k] || 0) === want) return;
    const t = wrap();
    if (!t) return; // not mounted yet: state never flips, gets retried next frame
    sta.cur[k] = want;
    t.dispatchEvent(keyEv(on ? 'keydown' : 'keyup', k));
  }
  function clearPad(sta) {
    const t = wrap();
    for (const k in sta.cur) {
      sta.cur[k] = 0;
      if (t) t.dispatchEvent(keyEv('keyup', k));
    }
    sta.cur = {};
  }

  function decodeDir(gp, sta) {
    const a = gp.axes, d = { l: 0, r: 0, u: 0, d: 0 };
    let i, x = a[0] || 0, y = a[1] || 0;
    const rx = sta.rest[0] || 0, ry = sta.rest[1] || 0;
    if (Math.abs(rx) < 0.5) x -= rx;
    if (Math.abs(ry) < 0.5) y -= ry;
    if (x < -0.4) d.l = 1;
    if (x > 0.4) d.r = 1;
    if (y < -0.4) d.u = 1;
    if (y > 0.4) d.d = 1;
    if (a.length > 9) {
      const h = a[9];
      let hi = -1, best = 0.08;
      for (i = 0; i < 8; i++) { const dd = Math.abs(h - HATV[i]); if (dd < best) { best = dd; hi = i; } }
      if (hi >= 0) {
        if (hi === 0 || hi === 1 || hi === 7) d.u = 1;
        if (hi >= 1 && hi <= 3) d.r = 1;
        if (hi >= 3 && hi <= 5) d.d = 1;
        if (hi >= 5 && hi <= 7) d.l = 1;
      }
    }
    for (i = 2; i + 1 < a.length; i += 2) {
      if (i === 8 && a.length > 9) continue;
      if (Math.abs(sta.rest[i] || 0) > 0.2 || Math.abs(sta.rest[i + 1] || 0) > 0.2) continue;
      if (a[i] < -0.9) d.l = 1;
      if (a[i] > 0.9) d.r = 1;
      if (a[i + 1] < -0.9) d.u = 1;
      if (a[i + 1] > 0.9) d.d = 1;
    }
    if (gp.mapping === 'standard') {
      const b = gp.buttons;
      if ((b[14] || {}).pressed) d.l = 1;
      if ((b[15] || {}).pressed) d.r = 1;
      if ((b[12] || {}).pressed) d.u = 1;
      if ((b[13] || {}).pressed) d.d = 1;
    }
    const p = sta.prof;
    if (p && p.dir) {
      const b = gp.buttons;
      if (p.dir.l != null && (b[p.dir.l] || {}).pressed) d.l = 1;
      if (p.dir.r != null && (b[p.dir.r] || {}).pressed) d.r = 1;
      if (p.dir.u != null && (b[p.dir.u] || {}).pressed) d.u = 1;
      if (p.dir.d != null && (b[p.dir.d] || {}).pressed) d.d = 1;
    }
    return d;
  }

  function btnAt(gp, i) {
    if (i == null || i < 0) return false;
    const b = gp.buttons[i];
    return !!(b && (b.pressed || b.value > 0.6));
  }

  // ---------- connection toast + one-time button setup ----------

  let toastEl = null;
  function showToast(text, setup) {
    if (!document.body) return;
    hideToast();
    toastEl = document.createElement('div');
    toastEl.setAttribute('style',
      'position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;align-items:center;gap:10px;' +
      'padding:10px 14px;border-radius:10px;background:rgba(18,19,26,.92);color:#f0e6d2;' +
      'font:14px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4)');
    const msg = document.createElement('span');
    msg.textContent = text;
    toastEl.appendChild(msg);
    if (setup) {
      const b = document.createElement('button');
      b.textContent = 'Cài nút';
      b.setAttribute('style',
        'border:0;border-radius:8px;padding:6px 10px;background:#ffd23f;color:#12131a;' +
        'font:600 13px system-ui,sans-serif;cursor:pointer');
      b.addEventListener('click', () => { openWizard(); });
      toastEl.appendChild(b);
      const x = document.createElement('button');
      x.textContent = '×';
      x.setAttribute('style', 'border:0;background:transparent;color:#8a7a5c;font:16px system-ui,sans-serif;cursor:pointer');
      x.addEventListener('click', hideToast);
      toastEl.appendChild(x);
      toastEl._setup = setup;
    }
    document.body.appendChild(toastEl);
    pads._toast = true;
  }
  function hideToast() {
    if (toastEl) { try { toastEl.remove(); } catch (e) {} toastEl = null; }
    pads._toast = false;
  }

  const wiz = { open: false, pid: null, i: 0, draft: null, el: null };
  function openWizard() {
    const first = firstPad();
    if (!first) return;
    wiz.open = true; wiz.pid = first.gp.id; wiz.i = 0; wiz.draft = {};
    hideToast();
    wiz.el = document.createElement('div');
    wiz.el.setAttribute('style',
      'position:fixed;inset:0;z-index:999998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)');
    const card = document.createElement('div');
    card.setAttribute('style',
      'padding:28px 34px;border-radius:14px;background:#12131a;color:#f0e6d2;max-width:400px;' +
      'font:15px system-ui,sans-serif;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.6)');
    wiz.el.appendChild(card);
    card._txt = document.createElement('p');
    card._txt.setAttribute('style', 'margin:0 0 6px;font-size:24px;font-weight:800;color:#ffd23f');
    card.appendChild(card._txt);
    const hint = document.createElement('p');
    hint.setAttribute('style', 'margin:0 0 14px;font-size:13px;color:#8a7a5c');
    hint.textContent = 'Hướng được nhận tự động từ tay cầm. Các nút được lưu cho loại tay cầm này, cùng với các nút bạn đã cài trong trò chơi trứng.';
    card.appendChild(hint);
    const cancel = document.createElement('button');
    cancel.textContent = 'Hủy';
    cancel.setAttribute('style',
      'border:0;border-radius:8px;padding:6px 12px;background:rgba(255,255,255,.18);color:#fff;' +
      'font:600 13px system-ui,sans-serif;cursor:pointer');
    cancel.addEventListener('click', () => closeWizard(false));
    card.appendChild(cancel);
    document.body.appendChild(wiz.el);
    stepUI();
  }
  function stepUI() {
    if (!wiz.el || !wiz.el.firstChild) return;
    const txt = wiz.el.firstChild._txt;
    txt.textContent = 'Nhấn nút cho ' + LABEL[SEQ[wiz.i]];
    const done = SEQ.slice(0, wiz.i).map(k => LABEL[k] + ': nút ' + wiz.draft[k]).join('  ·  ');
    if (done) {
      let side = wiz.el.parentNode.querySelector('.vgpad-progress');
      if (!side) {
        side = document.createElement('p');
        side.className = 'vgpad-progress';
        side.setAttribute('style', 'margin:10px 0 0;font-size:12px;color:#d8c9a8');
        wiz.el.firstChild.appendChild(side);
      }
      side.textContent = done;
    }
  }
  function closeWizard(save) {
    const pid = wiz.pid, draft = wiz.draft;
    if (wiz.el) { try { wiz.el.remove(); } catch (e) {} }
    wiz.open = false; wiz.pid = null; wiz.el = null; wiz.draft = null;
    if (save && draft) {
      const all = sget(OWN) || {};
      all[pid] = {
        jump: draft.jump,
        dash: draft.act,
        item: draft.act,
        pause: draft.start,
        dir: (all[pid] && all[pid].dir) || undefined
      };
      try { localStorage.setItem(OWN, JSON.stringify(all)); } catch (e) {}
      ownP = null; // force a re-read
      for (const i in pads) {
        if (i !== '_toast' && pads[i]) pads[i].prof = undefined;
      }
    }
    const first = firstPad();
    if (first && !profFor(first.id)) showToast('Đã nối tay cầm', true);
  }
  function feedWizard(gp) {
    for (let n = 0; n < gp.buttons.length; n++) {
      const b = gp.buttons[n];
      if (!(b && (b.pressed || b.value > 0.6))) continue;
      for (const k of SEQ) if (wiz.draft[k] === n) return; // still holding the previous button
      wiz.draft[SEQ[wiz.i]] = n;
      wiz.i++;
      if (wiz.i >= SEQ.length) closeWizard(true); else stepUI();
      return; // at most one button per frame
    }
  }
  document.addEventListener('keydown', e => { if (wiz.open && e.code === 'Escape') { e.preventDefault(); closeWizard(false); } });

  function firstPad() {
    try {
      const list = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of list) {
        const sta = gp && gp.connected !== false ? pads[gp.index] : null;
        if (sta) return { index: gp.index, gp, sta };
      }
    } catch (e) {}
    return null;
  }

  // ---------- poll ----------

  function poll() {
    if (wiz.open) {
      const f = firstPad();
      if (f && f.gp.id === wiz.pid) feedWizard(f.gp);
      return; // no game input while setup is open
    }
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    const seen = {};
    for (const gp of list) {
      if (!gp || gp.connected === false) continue;
      seen[gp.index] = 1;
      const sta = pads[gp.index] && pads[gp.index].id === gp.id
        ? pads[gp.index]
        : (pads[gp.index] = { id: gp.id, mapping: gp.mapping, rest: Array.prototype.slice.call(gp.axes), cur: {}, prof: undefined });
      if (sta.prof === undefined) {
        sta.prof = profFor(gp.id);
        if (!sta.prof && !pads._toast) showToast('Đã nối tay cầm — vẫn dùng được bàn phím', true);
        if (sta.prof) hideToast();
      }
      const d = decodeDir(gp, sta);
      setKey(sta, 'left', d.l);
      setKey(sta, 'right', d.r);
      setKey(sta, 'up', d.u);
      setKey(sta, 'down', d.d);
      setKey(sta, 'jump', btnAt(gp, sta.prof ? sta.prof.jump : 0));
      setKey(sta, 'act', btnAt(gp, sta.prof ? sta.prof.act : 1));
      setKey(sta, 'start', btnAt(gp, sta.prof ? sta.prof.start : 9));
    }
    for (const i in pads) {
      if (i === '_toast') continue;
      if (!seen[i]) { clearPad(pads[i]); delete pads[i]; }
    }
  }

  window.addEventListener('gamepadconnected', e => {
    const p = e.gamepad && e.gamepad.id ? profFor(e.gamepad.id) : null;
    if (!p) showToast('Đã nối tay cầm — vẫn dùng được bàn phím', true);
  });
  window.addEventListener('gamepaddisconnected', () => hideToast());

  function loop() { try { poll(); } catch (e) {} window.requestAnimationFrame(loop); }
  window.requestAnimationFrame(loop);
})();
