// Bub Hub game registry. Adding a game = drop its .html file in this folder
// and add one line below. index.html is never touched.
// Loaded with a plain script tag (not fetch) so double-clicking index.html works.
window.BUB_GAMES = [
  { id: 'goldberg', file: 'goldberg.html', title: 'Goldberg', players: '2-5', color: '#e6c280', fill: true, lobby: true },
  { id: 'daltadka', file: 'tadka.html', title: 'Dal Tadka', players: 'solo', color: '#d9b26f', solo: true, lobby: true, fill: true },
  { id: 'warp', file: 'warpfront.html', title: 'Warp Front', players: '2-3', color: '#00ffcc' },
  { id: 'lotr', file: 'lotr.html', title: 'LOTR Cards', players: '2-6', color: '#b9c98a' },
  { id: 'blastoff', file: 'blastoff.html', title: 'Blast Off!', players: '2-6', color: '#00f2ff' },
  { id: 'grammar', file: 'discover_the_grammar.html', title: 'Discover the Grammar', players: '2-4', color: '#f3f0e8' },
  //{ id: 'wordwright', file: 'wordwright.html', title: 'Wordwright', players: '2-5', color: '#a5b4fc' },
  // solo: playable with no room and no bridge. `lobby: true` also lists it
  // in the lobby so there is something to play while waiting for others.
  // `fill` lets the stage own the viewport (solo games never report a height,
  // so the hub sizes the frame itself instead of pinning it).
  { id: 'waltz', file: 'LobbyWaltzEngine.html', title: 'Waltz Engine', players: 'solo', color: '#d9b26f', solo: true, lobby: true, fill: true },
  //{ id: 'DrawDrive', file: 'DrawDrive.html', title: 'Draw and Drive', players: '1-4', color: '#3cc3d4', fill: true },
  { id: 'eggs', file: 'eggs.html', title: 'eggs', players: '1-4', color: '#ffd23f', fill: true },
];
