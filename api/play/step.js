import { advanceByTime, applyAction, cloneMatch, getPublicMatch, parseTextCommand } from '../../src/shared/game-engine.js';
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
    if (!body.match) {
      sendJson(res, 400, { error: 'Request body must include a match snapshot.' });
      return;
    }

    const match = cloneMatch(body.match);
    const commandResult = body.commandText ? parseTextCommand(body.commandText) : { actions: Array.isArray(body.actions) ? body.actions : [] };
    if (commandResult.error) {
      sendJson(res, 400, { error: commandResult.error });
      return;
    }

    for (const action of commandResult.actions) {
      applyAction(match, action);
    }

    if (Number(body.advanceMs) > 0) {
      advanceByTime(match, Number(body.advanceMs));
    }

    sendJson(res, 200, {
      match: getPublicMatch(match),
    });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Unable to step match.' });
  }
}