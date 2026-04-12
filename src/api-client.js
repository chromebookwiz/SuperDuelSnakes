async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return payload;
}

export function createRoom(settings) {
  return requestJson('/api/rooms/create', {
    method: 'POST',
    body: JSON.stringify({ settings }),
  });
}

export function joinRoom(roomCode) {
  return requestJson('/api/rooms/join', {
    method: 'POST',
    body: JSON.stringify({ roomCode }),
  });
}

export function fetchRoomState(roomCode) {
  return requestJson(`/api/rooms/state?roomCode=${encodeURIComponent(roomCode)}`);
}

export function sendRoomCommand({ roomCode, token, action, commandText }) {
  return requestJson('/api/rooms/command', {
    method: 'POST',
    body: JSON.stringify({ roomCode, token, action, commandText }),
  });
}

export function fetchApiSchema() {
  return requestJson('/api/play/schema');
}