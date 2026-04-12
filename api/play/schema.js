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
      roomTurn: 'GET /api/rooms/turn?roomCode=XXXXXX&token=ROOM_TOKEN',
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
      'stay',
      'p1 stay',
      'p2 stay',
      'help',
    ],
    roomOptions: {
      playerModes: {
        player1: ['human', 'bot', 'agent'],
        player2: ['human', 'bot', 'agent'],
      },
      agentTiming: ['turn-based', 'realtime'],
      defaults: {
        player1: 'human',
        player2: 'human',
        agentTiming: 'turn-based',
      },
    },
    skillUrl: '/skills/superduelsnakes-llm-playbook.md',
    trainingModes: {
      humanVsAgent: 'Create a room with playerModes { player1: human, player2: agent }.',
      llmVsBot: 'Create a room with playerModes { player1: agent, player2: bot }.',
      llmVsLlm: 'Create a room with playerModes { player1: agent, player2: agent }.',
      botVsBot: 'Create a room with playerModes { player1: bot, player2: bot }.',
      humanVsBot: 'Create a room with playerModes { player1: human, player2: bot } or { player1: bot, player2: human }.',
    },
    notes: [
      'Text and API flows return a machine-readable match snapshot and an ASCII board representation.',
      'Room play is server-relayed via API polling. It is not true direct WebRTC peer-to-peer.',
      'For durable free-tier deployment, set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from a free Upstash Redis database.',
      'Without those env vars, the app falls back to in-memory rooms for local development and zero-config previews.',
      'Each seat can independently be human, bot, or agent; the default room mode remains human vs human.',
      'Replay history is available from GET /api/rooms/history and includes recent room frames with ASCII board snapshots.',
      'Rooms with one or more agent seats return an agentAccess map containing the token for each API-controlled seat.',
      'Rooms with one or more agent seats use per-tick pacing: fetch /api/rooms/turn, choose a direction or stay, submit one response per pending agent seat, and the game advances exactly one tick.',
      'Set agentTiming to realtime to keep the tick clock constant for agent rooms. In that mode the LLM still responds one tick at a time, but late responses miss the current tick instead of stalling the room.',
    ],
  });
}