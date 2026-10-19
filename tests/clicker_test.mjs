import { test } from 'bun:test';
import { mount } from '../games/clicker/index.js';
import { apiFor } from '../../src/main.js';

// Mock API for testing
const mockApi = {
  me: { id: 'test', name: 'Test Player' },
  seats: {},
  roster: [],
  isSpectator: false,
  atTable: [],
  isHost: true,
  isInRoom: true,
  send: () => {},
  root: document.createElement('div'),
  raf: () => 1,
  cancelRaf: () => {},
  setTimeout: () => 1,
  setInterval: () => 1,
};

test('Clicker game mounts and updates', () => {
  const root = document.createElement('div');
  const api = apiFor(mockApi, root);
  
  const { update, destroy } = mount(root, api);
  
  // Initial state
  const initialState = {
    level: 1,
    score: 0,
    buttons: [],
    currentIndex: 0,
    order: [],
    clickedOrder: [],
  };
  
  // Test initial update
  update(initialState);
  
  // Verify DOM elements exist
  const grid = root.querySelector('div[style*="grid"]');
  const scoreDisplay = root.querySelector('div[style*="textAlign: center"]');
  
  if (!grid || !scoreDisplay) {
    throw new Error('DOM elements not found');
  }
  
  destroy();
});