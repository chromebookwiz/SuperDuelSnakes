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
    const created = await createRoom(body.settings ?? {});
    sendJson(res, 200, {
      room: serializeRoom(created.room),
      token: created.token,
      role: created.role,
      note: created.room.durable
        ? 'Rooms are durable through Upstash Redis and API-relayed for free-tier Vercel compatibility.'
        : 'Rooms are API-relayed. Configure Upstash Redis env vars to make them durable on free-tier Vercel.',
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Unable to create room.' });
  }
}