// ============================================================
// Conway's Game of Life — script.js
// Rules: B3/S23 by default (configurable via UI sliders)
// Grid topology: toroidal — edges wrap around seamlessly
// ============================================================

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

// --- Visual config ------------------------------------------
const CELL_SIZE     = 14;       // pixels per cell (desktop default)
const AGE_THRESHOLD = 15;       // generations before a cell shifts to "old" color
const COLOR_YOUNG   = '#00FF41'; // bright lime — newly born or young cells
const COLOR_OLD     = '#005C1A'; // deep forest green — long-lived, stable cells
const COLOR_BG      = '#0D0D0D'; // near-black background
const MONSOON_PROB  = 0.003;     // probability of random cell death per gen in monsoon mode

// --- Simulation state ---------------------------------------
let cols, rows;
let grid     = [];  // current gen — values: 1 (alive) or 0 (dead)
let nextGrid = [];  // scratch grid computed before swap
let ageGrid  = [];  // consecutive generations each cell has been alive

let running    = false;
let animId     = null;
let generation = 0;
let speed      = 10;  // target frames per second
let lastTime   = 0;

// Rule parameters — changed by UI sliders
let birthThreshold = 3;  // exactly this many neighbors → dead cell is born
let survivalMin    = 2;  // live cell needs ≥ this many neighbors to survive
let survivalMax    = 3;  // live cell needs ≤ this many neighbors to survive

let monsoonMode = false;  // random disaster deaths each generation

// Population graph state
let populationHistory = [];  // rolling population counts
const POP_HISTORY_MAX = 200;

// Rule presets — see README "Experiments" section for what these do
// Multi-value rules (HighLife B36, Day&Night B3678/S34678) use first value on sliders
const RULE_PRESETS = {
  conway:   { birth: 3, survMin: 2, survMax: 3 },
  highlife: { birth: 3, survMin: 2, survMax: 3 },  // B36/S23 — also births at 6
  seeds:    { birth: 2, survMin: 0, survMax: 0 },  // B2/S — nothing survives
  daynight: { birth: 3, survMin: 3, survMax: 8 }    // B3678/S34678 — approximation
};

// --- Canvas + grid sizing -----------------------------------

function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  canvas.width  = container.clientWidth;
  // Leave 80px at bottom for the population graph overlay
  canvas.height = container.clientHeight - 80;
  // Compute grid dimensions from cell size
  cols = Math.floor(canvas.width  / CELL_SIZE);
  rows = Math.floor(canvas.height / CELL_SIZE);
  initGrid();
}

function initGrid() {
  // Allocate all three grids as 2D arrays (rows × cols)
  grid     = Array.from({ length: rows }, () => new Array(cols).fill(0));
  nextGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  ageGrid  = Array.from({ length: rows }, () => new Array(cols).fill(0));
  generation = 0;
  populationHistory = [];
  updateGenDisplay();
}

// --- Neighbor counting (toroidal) ---------------------------

function countNeighbors(g, row, col) {
  // Check all 8 surrounding cells. Modulo arithmetic wraps the grid into
  // a torus — the left edge connects to the right, top to bottom.
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;  // skip the cell itself
      const r = (row + dr + rows) % rows;  // wrap row
      const c = (col + dc + cols) % cols;  // wrap col
      count += g[r][c];  // g[r][c] is 1 or 0, so this sums directly
    }
  }
  return count;
}

// --- Rule application ----------------------------------------

function applyRules() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n     = countNeighbors(grid, r, c);
      const alive = grid[r][c] === 1;

      if (alive) {
        // Survival: live cell stays alive if neighbors are within [min, max]
        nextGrid[r][c] = (n >= survivalMin && n <= survivalMax) ? 1 : 0;
      } else {
        // Birth: dead cell comes alive with exactly birthThreshold neighbors
        nextGrid[r][c] = (n === birthThreshold) ? 1 : 0;
      }

      // Monsoon mode: small random chance kills a live cell (models floods/evictions)
      if (monsoonMode && nextGrid[r][c] === 1 && Math.random() < MONSOON_PROB) {
        nextGrid[r][c] = 0;
      }

      // Age tracking: increment if still alive, reset to 0 if dead
      if (nextGrid[r][c] === 1) {
        // Reset age if the cell was just born (wasn't alive last gen)
        ageGrid[r][c] = alive ? ageGrid[r][c] + 1 : 1;
      } else {
        ageGrid[r][c] = 0;
      }
    }
  }

  // Swap current ↔ next: avoids allocating new arrays every generation
  [grid, nextGrid] = [nextGrid, grid];
  generation++;
  updateGenDisplay();

  // Track population for the graph
  const pop = grid.flat().reduce((a, b) => a + b, 0);
  updatePopDisplay(pop);
}

// --- Rendering ----------------------------------------------

function render() {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 0) continue;  // skip dead cells — background covers them

      // Cells that have survived past AGE_THRESHOLD generations render darker.
      // This makes stable structures (still lifes, old oscillators) visually distinct
      // from active growth fronts — a nod to "generational memory" in old communities.
      ctx.fillStyle = ageGrid[r][c] >= AGE_THRESHOLD ? COLOR_OLD : COLOR_YOUNG;
      ctx.fillRect(
        c * CELL_SIZE + 1,  // +1px gap creates subtle grid lines between cells
        r * CELL_SIZE + 1,
        CELL_SIZE - 1,
        CELL_SIZE - 1
      );
    }
  }
  renderPopGraph();
}

function renderPopGraph() {
  const popCanvas = document.getElementById('pop-canvas');
  if (!popCanvas) return;
  const pCtx = popCanvas.getContext('2d');
  const w = popCanvas.clientWidth;
  const h = popCanvas.height;
  pCtx.clearRect(0, 0, w, h);

  const visible = populationHistory.slice(-POP_HISTORY_MAX);
  if (visible.length < 2) return;

  // Always normalize to POP_HISTORY_MAX points spread across full width
  const maxPop = Math.max(...visible, 1);
  const minPop = Math.min(...visible, 0);
  const range = maxPop - minPop || 1;
  const stepX = w / (POP_HISTORY_MAX - 1);

  // Draw baseline
  pCtx.strokeStyle = '#1f1f1f';
  pCtx.lineWidth = 1;
  pCtx.beginPath();
  pCtx.moveTo(0, h - 1);
  pCtx.lineTo(w, h - 1);
  pCtx.stroke();

  // Draw population line — recent history fills the full graph width
  pCtx.strokeStyle = '#00FF41';
  pCtx.lineWidth = 1;
  pCtx.beginPath();
  visible.forEach((pop, i) => {
    const x = i * stepX;
    const y = h - ((pop - minPop) / range) * (h - 4) - 2;
    i === 0 ? pCtx.moveTo(x, y) : pCtx.lineTo(x, y);
  });
  pCtx.stroke();
}

// --- Game loop ----------------------------------------------

function gameLoop(timestamp) {
  if (!running) return;
  // Only advance if enough time has elapsed — enforces target FPS
  if (timestamp - lastTime >= 1000 / speed) {
    applyRules();
    render();
    lastTime = timestamp;
  }
  animId = requestAnimationFrame(gameLoop);
}

function startSim() {
  if (running) return;
  running = true;
  document.getElementById('btn-start').textContent = 'Pause';
  animId = requestAnimationFrame(gameLoop);
}

function pauseSim() {
  running = false;
  cancelAnimationFrame(animId);
  document.getElementById('btn-start').textContent = 'Start';
}

function toggleStartPause() {
  running ? pauseSim() : startSim();
}

// Advance exactly one generation — useful for watching rules apply step by step
function stepOnce() {
  pauseSim();
  applyRules();
  render();
}

// --- Preset patterns ----------------------------------------
// Each pattern is an array of [row, col] offsets from a center origin.
// Loaded centered on the grid.

const PATTERNS = {
  glider: [
    // Travels diagonally one cell every 4 generations — the simplest "spaceship"
    [0,1],[1,2],[2,0],[2,1],[2,2]
  ],
  blinker: [
    // Period-2 oscillator: three cells in a row flipping between horizontal/vertical
    [0,0],[0,1],[0,2]
  ],
  pulsar: [
    // Period-3 oscillator — large, symmetric, one of the most common patterns
    [0,2],[0,3],[0,4],[0,8],[0,9],[0,10],
    [2,0],[2,5],[2,7],[2,12],
    [3,0],[3,5],[3,7],[3,12],
    [4,0],[4,5],[4,7],[4,12],
    [5,2],[5,3],[5,4],[5,8],[5,9],[5,10],
    [7,2],[7,3],[7,4],[7,8],[7,9],[7,10],
    [8,0],[8,5],[8,7],[8,12],
    [9,0],[9,5],[9,7],[9,12],
    [10,0],[10,5],[10,7],[10,12],
    [12,2],[12,3],[12,4],[12,8],[12,9],[12,10]
  ],
  block: [
    // 2×2 still life — the simplest stable pattern, never changes
    [0,0],[0,1],[1,0],[1,1]
  ],
  beehive: [
    // 6-cell still life — very common in random starts, visually satisfying
    [0,1],[0,2],[1,0],[1,3],[2,1],[2,2]
  ],
  lwss: [
    // Lightweight Spaceship — travels horizontally, 4 cells per period
    [0,2],[0,3],[0,4],[0,5],
    [1,0],[1,5],
    [2,0],[2,4],[2,5],
    [3,1],[3,2],[3,3]
  ],
  gliderGun: [
    // Gosper Glider Gun — fires a glider every 30 generations, infinite growth
    [0,24],[1,22],[1,24],[2,12],[2,13],[2,20],[2,21],[2,34],[2,35],
    [3,11],[3,15],[3,20],[3,21],[3,34],[3,35],
    [4,0],[4,1],[4,10],[4,16],[4,20],[4,21],[4,34],[4,35],
    [5,0],[5,1],[5,10],[5,14],[5,16],[5,17],[5,22],[5,24],
    [6,10],[6,16],[6,24],[7,11],[7,15],[8,12],[8,13]
  ],
  eater: [
    // Eater — absorbs an incoming glider and survives intact
    [0,0],[0,1],[1,0],[1,2],[2,2]
  ]
};

function loadPattern(name) {
  pauseSim();
  initGrid();
  const cells = PATTERNS[name];
  if (!cells) return;

  // Center the pattern: find its bounding box and offset to grid middle
  const maxRow   = Math.max(...cells.map(([r]) => r));
  const maxCol   = Math.max(...cells.map(([, c]) => c));
  const startRow = Math.floor((rows - maxRow) / 2);
  const startCol = Math.floor((cols - maxCol) / 2);

  cells.forEach(([dr, dc]) => {
    const r = startRow + dr;
    const c = startCol + dc;
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      grid[r][c]    = 1;
      ageGrid[r][c] = 1;
    }
  });
  render();
}

// --- Utility ------------------------------------------------

function randomize() {
  pauseSim();
  initGrid();
  // ~30% density: a typical mid-density starting point that produces lively patterns
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid[r][c]    = Math.random() < 0.30 ? 1 : 0;
      ageGrid[r][c] = grid[r][c];
    }
  }
  render();
}

function clearGrid() {
  pauseSim();
  initGrid();
  render();
}

function updateGenDisplay() {
  document.getElementById('gen-count').textContent = generation;
}

function updatePopDisplay(count) {
  populationHistory.push(count);
  if (populationHistory.length > POP_HISTORY_MAX) populationHistory.shift();
  document.getElementById('pop-count').textContent = count;
}

function applyPreset(name) {
  const preset = RULE_PRESETS[name];
  if (!preset) return;
  birthThreshold = preset.birth;
  survivalMin = preset.survMin;
  survivalMax = preset.survMax;
  // Sync sliders and their value displays
  document.getElementById('slider-birth').value = birthThreshold;
  document.getElementById('val-birth').textContent = birthThreshold;
  document.getElementById('slider-surv-min').value = survivalMin;
  document.getElementById('val-surv-min').textContent = survivalMin;
  document.getElementById('slider-surv-max').value = survivalMax;
  document.getElementById('val-surv-max').textContent = survivalMax;
}

// --- Mouse / touch: draw cells ------------------------------

let isDrawing = false;
let drawValue = 1;  // 1 = painting alive, 0 = erasing — set on mousedown

function getCellFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    row: Math.floor((e.clientY - rect.top)  / CELL_SIZE),
    col: Math.floor((e.clientX - rect.left) / CELL_SIZE)
  };
}

function paintCell(e) {
  const { row, col } = getCellFromEvent(e);
  if (row < 0 || row >= rows || col < 0 || col >= cols) return;
  grid[row][col]    = drawValue;
  ageGrid[row][col] = drawValue;
  render();
}

canvas.addEventListener('mousedown', (e) => {
  isDrawing = true;
  const { row, col } = getCellFromEvent(e);
  drawValue = grid[row]?.[col] === 1 ? 0 : 1;  // toggle: click live → kill, dead → birth
  paintCell(e);
});
canvas.addEventListener('mousemove',  (e) => { if (isDrawing) paintCell(e); });
canvas.addEventListener('mouseup',    ()  => { isDrawing = false; });
canvas.addEventListener('mouseleave', ()  => { isDrawing = false; });

// Touch equivalents for mobile
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  isDrawing = true;
  const t = e.touches[0];
  const { row, col } = getCellFromEvent(t);
  drawValue = grid[row]?.[col] === 1 ? 0 : 1;
  paintCell(t);
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (isDrawing) paintCell(e.touches[0]);
}, { passive: false });
canvas.addEventListener('touchend', () => { isDrawing = false; });

// --- Keyboard shortcut: spacebar = toggle start/pause -------
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); toggleStartPause(); }
});

// --- Button wiring ------------------------------------------
document.getElementById('btn-start'  ).addEventListener('click', toggleStartPause);
document.getElementById('btn-step'   ).addEventListener('click', stepOnce);
document.getElementById('btn-random' ).addEventListener('click', randomize);
document.getElementById('btn-clear'  ).addEventListener('click', clearGrid);

document.getElementById('btn-monsoon').addEventListener('click', () => {
  monsoonMode = !monsoonMode;
  const btn = document.getElementById('btn-monsoon');
  btn.textContent = monsoonMode ? 'Monsoon: ON' : 'Monsoon';
  btn.classList.toggle('btn-active', monsoonMode);
});

// Rule preset buttons (any element with data-preset attribute)
document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});

// Pattern buttons (any element with data-pattern attribute)
document.querySelectorAll('[data-pattern]').forEach(btn => {
  btn.addEventListener('click', () => loadPattern(btn.dataset.pattern));
});

// --- Slider wiring ------------------------------------------
document.getElementById('slider-speed').addEventListener('input', (e) => {
  speed = parseInt(e.target.value);
  document.getElementById('val-speed').textContent = speed;
});

document.getElementById('slider-birth').addEventListener('input', (e) => {
  birthThreshold = parseInt(e.target.value);
  document.getElementById('val-birth').textContent = birthThreshold;
});

document.getElementById('slider-surv-min').addEventListener('input', (e) => {
  survivalMin = parseInt(e.target.value);
  // Clamp so min never exceeds max
  if (survivalMin > survivalMax) {
    survivalMax = survivalMin;
    document.getElementById('slider-surv-max').value        = survivalMax;
    document.getElementById('val-surv-max').textContent = survivalMax;
  }
  document.getElementById('val-surv-min').textContent = survivalMin;
});

document.getElementById('slider-surv-max').addEventListener('input', (e) => {
  survivalMax = parseInt(e.target.value);
  if (survivalMax < survivalMin) {
    survivalMin = survivalMax;
    document.getElementById('slider-surv-min').value        = survivalMin;
    document.getElementById('val-surv-min').textContent = survivalMin;
  }
  document.getElementById('val-surv-max').textContent = survivalMax;
});

// --- Init ---------------------------------------------------
window.addEventListener('resize', () => {
  const wasRunning = running;
  pauseSim();
  resizeCanvas();
  if (wasRunning) startSim();
});

resizeCanvas();  // set cols/rows, init grids
randomize();     // fill with random seed on load
