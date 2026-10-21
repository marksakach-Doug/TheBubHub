---
id: bladeslash
title: Blade & Word
players: 1-8
color: "#ef4444"
icon: "⚔️"
desc: "Swipe to slash the Vietnamese word that matches the picture — hit the wrong word and your blade clangs off solid steel."
soloable: true
---

# Blade & Word

A fast-paced touch-screen sword-slashing game for Vietnamese minimal pairs and tones.

## Rules

- **Start (`{ a: 'start' }`)**: The host (or solo player) starts a round with 3 lives, score 0, and a 3.5-second fuse for the first prompt.
- **Prompts**: Each prompt displays a center emoji picture (`pic`) and two words (`left` and `right`): one matching word and one decoy.
- **Slash (`{ a: 'slash', side: 'left' | 'right' }`)**:
  - **Correct side**: Increments `score` and `streak`, deals the next prompt immediately, and tightens the fuse timer down to a floor of 1.1 seconds.
  - **Wrong side**: The word turns to solid steel. Decrements `lives`, resets `streak` to 0, records `lastResult = 'clang'`, and deals the next prompt (or ends the game if `lives <= 0`).
- **Timeout (`{ a: 'timeout' }`)**: Validated against `state.endsAt`. Costs 1 life, resets `streak`, and deals the next prompt (or ends the game if `lives <= 0`).
- **Record (`summarize`)**: When `phase === 'over'`, records `<Name> sliced <score> words in Blade & Word`.