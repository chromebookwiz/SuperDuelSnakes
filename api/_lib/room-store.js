import { advanceByTime, applyAction, chooseBotDirection, createMatch, getPublicMatch, parseTextCommand } from '../../src/shared/game-engine.js';

const ROOM_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_EVENT_HISTORY = 16;
const MAX_REPLAY_HISTORY = 80;
const LOCK_TTL_MS = 4000;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export async function createRoom(settings = {}, options = {}) {
  const backend = getBackend();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const roomCode = randomCode(6);
    const now = Date.now();
    const player1Token = randomCode(24);
    const room = {
      roomCode,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_TTL_MS,
      lastAdvancedAt: now,
      backend: backend.name,
      durable: backend.durable,
      revision: 1,
      players: {
        player1: player1Token,
        player2: options.opponent === 'bot' ? 'BOT_PLAYER2' : null,
      },
      opponent: {
        kind: options.opponent === 'bot' ? 'bot' : 'human',
        botPlayer: 'player2',
        botDifficulty: 'adaptive',
      },
      events: [createEvent('room-created', { actor: 'system', opponent: options.opponent ?? 'human' }, now)],
      history: [],
      match: createMatch(settings),
    };

    recordReplayFrame(room, 'room-created', now);

    const created = await backend.createRoom(roomCode, room);
    if (!created) {
      continue;
    }

    return {
      room,
      token: player1Token,
      role: 'player1',
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

    if (synced.opponent?.kind !== 'bot' && !synced.players.player2) {
      synced.players.player2 = randomCode(24);
      touchRoom(synced, now);
      pushEvent(synced, createEvent('player-joined', { actor: 'player2' }, now));
      recordReplayFrame(synced, 'player-joined', now);
      return {
        room: synced,
        token: synced.players.player2,
        role: 'player2',
      };
    }

    touchRoom(synced, now, { bumpRevision: true });
    pushEvent(synced, createEvent('spectator-joined', { actor: 'spectator' }, now));
    recordReplayFrame(synced, 'spectator-joined', now);
    return {
      room: synced,
      token: randomCode(24),
      role: 'spectator',
    };
  });
}

export async function getRoom(roomCode) {
  const backend = getBackend();
  return backend.getRoom(normalizeRoomCode(roomCode));
}

export function syncRoom(room) {
  const now = Date.now();
  const delta = now - room.lastAdvancedAt;
  if (delta > 0) {
    const wasRunning = room.match.state === 'running';
    advanceByTime(room.match, delta, {
      onBeforeTick(currentMatch) {
        planBotMove(room, currentMatch);
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
    if (!role) {
      return { error: 'Invalid room token.' };
    }

    const parsed = commandText ? parseTextCommand(commandText) : { actions: [action] };
    if (parsed.error) {
      return { error: parsed.error };
    }

    const actions = parsed.actions;
    if (!actions || actions.length === 0) {
      return { error: 'No valid actions were supplied.' };
    }

    for (const nextAction of actions) {
      if (nextAction.type === 'direction') {
        const effectivePlayer = nextAction.player ?? role;
        if (role === 'spectator') {
          return { error: 'Spectators cannot control room players.' };
        }
        if (effectivePlayer !== role) {
          return { error: `Token for ${role} cannot control ${effectivePlayer}.` };
        }
        applyAction(room.match, { ...nextAction, player: effectivePlayer });
      } else {
        applyAction(room.match, nextAction);
      }
    }

    if (room.opponent?.kind === 'bot') {
      planBotMove(room, room.match);
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
    opponent: room.opponent,
    events: Array.isArray(room.events) ? room.events.slice(-safeLimit) : [],
    history: Array.isArray(room.history) ? room.history.slice(-safeLimit) : [],
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
    players: {
      player1Ready: Boolean(room.players.player1),
      player2Ready: Boolean(room.players.player2),
    },
    opponent: room.opponent,
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
  if (token && token === room.players.player1) {
    return 'player1';
  }
  if (token && token === room.players.player2) {
    return 'player2';
  }
  return null;
}

function planBotMove(room, match) {
  if (room.opponent?.kind !== 'bot') {
    return;
  }
  if (match.state === 'gameover') {
    return;
  }

  const playerKey = room.opponent.botPlayer ?? 'player2';
  const direction = chooseBotDirection(match, playerKey);
  if (!direction) {
    return;
  }

  applyAction(match, { type: 'direction', player: playerKey, direction });
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