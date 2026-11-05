id: fugue
title: Fugue
players: 1-8
max-lines: 2400
hidden: none

rules: |
  Three or more players. Every round one player is the CONNECTIONIST and the
  rest are STREAMERS. Each streamer has their own secret prompt and must lock
  a word every 3 seconds (type it, hit space — like an email address turning
  into a bubble). The host picks the flavor of the set: Classic holds one
  relation for the whole round; Full Fugue snaps to a new relation after every
  link; Free Association deals no relation and any link stands if the streamers
  vote it through (not available solo). The connectionist sees every locked
  word and forges links, one word from each of two or more streams. Straight
  vertical links and links reaching more streams score more. Streamers score
  too: 1 point per locked word, and 4 points for a word blessed by a standing
  link (a #blessed flash marks it at the tally). A streamer may swap their
  prompt once per round during live for 3 points; locked words carry over.
  Linked words turn into small lightning bolts; a column with every stream
  full of linked words collapses to a sliver. Afterwards the streamers vote on
  every link. Everyone takes a turn connecting, then the set is compared.
  On a one-player table the lobby offers two solo modes: Stream (timed word
  locking from a prompt) and Connect (three books, drawn from the bank baked
  by scripts/bake-fugue-words.py, drip words; the player is the connectionist
  and every link stands unjudged).

actions: |
  { a: 'join' }
  { a: 'start' }
  { a: 'start', m: 'classic' | 'full' | 'free' }
  { a: 'go' }
  { a: 'word', w: <text> }
  { a: 'link', picks: [...] }
  { a: 'prompt' }
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