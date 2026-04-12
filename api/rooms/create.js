import { createRoom, serializeRoom } from '../_lib/room-store.js';
import { allowMethods, readJsonBody, sendJson } from '../_lib/response.js';

export default async function handler(req, res) {
  allowMethods(res, ['POST', 'OPTIONS']);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const skillUrl = '/skills/superduelsnakes-llm-playbook.md';
    const created = await createRoom(body.settings ?? {}, {
      opponent: body.opponent,
    });
    const agentAccess = created.room.opponent.kind === 'agent'
      ? {
          mode: 'human-vs-agent',
          player: 'player2',
          roomCode: created.room.roomCode,
          token: created.room.players.player2,
          skillUrl,
        }
      : created.room.opponent.kind === 'bot'
        ? {
            mode: 'llm-vs-bot',
            player: 'player1',
            roomCode: created.room.roomCode,
            token: created.token,
            skillUrl,
          }
        : null;

    sendJson(res, 200, {
      room: serializeRoom(created.room),
      token: created.token,
      role: created.role,
      skillUrl,
      agentAccess,
      note: created.room.durable
        ? `Room created with ${created.room.opponent.kind} opponent mode and durable Upstash-backed storage.`
        : `Room created with ${created.room.opponent.kind} opponent mode. Configure Upstash Redis env vars to make it durable on free-tier Vercel.`,
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Unable to create room.' });
  }
}