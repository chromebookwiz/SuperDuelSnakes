# SuperDuelSnakes LLM Playbook

This document is meant to be fetched by an external agent that will play SuperDuelSnakes through HTTP API calls.

## Quick Start

### Human vs Agent

Create a room where a human or browser client plays player 1 and an external agent plays player 2.

```http
POST /api/rooms/create
Content-Type: application/json

{
  "settings": {
    "cellCount": 25,
    "speed": 6,
    "wrapWalls": false
  },
  "opponent": "agent"
}
```

Read `agentAccess.player`, `agentAccess.token`, and `agentAccess.roomCode` from the response. Use those values for future room commands.

### LLM vs Bot

Create a room where the external agent is player 1 and the built-in bot is player 2.

```http
POST /api/rooms/create
Content-Type: application/json

{
  "settings": {
    "cellCount": 20,
    "speed": 7,
    "wrapWalls": false
  },
  "opponent": "bot"
}
```

## Polling Loop

1. Fetch current room state.
2. Parse the ASCII board and legal actions.
3. Choose a single action.
4. Submit it.
5. Repeat until a winner exists.

```http
GET /api/rooms/state?roomCode=ABC123
```

Important response fields:

- `room.match.boardText`
- `room.match.legalActions`
- `room.match.summary`
- `room.events`
- `room.revision`

## Sending Moves

```http
POST /api/rooms/command
Content-Type: application/json

{
  "roomCode": "ABC123",
  "token": "ROOM_TOKEN",
  "commandText": "p1 right"
}
```

or

```http
POST /api/rooms/command
Content-Type: application/json

{
  "roomCode": "ABC123",
  "token": "ROOM_TOKEN",
  "action": {
    "type": "direction",
    "player": "player1",
    "direction": "right"
  }
}
```

## Replay and Error Analysis

Fetch recent history and events:

```http
GET /api/rooms/history?roomCode=ABC123&limit=20
```

Use history to analyze:

- repeated wall collisions
- failed food races
- head-on collisions
- whether your last action increased danger

## Board Symbols

- `A`: player 1 head
- `a`: player 1 body
- `B`: player 2 head
- `b`: player 2 body
- `*`: food
- `.`: empty cell

## Suggested Strategy

- Never reverse direction.
- Prefer safe moves first.
- Among safe moves, prefer shorter routes to food.
- Avoid entering cells that can be occupied by the opponent on the next tick.
- In bot mode, act quickly because player 2 continues to plan automatically.