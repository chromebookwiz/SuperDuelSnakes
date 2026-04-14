import { advanceByTime, advanceOneTick, applyAction, chooseBotDirection, createMatch, getPublicMatch, parseTextCommand } from '../../src/shared/game-engine.js';

const ROOM_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_EVENT_HISTORY = 16;
const MAX_REPLAY_HISTORY = 80;
const LOCK_TTL_MS = 4000;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const PLAYER_KEYS = ['player1', 'player2'];
const CONTROLLER_VALUES = ['human', 'bot', 'agent'];
const AGENT_TIMING_VALUES = ['turn-based', 'realtime'];

export async function createRoom(settings = {}, options = {}) {
  const backend = getBackend();
  const controllers = normalizeControllers(options);
  const agentTiming = hasAgentControllers(controllers) ? normalizeAgentTiming(options.agentTiming) : 'turn-based';

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const roomCode = randomCode(6);
    const now = Date.now();
    const seats = createSeats(controllers);
    const owner = claimCreatorSeat(seats);
    const room = {
      roomCode,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_TTL_MS,
      lastAdvancedAt: now,
      backend: backend.name,
      durable: backend.durable,
      revision: 1,
      controllers,
      agentTiming,
      seats,
      turn: createTurnState(controllers, agentTiming, now),
      events: [createEvent('room-created', { actor: 'system', controllers, agentTiming }, now)],
      history: [],
      match: createMatch(settings),
    };

    initializeRoomState(room);
    recordReplayFrame(room, 'room-created', now);

    const created = await backend.createRoom(roomCode, room);
    if (!created) {
      continue;
    }

    return {
      room,
      token: owner.token,
      role: owner.role,
    };
  }

  throw new Error('Unable to allocate a unique room code.');
}

export async function joinRoom(roomCode) {
  return withRoomMutation(normalizeRoomCode(roomCode), async (room) => {
    if (!room) {
      return null;
    }

    const synced = syncRoom(room);
    const now = Date.now();
    const nextHumanSeat = PLAYER_KEYS.find((playerKey) => {
      const seat = synced.seats[playerKey];
      return seat.controller === 'human' && !seat.claimed;
    });

    if (nextHumanSeat) {
      const token = randomCode(24);
      synced.seats[nextHumanSeat].token = token;
      synced.seats[nextHumanSeat].claimed = true;
      touchRoom(synced, now);
      pushEvent(synced, createEvent('player-joined', { actor: nextHumanSeat }, now));
      recordReplayFrame(synced, 'player-joined', now);
      return {
        room: synced,
        token,
        role: nextHumanSeat,
      };
    }

    touchRoom(synced, now, { bumpRevision: true });
    pushEvent(synced, createEvent('spectator-joined', { actor: 'spectator' }, now));
    recordReplayFrame(synced, 'spectator-joined', now);
    return {
      room: synced,
      token: null,
      role: 'spectator',
    };
  });
}

export async function getRoom(roomCode) {
  const backend = getBackend();
  return backend.getRoom(normalizeRoomCode(roomCode));
}

export function syncRoom(room) {
  if (room.turn.mode === 'per-tick') {
    return room;
  }

  if (room.turn.mode === 'realtime-agent') {
    return syncRealtimeAgentRoom(room);
  }

  const now = Date.now();
  const delta = now - room.lastAdvancedAt;
  if (delta > 0) {
    const wasRunning = room.match.state === 'running';
    advanceByTime(room.match, delta, {
      onBeforeTick(currentMatch) {
        planAllBots(room, currentMatch);
      },
    });
    touchRoom(room, now, { bumpRevision: wasRunning });
    if (wasRunning) {
      recordReplayFrame(room, 'tick-sync', now);
    }
  }
  return room;
}

export async function getRoomSnapshot(roomCode) {
  return withRoomMutation(normalizeRoomCode(roomCode), async (room) => {
    if (!room) {
      return null;
    }
    return syncRoom(room);
  });
}

export async function applyRoomCommand({ roomCode, token, action, commandText }) {
  return withRoomMutation(normalizeRoomCode(roomCode), async (room) => {
    if (!room) {
      return { error: 'Room not found.' };
    }

    syncRoom(room);
    const role = resolveRole(room, token);
    const parsed = commandText ? parseTextCommand(commandText) : { actions: [action] };
    if (parsed.error) {
      return { error: parsed.error };
    }

    const actions = parsed.actions;
    if (!actions || actions.length === 0) {
      return { error: 'No valid actions were supplied.' };
    }

    const mode = room.turn.mode;
    const tracksAgentResponses = mode === 'per-tick' || mode === 'realtime-agent';
    for (const nextAction of actions) {
      const effectivePlayer = nextAction.player ?? role;
      if (nextAction.type === 'direction' || nextAction.type === 'stay' || nextAction.type === 'noop') {
        const authorizationError = authorizeSeatAction(room, role, effectivePlayer, nextAction.type, mode);
        if (authorizationError) {
          return { error: authorizationError };
        }
      } else if (nextAction.type === 'start' || nextAction.type === 'pause' || nextAction.type === 'reset' || nextAction.type === 'toggle') {
        if (role === 'spectator' && !isBotOnlyRoom(room)) {
          return { error: 'Spectators cannot control this room.' };
        }
      }

      if (nextAction.type === 'direction') {
        applyAction(room.match, { ...nextAction, player: effectivePlayer });
        if (tracksAgentResponses && room.controllers[effectivePlayer] === 'agent') {
          room.turn.responses[effectivePlayer] = true;
        }
      } else if (nextAction.type === 'stay' || nextAction.type === 'noop') {
        if (tracksAgentResponses && room.controllers[effectivePlayer] === 'agent') {
          room.turn.responses[effectivePlayer] = true;
        }
      } else {
        applyAction(room.match, nextAction);
      }
    }

    if (mode === 'per-tick') {
      if (canResolveTick(room)) {
        advanceOneTick(room.match, {
          onBeforeTick(currentMatch) {
            planAllBots(room, currentMatch);
          },
        });
        advanceTurn(room);
        recordReplayFrame(room, 'tick-response', room.turn.pendingSince);
      }
    }

    const now = Date.now();
    touchRoom(room, now);
    pushEvent(room, createEvent('command', {
      actor: role,
      actionTypes: actions.map((nextAction) => nextAction.type),
      commandText: commandText ?? null,
    }, now));
    recordReplayFrame(room, 'command', now);
    return { room, role };
  });
}

export async function getRoomHistory(roomCode, limit = 40) {
  const room = await getRoomSnapshot(roomCode);
  if (!room) {
    return null;
  }

  const safeLimit = clampHistoryLimit(limit);
  return {
    roomCode: room.roomCode,
    revision: room.revision,
    backend: room.backend,
    durable: Boolean(room.durable),
    controllers: room.controllers,
    agentTiming: room.agentTiming,
    events: Array.isArray(room.events) ? room.events.slice(-safeLimit) : [],
    history: Array.isArray(room.history) ? room.history.slice(-safeLimit) : [],
  };
}

export async function getRoomTurn(roomCode, token) {
  const room = await getRoomSnapshot(roomCode);
  if (!room) {
    return null;
  }

  const role = resolveRole(room, token);
  const publicMatch = getPublicMatch(room.match);
  const pendingPlayers = getPendingPlayers(room);
  return {
    roomCode: room.roomCode,
    revision: room.revision,
    backend: room.backend,
    durable: Boolean(room.durable),
    role,
    controllers: room.controllers,
    agentTiming: room.agentTiming,
    turn: {
      mode: room.turn.mode,
      tickNumber: room.turn.tickNumber,
      pendingPlayers,
      pendingSince: room.turn.pendingSince,
      deadlineAt: room.turn.mode === 'realtime-agent' && room.turn.pendingSince
        ? room.turn.pendingSince + room.match.tickMs
        : null,
      timeRemainingMs: room.turn.mode === 'realtime-agent' && room.turn.pendingSince
        ? Math.max(0, room.turn.pendingSince + room.match.tickMs - Date.now())
        : null,
      readyForInput: Boolean(
        role &&
        pendingPlayers.includes(role) &&
        !room.turn.responses[role] &&
        room.match.state === 'running'
      ),
      allowStay: true,
    },
    observation: {
      boardText: publicMatch.boardText,
      legalActions: publicMatch.legalActions,
      summary: publicMatch.summary,
      events: Array.isArray(room.events) ? room.events.slice(-6) : [],
    },
  };
}

export function serializeRoom(room) {
  const publicMatch = getPublicMatch(room.match);
  return {
    roomCode: room.roomCode,
    backend: room.backend,
    durable: Boolean(room.durable),
    revision: room.revision,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    expiresAt: room.expiresAt,
    controllers: room.controllers,
    agentTiming: room.agentTiming,
    players: {
      player1Ready: isSeatActive(room.seats.player1),
      player2Ready: isSeatActive(room.seats.player2),
    },
    turn: {
      mode: room.turn.mode,
      tickNumber: room.turn.tickNumber,
      pendingPlayers: getPendingPlayers(room),
      pendingSince: room.turn.pendingSince,
    },
    events: Array.isArray(room.events) ? room.events : [],
    match: publicMatch,
  };
}

function getBackend() {
  if (REDIS_URL && REDIS_TOKEN) {
    return {
      name: 'upstash-redis',
      durable: true,
      createRoom: createRedisRoom,
      getRoom: getRedisRoom,
      saveRoom: saveRedisRoom,
    };
  }

  return {
    name: 'memory',
    durable: false,
    createRoom: createMemoryRoom,
    getRoom: getMemoryRoom,
    saveRoom: saveMemoryRoom,
  };
}

function createSeats(controllers) {
  return Object.fromEntries(PLAYER_KEYS.map((playerKey) => {
    const controller = controllers[playerKey];
    if (controller === 'bot') {
      return [playerKey, { controller, token: null, claimed: true }];
    }
    if (controller === 'agent') {
      return [playerKey, { controller, token: randomCode(24), claimed: true }];
    }
    return [playerKey, { controller, token: null, claimed: false }];
  }));
}

function claimCreatorSeat(seats) {
  for (const playerKey of PLAYER_KEYS) {
    const seat = seats[playerKey];
    if (seat.controller === 'human' && !seat.claimed) {
      seat.token = randomCode(24);
      seat.claimed = true;
      return { role: playerKey, token: seat.token };
    }
  }
  return { role: 'spectator', token: null };
}

function initializeRoomState(room) {
  if (room.turn.mode === 'per-tick' || isBotOnlyRoom(room)) {
    applyAction(room.match, { type: 'start' });
    return;
  }

  if (room.turn.mode === 'realtime-agent') {
    applyAction(room.match, { type: 'start' });
  }
}

function createTurnState(controllers, agentTiming, now) {
  const pendingAgents = PLAYER_KEYS.filter((playerKey) => controllers[playerKey] === 'agent');
  if (pendingAgents.length === 0) {
    return {
      mode: 'realtime',
      tickNumber: 0,
      pendingSince: null,
      responses: {},
    };
  }

  if (agentTiming === 'realtime') {
    return {
      mode: 'realtime-agent',
      tickNumber: 0,
      pendingSince: now,
      responses: {},
    };
  }

  return {
    mode: 'per-tick',
    tickNumber: 0,
    pendingSince: now,
    responses: {},
  };
}

function getPendingPlayers(room) {
  if (room.turn.mode !== 'per-tick' && room.turn.mode !== 'realtime-agent') {
    return [];
  }
  return PLAYER_KEYS.filter((playerKey) => room.controllers[playerKey] === 'agent');
}

function authorizeSeatAction(room, role, effectivePlayer, actionType, mode) {
  if (!effectivePlayer || !PLAYER_KEYS.includes(effectivePlayer)) {
    return 'A valid player must be supplied.';
  }

  const controller = room.controllers[effectivePlayer];
  if (controller === 'bot') {
    return `${effectivePlayer} is bot-controlled.`;
  }
  if (role !== effectivePlayer) {
    return `Token for ${role ?? 'spectator'} cannot control ${effectivePlayer}.`;
  }
  if ((mode === 'per-tick' || mode === 'realtime-agent') && controller === 'agent' && room.turn.responses[effectivePlayer]) {
    return `${effectivePlayer} has already responded for this tick.`;
  }
  if (mode === 'per-tick' && controller !== 'agent' && actionType !== 'direction') {
    return `${effectivePlayer} must provide a direction update through local controls.`;
  }
  return null;
}

function canResolveTick(room) {
  return getPendingPlayers(room).every((playerKey) => room.turn.responses[playerKey]);
}

function advanceTurn(room, timestamp = Date.now()) {
  room.turn.tickNumber += 1;
  room.turn.pendingSince = timestamp;
  room.turn.responses = {};
}

function syncRealtimeAgentRoom(room) {
  const now = Date.now();
  const delta = now - room.lastAdvancedAt;
  if (delta <= 0) {
    return room;
  }

  const wasRunning = room.match.state === 'running';
  const previousTickNumber = room.turn.tickNumber;
  if (wasRunning) {
    advanceByTime(room.match, delta, {
      onBeforeTick(currentMatch) {
        planAllBots(room, currentMatch);
      },
      onAfterTick() {
        advanceTurn(room);
      },
    });
  }

  touchRoom(room, now, { bumpRevision: wasRunning });
  if (room.turn.tickNumber !== previousTickNumber) {
    recordReplayFrame(room, 'tick-sync', now);
  }
  return room;
}

function isBotOnlyRoom(room) {
  return PLAYER_KEYS.every((playerKey) => room.controllers[playerKey] === 'bot');
}

function isSeatActive(seat) {
  return seat.controller === 'bot' || seat.claimed;
}

function getMemoryStore() {
  if (!globalThis.__SUPER_DUEL_SNAKES_ROOMS__) {
    globalThis.__SUPER_DUEL_SNAKES_ROOMS__ = new Map();
  }
  return globalThis.__SUPER_DUEL_SNAKES_ROOMS__;
}

async function createMemoryRoom(roomCode, room) {
  const store = getMemoryStore();
  cleanupExpiredRooms(store);
  if (store.has(roomCode)) {
    return false;
  }
  store.set(roomCode, structuredClone(room));
  return true;
}

async function getMemoryRoom(roomCode) {
  cleanupExpiredRooms(getMemoryStore());
  const room = getMemoryStore().get(roomCode);
  return room ? structuredClone(room) : null;
}

async function saveMemoryRoom(room) {
  cleanupExpiredRooms(getMemoryStore());
  getMemoryStore().set(room.roomCode, structuredClone(room));
  return room;
}

async function createRedisRoom(roomCode, room) {
  const key = getRedisKey(roomCode);
  const payload = JSON.stringify(room);
  const response = await executeRedisCommand(['SET', key, payload, 'NX', 'PX', String(ROOM_TTL_MS)]);
  return response.result === 'OK';
}

async function getRedisRoom(roomCode) {
  if (!roomCode) {
    return null;
  }
  const response = await executeRedisCommand(['GET', getRedisKey(roomCode)]);
  if (!response.result) {
    return null;
  }
  return JSON.parse(response.result);
}

async function saveRedisRoom(room) {
  const payload = JSON.stringify(room);
  await executeRedisCommand(['SET', getRedisKey(room.roomCode), payload, 'PX', String(ROOM_TTL_MS)]);
  return room;
}

async function withRoomMutation(roomCode, mutator) {
  const backend = getBackend();
  if (!roomCode) {
    return null;
  }

  if (backend.name !== 'upstash-redis') {
    const room = await backend.getRoom(roomCode);
    const result = await mutator(room);
    return persistMutationResult(backend, result);
  }

  return withRedisLock(roomCode, async () => {
    const room = await backend.getRoom(roomCode);
    const result = await mutator(room);
    return persistMutationResult(backend, result);
  });
}

async function persistMutationResult(backend, result) {
  if (result?.room) {
    await backend.saveRoom(result.room);
    return result;
  }
  if (result && result.roomCode) {
    await backend.saveRoom(result);
  }
  return result;
}

async function withRedisLock(roomCode, callback) {
  const token = randomCode(12);
  const lockKey = `${getRedisKey(roomCode)}:lock`;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const locked = await executeRedisCommand(['SET', lockKey, token, 'NX', 'PX', String(LOCK_TTL_MS)]);
    if (locked.result === 'OK') {
      try {
        return await callback();
      } finally {
        const current = await executeRedisCommand(['GET', lockKey]);
        if (current.result === token) {
          await executeRedisCommand(['DEL', lockKey]);
        }
      }
    }
    await delay(40 + attempt * 20);
  }

  throw new Error('Room is busy. Please retry.');
}

async function executeRedisCommand(command) {
  const response = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || 'Redis request failed.');
  }
  return payload;
}

function getRedisKey(roomCode) {
  return `superduelsnakes:room:${roomCode}`;
}

function resolveRole(room, token) {
  if (!token) {
    return 'spectator';
  }
  return PLAYER_KEYS.find((playerKey) => room.seats[playerKey].token === token) ?? 'spectator';
}

function planAllBots(room, match) {
  for (const playerKey of PLAYER_KEYS) {
    if (room.controllers[playerKey] !== 'bot') {
      continue;
    }
    if (match.state === 'gameover') {
      continue;
    }
    const direction = chooseBotDirection(match, playerKey);
    if (!direction) {
      continue;
    }
    applyAction(match, { type: 'direction', player: playerKey, direction });
  }
}

function touchRoom(room, now, { bumpRevision = true } = {}) {
  room.updatedAt = now;
  room.lastAdvancedAt = now;
  room.expiresAt = now + ROOM_TTL_MS;
  if (bumpRevision) {
    room.revision = Number(room.revision || 0) + 1;
  } else if (!Number.isFinite(room.revision)) {
    room.revision = 1;
  }
}

function pushEvent(room, event) {
  const nextEvents = Array.isArray(room.events) ? room.events.slice(-MAX_EVENT_HISTORY + 1) : [];
  nextEvents.push(event);
  room.events = nextEvents;
}

function recordReplayFrame(room, reason, timestamp) {
  const publicMatch = getPublicMatch(room.match);
  const nextHistory = Array.isArray(room.history) ? room.history.slice(-MAX_REPLAY_HISTORY + 1) : [];
  nextHistory.push({
    revision: room.revision,
    timestamp,
    reason,
    state: publicMatch.state,
    winner: publicMatch.winner,
    elapsedMs: publicMatch.elapsedMs,
    boardText: publicMatch.boardText,
  });
  room.history = nextHistory;
}

function createEvent(type, details, timestamp) {
  return {
    type,
    timestamp,
    details,
  };
}

function cleanupExpiredRooms(store) {
  const cutoff = Date.now();
  for (const [roomCode, room] of store.entries()) {
    if ((room.expiresAt ?? room.updatedAt ?? 0) < cutoff) {
      store.delete(roomCode);
    }
  }
}

function normalizeRoomCode(roomCode) {
  return String(roomCode || '').trim().toUpperCase();
}

function normalizeControllers(options) {
  if (options.playerModes && typeof options.playerModes === 'object') {
    const controllers = {
      player1: normalizeController(options.playerModes.player1),
      player2: normalizeController(options.playerModes.player2),
    };

    if (!options.allowAutomationRooms && (controllers.player1 !== 'human' || controllers.player2 !== 'human')) {
      throw new Error('Rooms created from the main room flow must be human versus human. Use automation modes for bot and LLM matches.');
    }

    return controllers;
  }

  if (options.opponent === 'agent') {
    return { player1: 'human', player2: 'agent' };
  }
  if (options.opponent === 'bot') {
    return { player1: 'human', player2: 'bot' };
  }
  return { player1: 'human', player2: 'human' };
}

function normalizeAgentTiming(value) {
  return AGENT_TIMING_VALUES.includes(value) ? value : 'turn-based';
}

function hasAgentControllers(controllers) {
  return PLAYER_KEYS.some((playerKey) => controllers[playerKey] === 'agent');
}

function normalizeController(value) {
  return CONTROLLER_VALUES.includes(value) ? value : 'human';
}

function clampHistoryLimit(limit) {
  return Math.min(Math.max(Number(limit) || 20, 1), MAX_REPLAY_HISTORY);
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function randomCode(length) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}
