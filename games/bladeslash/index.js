// Blade & Word — a module game for Bub Hub.
//
// The contract has no tick: state only moves through reduce(). The host owns
// the deck order, the current prompt (pic, left, right, correctSide), the
// score, lives, and endsAt for the current word's fuse bar. The client runs a
// 60fps api.raf loop to drain the timer bar smoothly, render the canvas sword
// trail and sparks, play the Web Audio slash / steel-clang / custom "hyah!"
// sound, and send { a: 'timeout' } if the fuse burns out.

const MAX_PLAYERS = 8;
const START_LIVES = 3;
const BASE_TIME_MS = 3500;
const MIN_TIME_MS = 1100;
const SPEEDUP_MS = 85;
const TIMEOUT_GRACE_MS = 150;
const TIMEOUT_RETRY_MS = 800;
const BEST_KEY = 'bladeslash.best.v1';

export const meta = {
  id: 'bladeslash',
  title: 'Blade & Word',
  players: { min: 1, max: MAX_PLAYERS },
  color: '#ef4444',
  icon: '⚔️',
  desc: 'Swipe to slash the word that matches the picture — slice the wrong one and your sword clangs off steel.',
  soloable: true
};

// ------------------------------------------------------------ word list ----

export const WORD_LIST = [
  { pic: '🐷', match: 'lợn', decoy: ['lớn'] },          // pig vs. big
  { pic: '🐴', match: 'ngựa', decoy: ['ngứa'] },        // horse vs. itchy
  { pic: '🐉', match: 'rồng', decoy: ['rộng'] },        // dragon vs. wide
  { pic: '🩴', match: 'dép', decoy: ['đẹp'] },          // sandal vs. beautiful
  { pic: '😴', match: 'ngủ', decoy: ['ngu'] },          // sleep vs. stupid
  { pic: '👟', match: 'giầy', decoy: ['dây'] },         // shoe vs. rope/wire
  { pic: '🧵', match: 'dây', decoy: ['giầy'] },         // string/wire vs. shoe
  { pic: '👂', match: 'tai', decoy: ['tay'] },          // ear vs. hand
  { pic: '✋', match: 'tay', decoy: ['tai'] },          // hand vs. ear
  { pic: '👃', match: 'mũi', decoy: ['mùi', 'mài'] },   // nose vs. smell / grind
  { pic: '🔥', match: 'hỏa', decoy: ['họa', 'hoa'] },   // fire vs. disaster / flower
  { pic: '🌸', match: 'hoa', decoy: ['hỏa', 'họa'] },   // flower vs. fire / disaster
  { pic: '🔥', match: 'lửa', decoy: ['lừa', 'lựa'] },   // fire vs. donkey / choose
  { pic: '🫏', match: 'lừa', decoy: ['lửa', 'lựa'] },   // donkey vs. fire / choose
  { pic: '🥥', match: 'dừa', decoy: ['dứa'] },          // coconut vs. pineapple
  { pic: '🍍', match: 'dứa', decoy: ['dừa'] },          // pineapple vs. coconut
  { pic: '💃', match: 'múa', decoy: ['mua'] },          // dance vs. buy
  { pic: '🛒', match: 'mua', decoy: ['múa'] },          // buy vs. dance
  { pic: '😂', match: 'cười', decoy: ['cưới'] },        // laugh vs. marry
  { pic: '💍', match: 'cưới', decoy: ['cười'] },        // marry vs. laugh
  { pic: '🐕', match: 'chó', decoy: ['cho'] },          // dog vs. give
  { pic: '🐓', match: 'gà', decoy: ['ga', 'già'] },     // chicken vs. train station / old
  { pic: '🚉', match: 'ga', decoy: ['gà'] },            // train station vs. chicken
  { pic: '🧓', match: 'già', decoy: ['gà'] },           // old vs. chicken
  { pic: '🗄️', match: 'tủ', decoy: ['tù'] },            // cabinet vs. prison
  { pic: '👁️', match: 'mắt', decoy: ['mặt'] },          // eye vs. face
  { pic: '🙂', match: 'mặt', decoy: ['mắt'] },          // face vs. eye
  { pic: '🥛', match: 'sữa', decoy: ['sửa'] },          // milk vs. fix/repair
  { pic: '🔧', match: 'sửa', decoy: ['sữa'] },          // fix/repair vs. milk
  { pic: '2️⃣', match: 'hai', decoy: ['hay'] },          // two vs. interesting/or
  { pic: '🪡', match: 'may', decoy: ['mai'] },          // sew vs. tomorrow
  { pic: '✉️', match: 'thư', decoy: ['thu'] },          // letter vs. autumn
  { pic: '🍂', match: 'thu', decoy: ['thư'] },          // autumn vs. letter
  { pic: '🌙', match: 'đêm', decoy: ['đem'] },          // night vs. bring
  { pic: '✂️', match: 'cắt', decoy: ['cất'] },          // cut vs. put away
  { pic: '🥵', match: 'nóng', decoy: ['nông'] },        // hot vs. shallow/farming
  { pic: '💪', match: 'cơ', decoy: ['cô'] },            // muscle vs. aunt/Miss
  { pic: '🐄', match: 'bò', decoy: ['bờ'] },            // cow vs. shore
  { pic: '🏖️', match: 'bờ', decoy: ['bò'] },            // shore vs. cow
  { pic: '🥑', match: 'bơ', decoy: ['bồ'] },            // avocado vs. sweetheart/basket
  { pic: '🧊', match: 'đá', decoy: ['da'] },            // ice vs. skin/leather
  { pic: '👦', match: 'trai', decoy: ['chai'] },        // boy vs. bottle
  { pic: '🍾', match: 'chai', decoy: ['trai'] },        // bottle vs. boy
  { pic: '🎍', match: 'tre', decoy: ['che'] },          // bamboo vs. cover/shelter
  { pic: '🪶', match: 'nhẹ', decoy: ['nghe'] },         // lightweight/feather vs. listen
  { pic: '🎧', match: 'nghe', decoy: ['nhẹ'] },         // listen vs. lightweight
  { pic: '🐦', match: 'chim', decoy: ['chín'] },        // bird vs. nine
  { pic: '9️⃣', match: 'chín', decoy: ['chim'] },        // nine vs. bird
  { pic: '🐍', match: 'rắn', decoy: ['răng'] },         // snake vs. tooth
  { pic: '🦷', match: 'răng', decoy: ['rắn'] },         // tooth vs. snake
  { pic: '🥶', match: 'lạnh', decoy: ['lặn'] },         // cold vs. dive
  { pic: '🤿', match: 'lặn', decoy: ['lạnh'] },         // dive vs. cold
  { pic: '🏆', match: 'giỏi', decoy: ['giở'] },
  { pic: '🧑‍🤝‍🧑', match: 'bạn', decoy: ['bàn'] },
  { pic: '🤕', match: 'đau', decoy: ['đâu'] },
  { pic: '🟩', match: 'xanh', decoy: ['sanh'] },
  { pic: '🐇', match: 'thỏ', decoy: ['to', 'tỏ'] },      // rabbit vs. big / clear
  { pic: '💊', match: 'thuốc', decoy: ['tuộc'] },        // medicine vs. octopus
  { pic: '🌉', match: 'cầu', decoy: ['khâu'] },          // bridge vs. sew
  { pic: '🐒', match: 'khỉ', decoy: ['kí', 'chỉ'] },     // monkey vs. kilo / thread
  { pic: '🍜', match: 'phở', decoy: ['phố'] },
  { pic: '🦀', match: 'cua', decoy: ['cưa'] },           // crab vs. saw
  { pic: '🪚', match: 'cưa', decoy: ['cua'] },           // saw vs. crab
  { pic: '🌧️', match: 'mưa', decoy: ['mua', 'mùa'] },    // rain vs. buy / season
  { pic: '🍎', match: 'táo', decoy: ['tàu'] },           // apple vs. ship/train
  { pic: '🚢', match: 'tàu', decoy: ['táo'] },           // ship vs. apple
  { pic: '⭐', match: 'sao', decoy: ['sâu', 'sau'] },    // star vs. worm / behind
  { pic: '🐛', match: 'sâu', decoy: ['sao', 'sau'] },    // worm/caterpillar vs. star / behind
  { pic: '🧄', match: 'tỏi', decoy: ['tối', 'tới'] },    // garlic vs. night / arrive
  { pic: '🏊', match: 'bơi', decoy: ['bôi', 'bói'] },    // swim vs. smear / fortune-telling
  { pic: '🎤', match: 'hát', decoy: ['hạt', 'hạc'] },    // sing vs. seed / crane
  { pic: '🦩', match: 'hạc', decoy: ['hạt', 'hát'] },    // crane vs. seed / sing
  { pic: '📖', match: 'sách', decoy: ['sạch', 'xác'] },  // book vs. clean / corpse
  { pic: '🌽', match: 'bắp', decoy: ['bắt', 'bắc'] },    // corn vs. catch / North
  { pic: '🧔', match: 'râu', decoy: ['dâu', 'rau'] },    // beard vs. strawberry / vegetable
  { pic: '🍓', match: 'dâu', decoy: ['râu', 'dầu'] },    // strawberry vs. beard / oil
  { pic: '🐘', match: 'voi', decoy: ['vội'] },           // elephant vs. hurry
  { pic: '🦇', match: 'dơi', decoy: ['rơi'] },           // bat vs. fall/drop
  { pic: '🐦‍⬛', match: 'quạ', decoy: ['quả', 'quà'] },    // crow vs. fruit / gift
  { pic: '🪑', match: 'ghế', decoy: ['gà', 'kê'] }       // chair vs. chicken / millet
];

// ---------------------------------------------------------------- state ----

function tableOf(ctx) {
  const c = ctx || {};
  const list = c.atTable || c.seats || [];
  const ids = [];
  list.forEach(function (m) {
    if (!m || !m.id || m.spectator) return;
    if (ids.indexOf(m.id) < 0 && ids.length < MAX_PLAYERS) ids.push(m.id);
  });
  return ids;
}

function dealPrompt(rng, prevIdx, score) {
  let idx = Math.floor(rng() * WORD_LIST.length);
  if (WORD_LIST.length > 1 && idx === prevIdx) {
    idx = (idx + 1 + Math.floor(rng() * (WORD_LIST.length - 1))) % WORD_LIST.length;
  }
  const item = WORD_LIST[idx];
  const decoyWord = item.decoy[Math.floor(rng() * item.decoy.length)];
  const matchLeft = rng() < 0.5;
  const durationMs = Math.max(MIN_TIME_MS, BASE_TIME_MS - score * SPEEDUP_MS);
  const now = Date.now();
  return {
    cardIndex: idx,
    pic: item.pic,
    left: matchLeft ? item.match : decoyWord,
    right: matchLeft ? decoyWord : item.match,
    correctSide: matchLeft ? 'left' : 'right',
    matchWord: item.match,
    decoyWord: decoyWord,
    durationMs: durationMs,
    endsAt: now + durationMs
  };
}

function freshState() {
  return {
    epoch: 0,
    phase: 'ready', // 'ready' | 'play' | 'over'
    players: [],
    hostId: '',
    table: [],
    score: 0,
    streak: 0,
    bestStreak: 0,
    lives: START_LIVES,
    step: 0,        // increments on every slash/timeout so client animates transitions
    prompt: null,
    lastEvent: null, // { step, type: 'hit'|'clang'|'timeout', side, pic, left, right, matchWord, by }
    over: null
  };
}

export function init(ctx) {
  const st = freshState();
  st.players = tableOf(ctx);
  st.hostId = st.players[0] || '';
  return st;
}

// --------------------------------------------------------------- reduce ----

export function reduce(state, action, ctx) {
  const from = (ctx && ctx.from) || {};
  const rng = (ctx && ctx.rng) || Math.random;
  const id = from.id || '';
  const kind = (action && action.a) || '';
  const now = Date.now();

  if (!id) return { error: 'No identity — reopen the game.' };

  const players = state.players.slice();
  const same = function (extra) { return Object.assign({}, state, extra); };

  if (kind === 'join') {
    if (players.indexOf(id) >= 0) return same({});
    if (players.length >= MAX_PLAYERS) return { error: 'Table is full.' };
    players.push(id);
    const hostId = state.hostId || id;
    return same({ players: players, hostId: hostId });
  }

  if (players.indexOf(id) < 0) return { error: 'You are watching — not seated.' };

  if (kind === 'start') {
    if (state.phase === 'play') return { error: 'A round is already running.' };
    const alone = players.length < 2;
    if (state.hostId && state.hostId !== id && !from.host && !alone) {
      return { error: 'Waiting for the host to start the round.' };
    }
    const prompt = dealPrompt(rng, -1, 0);
    return same({
      epoch: state.epoch + 1,
      phase: 'play',
      table: players.slice(),
      score: 0,
      streak: 0,
      bestStreak: 0,
      lives: START_LIVES,
      step: 1,
      prompt: prompt,
      lastEvent: null,
      over: null
    });
  }

  if (state.phase !== 'play' || !state.prompt) {
    return { error: 'Wait for the next round.' };
  }

  if (kind === 'slash') {
    const side = action.side;
    if (side !== 'left' && side !== 'right') {
      return { error: 'Swipe left or right to slash a word.' };
    }
    const p = state.prompt;
    const hit = side === p.correctSide;
    const nextStep = state.step + 1;

    if (hit) {
      const nextScore = state.score + 1;
      const nextStreak = state.streak + 1;
      const nextBestStreak = Math.max(state.bestStreak, nextStreak);
      const nextPrompt = dealPrompt(rng, p.cardIndex, nextScore);
      return same({
        score: nextScore,
        streak: nextStreak,
        bestStreak: nextBestStreak,
        step: nextStep,
        prompt: nextPrompt,
        lastEvent: {
          step: nextStep,
          type: 'hit',
          side: side,
          pic: p.pic,
          word: side === 'left' ? p.left : p.right,
          otherWord: side === 'left' ? p.right : p.left,
          matchWord: p.matchWord,
          by: id
        }
      });
    } else {
      const nextLives = state.lives - 1;
      const ev = {
        step: nextStep,
        type: 'clang',
        side: side,
        pic: p.pic,
        word: side === 'left' ? p.left : p.right,
        matchWord: p.matchWord,
        by: id
      };
      if (nextLives <= 0) {
        return same({
          lives: 0,
          streak: 0,
          step: nextStep,
          phase: 'over',
          lastEvent: ev,
          over: {
            score: state.score,
            bestStreak: state.bestStreak,
            reason: 'clang',
            lastPic: p.pic,
            lastMatch: p.matchWord,
            lastWrong: side === 'left' ? p.left : p.right,
            by: id
          }
        });
      }
      const nextPrompt = dealPrompt(rng, p.cardIndex, state.score);
      return same({
        lives: nextLives,
        streak: 0,
        step: nextStep,
        prompt: nextPrompt,
        lastEvent: ev
      });
    }
  }

  if (kind === 'timeout') {
    const p = state.prompt;
    if (now < p.endsAt - TIMEOUT_GRACE_MS) {
      return { error: 'The fuse is still burning.' };
    }
    const nextLives = state.lives - 1;
    const nextStep = state.step + 1;
    const ev = {
      step: nextStep,
      type: 'timeout',
      side: p.correctSide,
      pic: p.pic,
      word: p.matchWord,
      matchWord: p.matchWord,
      by: id
    };
    if (nextLives <= 0) {
      return same({
        lives: 0,
        streak: 0,
        step: nextStep,
        phase: 'over',
        lastEvent: ev,
        over: {
          score: state.score,
          bestStreak: state.bestStreak,
          reason: 'timeout',
          lastPic: p.pic,
          lastMatch: p.matchWord,
          lastWrong: null,
          by: id
        }
      });
    }
    const nextPrompt = dealPrompt(rng, p.cardIndex, state.score);
    return same({
      lives: nextLives,
      streak: 0,
      step: nextStep,
      prompt: nextPrompt,
      lastEvent: ev
    });
  }

  return { error: 'Unknown action: ' + kind };
}

// ---------------------------------------------------------------- prune ----

export function prune(state, goneId) {
  if (!state || !state.players || state.players.indexOf(goneId) < 0) return state;
  const players = state.players.filter(function (id) { return id !== goneId; });
  const table = (state.table || []).filter(function (id) { return id !== goneId; });
  const hostId = state.hostId === goneId ? (players[0] || '') : state.hostId;
  return Object.assign({}, state, {
    players: players,
    table: table,
    hostId: hostId
  });
}

// -------------------------------------------------------------- project ----

export function project(state, playerId, api) {
  // Strip correctSide during active play so the authoritative reducer owns
  // validation; lastEvent tells the client immediately whether the slash hit
  // or clanged off steel.
  let prompt = null;
  if (state.prompt) {
    prompt = {
      pic: state.prompt.pic,
      left: state.prompt.left,
      right: state.prompt.right,
      durationMs: state.prompt.durationMs,
      endsAt: state.prompt.endsAt
    };
  }
  return Object.assign({}, state, {
    you: playerId || '',
    prompt: prompt,
    roster: (api && api.roster) || null
  });
}

// ------------------------------------------------------------ summarize ----

export function roundId(state) {
  return 'e' + ((state && state.epoch) || 0);
}

export function summarize(state, nameOf) {
  if (state.phase !== 'over' || !state.over) return null;
  const ids = (state.table && state.table.length) ? state.table : state.players;
  const who = (ids || []).map(function (id) { return nameOf(id); }).filter(Boolean);
  const names = who.length === 2 ? who[0] + ' and ' + who[1]
    : (who.length > 2 ? who.slice(0, -1).join(', ') + ' and ' + who[who.length - 1]
      : (who[0] || 'Someone'));
  const s = Number(state.over.score || 0);
  return names + ' sliced ' + s + (s === 1 ? ' word' : ' words') + ' in ' + meta.title;
}

// ----------------------------------------------------------------- mount ----

const CSS = [
  '.bs-wrap{position:absolute;inset:0;display:flex;flex-direction:column;',
  'overflow:hidden;background:radial-gradient(circle at 50% 38%,#261822 0%,#12131a 70%);',
  'color:#f5f3ef;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;',
  '-webkit-tap-highlight-color:transparent;font:16px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}',
  '.bs-wrap.shudder{animation:bs-shake 0.42s cubic-bezier(.36,.07,.19,.97) both}',
  '@keyframes bs-shake{',
  '0%,100%{transform:translate(0,0) rotate(0deg)}',
  '12%{transform:translate(-14px,6px) rotate(-2.5deg)}',
  '25%{transform:translate(13px,-8px) rotate(2.5deg)}',
  '38%{transform:translate(-11px,-5px) rotate(-1.8deg)}',
  '52%{transform:translate(10px,6px) rotate(1.6deg)}',
  '68%{transform:translate(-7px,3px) rotate(-1deg)}',
  '84%{transform:translate(5px,-3px) rotate(0.6deg)}}',
  '.bs-wrap.flash-hit::after{content:"";position:absolute;inset:0;background:rgba(56,189,248,0.16);pointer-events:none;animation:bs-fade 0.22s ease-out forwards}',
  '.bs-wrap.flash-clang::after{content:"";position:absolute;inset:0;background:rgba(239,68,68,0.28);pointer-events:none;animation:bs-fade 0.35s ease-out forwards}',
  '@keyframes bs-fade{from{opacity:1}to{opacity:0}}',
  '.bs-hud{position:relative;z-index:4;display:flex;flex-direction:column;gap:8px;padding:12px 18px 0;pointer-events:none}',
  '.bs-hud-row{display:flex;justify-content:space-between;align-items:center}',
  '.bs-score-box{display:flex;align-items:baseline;gap:10px}',
  '.bs-score{font-size:1.8rem;font-weight:800;color:#fde047;text-shadow:0 2px 10px rgba(250,204,21,0.35)}',
  '.bs-streak{font-size:0.95rem;font-weight:700;color:#38bdf8;opacity:0;transform:scale(0.85);transition:all 0.15s ease}',
  '.bs-streak.on{opacity:1;transform:scale(1)}',
  '.bs-lives{display:flex;gap:6px;font-size:1.35rem}',
  '.bs-life{transition:transform 0.2s,opacity 0.2s}',
  '.bs-life.lost{opacity:0.2;transform:scale(0.75);filter:grayscale(1)}',
  '.bs-bar-track{width:100%;height:10px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,0.6)}',
  '.bs-bar-fill{height:100%;width:100%;background:linear-gradient(90deg,#38bdf8,#facc15,#ef4444);border-radius:999px;transform-origin:left center;will-change:transform}',
  '.bs-stage{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;touch-action:none;overflow:hidden}',
  '.bs-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5}',
  '.bs-pic-card{position:relative;z-index:2;margin-bottom:14px;display:flex;flex-direction:column;align-items:center}',
  '.bs-pic{font-size:clamp(4.4rem,16vmin,6.8rem);line-height:1;filter:drop-shadow(0 10px 18px rgba(0,0,0,0.55));transform:scale(1);transition:transform 0.12s ease}',
  '.bs-pic.pop{animation:bs-pop 0.2s ease-out}',
  '@keyframes bs-pop{0%{transform:scale(0.6)}70%{transform:scale(1.12)}100%{transform:scale(1)}}',
  '.bs-hint{font-size:0.8rem;text-transform:uppercase;letter-spacing:0.14em;color:#9ca3af;margin-top:4px}',
  '.bs-arena{position:relative;z-index:3;width:100%;max-width:680px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;padding:0 14px;box-sizing:border-box}',
  '.bs-word-slot{position:relative;display:flex;justify-content:center;align-items:center;min-height:110px}',
  '.bs-word{position:relative;width:100%;max-width:210px;min-height:88px;display:flex;align-items:center;justify-content:center;',
  'padding:12px 14px;border-radius:14px;background:linear-gradient(145deg,#fef3c7,#fde68a);color:#1c1917;',
  'font-size:clamp(1.65rem,5.5vmin,2.45rem);font-weight:800;letter-spacing:0.01em;text-align:center;',
  'box-shadow:0 8px 22px rgba(0,0,0,0.45),inset 0 2px 0 rgba(255,255,255,0.7);border:3px solid #f59e0b;',
  'cursor:pointer;transition:transform 0.1s ease}',
  '.bs-word:active{transform:scale(0.97)}',
  '.bs-word.steel{background:linear-gradient(135deg,#94a3b8 0%,#475569 45%,#cbd5e1 50%,#334155 100%) !important;',
  'color:#f8fafc !important;border-color:#e2e8f0 !important;',
  'box-shadow:0 0 28px rgba(239,68,68,0.85),inset 0 0 12px #0f172a !important;',
  'animation:bs-steel-clang 0.42s ease-out}',
  '.bs-word.steel::before,.bs-word.steel::after{content:"";position:absolute;width:8px;height:8px;border-radius:50%;background:#1e293b;box-shadow:inset 0 1px 1px rgba(255,255,255,0.5)}',
  '.bs-word.steel::before{top:8px;left:8px}',
  '.bs-word.steel::after{bottom:8px;right:8px}',
  '@keyframes bs-steel-clang{0%{transform:scale(1.14) rotate(-3deg)}30%{transform:scale(0.95) rotate(3deg)}60%{transform:scale(1.04) rotate(-1.5deg)}100%{transform:scale(1) rotate(0)}}',
  '.bs-slice-ghost{position:absolute;inset:0;pointer-events:none;z-index:6}',
  '.bs-half{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
  'border-radius:14px;background:linear-gradient(145deg,#bae6fd,#7dd3fc);color:#0c4a6e;',
  'font-size:clamp(1.65rem,5.5vmin,2.45rem);font-weight:800;border:3px solid #38bdf8}',
  '.bs-half.top{clip-path:polygon(0 0,100% 0,100% 35%,0 68%);animation:bs-slice-top 0.38s cubic-bezier(.16,1,.3,1) forwards}',
  '.bs-half.bot{clip-path:polygon(0 68%,100% 35%,100% 100%,0 100%);animation:bs-slice-bot 0.38s cubic-bezier(.16,1,.3,1) forwards}',
  '@keyframes bs-slice-top{to{transform:translate(-24px,-38px) rotate(-14deg);opacity:0}}',
  '@keyframes bs-slice-bot{to{transform:translate(24px,42px) rotate(14deg);opacity:0}}',
  '.bs-hero{position:relative;width:132px;height:164px;display:flex;align-items:center;justify-content:center;pointer-events:none}',
  '.bs-hero svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 8px 14px rgba(0,0,0,0.6))}',
  '.bs-hero-arm{transform-origin:65px 78px;transition:transform 0.09s cubic-bezier(.2,1.3,.4,1)}',
  '.bs-hero.slash-left .bs-hero-arm{transform:rotate(-118deg) scaleX(1.08)}',
  '.bs-hero.slash-right .bs-hero-arm{transform:rotate(68deg) scaleX(1.08)}',
  '.bs-hero.clang-left .bs-hero-arm{transform:rotate(-58deg);animation:bs-arm-recoil 0.4s ease}',
  '.bs-hero.clang-right .bs-hero-arm{transform:rotate(25deg);animation:bs-arm-recoil 0.4s ease}',
  '@keyframes bs-arm-recoil{0%,100%{filter:none}25%{transform:rotate(-15deg) translateY(5px);filter:drop-shadow(0 0 8px #ef4444)}}',
  '.bs-eyes-normal{display:block}.bs-eyes-wince{display:none}',
  '.bs-hero.wince .bs-eyes-normal{display:none}.bs-hero.wince .bs-eyes-wince{display:block}',
  '.bs-toast{position:absolute;top:56px;left:50%;transform:translateX(-50%);z-index:7;',
  'background:rgba(15,23,42,0.9);color:#f8fafc;padding:6px 16px;border-radius:999px;font-size:0.9rem;font-weight:600;',
  'opacity:0;pointer-events:none;transition:opacity 0.15s}',
  '.bs-toast.show{opacity:1}',
  '.bs-overlay{position:absolute;inset:0;z-index:8;display:flex;flex-direction:column;align-items:center;justify-content:center;',
  'gap:14px;padding:24px;text-align:center;background:rgba(15,17,23,0.92);backdrop-filter:blur(6px)}',
  '.bs-overlay[hidden]{display:none}',
  '.bs-title{margin:0;font-size:2.1rem;font-weight:800;color:#fef3c7;letter-spacing:-0.02em}',
  '.bs-sub{margin:0;max-width:24rem;color:#cbd5e1;font-size:0.98rem}',
  '.bs-stat{font-size:2.5rem;font-weight:800;color:#fde047;margin:4px 0}',
  '.bs-callout{padding:10px 18px;border-radius:12px;background:rgba(255,255,255,0.06);color:#e2e8f0;font-size:0.95rem}',
  '.bs-btn{font:inherit;font-weight:800;font-size:1.08rem;padding:13px 38px;min-height:48px;',
  'border:0;border-radius:10px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;',
  'box-shadow:0 6px 18px rgba(239,68,68,0.45);cursor:pointer}',
  '.bs-btn:disabled{opacity:0.45;cursor:default;box-shadow:none}',
  '.bs-note{font-size:0.86rem;color:#94a3b8;margin:0}'
].join('');

function readBest() {
  try {
    const v = parseInt(localStorage.getItem(BEST_KEY) || '', 10);
    return isFinite(v) && v >= 0 ? v : null;
  } catch (e) {
    return null;
  }
}

function saveBest(score) {
  try {
    const b = readBest();
    if (b === null || score > b) localStorage.setItem(BEST_KEY, String(score));
  } catch (e) {}
}

export function mount(root, api) {
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'bs-wrap';
  wrap.innerHTML =
    '<div class="bs-hud">' +
      '<div class="bs-hud-row">' +
        '<div class="bs-score-box"><span class="bs-score">0</span><span class="bs-streak"></span></div>' +
        '<div class="bs-lives">' +
          '<span class="bs-life">⚔️</span><span class="bs-life">⚔️</span><span class="bs-life">⚔️</span>' +
        '</div>' +
      '</div>' +
      '<div class="bs-bar-track"><div class="bs-bar-fill"></div></div>' +
    '</div>' +
    '<div class="bs-toast"></div>' +
    '<div class="bs-stage">' +
      '<canvas class="bs-canvas"></canvas>' +
      '<div class="bs-pic-card">' +
        '<div class="bs-pic">🐉</div>' +
        '<div class="bs-hint">Swipe the matching word</div>' +
      '</div>' +
      '<div class="bs-arena">' +
        '<div class="bs-word-slot" data-side="left"><div class="bs-word" data-side="left">rồng</div></div>' +
        '<div class="bs-hero">' +
          '<svg viewBox="0 0 130 160">' +
            '<!-- Cape & Body -->' +
            '<path d="M40 90 L22 148 L55 142 Z" fill="#991b1b"/>' +
            '<rect x="44" y="82" width="42" height="54" rx="12" fill="#334155" stroke="#94a3b8" stroke-width="3"/>' +
            '<path d="M44 102 H86" stroke="#ef4444" stroke-width="5"/>' +
            '<!-- Head & Headband -->' +
            '<circle cx="65" cy="54" r="24" fill="#fde68a" stroke="#1e293b" stroke-width="3"/>' +
            '<path d="M41 44 Q65 37 89 44 L88 52 Q65 46 42 52 Z" fill="#ef4444"/>' +
            '<path d="M87 46 Q106 38 114 48 Q103 55 88 50 Z" fill="#dc2626"/>' +
            '<!-- Normal Determined Eyes -->' +
            '<g class="bs-eyes-normal">' +
              '<path d="M51 50 L61 54" stroke="#0f172a" stroke-width="3.2" stroke-linecap="round"/>' +
              '<path d="M79 50 L69 54" stroke="#0f172a" stroke-width="3.2" stroke-linecap="round"/>' +
              '<circle cx="56" cy="57" r="3" fill="#0f172a"/>' +
              '<circle cx="74" cy="57" r="3" fill="#0f172a"/>' +
            '</g>' +
            '<!-- Wince Eyes (> <) when hitting steel -->' +
            '<g class="bs-eyes-wince">' +
              '<path d="M50 51 L59 56 L50 61" fill="none" stroke="#0f172a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="M80 51 L71 56 L80 61" fill="none" stroke="#0f172a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="M56 68 Q65 63 74 68" fill="none" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/>' +
            '</g>' +
            '<!-- Sword Arm & Katana -->' +
            '<g class="bs-hero-arm">' +
              '<circle cx="65" cy="78" r="9" fill="#475569" stroke="#e2e8f0" stroke-width="2"/>' +
              '<rect x="59" y="64" width="12" height="20" rx="5" fill="#b45309" stroke="#fef3c7" stroke-width="1.5"/>' +
              '<rect x="53" y="59" width="24" height="5" rx="2" fill="#facc15"/>' +
              '<path d="M60 59 L61 -18 L65 -30 L69 -18 L70 59 Z" fill="#f8fafc" stroke="#38bdf8" stroke-width="1.5"/>' +
              '<path d="M65 56 L65 -22" stroke="#bae6fd" stroke-width="2"/>' +
            '</g>' +
          '</svg>' +
        '</div>' +
        '<div class="bs-word-slot" data-side="right"><div class="bs-word" data-side="right">rộng</div></div>' +
      '</div>' +
    '</div>' +
    '<div class="bs-overlay">' +
      '<h1 class="bs-title">Blade &amp; Word</h1>' +
      '<div class="bs-stat" hidden></div>' +
      '<div class="bs-callout" hidden></div>' +
      '<p class="bs-sub"></p>' +
      '<button class="bs-btn" type="button">Draw Sword</button>' +
      '<p class="bs-note"></p>' +
    '</div>';
  root.appendChild(wrap);

  const scoreEl = wrap.querySelector('.bs-score');
  const streakEl = wrap.querySelector('.bs-streak');
  const lifeEls = wrap.querySelectorAll('.bs-life');
  const barFill = wrap.querySelector('.bs-bar-fill');
  const toastEl = wrap.querySelector('.bs-toast');
  const stageEl = wrap.querySelector('.bs-stage');
  const canvas = wrap.querySelector('.bs-canvas');
  const ctx2d = canvas.getContext ? canvas.getContext('2d') : null;
  const picEl = wrap.querySelector('.bs-pic');
  const leftSlot = wrap.querySelector('.bs-word-slot[data-side="left"]');
  const rightSlot = wrap.querySelector('.bs-word-slot[data-side="right"]');
  const leftWordEl = wrap.querySelector('.bs-word[data-side="left"]');
  const rightWordEl = wrap.querySelector('.bs-word[data-side="right"]');
  const heroEl = wrap.querySelector('.bs-hero');
  const overlay = wrap.querySelector('.bs-overlay');
  const ovTitle = wrap.querySelector('.bs-title');
  const ovStat = wrap.querySelector('.bs-stat');
  const ovCallout = wrap.querySelector('.bs-callout');
  const ovSub = wrap.querySelector('.bs-sub');
  const startBtn = wrap.querySelector('.bs-btn');
  const ovNote = wrap.querySelector('.bs-note');

  let view = null;
  let myId = (api.me && api.me.id) || '';
  let joined = false;
  let dead = false;
  let running = false;
  let rafId = null;
  let lastSeenStep = 0;
  let lastTimeoutReq = 0;
  let toastTimer = null;

  // ---- Audio (Custom 'hyah.mp3' + Web Audio Synth) ----
  let audioCtx = null;
  let hyahAudio = null;
  try {
    hyahAudio = new Audio('/assets/hyah.mp3');
    hyahAudio.preload = 'auto';
  } catch (e) {}

  function ensureAudio() {
    if (!audioCtx && typeof window !== 'undefined') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        try { audioCtx = new AC(); } catch (e) {}
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      try { audioCtx.resume(); } catch (e) {}
    }
  }

  function playHyahAndSlice() {
    ensureAudio();
    // Play recorded Hyah! if present, with slight pitch variation
    if (hyahAudio) {
      try {
        hyahAudio.currentTime = 0;
        hyahAudio.playbackRate = 0.92 + Math.random() * 0.18;
        const p = hyahAudio.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (e) {}
    }
    if (!audioCtx) return;
    const now = audioCtx.currentTime;

    // Sharp sword whoosh + crisp slice
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.14);
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.16);

    // High metallic ring
    const ring = audioCtx.createOscillator();
    const rGain = audioCtx.createGain();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(2400, now);
    ring.frequency.exponentialRampToValueAtTime(3200, now + 0.09);
    rGain.gain.setValueAtTime(0.12, now);
    rGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    ring.connect(rGain);
    rGain.connect(audioCtx.destination);
    ring.start(now);
    ring.stop(now + 0.13);
  }

  function playSteelClang() {
    ensureAudio();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate([45, 30, 90]); } catch (e) {}
    }
    if (!audioCtx) return;
    const now = audioCtx.currentTime;

    // Dissonant metallic anvil clang (inharmonic frequencies)
    const freqs = [415, 622, 987, 1540, 2310];
    freqs.forEach(function (f, i) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = i % 2 === 0 ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.94, now + 0.38);
      gain.gain.setValueAtTime(0.18 / (i + 1), now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.4);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.42);
    });
  }

  // ---- Canvas Sword Trail & Sparks ----
  const trail = [];
  const sparks = [];
  let cw = 300, ch = 300;

  function resizeCanvas() {
    cw = stageEl.clientWidth || 300;
    ch = stageEl.clientHeight || 300;
    canvas.width = cw;
    canvas.height = ch;
  }

  function spawnSparks(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 90 + Math.random() * 260;
      sparks.push({
        x: x,
        y: y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 60,
        life: 1,
        color: color,
        size: 2.5 + Math.random() * 3.5
      });
    }
  }

  function addSlashArc(side, isSteel) {
    const targetEl = side === 'left' ? leftSlot : rightSlot;
    const sRect = stageEl.getBoundingClientRect();
    const tRect = targetEl.getBoundingClientRect();
    const cx = (tRect.left - sRect.left) + tRect.width / 2;
    const cy = (tRect.top - sRect.top) + tRect.height / 2;
    const now = performance.now();

    trail.push({ x: cx - 75, y: cy + 55, t: now, color: isSteel ? '#ef4444' : '#38bdf8' });
    trail.push({ x: cx, y: cy, t: now + 16, color: isSteel ? '#fde047' : '#ffffff' });
    trail.push({ x: cx + 75, y: cy - 55, t: now + 32, color: isSteel ? '#ef4444' : '#38bdf8' });

    spawnSparks(cx, cy, isSteel ? '#f97316' : '#38bdf8', isSteel ? 26 : 16);
  }

  function triggerVisualEvent(ev) {
    if (!ev) return;
    const isLeft = ev.side === 'left';
    const slot = isLeft ? leftSlot : rightSlot;
    const wordEl = isLeft ? leftWordEl : rightWordEl;

    heroEl.classList.remove('slash-left', 'slash-right', 'clang-left', 'clang-right', 'wince');
    wrap.classList.remove('shudder', 'flash-hit', 'flash-clang');
    void wrap.offsetWidth; // reflow to restart CSS animations

    if (ev.type === 'hit') {
      playHyahAndSlice();
      heroEl.classList.add(isLeft ? 'slash-left' : 'slash-right');
      wrap.classList.add('flash-hit');
      addSlashArc(ev.side, false);

      // Spawn flying split-word halves
      const ghost = document.createElement('div');
      ghost.className = 'bs-slice-ghost';
      ghost.innerHTML =
        '<div class="bs-half top">' + escHtml(ev.word) + '</div>' +
        '<div class="bs-half bot">' + escHtml(ev.word) + '</div>';
      slot.appendChild(ghost);
      api.setTimeout(function () {
        if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      }, 400);
    } else if (ev.type === 'clang') {
      playSteelClang();
      heroEl.classList.add(isLeft ? 'clang-left' : 'clang-right', 'wince');
      wrap.classList.add('shudder', 'flash-clang');
      wordEl.classList.add('steel');
      addSlashArc(ev.side, true);
      api.setTimeout(function () {
        wordEl.classList.remove('steel');
        heroEl.classList.remove('wince');
      }, 430);
    } else if (ev.type === 'timeout') {
      playSteelClang();
      wrap.classList.add('shudder', 'flash-clang');
      heroEl.classList.add('wince');
      showToast('Too slow! (' + ev.pic + ' = ' + ev.matchWord + ')');
      api.setTimeout(function () {
        heroEl.classList.remove('wince');
      }, 430);
    }
  }

  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = api.setTimeout(function () {
      toastEl.classList.remove('show');
      toastTimer = null;
    }, 1400);
  }

  // ---- Loop ----
  let lastFrame = 0;

  function startLoop() {
    if (dead || running) return;
    running = true;
    lastFrame = performance.now();
    rafId = api.raf(frame);
  }

  function stopLoop() {
    running = false;
    if (rafId !== null) {
      api.cancelRaf(rafId);
      rafId = null;
    }
  }

  function frame(now) {
    rafId = null;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    // 1. Update fuse bar & ask for timeout if expired
    if (view && view.phase === 'play' && view.prompt) {
      const rem = Math.max(0, view.prompt.endsAt - Date.now());
      const frac = Math.max(0, Math.min(1, rem / (view.prompt.durationMs || BASE_TIME_MS)));
      barFill.style.transform = 'scaleX(' + frac + ')';

      if (rem <= 0 && seated() && Date.now() - lastTimeoutReq > TIMEOUT_RETRY_MS) {
        lastTimeoutReq = Date.now();
        api.send({ a: 'timeout' });
      }
    }

    // 2. Render sword trail & sparks on canvas
    if (ctx2d) {
      ctx2d.clearRect(0, 0, cw, ch);

      // Filter recent trail points
      for (let i = trail.length - 1; i >= 0; i--) {
        if (now - trail[i].t > 180) trail.splice(i, 1);
      }
      if (trail.length > 1) {
        ctx2d.save();
        ctx2d.lineCap = 'round';
        ctx2d.lineJoin = 'round';
        for (let i = 1; i < trail.length; i++) {
          const p0 = trail[i - 1];
          const p1 = trail[i];
          const age = Math.max(0, 1 - (now - p1.t) / 180);
          ctx2d.strokeStyle = p1.color || '#38bdf8';
          ctx2d.globalAlpha = age;
          ctx2d.lineWidth = 14 * age;
          ctx2d.beginPath();
          ctx2d.moveTo(p0.x, p0.y);
          ctx2d.lineTo(p1.x, p1.y);
          ctx2d.stroke();
        }
        ctx2d.restore();
      }

      // Update sparks
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.vy += 480 * dt; // gravity
        sp.life -= dt * 2.6;
        if (sp.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx2d.save();
        ctx2d.globalAlpha = Math.max(0, sp.life);
        ctx2d.fillStyle = sp.color;
        ctx2d.beginPath();
        ctx2d.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.restore();
      }
    }

    if (running && view && (view.phase === 'play' || sparks.length > 0 || trail.length > 0)) {
      rafId = api.raf(frame);
    } else {
      running = false;
    }
  }

  // ---- Input: Swiping & Tapping ----
  let pointerActive = false;
  let startX = 0;
  let startY = 0;
  let slashedThisGesture = false;

  function seated() {
    return !!view && (view.players || []).indexOf(myId) >= 0;
  }

  function iAmHost() {
    if (!view) return false;
    if (view.hostId) return view.hostId === myId;
    return !!api.isHost;
  }

  function sendSlash(side) {
    if (!view || view.phase !== 'play' || !seated()) return;
    ensureAudio();
    api.send({ a: 'slash', side: side });
  }

  stageEl.addEventListener('pointerdown', function (e) {
    if (!view || view.phase !== 'play' || !seated()) return;
    ensureAudio();
    pointerActive = true;
    slashedThisGesture = false;
    const rect = stageEl.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    trail.push({ x: startX, y: startY, t: performance.now(), color: '#38bdf8' });
    startLoop();
    try { stageEl.setPointerCapture(e.pointerId); } catch (err) {}
  });

  stageEl.addEventListener('pointermove', function (e) {
    if (!pointerActive || !view || view.phase !== 'play') return;
    const rect = stageEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    trail.push({ x: x, y: y, t: performance.now(), color: '#e0f2fe' });

    if (slashedThisGesture) return;

    // Check if finger sliced across one of the word boxes
    const lRect = leftWordEl.getBoundingClientRect();
    const rRect = rightWordEl.getBoundingClientRect();
    const dx = x - startX;
    const dy = y - startY;
    const dist = Math.hypot(dx, dy);

    if (dist > 18) {
      if (e.clientX >= lRect.left && e.clientX <= lRect.right &&
          e.clientY >= lRect.top - 20 && e.clientY <= lRect.bottom + 20) {
        slashedThisGesture = true;
        sendSlash('left');
        return;
      }
      if (e.clientX >= rRect.left && e.clientX <= rRect.right &&
          e.clientY >= rRect.top - 20 && e.clientY <= rRect.bottom + 20) {
        slashedThisGesture = true;
        sendSlash('right');
        return;
      }
    }

    // Or a decisive directional swipe anywhere on screen (> 42px horizontal)
    if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 0.85) {
      slashedThisGesture = true;
      sendSlash(dx < 0 ? 'left' : 'right');
    }
  });

  function endGesture(e) {
    if (!pointerActive) return;
    pointerActive = false;
    if (!slashedThisGesture && view && view.phase === 'play') {
      // Allow a direct tap/mini-swipe on a word button as fallback
      const lRect = leftWordEl.getBoundingClientRect();
      const rRect = rightWordEl.getBoundingClientRect();
      if (e.clientX >= lRect.left && e.clientX <= lRect.right &&
          e.clientY >= lRect.top && e.clientY <= lRect.bottom) {
        sendSlash('left');
      } else if (e.clientX >= rRect.left && e.clientX <= rRect.right &&
                 e.clientY >= rRect.top && e.clientY <= rRect.bottom) {
        sendSlash('right');
      }
    }
  }

  stageEl.addEventListener('pointerup', endGesture);
  stageEl.addEventListener('pointercancel', function () { pointerActive = false; });

  startBtn.addEventListener('click', function () {
    if (!view || view.phase === 'play' || !seated()) return;
    ensureAudio();
    api.send({ a: 'start' });
  });

  // ---- Rendering ----
  function renderView() {
    if (!view) return;
    const isPlaying = view.phase === 'play';
    const atTable = seated();
    const host = iAmHost();
    const alone = (view.players || []).length < 2;

    scoreEl.textContent = String(view.score || 0);
    if (view.streak >= 2) {
      streakEl.textContent = '🔥 ' + view.streak + 'x';
      streakEl.classList.add('on');
    } else {
      streakEl.classList.remove('on');
    }

    for (let i = 0; i < START_LIVES; i++) {
      if (lifeEls[i]) {
        lifeEls[i].classList.toggle('lost', i >= (view.lives || 0));
      }
    }

    if (view.prompt) {
      picEl.textContent = view.prompt.pic;
      leftWordEl.textContent = view.prompt.left;
      rightWordEl.textContent = view.prompt.right;
    }

    if (view.lastEvent && view.lastEvent.step !== lastSeenStep) {
      lastSeenStep = view.lastEvent.step;
      triggerVisualEvent(view.lastEvent);
      picEl.classList.remove('pop');
      void picEl.offsetWidth;
      picEl.classList.add('pop');
    }

    overlay.hidden = isPlaying;
    if (isPlaying) return;

    if (!atTable) {
      ovTitle.textContent = 'Observing';
      ovStat.hidden = true;
      ovCallout.hidden = true;
      ovSub.textContent = 'You are watching this table. Seated players swipe to slash the matching Vietnamese word.';
      startBtn.hidden = true;
      ovNote.textContent = (view.players || []).length + ' at the table.';
      return;
    }

    startBtn.hidden = false;
    const canStart = host || alone;
    startBtn.disabled = !canStart;

    if (view.phase === 'over' && view.over) {
      const o = view.over;
      saveBest(o.score || 0);
      ovTitle.textContent = o.reason === 'clang' ? 'Blade Shattered!' : 'Out of Time!';
      ovStat.hidden = false;
      ovStat.textContent = o.score + (o.score === 1 ? ' word' : ' words');
      ovCallout.hidden = false;
      ovCallout.innerHTML = o.reason === 'clang'
        ? 'Swiped <b>' + escHtml(o.lastWrong) + '</b> (solid steel!) — ' + escHtml(o.lastPic) + ' is <b>' + escHtml(o.lastMatch) + '</b>'
        : 'Fuse ran out on ' + escHtml(o.lastPic) + ' (<b>' + escHtml(o.lastMatch) + '</b>)';
      ovSub.textContent = 'Best streak this run: ' + (o.bestStreak || 0) + 'x';
      startBtn.textContent = canStart ? 'Slash Again' : 'Waiting for host';
      const best = readBest();
      ovNote.textContent = best !== null ? 'Personal best: ' + best + ' words' : '';
    } else {
      ovTitle.textContent = 'Blade & Word';
      ovStat.hidden = true;
      ovCallout.hidden = true;
      ovSub.innerHTML = 'A picture appears in the center with two Vietnamese words.<br>' +
        '<b>Swipe left or right</b> to slice the matching word.<br>' +
        'Slice the wrong word and your blade clangs off solid steel!';
      startBtn.textContent = canStart ? 'Draw Sword' : 'Waiting for host';
      const best = readBest();
      ovNote.textContent = best !== null ? 'Personal best: ' + best + ' words' : 'Touch & swipe anywhere on the arena';
    }
  }

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(resizeCanvas);
    ro.observe(stageEl);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  return {
    update: function (next) {
      if (dead || !next) return;
      view = next;
      if (typeof next.you === 'string' && next.you) myId = next.you;
      resizeCanvas();
      renderView();
      if (next.phase === 'play') {
        startLoop();
      }
      if (!joined && !api.isSpectator) {
        joined = true;
        api.send({ a: 'join' });
      }
    },
    denied: function (text) {
      if (dead) return;
      const msg = String(text || 'Action refused.');
      if (/fuse is still burning/i.test(msg)) lastTimeoutReq = 0;
      showToast(msg);
    },
    destroy: function () {
      dead = true;
      if (toastTimer) clearTimeout(toastTimer);
      stopLoop();
      if (ro) ro.disconnect();
      window.removeEventListener('resize', resizeCanvas);
      if (audioCtx && typeof audioCtx.close === 'function') {
        try { audioCtx.close(); } catch (e) {}
      }
    }
  };
}