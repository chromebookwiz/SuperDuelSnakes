import { BACKDROP_STYLES, DEFAULT_SETTINGS, GRID_STYLES, THEMES } from '../themes.js';

export const PLAYER_KEYS = ['player1', 'player2'];

export const DIRECTION_VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const DEFAULT_SCORE = {
  player1: 0,
  player2: 0,
  draws: 0,
  streakOwner: null,
  streakCount: 0,
  longestRoundMs: 0,
};

export function normalizeSettings(raw = {}) {
  const theme = THEMES[raw.theme] ? raw.theme : DEFAULT_SETTINGS.theme;
  const backdropStyle = BACKDROP_STYLES.some((item) => item.value === raw.backdropStyle)
    ? raw.backdropStyle
    : DEFAULT_SETTINGS.backdropStyle;
  const gridStyle = GRID_STYLES.some((item) => item.value === raw.gridStyle)
    ? raw.gridStyle
    : DEFAULT_SETTINGS.gridStyle;

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

export function createMatch(rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  const match = {
    settings,
    tickMs: 1000 / settings.speed,
    state: 'stopped',
    winner: null,
    roundCount: 0,
    elapsedMs: 0,
    accumulatorMs: 0,
    previousHeads: null,
    food: { x: 0, y: 0 },
    score: { ...DEFAULT_SCORE },
    snake1: null,
    snake2: null,
    updatedAt: Date.now(),
  };

  return resetRound(match, { preserveScore: true, preserveWinner: false });
}

export function cloneMatch(match) {
  return JSON.parse(JSON.stringify(match));
}

export function resetRound(match, { preserveWinner = false, preserveScore = true } = {}) {
  const settings = normalizeSettings(match.settings);
  const size = settings.cellCount;

  match.settings = settings;
  match.tickMs = 1000 / settings.speed;
  match.state = 'stopped';
  match.winner = preserveWinner ? match.winner : null;
  match.elapsedMs = 0;
  match.accumulatorMs = 0;
  match.previousHeads = null;
  if (!preserveScore) {
    match.score = { ...DEFAULT_SCORE };
  }

  match.snake1 = createSnake(
    [
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ],
    'right',
    'player1',
  );
  match.snake2 = createSnake(
    [
      { x: size - 3, y: size - 3 },
      { x: size - 2, y: size - 3 },
      { x: size - 1, y: size - 3 },
    ],
    'left',
    'player2',
  );
  match.food = randomOpenCell(match);
  match.updatedAt = Date.now();

  return match;
}

export function startMatch(match) {
  if (match.winner) {
    resetRound(match);
  }
  if (match.state !== 'running') {
    match.state = 'running';
  }
  match.updatedAt = Date.now();
  return match;
}

export function pauseMatch(match) {
  if (match.state === 'running') {
    match.state = 'paused';
  }
  match.updatedAt = Date.now();
  return match;
}

export function toggleMatch(match) {
  if (match.state === 'running') {
    return pauseMatch(match);
  }
  return startMatch(match);
}

export function queueDirection(match, playerKey, directionName) {
  const snake = playerKey === 'player1' ? match.snake1 : match.snake2;
  const nextDirection = DIRECTION_VECTORS[directionName];
  if (!snake || !nextDirection) {
    return match;
  }

  if (match.winner) {
    resetRound(match);
  }

  if (
    nextDirection.x === -snake.direction.x &&
    nextDirection.y === -snake.direction.y
  ) {
    return match;
  }

  snake.queuedDirectionName = directionName;
  snake.queuedDirection = { ...nextDirection };

  if (match.state === 'stopped') {
    startMatch(match);
  }

  match.updatedAt = Date.now();
  return match;
}

export function applyAction(match, action) {
  if (!action || typeof action !== 'object') {
    return match;
  }

  switch (action.type) {
    case 'start':
      return startMatch(match);
    case 'pause':
      return pauseMatch(match);
    case 'toggle':
      return toggleMatch(match);
    case 'reset':
      return resetRound(match, { preserveScore: true, preserveWinner: false });
    case 'direction':
      return queueDirection(match, action.player, action.direction);
    case 'advance':
      return advanceByTime(match, Number(action.deltaMs) || 0);
    default:
      return match;
  }
}

export function advanceByTime(match, deltaMs, hooks = {}) {
  const boundedDelta = clamp(Number(deltaMs) || 0, 0, 1000);
  if (boundedDelta <= 0 || match.state !== 'running') {
    return match;
  }

  match.elapsedMs += boundedDelta;
  match.accumulatorMs += boundedDelta;

  while (match.accumulatorMs >= match.tickMs) {
    hooks.onBeforeTick?.(match);
    stepMatch(match);
    match.accumulatorMs -= match.tickMs;
    if (match.state !== 'running') {
      match.accumulatorMs = 0;
      break;
    }
  }

  match.updatedAt = Date.now();
  return match;
}

export function parseTextCommand(commandText) {
  const trimmed = String(commandText || '').trim();
  if (!trimmed) {
    return { actions: [], help: false };
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === 'help') {
    return { actions: [], help: true };
  }
  if (normalized === 'start' || normalized === 'play') {
    return { actions: [{ type: 'start' }] };
  }
  if (normalized === 'pause') {
    return { actions: [{ type: 'pause' }] };
  }
  if (normalized === 'toggle') {
    return { actions: [{ type: 'toggle' }] };
  }
  if (normalized === 'reset') {
    return { actions: [{ type: 'reset' }] };
  }
  if (normalized === 'up' || normalized === 'down' || normalized === 'left' || normalized === 'right') {
    return { actions: [{ type: 'direction', player: 'player1', direction: normalized }] };
  }

  const parts = normalized.split(/\s+/);
  if (parts.length === 2 && isPlayerToken(parts[0]) && isDirectionToken(parts[1])) {
    return {
      actions: [{
        type: 'direction',
        player: normalizePlayer(parts[0]),
        direction: parts[1],
      }],
    };
  }

  if (parts.length === 3 && parts[0] === 'tick' && parts[1] === 'for') {
    return { actions: [{ type: 'advance', deltaMs: Number(parts[2]) || 0 }] };
  }
  if (parts.length === 2 && parts[0] === 'tick') {
    return { actions: [{ type: 'advance', deltaMs: Number(parts[1]) || 0 }] };
  }

  return { actions: [], error: `Unrecognized command: ${trimmed}` };
}

export function getPublicMatch(match) {
  const snapshot = cloneMatch(match);
  return {
    ...snapshot,
    boardText: renderAsciiBoard(snapshot),
    legalActions: {
      player1: getLegalDirections(snapshot.snake1),
      player2: getLegalDirections(snapshot.snake2),
    },
    summary: {
      state: snapshot.state,
      winner: snapshot.winner,
      roundCount: snapshot.roundCount,
      elapsedMs: snapshot.elapsedMs,
    },
  };
}

export function renderAsciiBoard(match) {
  const size = match.settings.cellCount;
  const board = Array.from({ length: size }, () => Array.from({ length: size }, () => '.'));

  match.snake1.body.forEach((cell, index) => {
    if (isCellInBounds(cell, size)) {
      board[cell.y][cell.x] = index === 0 ? 'A' : 'a';
    }
  });
  match.snake2.body.forEach((cell, index) => {
    if (isCellInBounds(cell, size)) {
      board[cell.y][cell.x] = index === 0 ? 'B' : 'b';
    }
  });

  if (isCellInBounds(match.food, size)) {
    board[match.food.y][match.food.x] = '*';
  }

  const header = [
    `state=${match.state}`,
    `winner=${match.winner ?? 'none'}`,
    `round=${match.roundCount}`,
    `elapsedMs=${Math.round(match.elapsedMs)}`,
    `score=${match.score.player1}-${match.score.player2}-${match.score.draws}`,
  ].join(' ');

  return [header, ...board.map((row) => row.join(' '))].join('\n');
}

export function chooseBotDirection(match, playerKey = 'player2') {
  const snake = playerKey === 'player1' ? match.snake1 : match.snake2;
  const opponent = playerKey === 'player1' ? match.snake2 : match.snake1;
  if (!snake || !opponent) {
    return null;
  }

  const legalDirections = getLegalDirections(snake);
  const candidates = legalDirections.map((direction) => {
    const vector = DIRECTION_VECTORS[direction];
    const nextHead = getNextHead(snake.body[0], vector, match.settings);
    const immediateDeath = isDangerCell(match, nextHead, playerKey);
    const foodDistance = manhattanDistance(nextHead, match.food);
    const centerBias = manhattanDistance(nextHead, {
      x: Math.floor(match.settings.cellCount / 2),
      y: Math.floor(match.settings.cellCount / 2),
    });
    const pressure = manhattanDistance(nextHead, opponent.body[0]);

    return {
      direction,
      score: [
        immediateDeath ? -1000 : 0,
        immediateDeath ? 0 : 100 - foodDistance * 4,
        immediateDeath ? 0 : pressure * 1.5,
        immediateDeath ? 0 : -centerBias,
      ].reduce((sum, value) => sum + value, 0),
    };
  });

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.direction ?? null;
}

function stepMatch(match) {
  match.previousHeads = {
    snake1: { ...match.snake1.body[0] },
    snake2: { ...match.snake2.body[0] },
  };

  match.snake1 = advanceSnake(match.snake1, match);
  match.snake2 = advanceSnake(match.snake2, match);

  if (sameCell(match.snake1.body[0], match.food) || sameCell(match.snake2.body[0], match.food)) {
    match.food = randomOpenCell(match);
  }

  const winner = resolveWinner(match);
  if (winner) {
    completeRound(match, winner);
  }

  return match;
}

function completeRound(match, winner) {
  match.winner = winner;
  match.roundCount += 1;
  match.score.longestRoundMs = Math.max(match.score.longestRoundMs, match.elapsedMs);

  if (winner === 'Player 1') {
    match.score.player1 += 1;
    if (match.score.streakOwner === 'Player 1') {
      match.score.streakCount += 1;
    } else {
      match.score.streakOwner = 'Player 1';
      match.score.streakCount = 1;
    }
  } else if (winner === 'Player 2') {
    match.score.player2 += 1;
    if (match.score.streakOwner === 'Player 2') {
      match.score.streakCount += 1;
    } else {
      match.score.streakOwner = 'Player 2';
      match.score.streakCount = 1;
    }
  } else {
    match.score.draws += 1;
    match.score.streakOwner = null;
    match.score.streakCount = 0;
  }

  match.state = 'gameover';
  match.accumulatorMs = 0;
}

function advanceSnake(snake, match) {
  const direction = snake.queuedDirection;
  let nextHead = {
    x: snake.body[0].x + direction.x,
    y: snake.body[0].y + direction.y,
  };

  if (match.settings.wrapWalls) {
    nextHead = {
      x: (nextHead.x + match.settings.cellCount) % match.settings.cellCount,
      y: (nextHead.y + match.settings.cellCount) % match.settings.cellCount,
    };
  }

  const willEat = sameCell(nextHead, match.food);
  const nextBody = [nextHead, ...snake.body.map(cloneCell)];
  if (!(snake.grow || willEat)) {
    nextBody.pop();
  }

  return {
    ...snake,
    body: nextBody,
    direction: { ...direction },
    directionName: snake.queuedDirectionName,
    queuedDirection: { ...direction },
    queuedDirectionName: snake.queuedDirectionName,
    grow: false,
    trail: [cloneCell(snake.body[0]), ...snake.trail.map(cloneCell)].slice(0, 10),
  };
}

function resolveWinner(match) {
  const out1 = !match.settings.wrapWalls && isOutOfBounds(match.snake1.body[0], match.settings.cellCount);
  const out2 = !match.settings.wrapWalls && isOutOfBounds(match.snake2.body[0], match.settings.cellCount);

  if (out1 && out2) {
    return 'Draw';
  }
  if (out1) {
    return 'Player 2';
  }
  if (out2) {
    return 'Player 1';
  }

  const snake1NoHead = match.snake1.body.slice(1);
  const snake2NoHead = match.snake2.body.slice(1);
  const snake1Hits = containsCell(snake1NoHead, match.snake1.body[0]) || containsCell(snake2NoHead, match.snake1.body[0]);
  const snake2Hits = containsCell(snake2NoHead, match.snake2.body[0]) || containsCell(snake1NoHead, match.snake2.body[0]);
  const headOn = sameCell(match.snake1.body[0], match.snake2.body[0]);
  const headSwap = Boolean(
    match.previousHeads &&
      sameCell(match.snake1.body[0], match.previousHeads.snake2) &&
      sameCell(match.snake2.body[0], match.previousHeads.snake1),
  );

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

function randomOpenCell(match) {
  const occupied = new Set([...match.snake1.body, ...match.snake2.body].map((cell) => `${cell.x}:${cell.y}`));
  let candidate = null;
  do {
    candidate = {
      x: Math.floor(Math.random() * match.settings.cellCount),
      y: Math.floor(Math.random() * match.settings.cellCount),
    };
  } while (occupied.has(`${candidate.x}:${candidate.y}`));
  return candidate;
}

function createSnake(body, directionName, id) {
  const direction = DIRECTION_VECTORS[directionName];
  return {
    id,
    body: body.map(cloneCell),
    directionName,
    queuedDirectionName: directionName,
    direction: { ...direction },
    queuedDirection: { ...direction },
    grow: false,
    trail: [],
  };
}

function getLegalDirections(snake) {
  return Object.entries(DIRECTION_VECTORS)
    .filter(([, vector]) => !(vector.x === -snake.direction.x && vector.y === -snake.direction.y))
    .map(([name]) => name);
}

function isPlayerToken(value) {
  return value === 'p1' || value === 'p2' || value === 'player1' || value === 'player2';
}

function isDirectionToken(value) {
  return value in DIRECTION_VECTORS;
}

function normalizePlayer(value) {
  return value === 'p2' ? 'player2' : value === 'player1' ? 'player1' : value === 'player2' ? 'player2' : 'player1';
}

function cloneCell(cell) {
  return { x: cell.x, y: cell.y };
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

function isCellInBounds(cell, cellCount) {
  return cell.x >= 0 && cell.y >= 0 && cell.x < cellCount && cell.y < cellCount;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getNextHead(head, vector, settings) {
  const candidate = {
    x: head.x + vector.x,
    y: head.y + vector.y,
  };

  if (!settings.wrapWalls) {
    return candidate;
  }

  return {
    x: (candidate.x + settings.cellCount) % settings.cellCount,
    y: (candidate.y + settings.cellCount) % settings.cellCount,
  };
}

function isDangerCell(match, cell, playerKey) {
  if (!match.settings.wrapWalls && isOutOfBounds(cell, match.settings.cellCount)) {
    return true;
  }

  const ownSnake = playerKey === 'player1' ? match.snake1 : match.snake2;
  const otherSnake = playerKey === 'player1' ? match.snake2 : match.snake1;
  const ownBody = ownSnake.body.slice(0, -1);
  const otherBody = otherSnake.body;
  return containsCell(ownBody, cell) || containsCell(otherBody, cell);
}

function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}