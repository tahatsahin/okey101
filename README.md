# Okey 101

A real-time multiplayer **Okey 101** (Turkish tile rummy) game for 4 players, built with a full TypeScript stack.

## Overview

Okey 101 is a traditional Turkish tile game played with 106 tiles (4 colors × 13 values × 2 copies + 2 false jokers). This project implements the complete rule set including:

- Indicator tile → joker (okey) determination
- 21/22 tile dealing (first player gets 22, skips initial draw)
- Runs, sets, and pairs melding
- Opening requirement (≥101 points or 5+ pairs)
- Take-from-discard-and-meld-immediately rule (cannot take into hand)
- Penalty system (+101 for joker discard, extendable tile discard, failed opening)
- Layoffs onto existing table melds
- Hand end conditions (win on last discard, deck empty, all-pairs)
- Dealer rotation per hand

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Monorepo** | npm workspaces |
| **Server** | Node.js, Express, Socket.IO |
| **Client** | React, Vite |
| **Shared** | `@okey/shared` — types, Zod schemas, event names |
| **Language** | TypeScript (strict, no implicit any) |
| **Validation** | Zod |
| **State** | Server-authoritative reducer pattern, in-memory |

## Project Structure

```
okey101/
├── apps/
│   ├── server/          # Game server (Express + Socket.IO)
│   │   ├── src/
│   │   │   ├── index.ts          # HTTP server + Socket.IO setup
│   │   │   ├── socket.ts         # Socket event handlers
│   │   │   ├── game/
│   │   │   │   ├── gameLogic.ts  # Deck creation, dealing, client view
│   │   │   │   ├── reducer.ts    # Authoritative state transitions
│   │   │   │   ├── tileUtils.ts  # Tile helpers (joker detection, etc.)
│   │   │   │   └── validate.ts   # Meld/opening/layoff validation
│   │   │   └── rooms/
│   │   │       ├── roomRegistry.ts  # Room management + dispatch
│   │   │       └── roomTypes.ts     # Room type definitions
│   │   └── test/                 # Unit + integration tests
│   └── web/             # React frontend (Vite)
│       └── src/
│           ├── App.tsx           # Game UI (join, lobby, game board)
│           ├── App.css           # Themed styles (felt table, tile rack)
│           ├── socket.ts         # Socket.IO client
│           └── types.ts          # Client-side type helpers
└── packages/
    └── shared/          # Shared types & schemas
        └── src/
            ├── types/
            │   ├── gameState.ts  # GameState discriminated union
            │   └── ids.ts        # Branded ID types
            └── schema/
                ├── events.ts     # Zod schemas for socket payloads
                └── eventNames.ts # Event name constants
```

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9 (for workspaces support)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/tahatsahin/okey101.git
cd okey101

# Install all dependencies (root + workspaces)
npm install

# Run both server and client in development mode
npm run dev
```

This starts:
- **Server** on `http://localhost:3001` (with hot reload via tsx watch)
- **Client** on `http://localhost:5173` (Vite dev server)

### Individual commands

```bash
# Server only
npm run dev:server

# Client only
npm run dev:web

# Type-check entire monorepo
npm run typecheck

# Run server tests
npm -w apps/server test
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server listen port |
| `VITE_SERVER_URL` | `http://localhost:3001` | Socket.IO server URL (client) |

## How to Play

1. Open the app and enter a **Room ID** and your **name**, then click **Join Room**.
2. Wait for 4 players to join and click **Ready**.
3. Any player can click **Start Game** once all 4 are ready.
4. The first player (dealer's right) starts with 22 tiles and must discard without drawing.
5. On your turn:
   - **Draw** from the deck, or **Take & Meld** the previous discard immediately.
   - Optionally **Open Meld** (runs/sets ≥101 points, or 5+ pairs) or **Layoff** onto table melds.
   - **Discard** one tile to end your turn.
6. First player to meld all tiles and discard their last tile wins!

### Tile Controls

- **Click** a tile to select/deselect it.
- **Drag** tiles between rack slots to rearrange (gaps allowed).
- **Double-click** a tile to discard it (when it's your turn to discard).
- Use the **Discard** button with one tile selected.

## Tests

```bash
cd apps/server
npx tsx test/index.ts
```

Tests cover:
- Tile utilities (joker detection, indicator-to-okey mapping)
- Meld validation (runs, sets, pairs, joker substitution)
- Reducer transitions (draw, discard, open, layoff, reorder, penalties)
- Integration (full 4-player multi-turn game flow)

## Deployment

See [DEPLOYMENT.md](/home/tahatsahin/github/tahatsahin/okey101/DEPLOYMENT.md).

## License

ISC
