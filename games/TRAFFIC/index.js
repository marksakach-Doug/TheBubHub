import { engine } from './engine.js';

export const meta = {
  id: 'TRAFFIC',
  title: 'TRAFFIC',
  players: '1-6',
  color: '#f59e0b',
  icon: '🚦',
  desc: 'Out-route traffic and left-turn penalties on a 9×9 grid.',
  soloable: true
};

function buildInitialRoutes(players, startCell) {
  const routes = {};
  for (let i = 0; i < players.length; i++) {
    routes[players[i]] = [startCell];
  }
  return routes;
}

function computeOverSummary(puzzle, players, submitted) {
  const optCost = (puzzle.optimal && puzzle.optimal.cost) || 1;
  const ranked = [];
  for (let i = 0; i < players.length; i++) {
    const pid = players[i];
    const sub = submitted[pid];
    if (!sub) continue;
    const eff = Math.min(100, Math.round((optCost / Math.max(0.01, sub.cost)) * 1000) / 10);
    ranked.push({
      id: pid,
      cost: sub.cost,
      distance: sub.distance,
      leftTurns: sub.leftTurns,
      rightTurns: sub.rightTurns,
      straightMoves: sub.straightMoves,
      efficiency: eff,
      cells: sub.cells
    });
  }
  ranked.sort((a, b) => a.cost - b.cost);
  const winner = ranked.length > 0 ? ranked[0].id : null;
  const winnerEff = ranked.length > 0 ? ranked[0].efficiency : 0;
  return {
    winner: winner,
    winnerEff: winnerEff,
    ranked: ranked
  };
}

export function init(ctx) {
  const tableList = (ctx && Array.isArray(ctx.atTable) && ctx.atTable.length > 0)
    ? ctx.atTable
    : (ctx && Array.isArray(ctx.seats) ? ctx.seats : []);

  const players = [];
  for (let i = 0; i < tableList.length; i++) {
    const p = tableList[i];
    if (p && p.id && !p.spectator && players.indexOf(p.id) < 0) {
      players.push(p.id);
    }
  }

  const rng = (ctx && ctx.rng) || Math.random;
  engine.useRng(rng);

  const options = (ctx && ctx.options) || {};
  const size = options.size === 7 || options.size === 11 ? options.size : 9;
  const mode = ['standard', 'rush', 'highway', 'delivery'].indexOf(options.mode) >= 0
    ? options.mode
    : 'standard';

  const puzzle = engine.generatePuzzle({ size: size, mode: mode, iters: 40 });

  return {
    epoch: 1,
    phase: 'playing',
    size: size,
    mode: mode,
    puzzle: puzzle,
    players: players,
    routes: buildInitialRoutes(players, puzzle.start),
    submitted: {},
    over: null
  };
}

export function reduce(state, action, ctx) {
  const id = (ctx && ctx.from && ctx.from.id) || '';
  const isHost = !!(ctx && ctx.from && ctx.from.host);
  const rng = (ctx && ctx.rng) || Math.random;
  if (!action || typeof action.a !== 'string') {
    return { error: 'Invalid action.' };
  }

  // Allow an unseated viewer to join the active table
  if (action.a === 'join') {
    if (!id) return { error: 'Missing player id.' };
    if (state.players.indexOf(id) >= 0) return state;
    const nextPlayers = state.players.concat([id]);
    const nextRoutes = Object.assign({}, state.routes);
    nextRoutes[id] = [state.puzzle.start];
    return Object.assign({}, state, {
      players: nextPlayers,
      routes: nextRoutes
    });
  }

  // Host controls: start a fresh round or change mode/grid size
  if (action.a === 'newRound') {
    if (!isHost) return { error: 'Only the host can deal a new map.' };
    const nextSize = (action.size === 7 || action.size === 9 || action.size === 11)
      ? action.size
      : state.size;
    const nextMode = ['standard', 'rush', 'highway', 'delivery'].indexOf(action.mode) >= 0
      ? action.mode
      : state.mode;

    engine.useRng(rng);
    const nextPuzzle = engine.generatePuzzle({ size: nextSize, mode: nextMode, iters: 40 });
    return {
      epoch: state.epoch + 1,
      phase: 'playing',
      size: nextSize,
      mode: nextMode,
      puzzle: nextPuzzle,
      players: state.players.slice(),
      routes: buildInitialRoutes(state.players, nextPuzzle.start),
      submitted: {},
      over: null
    };
  }

  if (action.a === 'finish') {
    if (!isHost) return { error: 'Only the host can finish the round early.' };
    if (state.phase === 'over') return state;
    if (Object.keys(state.submitted).length === 0) {
      return { error: 'At least one player must submit a route first.' };
    }
    return Object.assign({}, state, {
      phase: 'over',
      over: computeOverSummary(state.puzzle, state.players, state.submitted)
    });
  }

  // Player actions require being seated
  if (!id || state.players.indexOf(id) < 0) {
    return { error: 'You are watching — tap Join Table to play.' };
  }
  if (state.phase === 'over') {
    return { error: 'This round is over. Start a new map to keep playing.' };
  }

  if (action.a === 'unsubmit') {
    if (!state.submitted[id]) return state;
    const nextSub = Object.assign({}, state.submitted);
    delete nextSub[id];
    return Object.assign({}, state, { submitted: nextSub });
  }

  if (state.submitted[id]) {
    return { error: 'Route is locked in. Tap Edit Route to make changes.' };
  }

  if (action.a === 'step') {
    const current = state.routes[id] || [state.puzzle.start];
    const res = engine.applyStep(state.puzzle, current, action.cell);
    if (res.err) return { error: res.err };
    if (!res.changed) return state;
    const nextRoutes = Object.assign({}, state.routes);
    nextRoutes[id] = res.cells;
    return Object.assign({}, state, { routes: nextRoutes });
  }

  if (action.a === 'setPath') {
    const check = engine.validatePath(state.puzzle, action.cells);
    if (check.err) return { error: check.err };
    const nextRoutes = Object.assign({}, state.routes);
    nextRoutes[id] = action.cells.slice();
    return Object.assign({}, state, { routes: nextRoutes });
  }

  if (action.a === 'undo') {
    const current = state.routes[id] || [state.puzzle.start];
    if (current.length <= 1) return state;
    const nextRoutes = Object.assign({}, state.routes);
    nextRoutes[id] = current.slice(0, current.length - 1);
    return Object.assign({}, state, { routes: nextRoutes });
  }

  if (action.a === 'clear') {
    const nextRoutes = Object.assign({}, state.routes);
    nextRoutes[id] = [state.puzzle.start];
    return Object.assign({}, state, { routes: nextRoutes });
  }

  if (action.a === 'submit') {
    const current = state.routes[id] || [state.puzzle.start];
    const check = engine.validatePath(state.puzzle, current);
    if (check.err) return { error: check.err };
    const ev = check.eval;
    if (current[current.length - 1] !== state.puzzle.end) {
      return { error: 'Your route must reach the red END goal.' };
    }
    if (!ev.hitAllCheckpoints) {
      return { error: 'Collect every delivery package (📦) before finishing!' };
    }

    const nextSub = Object.assign({}, state.submitted);
    nextSub[id] = ev;

    const allDone = state.players.length > 0 && state.players.every((pid) => !!nextSub[pid]);
    if (allDone) {
      return Object.assign({}, state, {
        submitted: nextSub,
        phase: 'over',
        over: computeOverSummary(state.puzzle, state.players, nextSub)
      });
    }
    return Object.assign({}, state, { submitted: nextSub });
  }

  return { error: 'Unknown action.' };
}

export function project(state, playerId) {
  const isOver = state.phase === 'over';

  // Strip optimal & benchmark solutions while the round is live
  const projectedPuzzle = isOver
    ? state.puzzle
    : {
        size: state.puzzle.size,
        mode: state.puzzle.mode,
        grid: state.puzzle.grid,
        start: state.puzzle.start,
        end: state.puzzle.end,
        checkpoints: state.puzzle.checkpoints,
        optimal: null,
        gps: null,
        greedy: null
      };

  // Strip other players' live coordinates & costs until the round ends
  const myRoute = state.routes[playerId] || [state.puzzle.start];
  const myEval = engine.evaluatePath(state.puzzle, myRoute);

  const peerStatus = {};
  for (let i = 0; i < state.players.length; i++) {
    const pid = state.players[i];
    const r = state.routes[pid] || [state.puzzle.start];
    peerStatus[pid] = {
      steps: Math.max(0, r.length - 1),
      submitted: !!state.submitted[pid],
      result: isOver ? (state.submitted[pid] || null) : null
    };
  }

  return {
    epoch: state.epoch,
    phase: state.phase,
    size: state.size,
    mode: state.mode,
    puzzle: projectedPuzzle,
    players: state.players,
    you: playerId,
    isSeated: state.players.indexOf(playerId) >= 0,
    myRoute: myRoute,
    myEval: myEval,
    mySubmitted: !!state.submitted[playerId],
    peerStatus: peerStatus,
    over: isOver ? state.over : null
  };
}

export function roundId(state) {
  return 'traffic-e' + state.epoch;
}

export function prune(state, goneId) {
  if (state.players.indexOf(goneId) < 0) return state;
  const nextPlayers = state.players.filter((id) => id !== goneId);
  const nextRoutes = Object.assign({}, state.routes);
  const nextSub = Object.assign({}, state.submitted);
  delete nextRoutes[goneId];
  delete nextSub[goneId];

  let nextPhase = state.phase;
  let nextOver = state.over;
  if (
    nextPhase === 'playing' &&
    nextPlayers.length > 0 &&
    Object.keys(nextSub).length > 0 &&
    nextPlayers.every((pid) => !!nextSub[pid])
  ) {
    nextPhase = 'over';
    nextOver = computeOverSummary(state.puzzle, nextPlayers, nextSub);
  }

  return Object.assign({}, state, {
    players: nextPlayers,
    routes: nextRoutes,
    submitted: nextSub,
    phase: nextPhase,
    over: nextOver
  });
}

export function summarize(state, nameOf) {
  if (!state.over || !state.over.winner) return null;
  const winnerName = nameOf(state.over.winner);
  const eff = Math.round(state.over.winnerEff);
  if (state.over.ranked && state.over.ranked.length > 1) {
    return `${winnerName} won ${meta.title} (${eff}% efficiency)`;
  }
  return `${winnerName} cleared ${meta.title} at ${eff}% efficiency`;
}

export function mount(root, api) {
  const style = document.createElement('style');
  style.textContent = `
    :host {
      display: block;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #f8fafc;
      background: #0f172a;
      border-radius: 14px;
      padding: 14px;
      max-width: 820px;
      margin: 0 auto;
      user-select: none;
      -webkit-user-select: none;
    }
    * { box-sizing: border-box; }
    .top-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid #1e293b;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand h2 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      color: #fbbf24;
    }
    .sub-pill {
      font-size: 0.72rem;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.35);
      color: #6ee7b7;
      font-weight: 700;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    select, button {
      min-height: 40px;
      padding: 7px 12px;
      border-radius: 9px;
      border: 1px solid #334155;
      background: #1e293b;
      color: #f8fafc;
      font-weight: 700;
      font-size: 0.82rem;
      cursor: pointer;
      transition: transform 0.12s, background 0.15s;
    }
    button:hover:not(:disabled) { background: #334155; }
    button:active:not(:disabled) { transform: scale(0.97); }
    button:disabled { opacity: 0.42; cursor: not-allowed; }
    .btn-amber { background: #d97706; border-color: #f59e0b; color: #fff; }
    .btn-amber:hover:not(:disabled) { background: #b45309; }
    .btn-green { background: #059669; border-color: #10b981; color: #fff; }
    .btn-green:hover:not(:disabled) { background: #047857; }
    .btn-red { background: rgba(239, 68, 68, 0.18); border-color: rgba(239, 68, 68, 0.4); color: #fca5a5; }
    .banner {
      padding: 10px 12px;
      border-radius: 10px;
      background: #1e293b;
      border: 1px solid #334155;
      font-size: 0.86rem;
      font-weight: 600;
      text-align: center;
      margin-bottom: 12px;
      color: #93c5fd;
    }
    .banner.warn {
      background: rgba(245, 158, 11, 0.14);
      border-color: rgba(245, 158, 11, 0.45);
      color: #fde68a;
    }
    .banner.over {
      background: rgba(16, 185, 129, 0.14);
      border-color: rgba(16, 185, 129, 0.45);
      color: #6ee7b7;
    }
    .layout {
      display: grid;
      grid-template-columns: 1fr 250px;
      gap: 14px;
      align-items: start;
    }
    @media (max-width: 700px) {
      .layout { grid-template-columns: 1fr; }
    }
    .board-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
    }
    .canvas-shell {
      width: 100%;
      max-width: 470px;
      aspect-ratio: 1 / 1;
      background: #090d16;
      border-radius: 12px;
      border: 2px solid #334155;
      overflow: hidden;
      touch-action: none;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      cursor: pointer;
      touch-action: none;
    }
    .action-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
      width: 100%;
      max-width: 470px;
      margin-top: 10px;
    }
    .action-row button { flex: 1 1 auto; }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: center;
      margin-top: 8px;
      font-size: 0.74rem;
      color: #94a3b8;
    }
    .side-col {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 11px;
    }
    .card-title {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #94a3b8;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .metric-big {
      font-size: 1.35rem;
      font-weight: 800;
      color: #f8fafc;
    }
    .turn-pills {
      display: flex;
      gap: 5px;
      margin-top: 6px;
      font-size: 0.72rem;
      font-weight: 700;
    }
    .tp {
      flex: 1;
      text-align: center;
      padding: 4px;
      border-radius: 6px;
    }
    .tp.r { background: rgba(16, 185, 129, 0.15); color: #34d399; }
    .tp.s { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
    .tp.l { background: rgba(239, 68, 68, 0.15); color: #f87171; }
    .roster-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 8px;
      border-radius: 7px;
      background: rgba(15, 23, 42, 0.6);
      margin-bottom: 5px;
      font-size: 0.8rem;
    }
    .ai-cmp {
      font-size: 0.78rem;
      line-height: 1.45;
      color: #cbd5e1;
    }
    .ai-cmp div {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
  `;

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="top-bar">
      <div class="brand">
        <span>🚦</span>
        <h2>TRAFFIC</h2>
        <span class="sub-pill">UPS Turns: R 1.1× · L 1.6×</span>
      </div>
      <div class="toolbar">
        <select id="sizeSel" title="Grid Size">
          <option value="7">7×7 Quick</option>
          <option value="9" selected>9×9 Standard</option>
          <option value="11">11×11 Metro</option>
        </select>
        <select id="modeSel" title="Traffic Mode">
          <option value="standard">🏙️ Standard</option>
          <option value="rush">🚨 Rush Hour</option>
          <option value="highway">⚡ Expressway</option>
          <option value="delivery">📦 Delivery Stops</option>
        </select>
        <button class="btn-amber" id="newBtn">🎲 New Map</button>
        <button id="finishBtn" style="display:none;">🏁 Reveal</button>
      </div>
    </div>

    <div class="banner" id="banner">Drag or tap adjacent tiles from START (🟢) to END (🔴).</div>

    <div class="layout">
      <div class="board-col">
        <div class="canvas-shell">
          <canvas id="board" width="540" height="540"></canvas>
        </div>
        <div class="action-row">
          <button class="btn-green" id="submitBtn">✅ Submit Route</button>
          <button id="undoBtn">↩️ Undo</button>
          <button class="btn-red" id="clearBtn">🗑️ Clear</button>
          <button class="btn-amber" id="joinBtn" style="display:none;">🪑 Join Table</button>
        </div>
        <div class="legend">
          <span>🟢 Start</span>
          <span>🔴 End</span>
          <span>🚧 Jam 2.2×</span>
          <span>🚦 Gridlock 3.5×</span>
          <span>⚡ Highway 0.55×</span>
          <span style="color:#34d399;">↪ Right 1.1×</span>
          <span style="color:#f87171;">↩ Left 1.6×</span>
        </div>
      </div>

      <div class="side-col">
        <div class="card">
          <div class="card-title">Your Route Time</div>
          <div class="metric-big" id="myCost">0.0s</div>
          <div class="turn-pills">
            <span class="tp r" id="myRights">↪ 0 R</span>
            <span class="tp s" id="myStraights">⬆ 0 S</span>
            <span class="tp l" id="myLefts">↩ 0 L</span>
          </div>
        </div>

        <div class="card" id="aiCard" style="display:none;">
          <div class="card-title">Engine Benchmarks</div>
          <div class="ai-cmp" id="aiList"></div>
        </div>

        <div class="card">
          <div class="card-title">Dispatch Drivers</div>
          <div id="driverList"></div>
        </div>
      </div>
    </div>
  `;

  root.appendChild(style);
  root.appendChild(wrap);

  const canvas = wrap.querySelector('#board');
  const ctx = canvas.getContext('2d');
  const bannerEl = wrap.querySelector('#banner');
  const sizeSel = wrap.querySelector('#sizeSel');
  const modeSel = wrap.querySelector('#modeSel');
  const newBtn = wrap.querySelector('#newBtn');
  const finishBtn = wrap.querySelector('#finishBtn');
  const submitBtn = wrap.querySelector('#submitBtn');
  const undoBtn = wrap.querySelector('#undoBtn');
  const clearBtn = wrap.querySelector('#clearBtn');
  const joinBtn = wrap.querySelector('#joinBtn');
  const myCostEl = wrap.querySelector('#myCost');
  const myRightsEl = wrap.querySelector('#myRights');
  const myStraightsEl = wrap.querySelector('#myStraights');
  const myLeftsEl = wrap.querySelector('#myLefts');
  const aiCardEl = wrap.querySelector('#aiCard');
  const aiListEl = wrap.querySelector('#aiList');
  const driverListEl = wrap.querySelector('#driverList');

  let view = null;
  let localCells = [];
  let isDragging = false;
  let lastPointerCell = -1;
  let errorMsg = '';
  let errorTimer = null;
  let animRunning = false;
  let animProgress = 0;

  function showTransientError(msg) {
    errorMsg = msg;
    renderBanner();
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = api.setTimeout(() => {
      errorMsg = '';
      renderBanner();
    }, 2600);
  }

  function nameFor(pid) {
    if (pid === (api.me && api.me.id)) return api.me.name || 'You';
    const roster = api.roster || [];
    for (let i = 0; i < roster.length; i++) {
      if (roster[i].id === pid) return roster[i].name;
    }
    return 'Driver ' + String(pid).slice(0, 4);
  }

  function cellFromEvent(e) {
    if (!view || !view.puzzle) return -1;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const N = view.puzzle.size;
    const tile = canvas.width / N;
    const c = Math.floor(x / tile);
    const r = Math.floor(y / tile);
    if (r < 0 || r >= N || c < 0 || c >= N) return -1;
    return r * N + c;
  }

  function handleStepTo(cell) {
    if (!view || view.phase === 'over') return;
    if (!view.isSeated) {
      showTransientError('👁 Watching — tap Join Table to draw a route.');
      return;
    }
    if (view.mySubmitted) {
      showTransientError('Route is submitted — tap Edit Route first.');
      return;
    }
    const res = engine.applyStep(view.puzzle, localCells, cell);
    if (res.err) return;
    if (res.changed) {
      localCells = res.cells;
      api.send({ a: 'setPath', cells: localCells });
      drawBoard();
      renderStats();
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    }
    const cell = cellFromEvent(e);
    if (cell < 0) return;
    isDragging = true;
    lastPointerCell = cell;
    handleStepTo(cell);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const cell = cellFromEvent(e);
    if (cell < 0 || cell === lastPointerCell) return;
    lastPointerCell = cell;
    handleStepTo(cell);
  });

  function stopDrag() {
    isDragging = false;
    lastPointerCell = -1;
  }
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  newBtn.addEventListener('click', () => {
    api.send({
      a: 'newRound',
      size: parseInt(sizeSel.value, 10) || 9,
      mode: modeSel.value || 'standard'
    });
  });

  finishBtn.addEventListener('click', () => {
    api.send({ a: 'finish' });
  });

  submitBtn.addEventListener('click', () => {
    if (!view) return;
    if (view.mySubmitted) {
      api.send({ a: 'unsubmit' });
      return;
    }
    const ev = engine.evaluatePath(view.puzzle, localCells);
    if (localCells[localCells.length - 1] !== view.puzzle.end) {
      showTransientError('Draw all the way to the red END tile first!');
      return;
    }
    if (!ev.hitAllCheckpoints) {
      showTransientError('Collect every 📦 delivery checkpoint before submitting!');
      return;
    }
    api.send({ a: 'submit' });
  });

  undoBtn.addEventListener('click', () => {
    if (!view || !view.isSeated || view.mySubmitted || localCells.length <= 1) return;
    localCells = localCells.slice(0, localCells.length - 1);
    api.send({ a: 'undo' });
    drawBoard();
    renderStats();
  });

  clearBtn.addEventListener('click', () => {
    if (!view || !view.isSeated || view.mySubmitted) return;
    localCells = [view.puzzle.start];
    api.send({ a: 'clear' });
    drawBoard();
    renderStats();
  });

  joinBtn.addEventListener('click', () => {
    api.send({ a: 'join' });
  });

  function renderBanner() {
    if (!view) return;
    bannerEl.className = 'banner';
    if (errorMsg) {
      bannerEl.classList.add('warn');
      bannerEl.textContent = '⚠️ ' + errorMsg;
      return;
    }
    if (!view.isSeated) {
      bannerEl.classList.add('warn');
      bannerEl.textContent = '👁 Watching — tap Join Table below to jump in.';
      return;
    }
    if (view.phase === 'over' && view.over) {
      bannerEl.classList.add('over');
      const optCost = view.puzzle.optimal ? view.puzzle.optimal.cost.toFixed(1) : '?';
      const gpsCost = view.puzzle.gps ? view.puzzle.gps.cost.toFixed(1) : '?';
      const wName = view.over.winner ? nameFor(view.over.winner) : 'Done';
      bannerEl.textContent = `🏁 ${wName} leads (${view.over.winnerEff}% eff) · UPS Optimal: ${optCost}s vs Naive GPS: ${gpsCost}s`;
      return;
    }
    if (view.mySubmitted) {
      bannerEl.textContent = '✅ Route locked in! Waiting for other drivers...';
      return;
    }
    const ev = engine.evaluatePath(view.puzzle, localCells);
    if (ev.complete) {
      bannerEl.classList.add('over');
      bannerEl.textContent = `🎯 Goal reached (${ev.cost.toFixed(1)}s)! Tap Submit Route to lock it in.`;
    } else {
      bannerEl.textContent = 'Drag or tap tiles from START (🟢) to END (🔴). Favor right turns (1.1×) over left turns (1.6×)!';
    }
  }

  function renderStats() {
    if (!view || !view.puzzle) return;
    const ev = engine.evaluatePath(view.puzzle, localCells);
    myCostEl.textContent = ev.cost.toFixed(1) + 's';
    myRightsEl.textContent = '↪ ' + ev.rightTurns + ' R';
    myStraightsEl.textContent = '⬆ ' + ev.straightMoves + ' S';
    myLeftsEl.textContent = '↩ ' + ev.leftTurns + ' L';

    const isHost = !!api.isHost;
    sizeSel.disabled = !isHost;
    modeSel.disabled = !isHost;
    newBtn.disabled = !isHost;

    if (document.activeElement !== sizeSel) sizeSel.value = String(view.size);
    if (document.activeElement !== modeSel) modeSel.value = view.mode;

    const anySubmitted = Object.keys(view.peerStatus || {}).some((k) => view.peerStatus[k].submitted);
    finishBtn.style.display = (isHost && view.phase === 'playing' && view.players.length > 1 && anySubmitted)
      ? 'inline-block'
      : 'none';

    joinBtn.style.display = !view.isSeated ? 'inline-block' : 'none';
    submitBtn.style.display = view.isSeated ? 'inline-block' : 'none';
    undoBtn.style.display = view.isSeated ? 'inline-block' : 'none';
    clearBtn.style.display = view.isSeated ? 'inline-block' : 'none';

    submitBtn.disabled = view.phase === 'over';
    submitBtn.textContent = view.mySubmitted ? '✏️ Edit Route' : '✅ Submit Route';
    undoBtn.disabled = view.phase === 'over' || view.mySubmitted || localCells.length <= 1;
    clearBtn.disabled = view.phase === 'over' || view.mySubmitted || localCells.length <= 1;

    if (view.phase === 'over' && view.puzzle.optimal) {
      aiCardEl.style.display = 'block';
      const opt = view.puzzle.optimal;
      const gps = view.puzzle.gps || opt;
      const saved = Math.max(0, gps.cost - opt.cost).toFixed(1);
      aiListEl.innerHTML = `
        <div><span>🚚 <b>UPS Optimal</b> (R:${opt.rightTurns} L:${opt.leftTurns})</span><b>${opt.cost.toFixed(1)}s</b></div>
        <div><span>🚕 <b>Turn-Blind GPS</b> (R:${gps.rightTurns} L:${gps.leftTurns})</span><b>${gps.cost.toFixed(1)}s</b></div>
        <div style="color:#34d399;border:none;"><span>💡 Right-Turn Savings:</span><b>-${saved}s</b></div>
      `;
    } else {
      aiCardEl.style.display = 'none';
    }

    driverListEl.innerHTML = '';
    for (let i = 0; i < view.players.length; i++) {
      const pid = view.players[i];
      const st = (view.peerStatus && view.peerStatus[pid]) || { steps: 0, submitted: false };
      const row = document.createElement('div');
      row.className = 'roster-item';
      let badge = st.submitted ? '✅ Locked' : `${st.steps} steps`;
      if (view.phase === 'over' && st.result && view.puzzle.optimal) {
        const eff = Math.min(100, Math.round((view.puzzle.optimal.cost / Math.max(0.01, st.result.cost)) * 100));
        badge = `${st.result.cost.toFixed(1)}s (${eff}%)`;
      }
      row.innerHTML = `<span><b>${nameFor(pid)}</b></span><span style="color:#93c5fd;font-weight:700;">${badge}</span>`;
      driverListEl.appendChild(row);
    }
  }

  function drawRouteRibbon(cells, N, tile, color, width, dashed) {
    if (!cells || cells.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dashed) ctx.setLineDash(dashed);
    ctx.beginPath();
    for (let i = 0; i < cells.length; i++) {
      const r = (cells[i] / N) | 0, c = cells[i] % N;
      const x = (c + 0.5) * tile, y = (r + 0.5) * tile;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawTurnBadges(nodes, N, tile) {
    if (!nodes || nodes.length < 2) return;
    const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const curr = nodes[i];
      const x = (prev.c + 0.5) * tile;
      const y = (prev.r + 0.5) * tile;
      let col = '#38bdf8';
      if (curr.turn === 'left' || curr.turn === 'uturn') col = '#ef4444';
      else if (curr.turn === 'right') col = '#10b981';

      if (i >= 2) {
        ctx.save();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(8, tile * 0.17), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(tile * 0.2)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(arrows[curr.dirIdx] || '•', x, y);
        ctx.restore();
      }
    }
  }

  function drawVehicleMarker(cells, N, tile, progress, label, color) {
    if (!cells || cells.length < 2) return;
    const totalSegs = cells.length - 1;
    const exact = Math.min(1, Math.max(0, progress)) * totalSegs;
    const idx = Math.min(totalSegs - 1, Math.floor(exact));
    const frac = exact - idx;
    const c1 = cells[idx], c2 = cells[idx + 1];
    const r1 = (c1 / N) | 0, col1 = c1 % N;
    const r2 = (c2 / N) | 0, col2 = c2 % N;
    const x = (col1 + (col2 - col1) * frac + 0.5) * tile;
    const y = (r1 + (r2 - r1) * frac + 0.5) * tile;

    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, tile * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `${Math.round(tile * 0.28)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
    ctx.restore();
  }

  function drawBoard() {
    if (!view || !view.puzzle) return;
    const puzzle = view.puzzle;
    const N = puzzle.size;
    const tile = canvas.width / N;
    const grid = puzzle.grid;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < N * N; i++) {
      const r = (i / N) | 0, c = i % N;
      const x = c * tile, y = r * tile;
      const t = grid[i];

      ctx.fillStyle = (r + c) % 2 === 0 ? '#131c2e' : '#162033';
      ctx.fillRect(x, y, tile, tile);

      if (t === engine.TILE_WALL) {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x + 5, y + 5, tile - 10, tile - 10);
      } else if (t === engine.TILE_TRAFFIC) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.24)';
        ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
        ctx.font = `${Math.round(tile * 0.34)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🚧', x + tile * 0.5, y + tile * 0.42);
        ctx.fillStyle = '#fcd34d';
        ctx.font = `bold ${Math.round(tile * 0.18)}px sans-serif`;
        ctx.fillText('2.2×', x + tile * 0.5, y + tile * 0.8);
      } else if (t === engine.TILE_GRIDLOCK) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.26)';
        ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
        ctx.font = `${Math.round(tile * 0.34)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🚦', x + tile * 0.5, y + tile * 0.42);
        ctx.fillStyle = '#fca5a5';
        ctx.font = `bold ${Math.round(tile * 0.18)}px sans-serif`;
        ctx.fillText('3.5×', x + tile * 0.5, y + tile * 0.8);
      } else if (t === engine.TILE_HIGHWAY) {
        ctx.fillStyle = 'rgba(139, 92, 246, 0.24)';
        ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
        ctx.font = `${Math.round(tile * 0.34)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡', x + tile * 0.5, y + tile * 0.42);
        ctx.fillStyle = '#c4b5fd';
        ctx.font = `bold ${Math.round(tile * 0.18)}px sans-serif`;
        ctx.fillText('0.55×', x + tile * 0.5, y + tile * 0.8);
      }

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, tile, tile);
    }

    // Highlight legal next steps with turn-cost color hints while playing
    if (view.phase === 'playing' && view.isSeated && !view.mySubmitted && localCells.length > 0) {
      const head = localCells[localCells.length - 1];
      const hr = (head / N) | 0, hc = head % N;
      let prevDir = 8;
      if (localCells.length >= 2) {
        const prev = localCells[localCells.length - 2];
        const pr = (prev / N) | 0, pc = prev % N;
        for (let d = 0; d < 8; d++) {
          if (hr - pr === [-1, -1, 0, 1, 1, 1, 0, -1][d] && hc - pc === [0, 1, 1, 1, 0, -1, -1, -1][d]) {
            prevDir = d;
          }
        }
      }
      for (let d = 0; d < 8; d++) {
        const nr = hr + [-1, -1, 0, 1, 1, 1, 0, -1][d];
        const nc = hc + [0, 1, 1, 1, 0, -1, -1, -1][d];
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        const nCell = nr * N + nc;
        if (!engine.canStep(grid, N, head, nCell) || localCells.indexOf(nCell) >= 0) continue;
        const tInfo = prevDir < 8 ? engine.classifyTurn(prevDir, d) : { type: 'straight' };
        ctx.fillStyle = tInfo.type === 'right'
          ? 'rgba(16, 185, 129, 0.16)'
          : (tInfo.type === 'left' ? 'rgba(239, 68, 68, 0.14)' : 'rgba(56, 189, 248, 0.14)');
        ctx.fillRect(nc * tile + 3, nr * tile + 3, tile - 6, tile - 6);
      }
    }

    // Checkpoints
    const cps = puzzle.checkpoints || [];
    for (let k = 0; k < cps.length; k++) {
      const cp = cps[k];
      const cr = (cp / N) | 0, cc = cp % N;
      const hit = localCells.indexOf(cp) >= 0;
      ctx.fillStyle = hit ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)';
      ctx.fillRect(cc * tile + 4, cr * tile + 4, tile - 8, tile - 8);
      ctx.font = `${Math.round(tile * 0.42)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hit ? '✅' : '📦', (cc + 0.5) * tile, (cr + 0.5) * tile);
    }

    // Post-round optimal & GPS paths
    if (view.phase === 'over' && puzzle.optimal) {
      if (puzzle.gps && puzzle.gps.cells) {
        drawRouteRibbon(puzzle.gps.cells, N, tile, 'rgba(251, 191, 36, 0.5)', Math.max(4, tile * 0.1), [6, 6]);
      }
      drawRouteRibbon(puzzle.optimal.cells, N, tile, '#10b981', Math.max(6, tile * 0.15), [10, 6]);
    }

    // Player's route
    const ev = engine.evaluatePath(puzzle, localCells);
    drawRouteRibbon(localCells, N, tile, '#38bdf8', Math.max(6, tile * 0.16), null);
    drawTurnBadges(ev.nodes, N, tile);

    // Start & End markers
    const sr = (puzzle.start / N) | 0, sc = puzzle.start % N;
    const er = (puzzle.end / N) | 0, ec = puzzle.end % N;
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc((sc + 0.5) * tile, (sr + 0.5) * tile, tile * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(tile * 0.2)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('START', (sc + 0.5) * tile, (sr + 0.5) * tile);

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc((ec + 0.5) * tile, (er + 0.5) * tile, tile * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('END', (ec + 0.5) * tile, (er + 0.5) * tile);

    // Current player vehicle head or animated race replay
    if (view.phase === 'over' && puzzle.optimal) {
      if (puzzle.gps && puzzle.gps.cells) {
        drawVehicleMarker(puzzle.gps.cells, N, tile, animProgress, '🚕', '#f59e0b');
      }
      drawVehicleMarker(puzzle.optimal.cells, N, tile, animProgress, '🚚', '#10b981');
      drawVehicleMarker(localCells, N, tile, animProgress, '🚗', '#38bdf8');
    } else if (localCells.length > 0) {
      const head = localCells[localCells.length - 1];
      const hr = (head / N) | 0, hc = head % N;
      ctx.font = `${Math.round(tile * 0.4)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚗', (hc + 0.5) * tile, (hr + 0.5) * tile);
    }
  }

  function startReplayLoop() {
    if (animRunning) return;
    animRunning = true;
    let lastTs = performance.now();
    function tick(now) {
      if (!animRunning || !view || view.phase !== 'over') {
        animRunning = false;
        return;
      }
      const dt = (now - lastTs) / 1000;
      lastTs = now;
      animProgress = (animProgress + dt * 0.38) % 1.18;
      drawBoard();
      api.raf(tick);
    }
    api.raf(tick);
  }

  return {
    update(nextView) {
      const prevEpoch = view ? view.epoch : -1;
      const wasOver = view ? view.phase === 'over' : false;
      view = nextView;

      if (view.epoch !== prevEpoch || !isDragging) {
        localCells = (view.myRoute && view.myRoute.length)
          ? view.myRoute.slice()
          : [view.puzzle.start];
      }

      renderBanner();
      renderStats();
      drawBoard();

      if (view.phase === 'over' && !wasOver) {
        animProgress = 0;
        startReplayLoop();
      } else if (view.phase !== 'over') {
        animRunning = false;
      }
    },
    destroy() {
      animRunning = false;
    }
  };
}