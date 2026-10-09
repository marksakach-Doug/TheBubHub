// Bub Hub game registry. Adding a game = drop its .html file in this folder
// and add one line below. index.html is never touched.
// Loaded with a plain script tag (not fetch) so double-clicking index.html works.
//
// `icon` and `desc` are pure decoration: the icon leads the button, the one
// sentence in `desc` shows up in the button's tooltip next to the player count.
//
// `soloable: true` = a bridge game that also runs a real solo table, so it
// belongs in the pre-room "Solo Corner" list. Such a game promotes itself to
// local host when the hub reports no room (see goldberg.html for the pattern).
// It keeps its real player count for the in-room grouping.
//
// `menuLabel` overrides the button text only (not the title used in invites,
// chat, and the record) — for games that aren't really "played".
window.BUB_GAMES = [
  { id: 'goldberg', file: 'goldberg.html', title: 'Goldberg', players: '2-5', color: '#e6c280', fill: true, lobby: true,
    icon: '🔔', desc: 'Build a chain-reaction machine together out of parts, then press play and watch it go.' },
  { id: 'daltadka', file: 'daltadka.html', title: 'Dal Tadka', players: 'solo', color: '#d9b26f', solo: true, lobby: true, fill: true,
    icon: '🍲', desc: 'Cook dal from scratch for hungry judges, who score how well you timed each step.' },
  { id: 'warp', file: 'warpfront.html', title: 'Warp Front', players: '2-3', color: '#00ffcc', soloable: true,
    icon: '🛸', desc: 'Claim a faction and play cards onto planets — first side to five planets wins.' },
  { id: 'lotr', file: 'lotr.html', title: 'LOTR Cards', players: '2-6', color: '#b9c98a',
    icon: '🃏', desc: 'Race to Level 15 while monsters hunt whoever is in the lead.' },
  { id: 'blastoff', file: 'blastoff.html', title: 'Blast Off!', players: '2-6', color: '#00f2ff', soloable: true,
    icon: '🚀', desc: 'Pick destinations and maneuver your rocket; the hand holding most red cards launches first.' },
  { id: 'grammar', file: 'discover_the_grammar.html', title: 'Discover the Grammar', players: '2-4', color: '#f3f0e8', soloable: true,
    icon: '🔤', desc: 'Compare strange sentences side by side and work out the hidden rule behind them.' },
  { id: 'wordbridge', file: 'wordbridge.html', title: 'Word Bridge', players: '2-4', color: '#000000',
    icon: '🌉', desc: 'Everyone writes one word that fits both meanings, then the table judges each bridge.' },
  //{ id: 'wordwright', file: 'wordwright.html', title: 'Wordwright', players: '2-5', color: '#a5b4fc',
  //  icon: '📝', desc: 'Co-write a story one sentence at a time.' },
  // solo: playable with no room and no bridge. `lobby: true` also lists it
  // in the lobby so there is something to play while waiting for others.
  // `fill` lets the stage own the viewport (solo games never report a height,
  // so the hub sizes the frame itself instead of pinning it).
  { id: 'waltz', file: 'LobbyWaltzEngine.html', title: 'Waltz Engine', players: 'solo', color: '#d9b26f', solo: true, lobby: true, fill: true,
    icon: '💃', desc: 'Step, turn and glide in time with a waltz the engine writes for you.' },
  { id: 'truth', file: 'truths.html', title: 'Write Something True', players: 'solo', color: '#b8a77e', solo: true, lobby: true, fill: true, noRecord: true,
    menuLabel: 'Write something true',
    icon: '✍️', desc: 'Write one honest line a day — editable until midnight, sealed after.' },
  //{ id: 'DrawDrive', file: 'DrawDrive.html', title: 'Draw and Drive', players: '1-4', color: '#3cc3d4', fill: true,
  //  icon: '✏️', desc: 'Draw a track, then drive a car along what you drew.' },
  { id: 'eggs', file: 'eggs.html', title: 'eggs', players: '1-4', color: '#ffd23f', fill: true, soloable: true,
    icon: '🥚', desc: 'Bounce and splat around a chicken coop, growing bigger with beans while you knock rivals off the edge.' },
  { id: 'chess', file: 'chess.html', title: 'Chess', players: '1-2', color: '#c89b6d', fill: true, soloable: true,
    icon: '♞', desc: 'Full-rules chess — you are White, against a friend or a simple greedy bot.' },
];
