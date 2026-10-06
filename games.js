// Bub Hub game registry. Adding a game = drop its .html file in this folder
// and add one line below. index.html is never touched.
// Loaded with a plain script tag (not fetch) so double-clicking index.html works.
window.BUB_GAMES = [
  { id: 'warp', file: 'warpfront.html', title: 'Warp Front', players: '2-3', color: '#00ffcc' },
  { id: 'lotr', file: 'lotr.html', title: 'LOTR Cards', players: '2-6', color: '#b9c98a' },
  // solo: playable with no room and no bridge. `lobby: true` also lists it
  // in the lobby so there is something to play while waiting for others.
  // `height` fixes the stage size since a solo game never reports one.
  { id: 'waltz', file: 'LobbyWaltzEngine.html', title: 'Waltz Engine', players: 'solo', color: '#d9b26f', solo: true, lobby: true, height: 640 },
];
