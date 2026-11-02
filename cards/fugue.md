id: fugue
title: Fugue
players: 3-8
max-lines: 500
hidden: none

rules: |
  Three or more players. Every round one player is the CONNECTIONIST and the
  rest are STREAMERS. Each streamer has their own secret prompt and must lock
  a word every 3 seconds (type it, hit space — like an email address turning
  into a bubble). The connectionist sees every locked word and forges links,
  one word from each of two or more streams, that fit a relation which snaps
  to a new one after every link. Straight vertical links and links reaching
  more streams score more. Afterwards the streamers vote on every link. Only
  the connectionist scores; everyone takes a turn, then the set is compared.

actions: |
  { a: 'join' }
  { a: 'start' }
  { a: 'go' }
  { a: 'word', w: <text> }
  { a: 'link', picks: [...] }
  { a: 'finish' }
  { a: 'vote', n: <num>, yes: <bool> }
  { a: 'close' }
  { a: 'next' }

summarize: "<name> won Fugue with <pts> points (<rest>)"

scenarios:
  - name: init with 3 players starts a set
    steps: p1 join, p2 join, p3 join, start
    expect: { "phase": "intro" }
  - name: adding four is not a legal move
    steps: p1 add 4
    expect: { "error": true }
  - name: a full set runs through intro, live, vote, tally, over
    steps: p1 join, p2 join, p3 join, start, go, word p1 hello, word p2 world, finish, vote p1 yes, close
    expect: { "summarize": "Alice won Fugue with 0 points (Bo 0)" }