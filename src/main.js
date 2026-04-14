import './style.css';
import { createRoom, fetchApiSchema, fetchRoomHistory, fetchRoomState, fetchRoomTurn, joinRoom, sendRoomCommand } from './api-client.js';
import { chooseBotDirection, DIRECTION_VECTORS, parseTextCommand, renderAsciiBoard } from './shared/game-engine.js';
import { BACKDROP_STYLES, DEFAULT_SETTINGS, GRID_STYLES, THEMES } from './themes.js';

const SETTINGS_KEY = 'duelsnakes.arena.settings';
const SCORE_KEY = 'duelsnakes.arena.score';
const MUSIC_KEY = 'duelsnakes.arena.music';
const LLM_PROVIDER_KEY = 'duelsnakes.llm.provider';
const LLM_MODEL_KEY = 'duelsnakes.llm.model';
const LLM_ENDPOINT_KEY = 'duelsnakes.llm.endpoint';
const LLM_SECRET_KEY = 'duelsnakes.llm.secret';
const MAX_FRAME_DELTA = 100;
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

const PROVIDER_OPTIONS = {
  openrouter: {
    label: 'OpenRouter',
    endpoint: '',
    endpointPlaceholder: '',
    modelPlaceholder: 'openai/gpt-4.1-mini',
    apiKeyPlaceholder: 'Paste your OpenRouter API key',
    needsEndpoint: false,
  },
  ollama: {
    label: 'Ollama',
    endpoint: 'http://localhost:11434',
    endpointPlaceholder: 'http://localhost:11434',
    modelPlaceholder: 'llama3.1',
    apiKeyPlaceholder: 'Optional bearer token',
    needsEndpoint: true,
  },
  vllm: {
    label: 'vLLM / OpenAI-compatible',
    endpoint: 'http://localhost:8000',
    endpointPlaceholder: 'http://localhost:8000',
    modelPlaceholder: 'your-local-model',
    apiKeyPlaceholder: 'Optional bearer token',
    needsEndpoint: true,
  },
};

const app = document.querySelector('#app');

if (!app) {
  throw new Error('SuperDuelSnakes Arena failed to mount: missing #app root.');
}

app.innerHTML = `
  <main class="shell game-shell">
    <div class="corner-ui">
      <div class="room-badge ${''}" id="roomStatus"></div>
      <div class="music-dock" aria-label="Music controls">
        <button class="icon-button music-button" id="musicToggleButton" type="button" aria-label="Toggle volume controls">
          <span class="speaker-icon" aria-hidden="true">
            <span class="speaker-box"></span>
            <span class="speaker-wave speaker-wave-1"></span>
            <span class="speaker-wave speaker-wave-2"></span>
          </span>
        </button>
        <div class="volume-popover visually-hidden" id="musicVolumePopover">
          <input id="musicVolume" type="range" min="0" max="100" step="1" aria-label="Music volume" />
        </div>
      </div>
    </div>

    <section class="screen screen-home is-active" id="homeView" data-screen="home">
      <h1 class="sr-only">SuperDuelSnakes Arena</h1>
      <img class="home-logo" src="/original/title.png" alt="DuelSnakes" />
      <div class="menu-stack">
        <button class="menu-button" id="homePlayButton" type="button">Play</button>
        <button class="menu-button" id="homeAutomateButton" type="button">Automate</button>
        <button class="menu-button" id="homeCreateRoomButton" type="button">Create Room</button>
        <button class="menu-button" id="homeJoinRoomButton" type="button">Join Room</button>
        <button class="menu-button" id="homeSettingsButton" type="button">Settings</button>
      </div>
    </section>

    <section class="screen screen-menu" id="playView" data-screen="play">
      <div class="menu-panel">
        <p class="screen-kicker">Play</p>
        <h2>Choose a duel</h2>
        <p class="screen-copy">Pick the direct play mode here. Local stays on one device, or launch a quick match against the built-in bot.</p>
        <div class="menu-stack">
          <button class="menu-button" id="playLocalButton" type="button">2 Player Local</button>
          <button class="menu-button" id="playBotButton" type="button">Play v Bot</button>
        </div>
        <button class="button button-ghost back-button" id="backFromPlayButton" type="button">Back</button>
      </div>
    </section>

    <section class="screen screen-menu" id="automationView" data-screen="automation">
      <div class="menu-panel automation-panel">
        <p class="screen-kicker">Automate</p>
        <h2>Automation modes</h2>
        <p class="screen-copy">Use the configured provider for assisted and autonomous LLM matches here.</p>
        <div class="toggle-row automation-toggle">
          <label for="automationRealtimeAgentTiming">Real time llm? (warning, probably won't work)</label>
          <label class="switch">
            <input id="automationRealtimeAgentTiming" type="checkbox" />
            <span class="slider"></span>
          </label>
        </div>
        <div class="menu-grid">
          <button class="menu-button" id="automationPlayVsLlmButton" type="button">Play v LLM</button>
          <button class="menu-button" id="automationLlmVsLlmButton" type="button">LLM v LLM</button>
          <button class="menu-button" id="automationLlmVsBotButton" type="button">LLM v Bot</button>
        </div>
        <section class="sandbox-panel">
          <p class="screen-kicker">Sandbox</p>
          <div class="room-join-row">
            <input class="text-input" id="textCommandInput" type="text" placeholder="Examples: start, p1 up, p2 left, pause, reset" />
            <button class="button button-solid" id="sendCommandButton" type="button">Send</button>
          </div>
          <div class="actions automation-actions">
            <button class="button button-ghost" id="refreshTextButton" type="button">Refresh Snapshot</button>
            <button class="button button-ghost" id="roomHistoryButton" type="button">Room History</button>
            <button class="button button-ghost" id="apiDocsButton" type="button">API Schema</button>
          </div>
          <pre class="terminal-board" id="textBoard"></pre>
          <pre class="api-log" id="apiLog"></pre>
        </section>
        <button class="button button-ghost back-button" id="backFromAutomationButton" type="button">Back</button>
      </div>
    </section>

    <section class="screen screen-menu" id="joinView" data-screen="join">
      <div class="menu-panel join-panel">
        <p class="screen-kicker">Join Room</p>
        <h2>Enter a room code</h2>
        <p class="screen-copy">Join an existing hosted duel by code.</p>
        <div class="menu-stack join-stack">
          <input class="text-input" id="roomCodeInput" type="text" maxlength="6" placeholder="ROOM CODE" />
          <button class="menu-button" id="joinRoomButton" type="button">Join Room</button>
        </div>
        <button class="button button-ghost back-button" id="backFromJoinButton" type="button">Back</button>
      </div>
    </section>

    <section class="screen screen-config" id="configView" data-screen="config">
      <div class="config-shell">
        <div class="config-header">
          <div>
            <p class="screen-kicker" id="configKicker">Settings</p>
            <h2 id="configTitle">Tune the arena</h2>
            <p class="screen-copy" id="configCopy">Adjust the board, speed, snake colors, and presentation.</p>
          </div>
          <button class="button button-ghost back-button" id="backFromConfigButton" type="button">Back</button>
        </div>

        <form class="settings-form mono-form" id="settingsForm">
          <section class="settings-group">
            <h3>Match Rules</h3>
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
              <div class="toggle-row">
                <label for="wrapWalls">Wrap arena walls</label>
                <label class="switch">
                  <input id="wrapWalls" name="wrapWalls" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
          </section>

          <section class="settings-group">
            <h3>Presentation</h3>
            <div class="control-grid">
              <div class="control-row">
                <label for="gridStyle">Grid Style</label>
                <select id="gridStyle" name="gridStyle"></select>
              </div>
              <div class="control-row">
                <label for="snake1Color">Player 1 Color</label>
                <input id="snake1Color" name="snake1Color" type="color" />
              </div>
              <div class="control-row">
                <label for="snake2Color">Player 2 Color</label>
                <input id="snake2Color" name="snake2Color" type="color" />
              </div>
              <div class="toggle-row">
                <label for="showTrails">Head trails</label>
                <label class="switch">
                  <input id="showTrails" name="showTrails" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
              <div class="toggle-row">
                <label for="foodPulse">Food pulse</label>
                <label class="switch">
                  <input id="foodPulse" name="foodPulse" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
              <div class="hidden-config">
                <select id="theme" name="theme"></select>
                <select id="backdropStyle" name="backdropStyle"></select>
              </div>
            </div>
          </section>

          <section class="settings-group">
            <h3>Effects</h3>
            <div class="control-grid">
              <div class="toggle-row">
                <label for="soundEnabled">Sound effects</label>
                <label class="switch">
                  <input id="soundEnabled" name="soundEnabled" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
              <div class="toggle-row">
                <label for="screenShake">Screen shake</label>
                <label class="switch">
                  <input id="screenShake" name="screenShake" type="checkbox" />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
          </section>

          <section class="settings-group" id="llmProviderSection">
            <h3>AI Provider</h3>
            <div class="control-grid">
              <p class="provider-current" id="llmProviderSelected">Selected provider: OpenRouter</p>
              <div class="control-row">
                <label for="llmProvider">Provider</label>
                <select id="llmProvider">
                  <option value="openrouter" selected>OpenRouter</option>
                  <option value="ollama">Ollama</option>
                  <option value="vllm">vLLM / OpenAI-compatible</option>
                </select>
              </div>
              <div class="control-row" id="llmEndpointRow">
                <label for="llmEndpoint">Endpoint</label>
                <input class="text-input" id="llmEndpoint" type="text" placeholder="http://localhost:11434" autocomplete="off" />
              </div>
              <div class="control-row">
                <label for="llmApiKey">API Key</label>
                <input class="text-input" id="llmApiKey" type="password" placeholder="Paste your provider API key if needed" autocomplete="off" />
              </div>
              <div class="control-row">
                <label for="llmModel">Model</label>
                <input class="text-input" id="llmModel" type="text" placeholder="openai/gpt-4.1-mini, llama3.1, or your local model" autocomplete="off" />
              </div>
              <div class="actions vertical-actions">
                <button class="button button-solid" id="saveLlmProviderButton" type="button">Save Provider Settings</button>
                <button class="button button-ghost" id="clearLlmProviderButton" type="button">Clear API Key</button>
              </div>
              <p class="pending-note pending-note-muted" id="llmProviderStatus"></p>
            </div>
          </section>

          <section class="settings-group" id="roomSetupSection">
            <h3>Create Room</h3>
            <div class="control-grid">
              <p class="screen-copy">Rooms are human versus human only. Create a room here, then have the second player join with the room code.</p>
            </div>
            <div class="room-actions" id="roomActions">
              <button class="button button-solid" id="createRoomButton" type="button">Create Room</button>
            </div>
          </section>

          <section class="settings-group" id="settingsActionsSection">
            <h3>System</h3>
            <div class="actions vertical-actions">
              <button class="button button-solid" id="applySettingsButton" type="button">Apply Settings</button>
              <button class="button button-ghost" id="resetScoresButton" type="button">Reset Scores</button>
              <button class="button button-ghost visually-hidden" id="randomThemeButton" type="button">Randomize Look</button>
            </div>
          </section>

          <p class="pending-note" id="pendingNote"></p>
          <p class="pending-note pending-note-muted" id="statusNote"></p>
        </form>
      </div>
    </section>

    <section class="screen screen-game" id="gameView" data-screen="game">
      <div class="game-layout">
        <div class="game-header">
          <div class="hud-grid">
            <article class="hud-card"><span>P1</span><strong id="p1Score">0</strong></article>
            <article class="hud-card"><span>P2</span><strong id="p2Score">0</strong></article>
            <article class="hud-card"><span>Clock</span><strong id="roundClock">00:00</strong></article>
          </div>
          <div class="game-top-actions">
            <button class="button button-ghost" id="returnHomeButton" type="button">Return</button>
            <button class="button button-ghost" id="restartButton" type="button">Reset Round</button>
          </div>
        </div>

        <div class="canvas-shell" id="canvasShell">
          <canvas class="board-canvas" id="gameCanvas"></canvas>
          <div class="canvas-overlay" id="canvasOverlay"></div>
        </div>

        <section class="touch-panel" aria-label="Touch controls">
          <div class="touch-card">
            <span>Player 1</span>
            <div class="touch-grid" data-player="1">
              <button class="touch-button touch-up" data-player="1" data-direction="up" type="button" aria-label="Player 1 up">▲</button>
              <button class="touch-button touch-left" data-player="1" data-direction="left" type="button" aria-label="Player 1 left">◀</button>
              <button class="touch-button touch-right" data-player="1" data-direction="right" type="button" aria-label="Player 1 right">▶</button>
              <button class="touch-button touch-down" data-player="1" data-direction="down" type="button" aria-label="Player 1 down">▼</button>
            </div>
          </div>
          <div class="touch-card">
            <span>Player 2</span>
            <div class="touch-grid" data-player="2">
              <button class="touch-button touch-up" data-player="2" data-direction="up" type="button" aria-label="Player 2 up">▲</button>
              <button class="touch-button touch-left" data-player="2" data-direction="left" type="button" aria-label="Player 2 left">◀</button>
              <button class="touch-button touch-right" data-player="2" data-direction="right" type="button" aria-label="Player 2 right">▶</button>
              <button class="touch-button touch-down" data-player="2" data-direction="down" type="button" aria-label="Player 2 down">▼</button>
            </div>
          </div>
        </section>
      </div>
    </section>
  </main>
`;

const elements = {
  screens: document.querySelectorAll('[data-screen]'),
  homePlayButton: document.querySelector('#homePlayButton'),
  homeAutomateButton: document.querySelector('#homeAutomateButton'),
  homeCreateRoomButton: document.querySelector('#homeCreateRoomButton'),
  homeJoinRoomButton: document.querySelector('#homeJoinRoomButton'),
  homeSettingsButton: document.querySelector('#homeSettingsButton'),
  playLocalButton: document.querySelector('#playLocalButton'),
  playBotButton: document.querySelector('#playBotButton'),
  backFromPlayButton: document.querySelector('#backFromPlayButton'),
  automationPlayVsLlmButton: document.querySelector('#automationPlayVsLlmButton'),
  automationLlmVsLlmButton: document.querySelector('#automationLlmVsLlmButton'),
  automationLlmVsBotButton: document.querySelector('#automationLlmVsBotButton'),
  automationRealtimeAgentTiming: document.querySelector('#automationRealtimeAgentTiming'),
  backFromAutomationButton: document.querySelector('#backFromAutomationButton'),
  backFromJoinButton: document.querySelector('#backFromJoinButton'),
  configKicker: document.querySelector('#configKicker'),
  configTitle: document.querySelector('#configTitle'),
  configCopy: document.querySelector('#configCopy'),
  backFromConfigButton: document.querySelector('#backFromConfigButton'),
  llmProviderSection: document.querySelector('#llmProviderSection'),
  roomSetupSection: document.querySelector('#roomSetupSection'),
  settingsActionsSection: document.querySelector('#settingsActionsSection'),
  returnHomeButton: document.querySelector('#returnHomeButton'),
  p1Score: document.querySelector('#p1Score'),
  p2Score: document.querySelector('#p2Score'),
  roundClock: document.querySelector('#roundClock'),
  musicToggleButton: document.querySelector('#musicToggleButton'),
  musicVolumePopover: document.querySelector('#musicVolumePopover'),
  musicVolume: document.querySelector('#musicVolume'),
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
  snake1Color: document.querySelector('#snake1Color'),
  snake2Color: document.querySelector('#snake2Color'),
  foodPulse: document.querySelector('#foodPulse'),
  soundEnabled: document.querySelector('#soundEnabled'),
  screenShake: document.querySelector('#screenShake'),
  applySettingsButton: document.querySelector('#applySettingsButton'),
  randomThemeButton: document.querySelector('#randomThemeButton'),
  resetScoresButton: document.querySelector('#resetScoresButton'),
  llmProvider: document.querySelector('#llmProvider'),
  llmProviderSelected: document.querySelector('#llmProviderSelected'),
  llmEndpointRow: document.querySelector('#llmEndpointRow'),
  llmEndpoint: document.querySelector('#llmEndpoint'),
  llmApiKey: document.querySelector('#llmApiKey'),
  llmModel: document.querySelector('#llmModel'),
  saveLlmProviderButton: document.querySelector('#saveLlmProviderButton'),
  clearLlmProviderButton: document.querySelector('#clearLlmProviderButton'),
  llmProviderStatus: document.querySelector('#llmProviderStatus'),
  pendingNote: document.querySelector('#pendingNote'),
  statusNote: document.querySelector('#statusNote'),
  touchCards: document.querySelectorAll('.touch-card'),
  touchButtons: document.querySelectorAll('.touch-button'),
  createRoomButton: document.querySelector('#createRoomButton'),
  roomCodeInput: document.querySelector('#roomCodeInput'),
  joinRoomButton: document.querySelector('#joinRoomButton'),
  roomStatus: document.querySelector('#roomStatus'),
  textCommandInput: document.querySelector('#textCommandInput'),
  sendCommandButton: document.querySelector('#sendCommandButton'),
  refreshTextButton: document.querySelector('#refreshTextButton'),
  roomHistoryButton: document.querySelector('#roomHistoryButton'),
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
  controllers: { player1: 'human', player2: 'human' },
  agentTiming: 'turn-based',
  skillUrl: '',
  agentAccess: null,
  pollTimer: 0,
  lastSnapshot: null,
};
let activeScreen = 'home';
let configMode = 'settings';
let localControllers = { player1: 'human', player2: 'human' };
let llmSettings = {
  provider: localStorage.getItem(LLM_PROVIDER_KEY) || 'openrouter',
  endpoint: localStorage.getItem(LLM_ENDPOINT_KEY) || '',
  apiKey: '',
  model: localStorage.getItem(LLM_MODEL_KEY) || 'openai/gpt-4.1-mini',
};
const llmRuntime = {
  pollers: {},
  traces: {
    player1: 'Idle',
    player2: 'Idle',
  },
  busy: {
    player1: false,
    player2: false,
  },
};

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function openSecretDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('superduelsnakes-secrets', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('keys');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open secret storage.'));
  });
}

async function withSecretStore(mode, callback) {
  const db = await openSecretDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', mode);
    const store = tx.objectStore('keys');
    const result = callback(store, resolve, reject);
    tx.onabort = () => reject(tx.error || new Error('Secret storage transaction failed.'));
    tx.onerror = () => reject(tx.error || new Error('Secret storage transaction failed.'));
    return result;
  });
}

async function getEncryptionKey() {
  const stored = await withSecretStore('readonly', (store, resolve, reject) => {
    const request = store.get('llm-provider-key');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Unable to read encryption key.'));
  });
  if (stored) {
    return stored;
  }

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  await withSecretStore('readwrite', (store, resolve, reject) => {
    const request = store.put(key, 'llm-provider-key');
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error || new Error('Unable to persist encryption key.'));
  });
  return key;
}

async function encryptCachedSecret(secret) {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(secret);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded));
  return JSON.stringify({ iv: toBase64(iv), value: toBase64(ciphertext) });
}

async function decryptCachedSecret(payload) {
  if (!payload) {
    return '';
  }
  const parsed = JSON.parse(payload);
  const key = await getEncryptionKey();
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(parsed.iv) }, key, fromBase64(parsed.value));
  return new TextDecoder().decode(plaintext);
}

async function loadLlmSettings() {
  const encrypted = localStorage.getItem(LLM_SECRET_KEY);
  const apiKey = encrypted ? await decryptCachedSecret(encrypted).catch(() => '') : '';
  return {
    provider: localStorage.getItem(LLM_PROVIDER_KEY) || 'openrouter',
    endpoint: localStorage.getItem(LLM_ENDPOINT_KEY) || '',
    apiKey,
    model: localStorage.getItem(LLM_MODEL_KEY) || 'openai/gpt-4.1-mini',
  };
}

async function saveLlmSettings(nextSettings) {
  const trimmedKey = String(nextSettings.apiKey || '').trim();
  const provider = String(nextSettings.provider || 'openrouter');
  const providerConfig = PROVIDER_OPTIONS[provider] || PROVIDER_OPTIONS.openrouter;
  const trimmedEndpoint = providerConfig.needsEndpoint ? String(nextSettings.endpoint || '').trim() : '';
  const trimmedModel = String(nextSettings.model || providerConfig.modelPlaceholder || 'openai/gpt-4.1-mini').trim()
    || providerConfig.modelPlaceholder
    || 'openai/gpt-4.1-mini';

  if (trimmedKey) {
    localStorage.setItem(LLM_SECRET_KEY, await encryptCachedSecret(trimmedKey));
  } else {
    localStorage.removeItem(LLM_SECRET_KEY);
  }
  localStorage.setItem(LLM_PROVIDER_KEY, provider);
  localStorage.setItem(LLM_ENDPOINT_KEY, trimmedEndpoint);
  localStorage.setItem(LLM_MODEL_KEY, trimmedModel);
}

function clearLlmSettings() {
  localStorage.removeItem(LLM_SECRET_KEY);
  localStorage.removeItem(LLM_PROVIDER_KEY);
  localStorage.removeItem(LLM_ENDPOINT_KEY);
  localStorage.removeItem(LLM_MODEL_KEY);
}

function syncLlmProviderInputs() {
  elements.llmProvider.value = llmSettings.provider;
  elements.llmEndpoint.value = llmSettings.endpoint;
  elements.llmApiKey.value = llmSettings.apiKey;
  elements.llmModel.value = llmSettings.model;
  updateLlmProviderUi();
}

function setLlmProviderStatus(message) {
  elements.llmProviderStatus.textContent = message;
}

function updateLlmProviderUi() {
  const provider = elements.llmProvider.value;
  const providerConfig = PROVIDER_OPTIONS[provider] || PROVIDER_OPTIONS.openrouter;
  elements.llmProviderSelected.textContent = `Selected provider: ${providerConfig.label}`;
  elements.llmProviderSelected.dataset.provider = provider;
  elements.llmApiKey.placeholder = providerConfig.apiKeyPlaceholder;
  elements.llmModel.placeholder = providerConfig.modelPlaceholder;
  elements.llmEndpointRow.classList.toggle('visually-hidden', !providerConfig.needsEndpoint);
  elements.llmEndpoint.placeholder = providerConfig.endpointPlaceholder;
  if (providerConfig.needsEndpoint && !elements.llmEndpoint.value.trim()) {
    elements.llmEndpoint.value = providerConfig.endpoint;
  }
}

function setTrace(playerKey, text) {
  llmRuntime.traces[playerKey] = text;
}

function updateTraceWindows() {
  if (!roomSession.agentAccess) {
    llmRuntime.traces.player1 = 'Idle';
    llmRuntime.traces.player2 = 'Idle';
  }
}

async function ensureLlmProviderReady() {
  const provider = llmSettings.provider;
  const endpoint = llmSettings.endpoint.trim();
  const model = llmSettings.model.trim();

  if (provider === 'openrouter' && !llmSettings.apiKey.trim()) {
    showConfigScreen('settings');
    setStatus('An API key is required for the selected LLM provider.');
    setLlmProviderStatus('Save an API key in Settings before starting an LLM mode.');
    return false;
  }
  if (!model) {
    showConfigScreen('settings');
    setStatus('A model is required for LLM modes.');
    setLlmProviderStatus('Set a model name in Settings first.');
    return false;
  }
  if ((provider === 'ollama' || provider === 'vllm') && !endpoint) {
    showConfigScreen('settings');
    setStatus('An endpoint is required for the selected local provider.');
    setLlmProviderStatus('Set the provider endpoint in Settings first.');
    return false;
  }

  return true;
}

function extractJsonBlock(content) {
  const match = String(content || '').match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function normalizeEndpoint(endpoint, path) {
  return `${String(endpoint || '').replace(/\/+$/, '')}${path}`;
}

function getProviderDisplayName() {
  return (PROVIDER_OPTIONS[llmSettings.provider] || PROVIDER_OPTIONS.openrouter).label;
}

function parseProviderMove(content, fallbackReasoning = '', toolCalls = null) {
  const parsed = extractJsonBlock(content) || {};
  return {
    direction: ['up', 'down', 'left', 'right', 'stay'].includes(parsed.direction) ? parsed.direction : 'stay',
    reasoning: parsed.reasoning || parsed.thought || fallbackReasoning || content || 'No reasoning provided.',
    toolCalls,
  };
}

async function requestProviderMove(playerKey, turnState) {
  const prompt = [
    `player: ${playerKey}`,
    `turn mode: ${turnState.turn.mode}`,
    `tick: ${turnState.turn.tickNumber}`,
    `timeRemainingMs: ${turnState.turn.timeRemainingMs ?? 'n/a'}`,
    `legal actions: ${JSON.stringify(turnState.observation.legalActions[playerKey] ?? [])}`,
    'board:',
    turnState.observation.boardText,
    '',
    `summary: ${JSON.stringify(turnState.observation.summary)}`,
    `recent events: ${JSON.stringify(turnState.observation.events)}`,
  ].join('\n');

  if (llmSettings.provider === 'openrouter') {
    const response = await fetch(normalizeEndpoint(OPENROUTER_API_BASE, '/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llmSettings.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: llmSettings.model,
        messages: [
          { role: 'system', content: 'You are playing SuperDuelSnakes. Reply with strict JSON: {"direction":"up|down|left|right|stay","reasoning":"short note"}. Never output anything else.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error?.message || payload.error || 'OpenRouter request failed.');
    }
    const choice = payload.choices?.[0]?.message;
    const content = Array.isArray(choice?.content)
      ? choice.content.map((part) => part.text || '').join('')
      : choice?.content || '';
    return parseProviderMove(content, content, choice?.tool_calls || payload.choices?.[0]?.tool_calls || null);
  }

  if (llmSettings.provider === 'ollama') {
    const response = await fetch(normalizeEndpoint(llmSettings.endpoint, '/api/chat'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: llmSettings.model,
        stream: false,
        messages: [
          { role: 'system', content: 'You are playing SuperDuelSnakes. Reply with strict JSON: {"direction":"up|down|left|right|stay","reasoning":"short note"}. Never output anything else.' },
          { role: 'user', content: prompt },
        ],
        options: { temperature: 0.2 },
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Ollama request failed.');
    }
    const content = payload.message?.content || payload.response || '';
    const fallback = payload.message?.thinking || content;
    return parseProviderMove(content, fallback, payload.message?.tool_calls || null);
  }

  const response = await fetch(normalizeEndpoint(llmSettings.endpoint, '/v1/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(llmSettings.apiKey ? { Authorization: `Bearer ${llmSettings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: llmSettings.model,
      messages: [
        { role: 'system', content: 'You are playing SuperDuelSnakes. Reply with strict JSON: {"direction":"up|down|left|right|stay","reasoning":"short note"}. Never output anything else.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || 'vLLM request failed.');
  }
  const choice = payload.choices?.[0]?.message;
  const content = Array.isArray(choice?.content)
    ? choice.content.map((part) => part.text || '').join('')
    : choice?.content || '';
  return parseProviderMove(content, content, choice?.tool_calls || payload.choices?.[0]?.tool_calls || null);
}

async function runLlmSeat(playerKey, token) {
  if (!roomSession.active || !roomSession.roomCode || llmRuntime.busy[playerKey]) {
    return;
  }
  llmRuntime.busy[playerKey] = true;

  try {
    const turnState = await fetchRoomTurn(roomSession.roomCode, token);
    if (!turnState.turn.readyForInput || turnState.observation.summary.state !== 'running') {
      return;
    }

    setTrace(playerKey, `provider: ${getProviderDisplayName()}\nmodel: ${llmSettings.model}\nTick ${turnState.turn.tickNumber}\nThinking...`);
    const move = await requestProviderMove(playerKey, turnState);
    const action = move.direction === 'stay'
      ? { type: 'stay', player: playerKey }
      : { type: 'direction', player: playerKey, direction: move.direction };

    setTrace(playerKey, [
      `provider: ${getProviderDisplayName()}`,
      `model: ${llmSettings.model}`,
      `tick: ${turnState.turn.tickNumber}`,
      `direction: ${move.direction}`,
      '',
      'thought:',
      move.reasoning,
      move.toolCalls ? `\n\ntool calls:\n${JSON.stringify(move.toolCalls, null, 2)}` : '',
    ].join('\n'));

    await sendRoomCommand({
      roomCode: roomSession.roomCode,
      token,
      action,
    });
    await syncRoomFromApi();
  } catch (error) {
    setTrace(playerKey, `error:\n${error instanceof Error ? error.message : 'LLM move failed.'}`);
  } finally {
    llmRuntime.busy[playerKey] = false;
  }
}

function stopLlmControllers() {
  Object.values(llmRuntime.pollers).forEach((pollerId) => {
    if (pollerId) {
      window.clearInterval(pollerId);
    }
  });
  llmRuntime.pollers = {};
  llmRuntime.busy.player1 = false;
  llmRuntime.busy.player2 = false;
  roomSession.agentAccess = null;
  updateTraceWindows();
}

function startLlmControllers() {
  stopLlmControllers();
  if (!roomSession.agentAccess) {
    return;
  }

  Object.entries(roomSession.agentAccess).forEach(([playerKey, access]) => {
    setTrace(playerKey, `Ready\nprovider: ${getProviderDisplayName()}\nmodel: ${llmSettings.model}\ntiming: ${access.agentTiming}`);
    llmRuntime.pollers[playerKey] = window.setInterval(() => {
      void runLlmSeat(playerKey, access.token);
    }, roomSession.agentTiming === 'realtime' ? 120 : 220);
  });
  updateTraceWindows();
}

function loadSettings() {
  const parsed = readStoredJson(SETTINGS_KEY, {});
  const isLegacyDefault = parsed &&
    parsed.cellCount === 25 &&
    parsed.speed === 6 &&
    parsed.theme === 'neonNoir' &&
    parsed.gridStyle === 'classic' &&
    parsed.backdropStyle === 'aurora' &&
    parsed.wrapWalls === false &&
    parsed.showTrails === true &&
    parsed.soundEnabled === true &&
    parsed.screenShake === true &&
    parsed.foodPulse === true;

  if (isLegacyDefault) {
    return sanitizeSettings(DEFAULT_SETTINGS);
  }

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

function loadMusicSettings() {
  const parsed = readStoredJson(MUSIC_KEY, {});
  return sanitizeMusicSettings(parsed);
}

function sanitizeSettings(raw) {
  const theme = 'originalArcade';
  const backdropStyle = 'none';
  const gridStyle = GRID_STYLES.some((item) => item.value === raw.gridStyle) ? raw.gridStyle : DEFAULT_SETTINGS.gridStyle;
  const snake1Color = /^#[0-9a-fA-F]{6}$/.test(String(raw.snake1Color || '').trim()) ? String(raw.snake1Color).trim().toLowerCase() : DEFAULT_SETTINGS.snake1Color;
  const snake2Color = /^#[0-9a-fA-F]{6}$/.test(String(raw.snake2Color || '').trim()) ? String(raw.snake2Color).trim().toLowerCase() : DEFAULT_SETTINGS.snake2Color;

  return {
    cellCount: clamp(Number.parseInt(raw.cellCount, 10) || DEFAULT_SETTINGS.cellCount, 12, 36),
    speed: clamp(Number.parseInt(raw.speed, 10) || DEFAULT_SETTINGS.speed, 4, 16),
    theme,
    backdropStyle,
    gridStyle,
    snake1Color,
    snake2Color,
    wrapWalls: Boolean(raw.wrapWalls),
    showTrails: raw.showTrails !== false,
    soundEnabled: raw.soundEnabled !== false,
    screenShake: raw.screenShake !== false,
    foodPulse: raw.foodPulse !== false,
  };
}

function showScreen(screenName) {
  activeScreen = screenName;
  elements.screens.forEach((screen) => {
    screen.classList.toggle('is-active', screen.dataset.screen === screenName);
  });
  window.setTimeout(() => {
    const firstButton = document.querySelector(`[data-screen="${screenName}"] .menu-button, [data-screen="${screenName}"] .button`);
    if (firstButton instanceof HTMLButtonElement) {
      firstButton.focus();
    }
  }, 0);
}

function setConfigMode(mode) {
  configMode = mode;
  const isRoomMode = mode === 'room';
  elements.configKicker.textContent = isRoomMode ? 'Create Room' : 'Settings';
  elements.configTitle.textContent = isRoomMode ? 'Build a room' : 'Tune the arena';
  elements.configCopy.textContent = isRoomMode
    ? 'Rooms are human versus human only. Create the room here, then share the code with the second player.'
    : 'Adjust the board and presentation, then apply the settings to your local game.';
  elements.llmProviderSection.classList.toggle('visually-hidden', isRoomMode);
  elements.roomSetupSection.classList.toggle('visually-hidden', !isRoomMode);
  elements.settingsActionsSection.classList.toggle('visually-hidden', isRoomMode);
}

function showConfigScreen(mode) {
  setConfigMode(mode);
  showScreen('config');
}

function enterGameScreen() {
  showScreen('game');
}

function returnToMenu() {
  setVolumePopoverVisible(false);
  if (roomSession.active) {
    leaveRoomSession();
  } else if (game.state === 'running') {
    game.pause();
  }
  updateControlHints();
  showScreen('home');
}

function resetLocalGame() {
  if (roomSession.active) {
    leaveRoomSession();
  }
  configureLocalControllers(localControllers);
  game.disableRemoteMode();
  game.winner = null;
  game.resetRound();
  updateLocalTextBoard();
  updateControlHints();
}

async function createConfiguredRoomSession(playerModes, agentTiming = 'turn-based') {
  if (roomSession.active) {
    leaveRoomSession();
  }
  if (Object.values(playerModes).includes('agent') && !(await ensureLlmProviderReady())) {
    throw new Error('The selected LLM provider is not configured for agent rooms.');
  }

  const payload = await createRoom(settings, {
    playerModes,
    agentTiming,
    allowAutomationRooms: playerModes.player1 !== 'human' || playerModes.player2 !== 'human',
  });
  roomSession.token = payload.token;
  roomSession.role = payload.role;
  roomSession.agentTiming = payload.agentTiming ?? agentTiming;
  roomSession.skillUrl = payload.skillUrl ?? '';
  roomSession.agentAccess = payload.agentAccess ?? null;
  applyRoomSnapshot(payload.room);
  startRoomPolling();
  startLlmControllers();
  setApiLog([
    payload.note || 'Room created.',
    '',
    describeAgentAccess(payload.agentAccess),
  ].filter(Boolean).join('\n'));
  return payload;
}

function saveSettings(settings) {
  writeStoredJson(SETTINGS_KEY, settings);
}

function saveScore(score) {
  writeStoredJson(SCORE_KEY, score);
}

function saveMusicSettings(musicSettings) {
  writeStoredJson(MUSIC_KEY, musicSettings);
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

function withAlpha(hex, alpha) {
  const normalized = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(255, 255, 255, ${alpha})`;
  }
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function sanitizeMusicSettings(raw) {
  const volume = Number(raw.volume);
  const previousVolume = Number(raw.previousVolume);
  return {
    volume: Number.isFinite(volume) ? clamp(volume, 0, 1) : 0.6,
    previousVolume: Number.isFinite(previousVolume) && previousVolume > 0 ? clamp(previousVolume, 0, 1) : 0.6,
  };
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
}

function fillSelect(select, options) {
  select.innerHTML = options.map((option) => `<option value="${option.value}">${option.label}</option>`).join('');
}

function fillThemeSelect(select) {
  select.innerHTML = Object.entries(THEMES)
    .map(([value, theme]) => `<option value="${value}">${theme.label}</option>`)
    .join('');
}

const originalFoodSprite = new Image();
originalFoodSprite.src = '/original/food.png';

class MusicPlayer {
  constructor(initialSettings) {
    this.audio = new Audio('/original/music.mp3');
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.audio.volume = initialSettings.volume;
    this.previousVolume = initialSettings.previousVolume;
    this.userGestureBound = false;
    this.bindLifecycle();
  }

  bindLifecycle() {
    this.audio.addEventListener('canplaythrough', () => {
      if (this.audio.volume > 0) {
        void this.play();
      }
    });

    this.audio.addEventListener('ended', () => {
      if (this.audio.volume <= 0) {
        return;
      }
      this.audio.currentTime = 0;
      void this.play();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.audio.volume > 0) {
        void this.play();
      }
    });

    window.addEventListener('focus', () => {
      if (this.audio.volume > 0) {
        void this.play();
      }
    });
  }

  bindUserGesture() {
    if (this.userGestureBound) {
      return;
    }

    const unlock = () => {
      if (this.audio.volume > 0) {
        void this.play();
      }
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    this.userGestureBound = true;
  }

  play() {
    return this.audio.play().catch(() => {});
  }

  setVolume(volume) {
    const nextVolume = clamp(volume, 0, 1);
    this.audio.volume = nextVolume;
    if (nextVolume > 0) {
      this.previousVolume = nextVolume;
      void this.play();
    } else {
      this.audio.pause();
    }
  }

  toggleMute() {
    if (this.audio.volume <= 0.001) {
      this.setVolume(this.previousVolume || 0.6);
      return;
    }
    this.setVolume(0);
  }

  getSettings() {
    return {
      volume: this.audio.volume,
      previousVolume: this.previousVolume,
    };
  }

  getButtonLabel() {
    if (this.audio.volume <= 0.001) {
      return 'Music Off';
    }
    return `Music ${Math.round(this.audio.volume * 100)}%`;
  }
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
    const directionName = direction.x > 0
      ? 'right'
      : direction.x < 0
        ? 'left'
        : direction.y > 0
          ? 'down'
          : 'up';

    return {
      id,
      body,
      directionName,
      queuedDirectionName: directionName,
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
    snake.queuedDirectionName = direction.x > 0
      ? 'right'
      : direction.x < 0
        ? 'left'
        : direction.y > 0
          ? 'down'
          : 'up';
    snake.queuedDirection = direction;
    if (this.state === 'stopped' && !this.winner) {
      this.start();
    }
  }

  setLocalControllers(controllers) {
    this.localControllers = {
      player1: controllers.player1 || 'human',
      player2: controllers.player2 || 'human',
    };
    this.renderOverlay();
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
    this.planLocalControllers();

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
      directionName: snake.queuedDirectionName,
      queuedDirection: { ...direction },
      queuedDirectionName: snake.queuedDirectionName,
      grow: false,
      trail,
    };
  }

  planLocalControllers() {
    if (this.remoteMode || this.state !== 'running') {
      return;
    }

    const snapshot = this.getSnapshot();
    if (this.localControllers.player1 === 'bot') {
      const direction = chooseBotDirection(snapshot, 'player1');
      if (direction && DIRECTION_VECTORS[direction]) {
        this.setDirection(1, DIRECTION_VECTORS[direction]);
      }
    }
    if (this.localControllers.player2 === 'bot') {
      const direction = chooseBotDirection(snapshot, 'player2');
      if (direction && DIRECTION_VECTORS[direction]) {
        this.setDirection(2, DIRECTION_VECTORS[direction]);
      }
    }
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
    elements.roundClock.textContent = formatTime(this.elapsedMs);
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
      copy = this.localControllers?.player2 === 'human'
        ? 'First movement input starts the duel. Player 1 uses WASD. Player 2 uses the arrow keys.'
        : 'First movement input starts the duel. Use WASD to control Player 1 against the automated opponent.';
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

    const snake1Color = this.settings.snake1Color || theme.snake1;
    const snake2Color = this.settings.snake2Color || theme.snake2;
    const snake1Glow = withAlpha(snake1Color, 0.4);
    const snake2Glow = withAlpha(snake2Color, 0.4);
    const trail1 = withAlpha(snake1Color, 0.16);
    const trail2 = withAlpha(snake2Color, 0.16);

    if (this.settings.showTrails) {
      this.drawTrail(this.snake1, trail1, cellSize, timestamp);
      this.drawTrail(this.snake2, trail2, cellSize, timestamp);
    }

    this.drawFood(cellSize, timestamp, theme);
    this.drawSnake(this.snake1, snake1Color, snake1Glow, cellSize, theme);
    this.drawSnake(this.snake2, snake2Color, snake2Glow, cellSize, theme);
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
          glow.addColorStop(0, index % 2 === 0 ? (this.settings.snake1Color || theme.snake1) : (this.settings.snake2Color || theme.snake2));
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
    const spriteSize = cellSize * 0.94 * pulse;

    if (originalFoodSprite.complete && originalFoodSprite.naturalWidth > 0) {
      ctx.save();
      ctx.shadowColor = theme.foodGlow;
      ctx.shadowBlur = cellSize * 0.42;
      ctx.drawImage(originalFoodSprite, centerX - spriteSize / 2, centerY - spriteSize / 2, spriteSize, spriteSize);
      ctx.restore();
      return;
    }

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
  elements.snake1Color.value = settings.snake1Color;
  elements.snake2Color.value = settings.snake2Color;
  elements.wrapWalls.checked = settings.wrapWalls;
  elements.showTrails.checked = settings.showTrails;
  elements.foodPulse.checked = settings.foodPulse;
  elements.soundEnabled.checked = settings.soundEnabled;
  elements.screenShake.checked = settings.screenShake;
  elements.cellCountValue.textContent = `${settings.cellCount} x ${settings.cellCount}`;
  elements.speedValue.textContent = `${settings.speed} ticks/s`;
}

function updateMusicControls(music) {
  const musicSettings = music.getSettings();
  elements.musicVolume.value = String(Math.round(musicSettings.volume * 100));
  elements.musicToggleButton.setAttribute('aria-label', music.getButtonLabel());
  elements.musicToggleButton.setAttribute('aria-pressed', musicSettings.volume <= 0.001 ? 'true' : 'false');
}

function setVolumePopoverVisible(visible) {
  elements.musicVolumePopover.classList.toggle('visually-hidden', !visible);
  elements.musicToggleButton.setAttribute('aria-expanded', visible ? 'true' : 'false');
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
      setStatus('Exited fullscreen mode.');
      clearStatusAfterDelay();
      return;
    }
    await elements.canvasShell.requestFullscreen();
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
let musicSettings = loadMusicSettings();
setThemeCss(settings.theme);
updateForm(settings);

const music = new MusicPlayer(musicSettings);
music.bindUserGesture();
updateMusicControls(music);
setVolumePopoverVisible(false);

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
game.setLocalControllers(localControllers);

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

function getActiveControllers() {
  return roomSession.active ? roomSession.controllers : localControllers;
}

function getLocallyControlledPlayers() {
  if (roomSession.active) {
    if (roomSession.role === 'player1' || roomSession.role === 'player2') {
      return new Set([roomSession.role]);
    }
    return new Set();
  }

  return new Set(Object.entries(localControllers)
    .filter(([, controller]) => controller === 'human')
    .map(([playerKey]) => playerKey));
}

function updateControlHints() {
  const activeControllers = getActiveControllers();
  const localPlayers = getLocallyControlledPlayers();

  elements.touchCards.forEach((card, index) => {
    const playerKey = index === 0 ? 'player1' : 'player2';
    const isHuman = activeControllers[playerKey] === 'human' && localPlayers.has(playerKey);
    card.classList.toggle('touch-card-inactive', !isHuman);
  });

  elements.touchButtons.forEach((button) => {
    const playerKey = button.dataset.player === '2' ? 'player2' : 'player1';
    const enabled = activeControllers[playerKey] === 'human' && localPlayers.has(playerKey);
    button.disabled = !enabled;
    button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  });
}

function configureLocalControllers(controllers) {
  localControllers = {
    player1: controllers.player1 || 'human',
    player2: controllers.player2 || 'human',
  };
  game.disableRemoteMode();
  game.setLocalControllers(localControllers);
  updateControlHints();
}

function updateRoomMeta() {
  elements.roomStatus.textContent = roomSession.active ? roomSession.roomCode : '';
  elements.roomStatus.classList.toggle('is-visible', roomSession.active);
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
  roomSession.controllers = room.controllers ?? { player1: 'human', player2: 'human' };
  roomSession.agentTiming = room.agentTiming ?? (room.turn?.mode === 'realtime-agent' ? 'realtime' : 'turn-based');
  game.applyRemoteSnapshot(room.match);
  renderTextBoard(room.match.boardText);
  updateRoomMeta();
  updateControlHints();
  updateTraceWindows();
}

function hasAgentSeat(controllers) {
  return Object.values(controllers).includes('agent');
}

function getAutomationTiming() {
  return elements.automationRealtimeAgentTiming.checked ? 'realtime' : 'turn-based';
}

function describeAgentAccess(agentAccess) {
  if (!agentAccess) {
    return '';
  }

  return Object.values(agentAccess)
    .map((entry) => [
      `player: ${entry.player}`,
      `token: ${entry.token}`,
      `timing: ${entry.agentTiming}`,
      `skill: ${entry.skillUrl}`,
    ].join('\n'))
    .join('\n\n');
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
  stopLlmControllers();
  roomSession.active = false;
  roomSession.roomCode = '';
  roomSession.token = '';
  roomSession.role = 'local';
  roomSession.backend = 'browser-local';
  roomSession.controllers = { player1: 'human', player2: 'human' };
  roomSession.agentTiming = 'turn-based';
  roomSession.skillUrl = '';
  roomSession.agentAccess = null;
  roomSession.lastSnapshot = null;
  game.disableRemoteMode();
  game.setLocalControllers(localControllers);
  game.resetRound();
  updateRoomMeta();
  updateControlHints();
  updateLocalTextBoard();
}

async function startCurrentMatch() {
  if (roomSession.active) {
    if (game.state === 'running') {
      return;
    }
    try {
      await sendRoomAction({ type: 'start' });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to start room round.');
    }
    return;
  }

  if (game.state !== 'running') {
    game.start();
    updateLocalTextBoard();
  }
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
  const playerKey = player === 2 ? 'player2' : 'player1';
  const activeControllers = getActiveControllers();
  const localPlayers = getLocallyControlledPlayers();

  if (activeControllers[playerKey] !== 'human' || !localPlayers.has(playerKey)) {
    return;
  }

  if (roomSession.active) {
    try {
      await sendRoomAction({ type: 'direction', direction: directionName, player: playerKey });
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
  if (!key) {
    return;
  }
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

elements.musicToggleButton.addEventListener('click', () => {
  setVolumePopoverVisible(elements.musicVolumePopover.classList.contains('visually-hidden'));
});

document.addEventListener('pointerdown', (event) => {
  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }
  if (elements.musicToggleButton.contains(target) || elements.musicVolumePopover.contains(target)) {
    return;
  }
  setVolumePopoverVisible(false);
});

elements.musicVolume.addEventListener('input', (event) => {
  const target = event.currentTarget;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  music.setVolume(Number(target.value) / 100);
  musicSettings = sanitizeMusicSettings(music.getSettings());
  saveMusicSettings(musicSettings);
  updateMusicControls(music);
});

elements.homePlayButton.addEventListener('click', () => {
  showScreen('play');
});

elements.homeAutomateButton.addEventListener('click', () => {
  showScreen('automation');
});

elements.homeCreateRoomButton.addEventListener('click', () => {
  showConfigScreen('room');
});

elements.homeJoinRoomButton.addEventListener('click', () => {
  showScreen('join');
});

elements.homeSettingsButton.addEventListener('click', () => {
  showConfigScreen('settings');
});

elements.backFromPlayButton.addEventListener('click', returnToMenu);
elements.backFromAutomationButton.addEventListener('click', returnToMenu);
elements.backFromJoinButton.addEventListener('click', returnToMenu);
elements.backFromConfigButton.addEventListener('click', returnToMenu);
elements.returnHomeButton.addEventListener('click', returnToMenu);

elements.playLocalButton.addEventListener('click', () => {
  configureLocalControllers({ player1: 'human', player2: 'human' });
  resetLocalGame();
  enterGameScreen();
  void startCurrentMatch();
  setStatus('Two-player local match ready.');
  clearStatusAfterDelay();
});

elements.playBotButton.addEventListener('click', async () => {
  configureLocalControllers({ player1: 'human', player2: 'bot' });
  resetLocalGame();
  enterGameScreen();
  void startCurrentMatch();
  setStatus('Play versus bot ready. Use WASD for Player 1.');
  clearStatusAfterDelay();
});

elements.automationPlayVsLlmButton.addEventListener('click', async () => {
  try {
    await createConfiguredRoomSession({ player1: 'human', player2: 'agent' }, getAutomationTiming());
    enterGameScreen();
    void startCurrentMatch();
    setStatus('Play versus LLM ready.');
    clearStatusAfterDelay();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to start play versus LLM.');
  }
});

elements.llmProvider.addEventListener('change', () => {
  updateLlmProviderUi();
  setLlmProviderStatus(`${(PROVIDER_OPTIONS[elements.llmProvider.value] || PROVIDER_OPTIONS.openrouter).label} selected.`);
});

elements.saveLlmProviderButton.addEventListener('click', async () => {
  try {
    llmSettings = {
      provider: elements.llmProvider.value,
      endpoint: elements.llmEndpoint.value.trim(),
      apiKey: elements.llmApiKey.value.trim(),
      model: elements.llmModel.value.trim() || (PROVIDER_OPTIONS[elements.llmProvider.value] || PROVIDER_OPTIONS.openrouter).modelPlaceholder,
    };
    await saveLlmSettings(llmSettings);
    llmSettings = await loadLlmSettings();
    syncLlmProviderInputs();
    setLlmProviderStatus(`${getProviderDisplayName()} settings cached locally.`);
  } catch (error) {
    setLlmProviderStatus(error instanceof Error ? error.message : 'Unable to save provider settings.');
  }
});

elements.clearLlmProviderButton.addEventListener('click', async () => {
  try {
    llmSettings = {
      provider: elements.llmProvider.value,
      endpoint: elements.llmEndpoint.value.trim(),
      apiKey: '',
      model: elements.llmModel.value.trim() || (PROVIDER_OPTIONS[elements.llmProvider.value] || PROVIDER_OPTIONS.openrouter).modelPlaceholder,
    };
    await saveLlmSettings(llmSettings);
    llmSettings = await loadLlmSettings();
    syncLlmProviderInputs();
    setLlmProviderStatus(`${getProviderDisplayName()} API key cleared from local cache.`);
  } catch (error) {
    setLlmProviderStatus(error instanceof Error ? error.message : 'Unable to clear provider API key.');
  }
});

elements.automationLlmVsLlmButton.addEventListener('click', async () => {
  try {
    await createConfiguredRoomSession({ player1: 'agent', player2: 'agent' }, getAutomationTiming());
    enterGameScreen();
    void startCurrentMatch();
    setStatus('LLM versus LLM ready.');
    clearStatusAfterDelay();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to start LLM versus LLM.');
  }
});

elements.automationLlmVsBotButton.addEventListener('click', async () => {
  try {
    await createConfiguredRoomSession({ player1: 'agent', player2: 'bot' }, getAutomationTiming());
    enterGameScreen();
    void startCurrentMatch();
    setStatus('LLM versus bot ready.');
    clearStatusAfterDelay();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to start LLM versus bot.');
  }
});

elements.restartButton.addEventListener('click', () => {
  handleResetRound();
  void startCurrentMatch();
  setStatus('Round reset.');
  clearStatusAfterDelay(1200);
});

elements.createRoomButton.addEventListener('click', async () => {
  try {
    const payload = await createConfiguredRoomSession({ player1: 'human', player2: 'human' }, 'turn-based');
    enterGameScreen();
    void startCurrentMatch();
    setStatus(`Room ${payload.room.roomCode} created.`);
    clearStatusAfterDelay();
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
    enterGameScreen();
    void startCurrentMatch();
    setStatus(`Joined room ${payload.room.roomCode} as ${payload.role}.`);
    clearStatusAfterDelay();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to join room.');
  }
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

elements.roomHistoryButton.addEventListener('click', async () => {
  if (!roomSession.active) {
    setApiLog('Room history is only available while connected to a room.');
    return;
  }

  try {
    const history = await fetchRoomHistory(roomSession.roomCode, 12);
    setApiLog([
      `history for ${history.roomCode}`,
      `backend: ${history.backend}`,
      `controllers: ${history.controllers.player1} vs ${history.controllers.player2}`,
      `agent timing: ${history.agentTiming ?? 'turn-based'}`,
      '',
      ...history.history.map((entry) => `r${entry.revision} ${entry.reason} ${entry.state} ${entry.winner ?? 'none'} ${entry.elapsedMs}ms`),
    ].join('\n'));
  } catch (error) {
    setApiLog(error instanceof Error ? error.message : 'Unable to load room history.');
  }
});

elements.apiDocsButton.addEventListener('click', async () => {
  try {
    const schema = await fetchApiSchema();
    setApiLog([
      schema.name,
      `room storage: ${schema.roomStorage.durableBackend}`,
      `skill: ${schema.skillUrl}`,
      '',
      'modes:',
      `- human-vs-human rooms: create room or join room`,
      `- play-vs-bot: ${schema.trainingModes.humanVsBot}`,
      `- play-vs-llm: ${schema.trainingModes.humanVsAgent}`,
      `- llm-vs-bot: ${schema.trainingModes.llmVsBot}`,
      `- llm-vs-llm: ${schema.trainingModes.llmVsLlm}`,
      `- realtime-agent timing: ${schema.roomOptions.agentTiming.join(', ')}`,
      '',
      ...schema.commands,
    ].join('\n'));
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
    if (target.disabled) {
      return;
    }
    const player = Number.parseInt(target.dataset.player ?? '1', 10);
    void handleDirectionalInput(player, target.dataset.direction ?? 'right');
  });
});

document.addEventListener('fullscreenchange', () => {
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
      if (!getLocallyControlledPlayers().has('player2')) {
        break;
      }
      event.preventDefault();
      void handleDirectionalInput(2, 'up');
      break;
    case 'ArrowDown':
      if (!getLocallyControlledPlayers().has('player2')) {
        break;
      }
      event.preventDefault();
      void handleDirectionalInput(2, 'down');
      break;
    case 'ArrowLeft':
      if (!getLocallyControlledPlayers().has('player2')) {
        break;
      }
      event.preventDefault();
      void handleDirectionalInput(2, 'left');
      break;
    case 'ArrowRight':
      if (!getLocallyControlledPlayers().has('player2')) {
        break;
      }
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
setConfigMode('settings');
showScreen('home');
updateLocalTextBoard();
setApiLog('Type help to inspect the text-command schema.');
syncLlmProviderInputs();
void loadLlmSettings().then((loaded) => {
  llmSettings = loaded;
  syncLlmProviderInputs();
  if (loaded.apiKey) {
    setLlmProviderStatus(`${getProviderDisplayName()} credentials loaded from encrypted local cache.`);
  }
}).catch(() => {
  setLlmProviderStatus('Unable to load provider credentials from local cache.');
});
window.setInterval(() => {
  if (!roomSession.active) {
    updateLocalTextBoard();
  }
}, 300);