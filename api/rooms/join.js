import { joinRoom, serializeRoom } from '../_lib/room-store.js';
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
    const joined = await joinRoom(body.roomCode);
    if (!joined) {
      sendJson(res, 404, { error: 'Room not found.' });
      return;
    }
    sendJson(res, 200, {
      room: serializeRoom(joined.room),
      token: joined.token,
      role: joined.role,
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Unable to join room.' });
  }
}