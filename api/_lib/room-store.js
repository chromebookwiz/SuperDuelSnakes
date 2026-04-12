import { advanceByTime, applyAction, createMatch, getPublicMatch, parseTextCommand } from '../../src/shared/game-engine.js';

const ROOM_TTL_MS = 1000 * 60 * 60 * 6;

function getStore() {
  if (!globalThis.__SUPER_DUEL_SNAKES_ROOMS__) {
    globalThis.__SUPER_DUEL_SNAKES_ROOMS__ = new Map();
  }
  return globalThis.__SUPER_DUEL_SNAKES_ROOMS__;
}

export function createRoom(settings = {}) {
  const store = getStore();
  cleanupExpiredRooms(store);

  let roomCode = '';
  do {
    roomCode = randomCode(6);
  } while (store.has(roomCode));

  const now = Date.now();
  const player1Token = randomCode(24);
  const room = {
    roomCode,
    createdAt: now,
    updatedAt: now,
    lastAdvancedAt: now,
    backend: 'memory',
    players: {
      player1: player1Token,
      player2: null,
    },
    match: createMatch(settings),
  };

  store.set(roomCode, room);
  return {
    room,
    token: player1Token,
    role: 'player1',
  };
}

export function joinRoom(roomCode) {
  const room = getRoom(roomCode);
  if (!room) {
    return null;
  }

  const synced = syncRoom(room);
  if (!synced.players.player2) {
    synced.players.player2 = randomCode(24);
    synced.updatedAt = Date.now();
    return {
      room: synced,
      token: synced.players.player2,
      role: 'player2',
    };
  }

  return {
    room: synced,
    token: randomCode(24),
    role: 'spectator',
  };
}

export function getRoom(roomCode) {
  const room = getStore().get(String(roomCode || '').toUpperCase());
  if (!room) {
    return null;
  }
  return room;
}

export function syncRoom(room) {
  const now = Date.now();
  const delta = now - room.lastAdvancedAt;
  if (delta > 0) {
    advanceByTime(room.match, delta);
    room.lastAdvancedAt = now;
    room.updatedAt = now;
  }
  return room;
}

export function getRoomSnapshot(roomCode) {
  const room = getRoom(roomCode);
  if (!room) {
    return null;
  }
  return syncRoom(room);
}

export function applyRoomCommand({ roomCode, token, action, commandText }) {
  const room = getRoom(roomCode);
  if (!room) {
    return { error: 'Room not found.' };
  }

  syncRoom(room);
  const role = resolveRole(room, token);
  if (!role) {
    return { error: 'Invalid room token.' };
  }

  const actions = commandText ? parseTextCommand(commandText).actions : [action];
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

  room.updatedAt = Date.now();
  room.lastAdvancedAt = Date.now();
  return { room, role };
}

export function serializeRoom(room) {
  const publicMatch = getPublicMatch(room.match);
  return {
    roomCode: room.roomCode,
    backend: room.backend,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    players: {
      player1Ready: Boolean(room.players.player1),
      player2Ready: Boolean(room.players.player2),
    },
    match: publicMatch,
  };
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

function cleanupExpiredRooms(store) {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [roomCode, room] of store.entries()) {
    if (room.updatedAt < cutoff) {
      store.delete(roomCode);
    }
  }
}

function randomCode(length) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}