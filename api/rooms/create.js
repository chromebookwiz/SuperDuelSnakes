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
      playerModes: body.playerModes,
      agentTiming: body.agentTiming,
      allowAutomationRooms: body.allowAutomationRooms === true,
    });
    const agentAccess = Object.fromEntries(
      Object.entries(created.room.controllers)
        .filter(([, controller]) => controller === 'agent')
        .map(([player, controller]) => [player, {
          player,
          controller,
          roomCode: created.room.roomCode,
          token: created.room.seats[player].token,
          agentTiming: created.room.agentTiming,
          skillUrl,
        }]),
    );

    const modeLabel = `${created.room.controllers.player1} vs ${created.room.controllers.player2}`;

    sendJson(res, 200, {
      room: serializeRoom(created.room),
      token: created.token,
      role: created.role,
      skillUrl,
      agentTiming: created.room.agentTiming,
      agentAccess: Object.keys(agentAccess).length > 0 ? agentAccess : null,
      note: created.room.durable
        ? `Room created in ${modeLabel} mode with ${created.room.agentTiming} agent timing and durable Upstash-backed storage.`
        : `Room created in ${modeLabel} mode with ${created.room.agentTiming} agent timing. Configure Upstash Redis env vars to make it durable on free-tier Vercel.`,
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Unable to create room.' });
  }
}