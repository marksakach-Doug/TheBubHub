id: blight
title: Blight
players: 3-6
max-lines: 1200
hidden: none

rules: |
  Everyone starts with three Living Plants (✿) and one Dead Tree (✖). Each round everyone
  plants one card face down, may add more, then someone starts the bidding: how many Living
  Plants can be revealed? The top bidder flips their own stack first, then other stacks, one
  card at a time. Reveal a Dead Tree and you lose a card. Win two rounds, or be the last
  gardener standing. Bots fill empty seats so a table never stalls. reduce() runs only on the
  host; project() keeps other players' hands and face-down stacks hidden.

actions: |
  { a: 'join' }
  { a: 'bots', n: <num> }
  { a: 'start' }
  { a: 'place', k: 'P' | 'D' }
  { a: 'add', k: 'P' | 'D' }
  { a: 'bid', n: <num> }
  { a: 'raise', n: <num> }
  { a: 'fold' }
  { a: 'flip', t: <player id> }
  { a: 'lose', k: 'P' | 'D' }
  { a: 'ready' }
  { a: 'next' }
  { a: 'skip' }
  { a: 'toLobby' }

summarize: "<name> won Blight in <n> round(s) against <others>"

scenarios:
  - name: a player cannot place out of turn
    steps: p1 join, p2 join, p3 join, start, p2 place P
    expect: { "error": true }
  - name: a three-player game plays to a winner
    steps: p1 join, p2 join, p3 join, start
    expect: { "summarize": null }
  - name: host can return to the lobby mid-game
    steps: p1 join, p2 join, p3 join, start, p1 toLobby
    expect: { "summarize": null }
