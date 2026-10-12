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
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(function () { prompt('Copy this link:', text); });
  }
  prompt('Copy this link:', text);
  return Promise.resolve();
}

export function createInvite(opts) {
  const store = opts.store;

  function currentLink() {
    const s = store.state;
    if (!s.roomId) return '';
    return buildInviteLink(s.roomId, s.openGame || '');
  }

  function copyInvite() {
    const link = currentLink();
    if (!link) return;
    copyText(link);
  }

  function wire() {
    ['active-room-id', 'drawer-room', 'focus-room', 'btn-header-room'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', copyInvite);
    });
    const bf = document.getElementById('btn-invite-focus');
    if (bf) bf.addEventListener('click', copyInvite);
  }

  return { currentLink: currentLink, copyInvite: copyInvite, wire: wire };
}
