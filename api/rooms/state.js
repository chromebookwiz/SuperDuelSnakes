import { getRoomSnapshot, serializeRoom } from '../_lib/room-store.js';
import { allowMethods, sendJson } from '../_lib/response.js';

export default async function handler(req, res) {
  allowMethods(res, ['GET', 'OPTIONS']);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }

  const roomCode = req.query?.roomCode;
  const room = await getRoomSnapshot(roomCode);
  if (!room) {
    sendJson(res, 404, { error: 'Room not found.' });
    return;
  }

  sendJson(res, 200, {
    room: serializeRoom(room),
  });
}