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
  const state = {
    level: 1,
    score: 0,
    buttons: [],
    currentIndex: 0,
    order: [],
    clickedOrder: [],
  };
  
  // Create buttons for level 1
  generateButtons(state);
  return state;
}

function generateButtons(state) {
  const gridSize = 9;
  const buttons = [];
  const order = [];
  
  // Clear existing buttons
  state.buttons = [];
  state.order = [];
  
  // Generate buttons for current level
  for (let i = 0; i < state.level; i++) {
    let x, y;
    do {
      x = Math.floor(Math.random() * gridSize);
      y = Math.floor(Math.random() * gridSize);
    } while (buttons.some(btn => btn.x === x && btn.y === y));
    
    buttons.push({ x, y, color: 'red' });
    order.push({ x, y });
  }
  
  state.buttons = buttons;
  state.order = order;
  state.currentIndex = 0;
  state.clickedOrder = [];
}

function reduce(state, action, ctx) {
  if (action.type === 'click') {
    const clickedButton = state.buttons.find(btn => btn.x === action.x && btn.y === action.y);
    
    if (clickedButton) {
      // Check if this is the correct button to click
      const expectedButton = state.order[state.currentIndex];
      if (clickedButton.x === expectedButton.x && clickedButton.y === expectedButton.y) {
        // Correct click
        const updatedButtons = state.buttons.map(btn => {
          if (btn.x === expectedButton.x && btn.y === expectedButton.y) {
            return { ...btn, color: 'blue' };
          }
          return btn;
        });
        
        // Move to next button
        const newCurrentIndex = state.currentIndex + 1;
        
        // Check if all buttons have been clicked
        if (newCurrentIndex >= state.order.length) {
          // Level complete, increase score and level
          generateButtons({ ...state, level: state.level + 1 });
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
          const nextButton = state.order[newCurrentIndex];
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
            currentIndex: newCurrentIndex,
            clickedOrder: [...state.clickedOrder, { x: clickedButton.x, y: clickedButton.y }],
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

export export function mount(root, api) {
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
    
    // Reset all buttons to blue
    Object.keys(buttons).forEach(key => {
      const [x, y] = key.split(',').map(Number);
      const button = buttons[key];
      button.style.backgroundColor = 'blue';
    });
    
    // Apply button colors from view
    view.buttons.forEach(btn => {
      const button = buttons[`${btn.x},${btn.y}`];
      if (button) {
        if (btn.color === 'red') {
          button.style.backgroundColor = 'red';
        } else if (btn.color === 'orange') {
          button.style.backgroundColor = 'orange';
        }
      }
    });
  };
  
  // Initial update
  update({
    level: 1,
    score: 0,
    buttons: [],
    currentIndex: 0,
    order: [],
    clickedOrder: [],
  });
  
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