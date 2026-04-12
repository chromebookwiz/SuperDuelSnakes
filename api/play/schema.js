import { sendJson, allowMethods } from '../_lib/response.js';

export default async function handler(req, res) {
  allowMethods(res, ['GET', 'OPTIONS']);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  sendJson(res, 200, {
    name: 'SuperDuelSnakes Text and API Schema',
    version: 1,
    endpoints: {
      createMatch: 'POST /api/play/new',
      stepMatch: 'POST /api/play/step',
      createRoom: 'POST /api/rooms/create',
      joinRoom: 'POST /api/rooms/join',
      roomState: 'GET /api/rooms/state?roomCode=XXXXXX',
      roomCommand: 'POST /api/rooms/command',
      roomHistory: 'GET /api/rooms/history?roomCode=XXXXXX&limit=40',
    },
    roomStorage: {
      durableBackend: process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? 'upstash-redis' : 'memory',
      freeTierReady: true,
      requiredEnvForDurability: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
      concurrencyModel: 'short-lived room lock for serialized durable writes',
    },
    commands: [
      'start',
      'pause',
      'reset',
      'p1 up',
      'p1 down',
      'p1 left',
      'p1 right',
      'p2 up',
      'p2 down',
      'p2 left',
      'p2 right',
      'tick 250',
      'help',
    ],
    roomOptions: {
      opponent: ['human', 'bot'],
    },
    notes: [
      'Text and API flows return a machine-readable match snapshot and an ASCII board representation.',
      'Room play is server-relayed via API polling. It is not true direct WebRTC peer-to-peer.',
      'For durable free-tier deployment, set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from a free Upstash Redis database.',
      'Without those env vars, the app falls back to in-memory rooms for local development and zero-config previews.',
      'Bot rooms reserve player 2 for an API-driven opponent that chooses safe food-seeking turns.',
      'Replay history is available from GET /api/rooms/history and includes recent room frames with ASCII board snapshots.',
    ],
  });
}