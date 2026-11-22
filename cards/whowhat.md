id: whowhat
title: Who Did What?
players: 3-8
max-lines: 400
hidden: none

rules: |
  Everyone writes one true line about the last five years, unsigned, 140
  characters max. Lines are shuffled. Everyone guesses the author of every
  line except their own. A right guess scores +1 to the guesser; a wrong
  guess on your line scores +1 to you (you tricked them). The host reveals,
  then starts the next round or returns to the lobby.

actions: |
  { a: 'join' }
  { a: 'start' }
  { a: 'line', text: <string> }
  { a: 'guess', picks: [<writer id or null per line>] }
  { a: 'reveal' }
  { a: 'lobby' }

summarize: "<name> fooled the table best this round."

scenarios:
  - name: only the host can start
    steps: p1 join, p2 join, p3 join, p2 start
    expect: { "error": true }
  - name: a three-player round reaches reveal
    steps: p1 join, p2 join, p3 join, p1 start
    expect: { "summarize": null }
" filePath="/home/mark/Documents/BubHub/cards/whowhat.md