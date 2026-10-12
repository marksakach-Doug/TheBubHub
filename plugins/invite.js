// BubHub v10 — invite / share-link plugin.
// Link shape stays ?room=<id>&game=<gameId> so old links keep working.
export function buildInviteLink(room, game) {
  const base = location.href.split('?')[0].split('#')[0];
  const q = '?room=' + encodeURIComponent(room) + (game ? '&game=' + encodeURIComponent(game) : '');
  return base + q;
}

export function parseInvite() {
  try {
    const u = new URL(location.href);
    return { room: u.searchParams.get('room') || '', game: u.searchParams.get('game') || '' };
  } catch (e) {
    return { room: '', game: '' };
  }
}

export function copyText(text) {
  // Fallback chain — navigator.clipboard rejects without permission/focus
  // (mobile, background tabs), execCommand covers the rest, prompt is last.
  // Resolves true when the link is on the clipboard, false otherwise.
  function viaTextarea(t) {
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () {
          if (viaTextarea(text)) return true;
          prompt('Copy this link:', text);
          return false;
        }
      );
    }
  } catch (e) {}
  if (viaTextarea(text)) return Promise.resolve(true);
  prompt('Copy this link:', text);
  return Promise.resolve(false);
}

export function createInvite(opts) {
  const store = opts.store;

  function currentLink() {
    const s = store.state;
    if (!s.roomId) return '';
    return buildInviteLink(s.roomId, s.openGame || '');
  }

  function flash(el, ok) {
    if (!el) return;
    const orig = el.textContent;
    const note = ok ? 'Copied ✓' : 'Copy failed — long-press to copy';
    el.textContent = note;
    setTimeout(function () {
      // only restore if nothing else (e.g. a roster redraw) relabeled it
      try { if (document.contains(el) && el.textContent === note) el.textContent = orig; } catch (e) {}
    }, 1500);
  }

  function copyInvite(sourceEl) {
    const link = currentLink();
    if (!link) return;
    copyText(link).then(function (ok) { flash(sourceEl, ok); });
  }

  function wire() {
    ['active-room-id', 'drawer-room', 'focus-room', 'btn-header-room'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', function () { copyInvite(el); });
    });
  }

  return { currentLink: currentLink, copyInvite: copyInvite, wire: wire };
}
