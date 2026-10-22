---
id: bladeslash
title: Blade & Word
players: 1-8
color: "#ef4444"
icon: "⚔️"
desc: "Swipe to slash the Vietnamese word that matches the picture — plus a Target Dojo flashcard mode and missed-word review."
soloable: true
---

# Blade & Word

A fast-paced touch-screen sword-slashing game for Vietnamese minimal pairs and tones, with an interactive Target Dojo flashcard mode.

## Rules

- **Start (`{ a: 'start' }`)**: The host (or solo player) starts a round with 3 lives, score 0, an empty `missed` list, and a 3.5-second fuse for the first prompt.
- **Prompts**: Each prompt displays a center emoji picture (`pic`) and two words (`left` and `right`): one matching word and one decoy.
- **Slash (`{ a: 'slash', side: 'left' | 'right' }`)**:
  - **Correct side**: Increments `score` and `streak`, deals the next prompt immediately, and tightens the fuse timer down to a floor of 1.1 seconds.
  - **Wrong side**: The word turns to solid steel. Decrements `lives`, resets `streak` to 0, records the missed card in `state.missed`, and deals the next prompt (or ends the game if `lives <= 0`).
- **Timeout (`{ a: 'timeout' }`)**: Validated against `state.endsAt`. Costs 1 life, resets `streak`, records the missed card in `state.missed`, and deals the next prompt (or ends the game if `lives <= 0`).
- **Missed Review & Target Dojo**: Any missed cards are displayed at the end of the game loop (`state.over.missed`) and can be practiced in interactive bamboo-target Flashcard Dojo mode.
- **Record (`summarize`)**: When `phase === 'over'`, records `<Name> sliced <score> words in Blade & Word`.