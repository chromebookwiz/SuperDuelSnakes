# SuperDuelSnakes Arena

This repository now contains two versions of DuelSnakes:

- The original desktop Pygame game remains unchanged in `Desktop/DuelSnakes/DuelSnakes.py`.
- A new browser-first Vite build lives at the repository root so the game can be deployed to Vercel.

## Features in the web build

- Two-player local duel gameplay that preserves the original wall, food, and snake collision core.
- Advanced settings panel for grid size, game speed, wall wrapping, effects, and sound.
- Multiple full-scene themes, background styles, and board grid textures.
- Enhanced rendering with animated food, glow trails, polished board lighting, and snake eyeballs on the head.
- Responsive layout for desktop and mobile browsers.
- Round scoreboard, streak tracking, fullscreen, touch controls, keyboard shortcuts, and persistent local settings.
- Text-command control surface with ASCII board rendering for agent-friendly interaction.
- Stateless text/API endpoints for creating and stepping matches with machine-readable snapshots.
- Room creation and join-by-code flow backed by Vercel API endpoints for browser-to-browser matches.

## Development

```bash
npm install
npm run dev
```

The Vite dev server only serves the frontend bundle. To exercise the API routes locally, use Vercel development tooling.

## Production build

```bash
npm run build
```

## Deploy to Vercel

The repository includes `vercel.json` for a static Vite deployment.

1. Import the repository into Vercel.
2. Vercel should detect the Vite framework automatically.
3. The frontend is emitted to `dist`, and the `api/` directory provides the text-play and room endpoints.
4. If needed, use:
   - Build command: `npm run build`
   - Output directory: `dist`

## API Endpoints

- `GET /api/play/schema`
- `POST /api/play/new`
- `POST /api/play/step`
- `POST /api/rooms/create`
- `POST /api/rooms/join`
- `GET /api/rooms/state?roomCode=XXXXXX`
- `POST /api/rooms/command`

## Room Model

- Rooms are server-relayed and synchronized through the API.
- Join codes are six characters.
- The included room backend is in-memory. On Vercel this works as a baseline implementation, but durable multi-instance production play would require a shared store such as KV.

## Controls

- Player 1: `W`, `A`, `S`, `D`
- Player 2: Arrow keys
- Pause / resume: `Space`
- Reset round: `R`
- Fullscreen: `F`