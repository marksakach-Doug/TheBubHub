id: raceton
title: Race to Ten
players: 2
max-lines: 250
hidden: none

rules: |
  Race to ten. On your turn add 1, 2 or 3 to your own total. First to ten or
  more wins. Nothing is hidden — both totals are on the table.

actions: |
  { a: 'add', n: 1 | 2 | 3 }

summarize: "<name> beat <name> at Race to Ten, null until over"

scenarios:
  - name: nothing is on the record sheet before the game is over
    steps: p1 add 3
    expect: { "summarize": null }
  - name: a full game, p1 gets to ten first
    steps: p1 add 3, p2 add 2, p1 add 3, p2 add 2, p1 add 3, p2 add 2, p1 add 3
    expect: { "summarize": "Alice beat Bo at Race to Ten" }
  - name: p2 can be the one who wins
    steps: p1 add 1, p2 add 3, p1 add 1, p2 add 3, p1 add 1, p2 add 3, p1 add 1, p2 add 3
    expect: { "summarize": "Bo beat Alice at Race to Ten" }
  - name: adding four is not a legal move
    steps: p1 add 4
    expect: { "error": true }
  - name: adding zero is not a legal move
    steps: p1 add 0
    expect: { "error": true }
  - name: out of your turn
    steps: p2 add 3
    expect: { "error": true }

out of scope: timers, animation, hidden information, sound, libraries