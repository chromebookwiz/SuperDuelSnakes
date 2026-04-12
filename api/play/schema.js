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
    notes: [
      'Text and API flows return a machine-readable match snapshot and an ASCII board representation.',
      'Room play is server-relayed via API polling. It is not true direct WebRTC peer-to-peer.',
      'The default room backend in this repository is in-memory, so production persistence depends on runtime instance stability.',
    ],
  });
}