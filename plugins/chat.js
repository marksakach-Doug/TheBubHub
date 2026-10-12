// BubHub v10 — chat plugin. Player chat only; game `say` chatter is dropped.
// Host relays to all guests.
import { T, msg } from '../net/protocol.js';

export function createChat(opts) {
  const store = opts.store;
  const getNet = opts.getNet || function () { return opts.net || null; };
  const box = document.getElementById('chat-box');
  const peek = document.getElementById('chat-peek');
  const pill = document.getElementById('chat-pill');
  const unread = document.getElementById('chat-unread');
  let unseen = 0;
  let peekTimer = null;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function renderPill() {
    if (!unread) return;
    unread.textContent = unseen > 0 ? '(' + unseen + ')' : '';
  }

  function logChat(name, text) {
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'text-slate-200 text-sm leading-relaxed';
    const b = document.createElement('b');
    b.className = 'text-teal-300 mr-1';
    b.textContent = name + ':';
    div.appendChild(b);
    div.appendChild(document.createTextNode(String(text)));
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    const drawerOpen = document.body.classList.contains('drawer-open') ||
      !document.body.classList.contains('focus-mode');
    if (!drawerOpen) {
      unseen += 1;
      renderPill();
      if (peek) {
        peek.classList.remove('hidden');
        peek.textContent = name + ': ' + text;
        if (peekTimer) clearTimeout(peekTimer);
        peekTimer = setTimeout(function () { peek.classList.add('hidden'); }, 6000);
      }
    }
  }

  function markSeen() { unseen = 0; renderPill(); }

  function send(text) {
    const t = String(text || '').trim().slice(0, 500);
    if (!t) return;
    const s = store.state;
    const packet = msg(T.CHAT, { id: s.me.id, name: s.me.name, text: t });
    const net = getNet();
    if (s.isHost) {
      logChat(s.me.name, t);
      if (net) net.broadcast(packet);
    } else {
      // optimistic local echo; host relay will deliver to others
      logChat(s.me.name, t);
      if (net) net.sendToHost(packet);
    }
  }

  function onNetMessage(m) {
    if (m.type === T.CHAT) {
      logChat(m.p.name || 'Player', m.p.text || '');
      const s = store.state;
      const net = getNet();
      if (s.isHost && net) net.broadcast(m); // relay to other guests
    }
  }

  function wire() {
    const input = document.getElementById('chat-input');
    const btn = document.getElementById('btn-send');
    if (btn) btn.addEventListener('click', function () { send(input.value); input.value = ''; });
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { send(input.value); input.value = ''; }
    });
    if (pill) pill.addEventListener('click', function () {
      document.body.classList.add('drawer-open');
      markSeen();
    });
  }

  return { send: send, onNetMessage: onNetMessage, logChat: logChat, markSeen: markSeen, wire: wire };
}
