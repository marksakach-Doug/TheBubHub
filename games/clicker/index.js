export const meta = {
  id: 'clicker',
  title: 'Clicker',
  players: 'solo',
  color: '#ff6b6b',
  icon: '🎯',
  desc: 'Click buttons in order to score!',
  soloable: true,
  noRecord: false
};

let gameState = {
  level: 1,
  score: 0,
  buttons: [],
  currentIndex: 0,
  order: [],
  clickedOrder: [],
};

function init(ctx) {
  // Initialize game state
  gameState = {
    level: 1,
    score: 0,
    buttons: [],
    currentIndex: 0,
    order: [],
    clickedOrder: [],
  };
  
  // Create buttons for level 1
  generateButtons();
  return gameState;
}

function generateButtons() {
  const gridSize = 9;
  const buttons = [];
  const order = [];
  
  // Clear existing buttons
  gameState.buttons = [];
  gameState.order = [];
  
  // Generate buttons for current level
  for (let i = 0; i < gameState.level; i++) {
    let x, y;
    do {
      x = Math.floor(Math.random() * gridSize);
      y = Math.floor(Math.random() * gridSize);
    } while (buttons.some(btn => btn.x === x && btn.y === y));
    
    buttons.push({ x, y, color: 'red' });
    order.push({ x, y });
  }
  
  gameState.buttons = buttons;
  gameState.order = order;
  gameState.currentIndex = 0;
  gameState.clickedOrder = [];
}

function reduce(state, action, ctx) {
  if (action.type === 'click') {
    const clickedButton = state.buttons.find(btn => btn.x === action.x && btn.y === action.y);
    
    if (clickedButton) {
      // Check if this is the correct button to click
      const expectedButton = state.order[state.currentIndex];
      if (clickedButton.x === expectedButton.x && clickedButton.y === expectedButton.y) {
        // Correct click
        state.clickedOrder.push({ x: clickedButton.x, y: clickedButton.y });
        
        // Update button colors
        const updatedButtons = state.buttons.map(btn => {
          if (btn.x === expectedButton.x && btn.y === expectedButton.y) {
            return { ...btn, color: 'blue' };
          }
          return btn;
        });
        
        // Move to next button
        state.currentIndex++;
        
        // Check if all buttons have been clicked
        if (state.currentIndex >= state.order.length) {
          // Level complete, increase score and level
          return {
            ...state,
            score: state.score + 1,
            level: state.level + 1,
            buttons: updatedButtons,
            currentIndex: 0,
            clickedOrder: [],
          };
        } else {
          // Update next button color to red
          const nextButton = state.order[state.currentIndex];
          const nextUpdatedButtons = updatedButtons.map(btn => {
            if (btn.x === nextButton.x && btn.y === nextButton.y) {
              return { ...btn, color: 'red' };
            } else if (btn.color === 'blue') {
              return { ...btn, color: 'orange' };
            }
            return btn;
          });
          
          return {
            ...state,
            buttons: nextUpdatedButtons,
            currentIndex: state.currentIndex,
            clickedOrder: [...state.clickedOrder],
          };
        }
      }
    }
  }
  return state;
}

function project(state, playerId) {
  return state;
}

function mount(root, api) {
  const gridSize = 9;
  const gridCellSize = 50;
  
  // Create grid container
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(${gridSize}, ${gridCellSize}px)`;
  grid.style.gridTemplateRows = `repeat(${gridSize}, ${gridCellSize}px)`;
  grid.style.gap = '2px';
  grid.style.margin = '20px auto';
  grid.style.width = `${gridSize * gridCellSize}px`;
  grid.style.height = `${gridSize * gridCellSize}px`;
  
  // Create buttons
  const buttons = {};
  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      const button = document.createElement('div');
      button.style.width = `${gridCellSize}px`;
      button.style.height = `${gridCellSize}px`;
      button.style.backgroundColor = 'blue';
      button.style.display = 'flex';
      button.style.justifyContent = 'center';
      button.style.alignItems = 'center';
      button.style.cursor = 'pointer';
      button.style.borderRadius = '4px';
      button.dataset.x = x;
      button.dataset.y = y;
      button.addEventListener('click', () => {
        api.send({ type: 'click', x: parseInt(button.dataset.x), y: parseInt(button.dataset.y) });
      });
      grid.appendChild(button);
      buttons[`${x},${y}`] = button;
    }
  }
  
  // Add score display
  const scoreDisplay = document.createElement('div');
  scoreDisplay.style.textAlign = 'center';
  scoreDisplay.style.fontSize = '24px';
  scoreDisplay.style.marginBottom = '10px';
  scoreDisplay.textContent = `Score: 0`;
  root.appendChild(scoreDisplay);
  
  // Add level display
  const levelDisplay = document.createElement('div');
  levelDisplay.style.textAlign = 'center';
  levelDisplay.style.fontSize = '20px';
  levelDisplay.style.marginBottom = '10px';
  levelDisplay.textContent = `Level: 1`;
  root.appendChild(levelDisplay);
  
  // Add instructions
  const instructions = document.createElement('div');
  instructions.style.textAlign = 'center';
  instructions.style.fontSize = '16px';
  instructions.style.marginBottom = '20px';
  instructions.textContent = `Click the red button, then the orange one, and so on!`;
  root.appendChild(instructions);
  
  root.appendChild(grid);
  
  // Update function
  const update = (view) => {
    // Update score display
    scoreDisplay.textContent = `Score: ${view.score}`;
    
    // Update level display
    levelDisplay.textContent = `Level: ${view.level}`;
    
    // Update buttons
    Object.keys(buttons).forEach(key => {
      const [x, y] = key.split(',').map(Number);
      const button = buttons[key];
      button.style.backgroundColor = 'blue';
    });
    
    view.buttons.forEach(btn => {
      const button = buttons[`${btn.x},${btn.y}`];
      if (button) {
        if (btn.color === 'red') {
          button.style.backgroundColor = 'red';
        } else if (btn.color === 'orange') {
          button.style.backgroundColor = 'orange';
        } else if (btn.color === 'blue') {
          button.style.backgroundColor = 'blue';
        }
      }
    });
  };
  
  // Initial update
  update(gameState);
  
  // Destroy function
  const destroy = () => {
    // Cleanup
  };
  
  return { update, destroy };
}

function summarize(state, nameOf) {
  return `${nameOf(api.me.id)} scored ${state.score} points!`;
}

function roundId(state) {
  return `round_${state.level}`;
}