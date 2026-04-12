import './style.css';
import { createRoom, fetchApiSchema, fetchRoomState, joinRoom, sendRoomCommand } from './api-client.js';
import { DIRECTION_VECTORS, parseTextCommand, renderAsciiBoard } from './shared/game-engine.js';
import { BACKDROP_STYLES, DEFAULT_SETTINGS, GRID_STYLES, THEMES } from './themes.js';

const SETTINGS_KEY = 'duelsnakes.arena.settings';
const SCORE_KEY = 'duelsnakes.arena.score';
const MAX_FRAME_DELTA = 100;

const app = document.querySelector('#app');

if (!app) {
  throw new Error('SuperDuelSnakes Arena failed to mount: missing #app root.');
}

app.innerHTML = `
  <main class="shell">
    <header class="hero">
      <section>
        <p class="eyebrow">Browser rebuild with the original duel core</p>
        <h1>SuperDuelSnakes Arena</h1>
        <p class="lede">
          Two players, one board, no mercy. This version keeps the head-to-head snake rules from the original desktop game,
          then adds configurable arenas, richer visuals, responsive controls, and a deployable web build.
        </p>
      </section>
      <section class="hero-meta">
        <article class="meta-card">
          <span class="meta-label">Player 1</span>
          <span class="meta-value" id="p1Score">0</span>
          <p class="meta-subtext">WASD controls</p>
        </article>
        <article class="meta-card">
          <span class="meta-label">Player 2</span>
          <span class="meta-value" id="p2Score">0</span>
          <p class="meta-subtext">Arrow keys</p>
        </article>
        <article class="meta-card">
          <span class="meta-label">Draws</span>
          <span class="meta-value" id="drawScore">0</span>
          <p class="meta-subtext">Head-on collisions count</p>
        </article>
        <article class="meta-card">
          <span class="meta-label">Round Clock</span>
          <span class="meta-value" id="roundClock">00:00</span>
          <p class="meta-subtext" id="arenaSummary">25x25 arena at 6 tps</p>
        </article>
      </section>
    </header>

    <section class="main-grid">
      <section class="stage-panel">
        <div class="stage-toolbar">
          <div class="toolbar-group">
            <div class="pill"><strong id="stateLabel">Stopped</strong></div>
            <div class="pill">Theme <strong id="themeLabel">Neon Noir</strong></div>
            <div class="pill">Round <strong id="roundNumber">0</strong></div>
            <div class="pill">Streak <strong id="streakLabel">None</strong></div>
          </div>
          <div class="toolbar-group">
            <button class="button button-secondary" id="fullscreenButton" type="button">Fullscreen</button>
            <button class="button button-primary" id="togglePlayButton" type="button">Start Round</button>
            <button class="button button-secondary" id="restartButton" type="button">Reset Round</button>
          </div>
        </div>

        <div class="canvas-shell" id="canvasShell">
          <canvas class="board-canvas" id="gameCanvas"></canvas>
          <div class="canvas-overlay" id="canvasOverlay"></div>
        </div>

        <div class="stage-footer">
          <article class="footer-card">
            <span>Controls</span>
            <strong>WASD and Arrow Keys</strong>
          </article>
          <article class="footer-card">
            <span>Quick Actions</span>
            <strong>Space to pause, R to reset</strong>
          </article>
          <article class="footer-card">
            <span>Rule Set</span>
            <strong>Wall and body collisions decide the duel</strong>
          </article>
        </div>

        <section class="touch-panel" aria-label="Touch controls">
          <div class="touch-card">
            <span>Player 1 Touch</span>
            <div class="touch-grid" data-player="1">
              <button class="touch-button touch-up" data-player="1" data-direction="up" type="button" aria-label="Player 1 up">▲</button>
              <button class="touch-button touch-left" data-player="1" data-direction="left" type="button" aria-label="Player 1 left">◀</button>
              <button class="touch-button touch-right" data-player="1" data-direction="right" type="button" aria-label="Player 1 right">▶</button>
              <button class="touch-button touch-down" data-player="1" data-direction="down" type="button" aria-label="Player 1 down">▼</button>
            </div>
          </div>
          <div class="touch-card">
            <span>Player 2 Touch</span>
            <div class="touch-grid" data-player="2">
              <button class="touch-button touch-up" data-player="2" data-direction="up" type="button" aria-label="Player 2 up">▲</button>
              <button class="touch-button touch-left" data-player="2" data-direction="left" type="button" aria-label="Player 2 left">◀</button>
              <button class="touch-button touch-right" data-player="2" data-direction="right" type="button" aria-label="Player 2 right">▶</button>
              <button class="touch-button touch-down" data-player="2" data-direction="down" type="button" aria-label="Player 2 down">▼</button>
            </div>
          </div>
        </section>
      </section>

      <aside class="settings-panel">
        <h2 class="panel-title">Advanced Arena Settings</h2>
        <p class="panel-copy">
          Tune board size, speed, wrap rules, effects, and the entire visual atmosphere. Theme and background changes apply live.
        </p>

        <form class="settings-form" id="settingsForm">
          <section class="settings-group">
            <h3>Gameplay</h3>
            <p>Keep the original duel intact, but make the arena fit the session.</p>
            <div class="control-grid">
              <div class="control-row">
                <div class="range-label">
                  <label for="cellCount">Grid Size</label>
                  <span class="range-value" id="cellCountValue">25 x 25</span>
                </div>
                <input id="cellCount" name="cellCount" type="range" min="12" max="36" step="1" />
              </div>
              <div class="control-row">
                <div class="range-label">
                  <label for="speed">Game Speed</label>
                  <span class="range-value" id="speedValue">6 ticks/s</span>
                </div>
                <input id="speed" name="speed" type="range" min="4" max="16" step="1" />
              </div>
            </div>
          </section>

          <section class="settings-group">
            <h3>Theme and Board</h3>
            <p>Swap the whole visual identity, then change the board texture under it.</p>
            <div class="control-grid">
              <div class="control-row">
                <label for="theme">Theme</label>
                <select id="theme" name="theme"></select>
              </div>
              <div class="control-row">
                <label for="backdropStyle">Background Scene</label>
                <select id="backdropStyle" name="backdropStyle"></select>
              </div>
              <div class="control-row">
                <label for="gridStyle">Grid Background</label>
                <select id="gridStyle" name="gridStyle"></select>
              </div>
            </div>
          </section>

          <section class="settings-group">
            <h3>Enhancements</h3>
            <p>Add useful options without changing the default competitive rules.</p>
            <div class="toggle-list">
              <div class="toggle-row">
                <label for="wrapWalls">Wrap arena walls</label>
                <label class="switch">
                  <input id="wrapWalls" name="wrapWalls" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
              <div class="toggle-row">
                <label for="showTrails">Head glow trails</label>
                <label class="switch">
                  <input id="showTrails" name="showTrails" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
              <div class="toggle-row">
                <label for="foodPulse">Animated food pulse</label>
                <label class="switch">
                  <input id="foodPulse" name="foodPulse" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
              <div class="toggle-row">
                <label for="soundEnabled">Sound effects</label>
                <label class="switch">
                  <input id="soundEnabled" name="soundEnabled" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
              <div class="toggle-row">
                <label for="screenShake">Impact screen shake</label>
                <label class="switch">
                  <input id="screenShake" name="screenShake" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
          </section>

          <section class="settings-group">
            <h3>Utility</h3>
            <p>Apply structural changes, shuffle the look, or clear the running match score.</p>
            <div class="actions">
              <button class="button button-primary" id="applySettingsButton" type="button">Apply Arena Changes</button>
              <button class="button button-secondary" id="randomThemeButton" type="button">Randomize Look</button>
              <button class="button button-secondary" id="resetScoresButton" type="button">Reset Scores</button>
            </div>
            <p class="pending-note" id="pendingNote"></p>
            <p class="pending-note pending-note-muted" id="statusNote"></p>
            <p class="control-hint">
              Structural settings like board size and wrap mode restart the round. Speed and visual settings update immediately.
            </p>
          </section>

          <section class="settings-group">
            <h3>Network Rooms</h3>
            <p>Create a hosted room, share the code, and play against a second browser through API-synced state.</p>
            <div class="room-grid">
              <button class="button button-primary" id="createRoomButton" type="button">Create Room</button>
              <div class="room-join-row">
                <input class="text-input" id="roomCodeInput" type="text" maxlength="6" placeholder="ROOM CODE" />
                <button class="button button-secondary" id="joinRoomButton" type="button">Join</button>
              </div>
              <button class="button button-secondary" id="leaveRoomButton" type="button">Leave Room</button>
            </div>
            <div class="room-meta">
              <span id="roomStatus">No active room</span>
              <span id="roomRole">Role: local</span>
              <span id="roomBackend">Backend: browser-local</span>
            </div>
            <p class="control-hint">
              This repository implements server-relayed room sync. True direct peer-to-peer transport would require additional signaling infrastructure.
            </p>
          </section>

          <section class="settings-group">
            <h3>Text and API Play</h3>
            <p>Drive the game with text commands, inspect the ASCII board, and expose a machine-friendly state for external agents.</p>
            <div class="room-join-row">
              <input class="text-input" id="textCommandInput" type="text" placeholder="Examples: start, p1 up, p2 left, pause, reset" />
              <button class="button button-primary" id="sendCommandButton" type="button">Send</button>
            </div>
            <div class="actions">
              <button class="button button-secondary" id="refreshTextButton" type="button">Refresh Snapshot</button>
              <button class="button button-secondary" id="apiDocsButton" type="button">API Schema</button>
            </div>
            <pre class="terminal-board" id="textBoard"></pre>
            <pre class="api-log" id="apiLog"></pre>
          </section>
        </form>
      </aside>
    </section>
  </main>
`;

const elements = {
  p1Score: document.querySelector('#p1Score'),
  p2Score: document.querySelector('#p2Score'),
  drawScore: document.querySelector('#drawScore'),
  roundClock: document.querySelector('#roundClock'),
  arenaSummary: document.querySelector('#arenaSummary'),
  stateLabel: document.querySelector('#stateLabel'),
  themeLabel: document.querySelector('#themeLabel'),
  roundNumber: document.querySelector('#roundNumber'),
  streakLabel: document.querySelector('#streakLabel'),
  fullscreenButton: document.querySelector('#fullscreenButton'),
  togglePlayButton: document.querySelector('#togglePlayButton'),
  restartButton: document.querySelector('#restartButton'),
  canvas: document.querySelector('#gameCanvas'),
  canvasShell: document.querySelector('#canvasShell'),
  canvasOverlay: document.querySelector('#canvasOverlay'),
  form: document.querySelector('#settingsForm'),
  cellCount: document.querySelector('#cellCount'),
  cellCountValue: document.querySelector('#cellCountValue'),
  speed: document.querySelector('#speed'),
  speedValue: document.querySelector('#speedValue'),
  theme: document.querySelector('#theme'),
  backdropStyle: document.querySelector('#backdropStyle'),
  gridStyle: document.querySelector('#gridStyle'),
  wrapWalls: document.querySelector('#wrapWalls'),
  showTrails: document.querySelector('#showTrails'),
  foodPulse: document.querySelector('#foodPulse'),
  soundEnabled: document.querySelector('#soundEnabled'),
  screenShake: document.querySelector('#screenShake'),
  applySettingsButton: document.querySelector('#applySettingsButton'),
  randomThemeButton: document.querySelector('#randomThemeButton'),
  resetScoresButton: document.querySelector('#resetScoresButton'),
  pendingNote: document.querySelector('#pendingNote'),
  statusNote: document.querySelector('#statusNote'),
  touchButtons: document.querySelectorAll('.touch-button'),
  createRoomButton: document.querySelector('#createRoomButton'),
  roomCodeInput: document.querySelector('#roomCodeInput'),
  joinRoomButton: document.querySelector('#joinRoomButton'),
  leaveRoomButton: document.querySelector('#leaveRoomButton'),
  roomStatus: document.querySelector('#roomStatus'),
  roomRole: document.querySelector('#roomRole'),
  roomBackend: document.querySelector('#roomBackend'),
  textCommandInput: document.querySelector('#textCommandInput'),
  sendCommandButton: document.querySelector('#sendCommandButton'),
  refreshTextButton: document.querySelector('#refreshTextButton'),
  apiDocsButton: document.querySelector('#apiDocsButton'),
  textBoard: document.querySelector('#textBoard'),
  apiLog: document.querySelector('#apiLog'),
};

const structuralKeys = new Set(['cellCount', 'wrapWalls']);
let pendingStructuralChange = false;
const roomSession = {
  active: false,
  roomCode: '',
  token: '',
  role: 'local',
  backend: 'browser-local',
  pollTimer: 0,
  lastSnapshot: null,
};

function loadSettings() {
  const parsed = readStoredJson(SETTINGS_KEY, {});
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...parsed });
}

function loadScore() {
  const parsed = readStoredJson(SCORE_KEY, {});
  return {
    player1: Number.isFinite(parsed.player1) ? parsed.player1 : 0,
    player2: Number.isFinite(parsed.player2) ? parsed.player2 : 0,
    draws: Number.isFinite(parsed.draws) ? parsed.draws : 0,
    streakOwner: typeof parsed.streakOwner === 'string' ? parsed.streakOwner : null,
    streakCount: Number.isFinite(parsed.streakCount) ? parsed.streakCount : 0,
    longestRoundMs: Number.isFinite(parsed.longestRoundMs) ? parsed.longestRoundMs : 0,
  };
}

function sanitizeSettings(raw) {
  const theme = THEMES[raw.theme] ? raw.theme : DEFAULT_SETTINGS.theme;
  const backdropStyle = BACKDROP_STYLES.some((item) => item.value === raw.backdropStyle)
    ? raw.backdropStyle
    : DEFAULT_SETTINGS.backdropStyle;
  const gridStyle = GRID_STYLES.some((item) => item.value === raw.gridStyle) ? raw.gridStyle : DEFAULT_SETTINGS.gridStyle;

  return {
    cellCount: clamp(Number.parseInt(raw.cellCount, 10) || DEFAULT_SETTINGS.cellCount, 12, 36),
    speed: clamp(Number.parseInt(raw.speed, 10) || DEFAULT_SETTINGS.speed, 4, 16),
    theme,
    backdropStyle,
    gridStyle,
    wrapWalls: Boolean(raw.wrapWalls),
    showTrails: raw.showTrails !== false,
    soundEnabled: raw.soundEnabled !== false,
    screenShake: raw.screenShake !== false,
    foodPulse: raw.foodPulse !== false,
  };
}

function saveSettings(settings) {
  writeStoredJson(SETTINGS_KEY, settings);
}

function saveScore(score) {
  writeStoredJson(SCORE_KEY, score);
}

function readStoredJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function setThemeCss(themeKey) {
  const theme = THEMES[themeKey];
  const root = document.documentElement;
  root.style.setProperty('--bg-1', theme.page[0]);
  root.style.setProperty('--bg-2', theme.page[1]);
  root.style.setProperty('--bg-3', theme.page[2]);
  root.style.setProperty('--card', theme.card);
  root.style.setProperty('--card-border', theme.cardBorder);
  root.style.setProperty('--text', theme.text);
  root.style.setProperty('--muted', theme.muted);
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--control-fill', theme.controlFill);
  elements.themeLabel.textContent = theme.label;
}

function fillSelect(select, options) {
  select.innerHTML = options.map((option) => `<option value="${option.value}">${option.label}</option>`).join('');
}

function fillThemeSelect(select) {
  select.innerHTML = Object.entries(THEMES)
    .map(([value, theme]) => `<option value="${value}">${theme.label}</option>`)
    .join('');
}

class AudioEngine {
  constructor() {
    this.context = null;
    this.enabled = true;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  ensureContext() {
    if (!this.enabled) {
      return null;
    }
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        return null;
      }
      this.context = new AudioContext();
    }
    if (this.context.state === 'suspended') {
      this.context.resume().catch(() => {});
    }
    return this.context;
  }

  beep({ frequency, endFrequency = frequency, duration = 0.1, type = 'sine', gain = 0.04 }) {
    const context = this.ensureContext();
    if (!context) {
      return;
    }
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const start = context.currentTime;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(endFrequency, 1), start + duration);

    gainNode.gain.setValueAtTime(gain, start);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  playEat() {
    this.beep({ frequency: 520, endFrequency: 740, duration: 0.08, type: 'triangle', gain: 0.03 });
  }

  playCrash() {
    this.beep({ frequency: 180, endFrequency: 70, duration: 0.22, type: 'sawtooth', gain: 0.05 });
  }

  playStart() {
    this.beep({ frequency: 300, endFrequency: 480, duration: 0.12, type: 'square', gain: 0.025 });
  }
}

class DuelSnakesGame {
  constructor(canvas, ui, audio) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) {
      throw new Error('Canvas 2D context is unavailable in this browser.');
    }
    this.ui = ui;
    this.audio = audio;
    this.settings = loadSettings();
    this.tickMs = 1000 / this.settings.speed;
    this.state = 'stopped';
    this.elapsedMs = 0;
    this.roundCount = 0;
    this.score = loadScore();
    this.accumulator = 0;
    this.lastFrameTime = 0;
    this.layout = { width: 0, height: 0, padding: 18, boardSize: 0, cellSize: 0 };
    this.previousHeads = null;
    this.remoteMode = false;

    this.resetRound();
    this.resizeCanvas();

    window.addEventListener('resize', () => this.resizeCanvas());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'running') {
        this.pause();
      }
    });

    requestAnimationFrame((time) => this.frame(time));
  }

  resetRound({ preserveWinner = false } = {}) {
    const size = this.settings.cellCount;
    this.snake1 = this.createSnake(
      [
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
      ],
      { x: 1, y: 0 },
      'player1',
    );
    this.snake2 = this.createSnake(
      [
        { x: size - 3, y: size - 3 },
        { x: size - 2, y: size - 3 },
        { x: size - 1, y: size - 3 },
      ],
      { x: -1, y: 0 },
      'player2',
    );
    this.food = this.randomOpenCell();
    this.elapsedMs = 0;
    this.accumulator = 0;
    this.lastFrameTime = 0;
    this.previousHeads = null;
    this.winner = preserveWinner ? this.winner : null;
    this.state = 'stopped';
    this.renderOverlay();
    this.updateUi();
  }

  createSnake(body, direction, id) {
    return {
      id,
      body,
      direction: { ...direction },
      queuedDirection: { ...direction },
      grow: false,
      trail: [],
    };
  }

  randomOpenCell() {
    const occupied = new Set([...this.snake1.body, ...this.snake2.body].map((cell) => `${cell.x}:${cell.y}`));
    let candidate = null;
    do {
      candidate = {
        x: Math.floor(Math.random() * this.settings.cellCount),
        y: Math.floor(Math.random() * this.settings.cellCount),
      };
    } while (occupied.has(`${candidate.x}:${candidate.y}`));
    return candidate;
  }

  setDirection(player, direction) {
    if (this.winner) {
      this.winner = null;
      this.resetRound();
    }

    const snake = player === 1 ? this.snake1 : this.snake2;
    if (
      direction.x === -snake.direction.x &&
      direction.y === -snake.direction.y
    ) {
      return;
    }
    snake.queuedDirection = direction;
    if (this.state === 'stopped' && !this.winner) {
      this.start();
    }
  }

  start() {
    if (this.state === 'running') {
      return;
    }
    if (this.winner) {
      this.winner = null;
      this.resetRound();
    }
    this.state = 'running';
    this.audio.playStart();
    this.renderOverlay();
    this.updateUi();
  }

  pause() {
    if (this.state !== 'running') {
      return;
    }
    this.state = 'paused';
    this.renderOverlay();
    this.updateUi();
  }

  togglePlay() {
    if (this.state === 'running') {
      this.pause();
      return;
    }
    this.start();
  }

  applySettings(nextSettings, { restart = false, updateVisualsOnly = false } = {}) {
    this.settings = sanitizeSettings(nextSettings);
    this.tickMs = 1000 / this.settings.speed;
    this.audio.setEnabled(this.settings.soundEnabled);
    setThemeCss(this.settings.theme);
    if (restart || updateVisualsOnly) {
      this.resizeCanvas();
    }
    if (restart) {
      this.winner = null;
      this.resetRound();
    }
    this.renderOverlay();
    this.updateUi();
  }

  completeRound(winner) {
    this.winner = winner;
    this.roundCount += 1;
    this.score.longestRoundMs = Math.max(this.score.longestRoundMs, this.elapsedMs);
    if (winner === 'Player 1') {
      this.score.player1 += 1;
      if (this.score.streakOwner === 'Player 1') {
        this.score.streakCount += 1;
      } else {
        this.score.streakOwner = 'Player 1';
        this.score.streakCount = 1;
      }
    } else if (winner === 'Player 2') {
      this.score.player2 += 1;
      if (this.score.streakOwner === 'Player 2') {
        this.score.streakCount += 1;
      } else {
        this.score.streakOwner = 'Player 2';
        this.score.streakCount = 1;
      }
    } else {
      this.score.draws += 1;
      this.score.streakOwner = null;
      this.score.streakCount = 0;
    }
    saveScore(this.score);
    this.state = 'gameover';
    if (this.settings.screenShake) {
      this.ui.shake();
    }
    this.audio.playCrash();
    this.renderOverlay();
    this.updateUi();
  }

  step() {
    this.previousHeads = {
      snake1: { ...this.snake1.body[0] },
      snake2: { ...this.snake2.body[0] },
    };

    const nextSnake1 = this.advanceSnake(this.snake1);
    const nextSnake2 = this.advanceSnake(this.snake2);

    this.snake1 = nextSnake1;
    this.snake2 = nextSnake2;

    this.handleFood();

    const winner = this.findWinner();
    if (winner) {
      this.completeRound(winner);
    }
  }

  advanceSnake(snake) {
    const head = snake.body[0];
    const direction = snake.queuedDirection;
    let nextHead = {
      x: head.x + direction.x,
      y: head.y + direction.y,
    };

    if (this.settings.wrapWalls) {
      nextHead = {
        x: (nextHead.x + this.settings.cellCount) % this.settings.cellCount,
        y: (nextHead.y + this.settings.cellCount) % this.settings.cellCount,
      };
    }

    const willEat = sameCell(nextHead, this.food);
    const nextBody = [nextHead, ...snake.body];
    if (!(snake.grow || willEat)) {
      nextBody.pop();
    }

    const trail = [head, ...snake.trail].slice(0, 10);

    return {
      ...snake,
      body: nextBody,
      direction: { ...direction },
      queuedDirection: { ...direction },
      grow: false,
      trail,
    };
  }

  handleFood() {
    const ate = sameCell(this.snake1.body[0], this.food) || sameCell(this.snake2.body[0], this.food);
    if (ate) {
      this.food = this.randomOpenCell();
      this.audio.playEat();
    }
  }

  findWinner() {
    const out1 = !this.settings.wrapWalls && isOutOfBounds(this.snake1.body[0], this.settings.cellCount);
    const out2 = !this.settings.wrapWalls && isOutOfBounds(this.snake2.body[0], this.settings.cellCount);

    if (out1 && out2) {
      return 'Draw';
    }
    if (out1) {
      return 'Player 2';
    }
    if (out2) {
      return 'Player 1';
    }

    const snake1NoHead = this.snake1.body.slice(1);
    const snake2NoHead = this.snake2.body.slice(1);
    const snake1Hits = containsCell(snake1NoHead, this.snake1.body[0]) || containsCell(snake2NoHead, this.snake1.body[0]);
    const snake2Hits = containsCell(snake2NoHead, this.snake2.body[0]) || containsCell(snake1NoHead, this.snake2.body[0]);
    const headOn = sameCell(this.snake1.body[0], this.snake2.body[0]);
    const headSwap =
      this.previousHeads &&
      sameCell(this.snake1.body[0], this.previousHeads.snake2) &&
      sameCell(this.snake2.body[0], this.previousHeads.snake1);

    if (headOn || headSwap || (snake1Hits && snake2Hits)) {
      return 'Draw';
    }
    if (snake1Hits) {
      return 'Player 2';
    }
    if (snake2Hits) {
      return 'Player 1';
    }

    return null;
  }

  resizeCanvas() {
    const size = Math.floor(this.canvas.clientWidth || this.canvas.parentElement.clientWidth || 720);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.layout.width = size;
    this.layout.height = size;
    this.layout.padding = clamp(size * 0.03, 18, 24);
    this.layout.boardSize = size - this.layout.padding * 2;
    this.layout.cellSize = this.layout.boardSize / this.settings.cellCount;
  }

  frame(timestamp) {
    if (!this.lastFrameTime) {
      this.lastFrameTime = timestamp;
    }
    const delta = Math.min(timestamp - this.lastFrameTime, MAX_FRAME_DELTA);
    this.lastFrameTime = timestamp;

    if (!this.remoteMode && this.state === 'running') {
      this.elapsedMs += delta;
      this.accumulator += delta;
      while (this.accumulator >= this.tickMs) {
        this.step();
        this.accumulator -= this.tickMs;
        if (this.state !== 'running') {
          this.accumulator = 0;
          break;
        }
      }
    }

    this.draw(timestamp);
    this.updateUi();

    requestAnimationFrame((time) => this.frame(time));
  }

  getSnapshot() {
    return {
      settings: sanitizeSettings(this.settings),
      state: this.state,
      winner: this.winner,
      roundCount: this.roundCount,
      elapsedMs: this.elapsedMs,
      score: JSON.parse(JSON.stringify(this.score)),
      snake1: JSON.parse(JSON.stringify(this.snake1)),
      snake2: JSON.parse(JSON.stringify(this.snake2)),
      food: JSON.parse(JSON.stringify(this.food)),
    };
  }

  applyRemoteSnapshot(snapshot) {
    this.remoteMode = true;
    this.settings = sanitizeSettings(snapshot.settings ?? this.settings);
    this.tickMs = 1000 / this.settings.speed;
    this.state = snapshot.state ?? this.state;
    this.winner = snapshot.winner ?? null;
    this.roundCount = Number.isFinite(snapshot.roundCount) ? snapshot.roundCount : this.roundCount;
    this.elapsedMs = Number.isFinite(snapshot.elapsedMs) ? snapshot.elapsedMs : this.elapsedMs;
    this.score = JSON.parse(JSON.stringify(snapshot.score ?? this.score));
    this.snake1 = JSON.parse(JSON.stringify(snapshot.snake1 ?? this.snake1));
    this.snake2 = JSON.parse(JSON.stringify(snapshot.snake2 ?? this.snake2));
    this.food = JSON.parse(JSON.stringify(snapshot.food ?? this.food));
    this.resizeCanvas();
    this.renderOverlay();
    this.updateUi();
  }

  disableRemoteMode() {
    this.remoteMode = false;
  }

  advanceSimulation(deltaMs) {
    const previousState = this.state;
    if (this.state !== 'running') {
      this.state = 'running';
    }

    let remaining = Math.max(Number(deltaMs) || 0, 0);
    while (remaining > 0 && this.state === 'running') {
      const slice = Math.min(remaining, this.tickMs);
      this.elapsedMs += slice;
      this.accumulator += slice;
      while (this.accumulator >= this.tickMs) {
        this.step();
        this.accumulator -= this.tickMs;
        if (this.state !== 'running') {
          this.accumulator = 0;
          break;
        }
      }
      remaining -= slice;
    }

    if (previousState !== 'running' && this.state === 'running') {
      this.state = 'paused';
    }

    this.renderOverlay();
    this.updateUi();
  }

  updateUi() {
    elements.p1Score.textContent = String(this.score.player1);
    elements.p2Score.textContent = String(this.score.player2);
    elements.drawScore.textContent = String(this.score.draws);
    elements.roundClock.textContent = formatTime(this.elapsedMs);
    elements.roundNumber.textContent = String(this.roundCount);
    elements.stateLabel.textContent = formatState(this.state, this.winner);
    elements.streakLabel.textContent = this.score.streakOwner ? `${this.score.streakOwner} x${this.score.streakCount}` : 'None';
    elements.togglePlayButton.textContent = this.state === 'running' ? 'Pause Round' : this.winner ? 'Play Again' : 'Start Round';
    elements.arenaSummary.textContent = `${this.settings.cellCount}x${this.settings.cellCount} arena at ${this.settings.speed} tps • longest ${formatTime(this.score.longestRoundMs)}`;
  }

  renderOverlay() {
    let title = '';
    let copy = '';

    if (this.winner) {
      title = this.winner === 'Draw' ? 'Dead Heat' : `${this.winner} Wins`;
      copy = 'Press start, use a movement key, or hit R to reset the board for the next round.';
    } else if (this.state === 'paused') {
      title = 'Paused';
      copy = 'Tap Space or the start button to continue. Round time is frozen while paused.';
    } else if (this.state === 'stopped') {
      title = 'Ready to Launch';
      copy = 'First movement input starts the duel. Player 1 uses WASD. Player 2 uses the arrow keys.';
    }

    if (!title) {
      elements.canvasOverlay.innerHTML = '';
      return;
    }

    elements.canvasOverlay.innerHTML = `
      <div class="overlay-card">
        <strong>${title}</strong>
        <span>${copy}</span>
      </div>
    `;
  }

  draw(timestamp) {
    const { ctx } = this;
    const { width, height, padding, boardSize, cellSize } = this.layout;
    const theme = THEMES[this.settings.theme];

    ctx.clearRect(0, 0, width, height);
    this.drawBackdrop(ctx, width, height, theme, timestamp);

    const boardRadius = 28;
    roundRect(ctx, padding, padding, boardSize, boardSize, boardRadius);
    ctx.fillStyle = theme.boardFill;
    ctx.shadowColor = theme.boardGlow;
    ctx.shadowBlur = 32;
    ctx.fill();
    ctx.shadowBlur = 0;

    this.drawGrid(ctx, padding, padding, boardSize, cellSize, theme, timestamp);

    ctx.strokeStyle = theme.boardEdge;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    roundRect(ctx, padding, padding, boardSize, boardSize, boardRadius);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (this.settings.showTrails) {
      this.drawTrail(this.snake1, theme.trail1, cellSize, timestamp);
      this.drawTrail(this.snake2, theme.trail2, cellSize, timestamp);
    }

    this.drawFood(cellSize, timestamp, theme);
    this.drawSnake(this.snake1, theme.snake1, theme.snake1Glow, cellSize, theme);
    this.drawSnake(this.snake2, theme.snake2, theme.snake2Glow, cellSize, theme);
  }

  drawBackdrop(ctx, width, height, theme, timestamp) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `${theme.page[0]}f2`);
    gradient.addColorStop(0.5, `${theme.page[1]}e8`);
    gradient.addColorStop(1, `${theme.page[2]}f4`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const time = timestamp * 0.0003;
    ctx.save();
    ctx.globalAlpha = 0.22;

    switch (this.settings.backdropStyle) {
      case 'aurora': {
        for (let index = 0; index < 4; index += 1) {
          const x = width * (0.18 + index * 0.22);
          const y = height * (0.24 + Math.sin(time + index) * 0.1);
          const radius = width * (0.13 + index * 0.02);
          const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
          glow.addColorStop(0, index % 2 === 0 ? theme.snake1 : theme.snake2);
          glow.addColorStop(1, 'transparent');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'rings': {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 1.5;
        for (let index = 1; index <= 8; index += 1) {
          ctx.globalAlpha = 0.06 + index * 0.015;
          ctx.beginPath();
          ctx.arc(width * 0.5, height * 0.5, width * (0.08 + index * 0.07 + Math.sin(time + index) * 0.01), 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'terrain': {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 1;
        for (let index = 0; index < 13; index += 1) {
          ctx.globalAlpha = 0.05 + index * 0.008;
          ctx.beginPath();
          for (let x = -30; x <= width + 30; x += 14) {
            const y = height * (index / 13) + Math.sin(x * 0.016 + time * 4 + index) * 8;
            if (x === -30) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        }
        break;
      }
      case 'stars': {
        ctx.fillStyle = theme.text;
        for (let index = 0; index < 60; index += 1) {
          const x = (index * 61) % width;
          const y = (index * 37) % height;
          const radius = ((index % 3) + 1) * 0.9;
          ctx.globalAlpha = 0.06 + ((Math.sin(time * 10 + index) + 1) * 0.06);
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      default:
        break;
    }

    ctx.restore();
  }

  drawGrid(ctx, originX, originY, boardSize, cellSize, theme, timestamp) {
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, originX, originY, boardSize, boardSize, 28);
    ctx.clip();

    switch (this.settings.gridStyle) {
      case 'classic': {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        for (let index = 1; index < this.settings.cellCount; index += 1) {
          const offset = originX + index * cellSize;
          ctx.beginPath();
          ctx.moveTo(offset, originY);
          ctx.lineTo(offset, originY + boardSize);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(originX, originY + index * cellSize);
          ctx.lineTo(originX + boardSize, originY + index * cellSize);
          ctx.stroke();
        }
        break;
      }
      case 'dots': {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
        const pulse = (Math.sin(timestamp * 0.003) + 1) * 0.08;
        for (let y = 0; y < this.settings.cellCount; y += 1) {
          for (let x = 0; x < this.settings.cellCount; x += 1) {
            ctx.globalAlpha = 0.18 + ((x + y) % 3) * 0.05 + pulse;
            ctx.beginPath();
            ctx.arc(originX + x * cellSize + cellSize / 2, originY + y * cellSize + cellSize / 2, Math.max(cellSize * 0.045, 1.3), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'diagonal': {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let index = -boardSize; index <= boardSize * 2; index += cellSize * 1.5) {
          ctx.beginPath();
          ctx.moveTo(originX + index, originY);
          ctx.lineTo(originX + index - boardSize, originY + boardSize);
          ctx.stroke();
        }
        break;
      }
      case 'checker': {
        for (let y = 0; y < this.settings.cellCount; y += 1) {
          for (let x = 0; x < this.settings.cellCount; x += 1) {
            if ((x + y) % 2 === 0) {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
              ctx.fillRect(originX + x * cellSize, originY + y * cellSize, cellSize, cellSize);
            }
          }
        }
        break;
      }
      default:
        break;
    }

    ctx.restore();
  }

  drawTrail(snake, fill, cellSize, timestamp) {
    const { ctx } = this;
    const pulse = (Math.sin(timestamp * 0.005) + 1) * 0.5;
    snake.trail.forEach((segment, index) => {
      const alpha = (1 - index / snake.trail.length) * (0.28 + pulse * 0.06);
      const { x, y } = this.toPixel(segment, cellSize);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize * (0.46 - index * 0.022), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  drawFood(cellSize, timestamp, theme) {
    const { ctx } = this;
    const { x, y } = this.toPixel(this.food, cellSize);
    const centerX = x + cellSize / 2;
    const centerY = y + cellSize / 2;
    const pulse = this.settings.foodPulse ? 1 + Math.sin(timestamp * 0.006) * 0.08 : 1;
    const radius = cellSize * 0.28 * pulse;

    ctx.save();
    ctx.shadowColor = theme.foodGlow;
    ctx.shadowBlur = cellSize * 0.7;
    ctx.fillStyle = theme.food;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.beginPath();
    ctx.arc(centerX - radius * 0.35, centerY - radius * 0.3, radius * 0.32, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = Math.max(cellSize * 0.05, 1.5);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radius);
    ctx.quadraticCurveTo(centerX + radius * 0.5, centerY - radius * 1.35, centerX + radius * 0.26, centerY - radius * 1.82);
    ctx.stroke();
    ctx.restore();
  }

  drawSnake(snake, fill, glow, cellSize, theme) {
    const { ctx } = this;
    snake.body.forEach((segment, index) => {
      const { x, y } = this.toPixel(segment, cellSize);
      const inset = index === 0 ? cellSize * 0.08 : cellSize * 0.12;
      const width = cellSize - inset * 2;
      const radius = index === 0 ? width * 0.44 : width * 0.34;

      ctx.save();
      if (index === 0) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = cellSize * 0.58;
      }
      roundRect(ctx, x + inset, y + inset, width, width, radius);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.shadowBlur = 0;

      const highlight = ctx.createLinearGradient(x, y, x + cellSize, y + cellSize);
      highlight.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
      highlight.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
      ctx.fillStyle = highlight;
      roundRect(ctx, x + inset, y + inset, width, width, radius);
      ctx.fill();

      if (index === 0) {
        this.drawEyes(x, y, cellSize, snake.direction, theme);
      }
      ctx.restore();
    });
  }

  drawEyes(x, y, cellSize, direction, theme) {
    const { ctx } = this;
    const centerX = x + cellSize / 2;
    const centerY = y + cellSize / 2;
    const eyeRadius = cellSize * 0.11;
    const pupilRadius = eyeRadius * 0.52;

    const offsets = eyeOffsets(direction, cellSize);

    offsets.forEach(({ x: eyeX, y: eyeY, px, py }) => {
      ctx.fillStyle = theme.eye;
      ctx.beginPath();
      ctx.arc(centerX + eyeX, centerY + eyeY, eyeRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = theme.pupil;
      ctx.beginPath();
      ctx.arc(centerX + eyeX + px, centerY + eyeY + py, pupilRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  toPixel(cell, cellSize) {
    return {
      x: this.layout.padding + cell.x * cellSize,
      y: this.layout.padding + cell.y * cellSize,
    };
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

function containsCell(cells, target) {
  return cells.some((cell) => sameCell(cell, target));
}

function isOutOfBounds(cell, cellCount) {
  return cell.x < 0 || cell.y < 0 || cell.x >= cellCount || cell.y >= cellCount;
}

function formatState(state, winner) {
  if (winner) {
    return winner === 'Draw' ? 'Draw' : `${winner} won`;
  }
  switch (state) {
    case 'running':
      return 'Running';
    case 'paused':
      return 'Paused';
    default:
      return 'Stopped';
  }
}

function eyeOffsets(direction, cellSize) {
  if (direction.x === 1) {
    return [
      { x: cellSize * 0.12, y: -cellSize * 0.14, px: cellSize * 0.04, py: 0 },
      { x: cellSize * 0.12, y: cellSize * 0.14, px: cellSize * 0.04, py: 0 },
    ];
  }
  if (direction.x === -1) {
    return [
      { x: -cellSize * 0.12, y: -cellSize * 0.14, px: -cellSize * 0.04, py: 0 },
      { x: -cellSize * 0.12, y: cellSize * 0.14, px: -cellSize * 0.04, py: 0 },
    ];
  }
  if (direction.y === 1) {
    return [
      { x: -cellSize * 0.14, y: cellSize * 0.12, px: 0, py: cellSize * 0.04 },
      { x: cellSize * 0.14, y: cellSize * 0.12, px: 0, py: cellSize * 0.04 },
    ];
  }
  return [
    { x: -cellSize * 0.14, y: -cellSize * 0.12, px: 0, py: -cellSize * 0.04 },
    { x: cellSize * 0.14, y: -cellSize * 0.12, px: 0, py: -cellSize * 0.04 },
  ];
}

function updateForm(settings) {
  elements.cellCount.value = String(settings.cellCount);
  elements.speed.value = String(settings.speed);
  elements.theme.value = settings.theme;
  elements.backdropStyle.value = settings.backdropStyle;
  elements.gridStyle.value = settings.gridStyle;
  elements.wrapWalls.checked = settings.wrapWalls;
  elements.showTrails.checked = settings.showTrails;
  elements.foodPulse.checked = settings.foodPulse;
  elements.soundEnabled.checked = settings.soundEnabled;
  elements.screenShake.checked = settings.screenShake;
  elements.cellCountValue.textContent = `${settings.cellCount} x ${settings.cellCount}`;
  elements.speedValue.textContent = `${settings.speed} ticks/s`;
}

function setStatus(message) {
  elements.statusNote.textContent = message;
}

function setApiLog(message) {
  elements.apiLog.textContent = message;
}

function clearStatusAfterDelay(delay = 2200) {
  window.clearTimeout(clearStatusAfterDelay.timeoutId);
  clearStatusAfterDelay.timeoutId = window.setTimeout(() => {
    setStatus('');
  }, delay);
}

function directionFromName(name) {
  return DIRECTION_VECTORS[name] ?? DIRECTION_VECTORS.right;
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      elements.fullscreenButton.textContent = 'Fullscreen';
      setStatus('Exited fullscreen mode.');
      clearStatusAfterDelay();
      return;
    }
    await document.documentElement.requestFullscreen();
    elements.fullscreenButton.textContent = 'Exit Fullscreen';
    setStatus('Fullscreen enabled.');
    clearStatusAfterDelay();
  } catch {
    setStatus('Fullscreen is not available in this browser context.');
  }
}

fillThemeSelect(elements.theme);
fillSelect(elements.backdropStyle, BACKDROP_STYLES);
fillSelect(elements.gridStyle, GRID_STYLES);

let settings = loadSettings();
setThemeCss(settings.theme);
updateForm(settings);

const audio = new AudioEngine();
audio.setEnabled(settings.soundEnabled);

const game = new DuelSnakesGame(elements.canvas, {
  shake() {
    elements.canvasShell.classList.remove('shake');
    void elements.canvasShell.offsetWidth;
    elements.canvasShell.classList.add('shake');
  },
}, audio);

game.applySettings(settings, { restart: true });

function markStructuralChange() {
  pendingStructuralChange = true;
  elements.pendingNote.textContent = 'Arena size or wrap rules changed. Apply arena changes to restart with the new layout.';
}

function clearStructuralChangeNote() {
  pendingStructuralChange = false;
  elements.pendingNote.textContent = '';
}

function setSetting(key, value) {
  settings = sanitizeSettings({ ...settings, [key]: value });
  saveSettings(settings);
  updateForm(settings);
  setStatus('Settings saved locally.');
  clearStatusAfterDelay(1200);
}

function getLiveSettings() {
  if (!pendingStructuralChange) {
    return settings;
  }

  return sanitizeSettings({
    ...settings,
    cellCount: game.settings.cellCount,
    wrapWalls: game.settings.wrapWalls,
  });
}

function applyVisuals() {
  setThemeCss(settings.theme);
  game.applySettings(getLiveSettings(), { updateVisualsOnly: true });
}

function renderTextBoard(boardText) {
  elements.textBoard.textContent = boardText;
}

function updateLocalTextBoard() {
  renderTextBoard(renderAsciiBoard(game.getSnapshot()));
}

function updateRoomMeta() {
  elements.roomStatus.textContent = roomSession.active ? `Room ${roomSession.roomCode}` : 'No active room';
  elements.roomRole.textContent = `Role: ${roomSession.role}`;
  elements.roomBackend.textContent = `Backend: ${roomSession.backend}`;
}

function stopRoomPolling() {
  if (roomSession.pollTimer) {
    window.clearInterval(roomSession.pollTimer);
    roomSession.pollTimer = 0;
  }
}

function applyRoomSnapshot(room) {
  roomSession.lastSnapshot = room;
  roomSession.active = true;
  roomSession.roomCode = room.roomCode;
  roomSession.backend = room.backend;
  game.applyRemoteSnapshot(room.match);
  renderTextBoard(room.match.boardText);
  updateRoomMeta();
}

async function syncRoomFromApi() {
  if (!roomSession.active) {
    return;
  }

  try {
    const payload = await fetchRoomState(roomSession.roomCode);
    applyRoomSnapshot(payload.room);
  } catch (error) {
    setStatus(error instanceof Error ? `Room sync failed: ${error.message}` : 'Room sync failed.');
  }
}

function startRoomPolling() {
  stopRoomPolling();
  roomSession.pollTimer = window.setInterval(() => {
    syncRoomFromApi();
  }, 350);
}

function leaveRoomSession() {
  stopRoomPolling();
  roomSession.active = false;
  roomSession.roomCode = '';
  roomSession.token = '';
  roomSession.role = 'local';
  roomSession.backend = 'browser-local';
  roomSession.lastSnapshot = null;
  game.disableRemoteMode();
  game.resetRound();
  updateRoomMeta();
  updateLocalTextBoard();
}

async function sendRoomAction(action) {
  if (!roomSession.active) {
    return;
  }

  const payload = await sendRoomCommand({
    roomCode: roomSession.roomCode,
    token: roomSession.token,
    action,
  });
  applyRoomSnapshot(payload.room);
}

async function executeTextCommand() {
  const commandText = elements.textCommandInput.value.trim();
  if (!commandText) {
    return;
  }

  elements.textCommandInput.value = '';
  if (roomSession.active) {
    try {
      const payload = await sendRoomCommand({
        roomCode: roomSession.roomCode,
        token: roomSession.token,
        commandText,
      });
      applyRoomSnapshot(payload.room);
      setApiLog(`room> ${commandText}`);
      return;
    } catch (error) {
      setApiLog(error instanceof Error ? error.message : 'Room command failed.');
      return;
    }
  }

  const parsed = parseTextCommand(commandText);
  if (parsed.help) {
    try {
      const schema = await fetchApiSchema();
      setApiLog(schema.commands.join('\n'));
    } catch (error) {
      setApiLog(error instanceof Error ? error.message : 'Unable to load API schema.');
    }
    return;
  }

  if (parsed.error) {
    setApiLog(parsed.error);
    return;
  }

  for (const action of parsed.actions) {
    switch (action.type) {
      case 'start':
        game.start();
        break;
      case 'pause':
        game.pause();
        break;
      case 'toggle':
        game.togglePlay();
        break;
      case 'reset':
        game.winner = null;
        game.resetRound();
        break;
      case 'direction':
        game.setDirection(action.player === 'player2' ? 2 : 1, directionFromName(action.direction));
        break;
      case 'advance':
        game.advanceSimulation(action.deltaMs);
        break;
      default:
        break;
    }
  }

  updateLocalTextBoard();
  setApiLog(`local> ${commandText}`);
}

async function handleDirectionalInput(player, directionName) {
  if (roomSession.active) {
    try {
      await sendRoomAction({ type: 'direction', direction: directionName, player: player === 2 ? 'player2' : 'player1' });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to send room move.');
    }
    return;
  }

  game.setDirection(player, directionFromName(directionName));
  updateLocalTextBoard();
}

async function handleTogglePlay() {
  if (roomSession.active) {
    try {
      await sendRoomAction({ type: game.state === 'running' ? 'pause' : 'start' });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to toggle room play state.');
    }
    return;
  }

  game.togglePlay();
  updateLocalTextBoard();
}

async function handleResetRound() {
  if (roomSession.active) {
    try {
      await sendRoomAction({ type: 'reset' });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to reset room round.');
    }
    return;
  }

  game.winner = null;
  game.resetRound();
  updateLocalTextBoard();
}

elements.form.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
    return;
  }

  const key = target.name;
  const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value;
  setSetting(key, value);

  if (key === 'speed') {
    game.applySettings(getLiveSettings(), { updateVisualsOnly: true });
  }

  if (key === 'theme' || key === 'gridStyle' || key === 'backdropStyle' || key === 'showTrails' || key === 'foodPulse' || key === 'soundEnabled' || key === 'screenShake') {
    applyVisuals();
  }

  if (structuralKeys.has(key)) {
    markStructuralChange();
  }
});

elements.applySettingsButton.addEventListener('click', () => {
  game.applySettings(settings, { restart: true });
  clearStructuralChangeNote();
  setStatus('Arena changes applied and round reset.');
  clearStatusAfterDelay();
});

elements.randomThemeButton.addEventListener('click', () => {
  const themeKeys = Object.keys(THEMES);
  const nextTheme = themeKeys[Math.floor(Math.random() * themeKeys.length)];
  const nextBackdrop = BACKDROP_STYLES[Math.floor(Math.random() * BACKDROP_STYLES.length)].value;
  const nextGrid = GRID_STYLES[Math.floor(Math.random() * GRID_STYLES.length)].value;
  settings = sanitizeSettings({
    ...settings,
    theme: nextTheme,
    backdropStyle: nextBackdrop,
    gridStyle: nextGrid,
  });
  saveSettings(settings);
  updateForm(settings);
  applyVisuals();
  setStatus('Randomized theme, background, and grid style.');
  clearStatusAfterDelay();
});

elements.resetScoresButton.addEventListener('click', () => {
  game.score = { player1: 0, player2: 0, draws: 0, streakOwner: null, streakCount: 0, longestRoundMs: 0 };
  game.roundCount = 0;
  saveScore(game.score);
  game.updateUi();
  setStatus('Match score and streak stats reset.');
  clearStatusAfterDelay();
});

elements.fullscreenButton.addEventListener('click', () => {
  toggleFullscreen();
});

elements.togglePlayButton.addEventListener('click', () => {
  handleTogglePlay();
});

elements.restartButton.addEventListener('click', () => {
  handleResetRound();
  setStatus('Round reset.');
  clearStatusAfterDelay(1200);
});

elements.createRoomButton.addEventListener('click', async () => {
  try {
    const payload = await createRoom(settings);
    roomSession.token = payload.token;
    roomSession.role = payload.role;
    applyRoomSnapshot(payload.room);
    startRoomPolling();
    setStatus(`Room ${payload.room.roomCode} created.`);
    clearStatusAfterDelay();
    setApiLog(payload.note || 'Room created.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to create room.');
  }
});

elements.joinRoomButton.addEventListener('click', async () => {
  const roomCode = elements.roomCodeInput.value.trim().toUpperCase();
  if (!roomCode) {
    setStatus('Enter a room code first.');
    return;
  }

  try {
    const payload = await joinRoom(roomCode);
    roomSession.token = payload.token;
    roomSession.role = payload.role;
    applyRoomSnapshot(payload.room);
    startRoomPolling();
    setStatus(`Joined room ${payload.room.roomCode} as ${payload.role}.`);
    clearStatusAfterDelay();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to join room.');
  }
});

elements.leaveRoomButton.addEventListener('click', () => {
  leaveRoomSession();
  setStatus('Left room mode.');
  clearStatusAfterDelay();
});

elements.sendCommandButton.addEventListener('click', () => {
  executeTextCommand();
});

elements.textCommandInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    executeTextCommand();
  }
});

elements.refreshTextButton.addEventListener('click', () => {
  if (roomSession.active && roomSession.lastSnapshot) {
    renderTextBoard(roomSession.lastSnapshot.match.boardText);
    setApiLog('Rendered latest room snapshot.');
    return;
  }
  updateLocalTextBoard();
  setApiLog('Rendered local snapshot.');
});

elements.apiDocsButton.addEventListener('click', async () => {
  try {
    const schema = await fetchApiSchema();
    setApiLog([schema.name, '', ...schema.commands].join('\n'));
  } catch (error) {
    setApiLog(error instanceof Error ? error.message : 'Unable to load API schema.');
  }
});

elements.touchButtons.forEach((button) => {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const target = event.currentTarget;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    const player = Number.parseInt(target.dataset.player ?? '1', 10);
    void handleDirectionalInput(player, target.dataset.direction ?? 'right');
  });
});

document.addEventListener('fullscreenchange', () => {
  elements.fullscreenButton.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
  game.resizeCanvas();
});

window.addEventListener('keydown', (event) => {
  if (event.repeat) {
    return;
  }

  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) {
    if (event.code !== 'Space') {
      return;
    }
  }

  switch (event.code) {
    case 'KeyW':
      event.preventDefault();
      void handleDirectionalInput(1, 'up');
      break;
    case 'KeyS':
      event.preventDefault();
      void handleDirectionalInput(1, 'down');
      break;
    case 'KeyA':
      event.preventDefault();
      void handleDirectionalInput(1, 'left');
      break;
    case 'KeyD':
      event.preventDefault();
      void handleDirectionalInput(1, 'right');
      break;
    case 'ArrowUp':
      event.preventDefault();
      void handleDirectionalInput(2, 'up');
      break;
    case 'ArrowDown':
      event.preventDefault();
      void handleDirectionalInput(2, 'down');
      break;
    case 'ArrowLeft':
      event.preventDefault();
      void handleDirectionalInput(2, 'left');
      break;
    case 'ArrowRight':
      event.preventDefault();
      void handleDirectionalInput(2, 'right');
      break;
    case 'Space':
      event.preventDefault();
      void handleTogglePlay();
      break;
    case 'KeyR':
      event.preventDefault();
      void handleResetRound();
      break;
    case 'KeyF':
      event.preventDefault();
      toggleFullscreen();
      break;
    default:
      break;
  }
});

updateRoomMeta();
updateLocalTextBoard();
setApiLog('Type help to inspect the text-command schema.');
window.setInterval(() => {
  if (!roomSession.active) {
    updateLocalTextBoard();
  }
}, 300);