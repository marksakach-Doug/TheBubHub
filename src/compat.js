// BubHub v10 — compat shim for legacy iframe games (chess.html, eggs.html…).
// Old games speak postMessage { t:'gu', game, k, p }; the hub used to reply
// { t:'gd', game, k, p }. This shim keeps that contract alive inside the new
// hub: roster/state/intent/result/denied all translated to/from room/store.
import { T } from '../net/protocol.js';

export function createCompat(stageRoot) {
  const frames = new Map(); // gameId -> { el, ready, queue: [] }
  let openId = null;
  const hooks = { onIntent: null, onResult: null, onTouched: null };

  function ensureFrame(meta, file) {
    let f = frames.get(meta.id);
    if (f) return f;
    const el = document.createElement('iframe');
    el.id = 'frame-' + meta.id;
    el.className = 'hidden';
    el.setAttribute('src', file);
// `fill` = the hub owns the frame height (canvas worlds); `grow` = the frame is
// sized to the game and the whole page scrolls. They are mutually exclusive, and
// only `fill` needs a CSS hook, because only `fill` overrides a reported height.
if (meta.fill) el.classList.add('frame-fill');
el.style.minHeight = (meta.height || 420) + 'px';
stageRoot.appendChild(el);
stageRoot.classList.remove('stage-idle');
f = { el: el, ready: false, queue: [], meta: meta };
    frames.set(meta.id, f);
    return f;
  }

  function down(gameId, k, p, from) {
    const f = frames.get(gameId);
    const m = { t: 'gd', game: gameId, k: k, p: p };
    if (from !== undefined) m.from = from;
    if (!f) return;
    if (!f.ready) { f.queue.push(m); return; }
    try { f.el.contentWindow.postMessage(m, '*'); } catch (e) {}
  }

  function pushRoster(gameId, rosterMsg) { down(gameId, 'roster', rosterMsg); }

  function open(meta, file) {
    frames.forEach(function (f) { f.el.classList.add('hidden'); });
    const f = ensureFrame(meta, file);
    f.el.classList.remove('hidden');
    stageRoot.classList.remove('stage-idle');
    openId = meta.id;
    document.body.classList.add('focus-mode');
  }

  function close(gameId) {
    const id = gameId || openId;
    if (!id) return;
    const f = frames.get(id);
    if (f) {
      f.el.classList.add('hidden');
      try { f.el.contentWindow.postMessage({ t: 'gd', game: id, k: 'hide' }, '*'); } catch (e) {}
    }
    if (id === openId) openId = null;
    if (!openId) {
      let anyVisible = false;
      frames.forEach(function (x) { if (!x.el.classList.contains('hidden')) anyVisible = true; });
      if (!anyVisible) {
        document.body.classList.remove('focus-mode', 'drawer-open');
        if (!stageRoot.querySelector('.stage-host')) stageRoot.classList.add('stage-idle');
      }
    }
  }

  function closeAll() {
    frames.forEach(function (f, id) { close(id); });
  }

  function onMessage(e, ctx) {
    const m = e.data;
    if (!m || m.t !== 'gu') return;
    const game = m.game;
    const f = frames.get(game);
    if (m.k === 'hello') {
      if (f) {
        f.ready = true;
        const q = f.queue.splice(0);
        q.forEach(function (qm) { try { f.el.contentWindow.postMessage(qm, '*'); } catch (err) {} });
      }
      if (ctx && ctx.onHello) ctx.onHello(game);
      return;
    }
    if (m.k === 'height') {
      // `fill` games never own their height — the CSS pins the frame to the
      // viewport. `grow` games do report it; that's the point of `grow`.
      if (f && f.meta && !f.meta.fill && typeof m.p === 'number') {
        f.el.style.height = Math.min(Math.max(m.p, 200), 4000) + 'px';
      }
      return;
    }
    if (m.k === 'close') { close(game); return; }
    if (m.k === 'intent') {
      // Goldberg-style engines never post result; any intent counts as play.
      if (hooks.onTouched) { try { hooks.onTouched(game); } catch (err) {} }
      if (ctx && ctx.routeIntent) ctx.routeIntent(game, m.p);
      return;
    }
    if (m.k === 'state') {
      if (ctx && ctx.routeState) ctx.routeState(game, m.p);
      return;
    }
    if (m.k === 'result') {
      if (hooks.onResult) { try { hooks.onResult(game, m.p); } catch (err) {} }
      return;
    }
    if (m.k === 'denied') {
      if (ctx && ctx.routeDenied) ctx.routeDenied(game, m.p);
      return;
    }
    // 'say' and 'invite' from legacy: say is dropped (chat log stays clean),
    // invite is handled by hub invite plugin via ctx.
    if (m.k === 'invite') {
      if (ctx && ctx.onInvite) ctx.onInvite(game);
    }
  }

  return {
    hooks: hooks,
    open: open,
    close: close,
    closeAll: closeAll,
    pushRoster: pushRoster,
    down: down,
    onMessage: onMessage,
    get openId() { return openId; },
    isCompat(id) { return frames.has(id); }
  };
}

// Build the legacy roster payload old games expect:
// { you:{id,name,isHost}, room, roster:[{id,name,host}] }
export function legacyRoster(store) {
  const s = store.state;
  return {
    you: { id: s.me.id, name: s.me.name, isHost: s.isHost },
    room: s.roomId || '',
    roster: s.roster.map(function (m) { return { id: m.id, name: m.name, host: !!m.host }; })
  };
}

export { T };
