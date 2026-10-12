// BubHub v10 — PeerJS wrapper with TURN config hook.
// No host election / probeRoom / takeover logic: those were deleted.
// If the host drops, guests dial the same room id until room/grace.js expires.
import { T, msg, isValid } from './protocol.js';

const DEFAULT_TURN = []; // set via window.BUB_TURN = [{ urls, username, credential }]

function peerConfig() {
  const turn = window.BUB_TURN || DEFAULT_TURN;
  const cfg = { debug: 0 };
  if (turn && turn.length) cfg.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }].concat(turn) };
  return cfg;
}

function getPeerCtor() {
  if (typeof window.Peer !== 'undefined') return window.Peer;
  throw new Error('PeerJS failed to load (CDN offline?). Check connection and reload.');
}

// onEvent: (kind, payload) where kind is one of:
// 'open' | 'guest-open' | 'message' | 'guest-left' | 'peer-error' | 'host-conn'
export function createNet(onEvent) {
  let peer = null;
  let hostConn = null; // guest -> host connection
  const guests = new Map(); // host-side: playerId -> conn
  let closed = false;

  function destroyPeer() {
    try { if (hostConn) hostConn.close(); } catch (e) {}
    try {
      guests.forEach(function (c) { try { c.close(); } catch (e) {} });
    } catch (e) {}
    guests.clear();
    hostConn = null;
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = null;
  }

  function wireGuestConn(conn, emitHello) {
    conn.on('open', function () {
      hostConn = conn;
      if (emitHello) emitHello(conn);
      onEvent('guest-open', { conn: conn });
    });
    conn.on('data', function (m) {
      if (!isValid(m)) return;
      onEvent('message', { fromConn: conn, msg: m });
    });
    conn.on('close', function () {
      if (hostConn === conn) hostConn = null;
      onEvent('host-conn', { state: 'closed' });
    });
    conn.on('error', function () {});
  }

  function wireHostConn(conn) {
    conn.on('open', function () {});
    conn.on('data', function (m) {
      if (!isValid(m)) return;
      onEvent('message', { fromConn: conn, msg: m });
    });
    conn.on('close', function () {
      let gone = null;
      guests.forEach(function (c, id) { if (c === conn) gone = id; });
      if (gone) guests.delete(gone);
      onEvent('guest-left', { id: gone });
    });
    conn.on('error', function () {});
  }

  return {
    get guests() { return guests; },
    get peer() { return peer; },

    host(roomId, attempt) {
      closed = false;
      destroyPeer();
      const Peer = getPeerCtor();
      return new Promise(function (resolve, reject) {
        let p;
        try { p = new Peer(roomId, peerConfig()); } catch (e) { reject(e); return; }
        peer = p;
        p.on('open', function () { onEvent('open', { room: roomId }); resolve(roomId); });
        p.on('connection', function (conn) {
          wireHostConn(conn);
          // remember by peer label once hello arrives; keep pending meanwhile
          const t = setInterval(function () {
            if (conn.open) { clearInterval(t); }
          }, 500);
        });
        p.on('disconnected', function () { try { p.reconnect(); } catch (e) {} });
        p.on('error', function (err) {
          if (err && (err.type === 'unavailable-id' || err.type === 'taken')) {
            if ((attempt || 0) < 5) {
              setTimeout(function () {
                this.host(roomId, (attempt || 0) + 1).then(resolve, reject);
              }.bind(this), 600);
            } else {
              reject(new Error('Room id taken — pick another name.'));
            }
          } else {
            onEvent('peer-error', { err: err });
          }
        }.bind(this));
        p.on('close', function () {});
      }.bind(this));
    },

    // called by host when a hello arrives to bind id -> conn
    bindGuest(id, conn) { guests.set(id, conn); },

    join(roomId) {
      closed = false;
      destroyPeer();
      const Peer = getPeerCtor();
      return new Promise(function (resolve, reject) {
        let p;
        try { p = new Peer(peerConfig()); } catch (e) { reject(e); return; }
        peer = p;
        p.on('open', function () {
          const conn = p.connect(roomId, { reliable: true });
          wireGuestConn(conn, null);
          resolve(conn);
        });
        p.on('disconnected', function () { try { p.reconnect(); } catch (e) {} });
        p.on('error', function (err) {
          if (err && err.type === 'peer-unavailable') {
            reject(new Error('Room not found — is the host still there?'));
          } else {
            onEvent('peer-error', { err: err });
          }
        });
      });
    },

    // guest redial during grace period: fresh Peer, same room id
    redial(roomId, onHello) {
      const Peer = getPeerCtor();
      let p;
      try { p = new Peer(peerConfig()); } catch (e) { return null; }
      // swap out the old dead peer without clearing guest map (host path unused here)
      try { if (peer) peer.destroy(); } catch (e) {}
      peer = p;
      p.on('open', function () {
        const conn = p.connect(roomId, { reliable: true });
        wireGuestConn(conn, onHello);
      });
      p.on('error', function () {});
      return p;
    },

    sendToHost(m) {
      if (hostConn && hostConn.open) { try { hostConn.send(m); return true; } catch (e) {} }
      return false;
    },

    sendTo(id, m) {
      const c = guests.get(id);
      if (c && c.open) { try { c.send(m); return true; } catch (e) {} }
      return false;
    },

    broadcast(m, exceptId) {
      guests.forEach(function (c, id) {
        if (id === exceptId) return;
        if (c && c.open) { try { c.send(m); } catch (e) {} }
      });
    },

    sendHello(conn, hello) { try { conn.send(msg(T.HELLO, hello)); } catch (e) {} },

    close() { closed = true; destroyPeer(); }
  };
}
