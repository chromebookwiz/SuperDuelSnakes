---
name: superduelsnakes-llm-player
description: "Use when: playing SuperDuelSnakes through the API, controlling player1 against the built-in bot, controlling player2 in an agent room, or training an LLM from ASCII board snapshots and room history."
---

# SuperDuelSnakes LLM Player

Use this skill when an agent needs to play SuperDuelSnakes through API calls instead of keyboard input.

## Modes

Each room seat can independently be one of:

- `human`
- `bot`
- `agent`

The default mode is `human` vs `human`.

### Human vs Agent

1. Create a room with `POST /api/rooms/create` and body `{ "settings": { ... }, "playerModes": { "player1": "human", "player2": "agent" } }`.
2. The response includes `agentAccess.player2`.
3. The browser user or another client can play as `player1`.
4. The agent controls `player2` by calling `POST /api/rooms/command` with the returned token.

### LLM vs Bot

1. Create a room with `POST /api/rooms/create` and body `{ "settings": { ... }, "playerModes": { "player1": "agent", "player2": "bot" } }`.
2. The response includes `agentAccess.player1`.
3. The built-in bot automatically plays `player2`.
4. The agent controls `player1` through `POST /api/rooms/command`.

### LLM vs LLM

1. Create a room with `POST /api/rooms/create` and body `{ "settings": { ... }, "playerModes": { "player1": "agent", "player2": "agent" } }`.
2. The response includes both `agentAccess.player1` and `agentAccess.player2`.
3. Each API client polls `/api/rooms/turn` with its own token.
4. A tick resolves after all pending agent seats respond.

## Core Endpoints

- `GET /api/play/schema`
- `POST /api/rooms/create`
- `GET /api/rooms/turn?roomCode=XXXXXX&token=ROOM_TOKEN`
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
- `stay`
- `p1 up`
- `p1 down`
- `p1 left`
- `p1 right`
- `p1 stay`
- `p2 up`
- `p2 down`
- `p2 left`
- `p2 right`
- `p2 stay`
- `tick 250`

## Per-Tick Loop

1. Fetch `GET /api/rooms/turn?roomCode=...&token=...`.
2. If `turn.readyForInput` is `false`, wait briefly and poll again.
3. Parse `observation.boardText`, `observation.legalActions`, `observation.summary`, and `observation.events`.
4. Choose one response for the current tick:
  - one direction for your player
  - `stay` if continuing straight is safest
5. Submit exactly one response with `POST /api/rooms/command`.
6. The room advances exactly one tick after all pending agent seats for that tick have responded.
7. Repeat until `winner` is no longer `none`.

## Response Contract

Respond with exactly one instruction per tick:

- `up`
- `down`
- `left`
- `right`
- `stay`

When sending text commands over the API, include the explicit player prefix if useful, for example `p2 left` or `p1 stay`.

## Decision Heuristics

- Avoid illegal reverse turns.
- Avoid cells occupied by either snake body.
- Prefer moves that reduce Manhattan distance to food when safe.
- Use `history` to inspect recent failures and collision patterns.
- In per-tick training modes the game does not advance until the waiting player responds.

## Skill URL

The deployed playbook is served from `/skills/superduelsnakes-llm-playbook.md`.