// BubHub v10 — Shadow DOM stage with error boundary + forced teardown.
// Every game mount gets tracked rAF/timer wrappers via api; destroy()
// cancels anything the game forgot, so switching games never leaks loops.
export function createStage(rootEl) {
  let current = null; // { meta, host, shadow, handle, rafIds, timeouts, intervals }

  function clear() {
    if (!current) return;
    const c = current;
    current = null;
    try { if (c.handle && typeof c.handle.destroy === 'function') c.handle.destroy(); } catch (e) {
      console.error('game destroy() threw:', e);
    }
    c.rafIds.forEach(function (id) { try { cancelAnimationFrame(id); } catch (e) {} });
    c.timeouts.forEach(function (id) { try { clearTimeout(id); } catch (e) {} });
    c.intervals.forEach(function (id) { try { clearInterval(id); } catch (e) {} });
    c.rafIds.length = 0; c.timeouts.length = 0; c.intervals.length = 0;
    rootEl.innerHTML = '';
    rootEl.classList.add('stage-idle');
    // Only drop the shell modes when no legacy frame is still visible — a
    // module clear racing an iframe open must not strip the stage out from
    // under it (open re-asserts both classes anyway).
    if (!rootEl.querySelector('iframe:not(.hidden)')) {
      document.body.classList.remove('focus-mode', 'drawer-open', 'stage-scroll');
    }
  }

  function errorCard(meta, err) {
    rootEl.innerHTML = '';
    rootEl.classList.remove('stage-idle');
    const d = document.createElement('div');
    d.className = 'stage-host pop-in';
    d.style.cssText = 'padding:24px;color:#fca5a5';
    d.textContent = 'Could not start ' + (meta.title || meta.id) + ': ' + ((err && err.message) || err);
    rootEl.appendChild(d);
  }

  // mount(meta, gameModule, api) — gameModule has mount(el, api)
  function mount(meta, gameModule, api) {
    clear();
    rootEl.classList.remove('stage-idle');
    const host = document.createElement('div');
    host.className = 'stage-host';
    rootEl.appendChild(host);
    let shadow = null;
    try {
      shadow = host.attachShadow({ mode: 'open' });
    } catch (e) {
      errorCard(meta, e);
      return null;
    }
    const rec = { meta: meta, host: host, shadow: shadow, handle: null, rafIds: [], timeouts: [], intervals: [] };
    const origRAF = window.requestAnimationFrame.bind(window);
    const trackedApi = Object.assign({}, api, {
      root: shadow,
      raf: function (fn) {
        const id = origRAF(function (t) {
          const i = rec.rafIds.indexOf(id);
          if (i >= 0) rec.rafIds.splice(i, 1);
          fn(t);
        });
        rec.rafIds.push(id);
        return id;
      },
      cancelRaf: function (id) {
        try { cancelAnimationFrame(id); } catch (e) {}
        const i = rec.rafIds.indexOf(id);
        if (i >= 0) rec.rafIds.splice(i, 1);
      },
      setTimeout: function (fn, ms) {
        const id = setTimeout(function () {
          const i = rec.timeouts.indexOf(id);
          if (i >= 0) rec.timeouts.splice(i, 1);
          fn();
        }, ms);
        rec.timeouts.push(id);
        return id;
      },
      setInterval: function (fn, ms) {
        const id = setInterval(fn, ms);
        rec.intervals.push(id);
        return id;
      }
    });
    current = rec;
    try {
      rec.handle = gameModule.mount(shadow, trackedApi);
    } catch (e) {
      console.error('game mount() threw:', e);
      errorCard(meta, e);
      current = null;
      return null;
    }
    document.body.classList.add('focus-mode');
    // Module games have no fill flag: Focus is a bounded canvas (no overflow,
    // so the scrollable stage is harmless) while Hook is a compact
    // composer that fits without it. Default modules to scroll mode unless
    // they opt into fill.
    document.body.classList.toggle('stage-scroll', !meta.fill);
    return {
      update: function (view) {
        try { if (rec.handle && typeof rec.handle.update === 'function') rec.handle.update(view); } catch (e) {
          console.error('game update() threw:', e);
        }
      },
      destroy: clear
    };
  }

  return {
    mount: mount,
    clear: clear,
    get current() { return current ? current.meta : null; }
  };
}
