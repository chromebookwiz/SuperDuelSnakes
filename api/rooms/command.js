import { applyRoomCommand, serializeRoom } from '../_lib/room-store.js';
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
    const result = applyRoomCommand({
      roomCode: body.roomCode,
      token: body.token,
      action: body.action,
      commandText: body.commandText,
    });

    if (result.error) {
      sendJson(res, 400, { error: result.error });
      return;
    }

    sendJson(res, 200, {
      room: serializeRoom(result.room),
      role: result.role,
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Unable to apply room command.' });
  }
}