---
name: superduelsnakes-llm-player
description: "Use when: playing SuperDuelSnakes through the API, controlling player1 against the built-in bot, controlling player2 in an agent room, or training an LLM from ASCII board snapshots and room history."
---

# SuperDuelSnakes LLM Player

Use this skill when an agent needs to play SuperDuelSnakes through API calls instead of keyboard input.

## Modes

### Human vs Agent

1. Create a room with `POST /api/rooms/create` and body `{ "settings": { ... }, "opponent": "agent" }`.
2. The response includes `agentAccess` for `player2`.
3. The browser user or another client can play as `player1`.
4. The agent controls `player2` by calling `POST /api/rooms/command` with the returned token.

### LLM vs Bot

1. Create a room with `POST /api/rooms/create` and body `{ "settings": { ... }, "opponent": "bot" }`.
2. The response includes `agentAccess` for `player1`.
3. The built-in bot automatically plays `player2`.
4. The agent controls `player1` through `POST /api/rooms/command`.

## Core Endpoints

- `GET /api/play/schema`
- `POST /api/rooms/create`
- `GET /api/rooms/state?roomCode=XXXXXX`
- `GET /api/rooms/history?roomCode=XXXXXX&limit=40`
- `POST /api/rooms/command`

## Command Format

Send JSON to `POST /api/rooms/command`:

```json
{
  "roomCode": "ABC123",
  "token": "ROOM_TOKEN",
  "commandText": "p2 left"
}
```

You may also send structured actions:

```json
{
  "roomCode": "ABC123",
  "token": "ROOM_TOKEN",
  "action": {
    "type": "direction",
    "player": "player2",
    "direction": "left"
  }
}
```

## Valid Commands

- `start`
- `pause`
- `reset`
- `p1 up`
- `p1 down`
- `p1 left`
- `p1 right`
- `p2 up`
- `p2 down`
- `p2 left`
- `p2 right`
- `tick 250`

## Recommended Agent Loop

1. Fetch room state.
2. Parse `match.boardText`, `match.legalActions`, `match.summary`, and `events`.
3. Choose one legal direction for your assigned player.
4. Submit exactly one action.
5. Repeat until `winner` is no longer `none`.

## Decision Heuristics

- Avoid illegal reverse turns.
- Avoid cells occupied by either snake body.
- Prefer moves that reduce Manhattan distance to food when safe.
- Use `history` to inspect recent failures and collision patterns.
- In `llm-vs-bot` mode, expect `player2` to keep advancing even if you wait.

## Skill URL

The deployed playbook is served from `/skills/superduelsnakes-llm-playbook.md`.