# Okey101 Project Agent Instructions

You are an AI coding agent helping implement Okey 101 rules and game logic.

## Project constraints (do not violate)
- Small hobby project (4 friends), minimal cost, no scaling, no HA.
- Single VPS (DigitalOcean), 1GB RAM.
- Full TypeScript stack.
- Backend: Node.js + Socket.IO.
- Frontend: React + Vite + TypeScript.
- Monorepo with `apps/*` and `packages/*`.
- In-memory authoritative server state; no DB initially.
- Reducer-based state transitions.
- GameState is a discriminated union by phase.
- Zod for validation.

## Critical: Okey 101 rules must be followed exactly
Use these core rules:
- 106 tiles total: 4 colors * 13 values * 2 copies = 104 + 2 false jokers (sahte okey).
- Indicator tile is a numbered tile (never false joker). It determines the joker (okey):
  - Joker = same color, value+1 (wrap 13->1).
- Two joker tiles (the actual okey tiles) are WILD.
- False jokers are NOT wild. They ONLY represent the current joker tile (the okey tile).
- Players start with 21 tiles, except player to dealer’s right starts with 22.
- Turn flow:
  - First player (dealer’s right) starts by optionally melding (if opening requirements met) then discards (no initial draw).
  - Others: draw from deck OR take previous discard.
  - Previous discard can be taken ONLY if immediately used in a meld (cannot be kept in hand).
  - Turn ends with a discard (even the last turn; cannot end with no discard).
- Meld styles:
  - Runs/Sets: sets (3-4 same value all different colors) and runs (>=3 consecutive same color; 1 only low; 12-13-1 not allowed).
  - Pairs: identical pairs (same color+value). Pairs cannot be extended.
  - A player who starts with runs/sets cannot play pairs that deal.
  - A player who starts with pairs cannot create new runs/sets, but can extend other players’ runs/sets.
- Opening requirements:
  - Runs/Sets opening: in one turn melds from hand totaling >= 101 value (joker value equals represented tile value).
  - Pairs opening: at least 5 pairs in one turn.
  - Before opening, player cannot add to table melds.
  - If taking previous discard before opening, it must be used in the opening meld (counts).
  - Exception: If player can lay down 21 tiles at once in runs/sets created only from hand (no layoff), they may finish even if total < 101.
- Penalties (+101 each):
  - Discarding a joker => +101 penalty points.
  - Discarding a tile that could extend any set/run on table => +101 (even if not opened), except when it is the final discard to finish the hand.
  - Failed opening attempt (must take tiles back) => +101.
  - “Taking back multiple tiles” penalty exists in physical play; for digital MVP, do atomic meld actions so “take back” is unnecessary.
- End conditions:
  - Win: meld all remaining tiles except one and discard last tile.
  - No tiles left to draw (only indicator remains): deal ends; no score except any jokers in hand => 101 penalty each.
  - If all four players meld pairs: deal ends similarly; no score except jokers-in-hand penalties.

## Engineering rules
- No overengineering: no DB, no complex infra.
- Strict TypeScript; no `any` leaks.
- Use Zod schemas for socket payloads.
- Server is authoritative; clients send “intent”, server validates and applies reducer transitions.
- Keep deterministic state transitions; no side effects inside reducer except pure calculations.

## Required workflow when implementing step 6
1) Add domain modeling first (tile evaluation: joker/false joker behavior).
2) Add new reducer actions for meld/open/layoff and special take-discard-and-meld.
3) Implement validation functions in a dedicated module:
   - validateMeldFromHand
   - validateOpeningRequirements
   - validateLayoff
   - canExtendAnyMeld (for discard penalty)
4) Add minimal UI intents later; backend correctness first.
5) Add tests (unit tests) for validation and edge cases:
   - 1 low-only in runs
   - discard-take must be used immediately
   - opening >=101 rules and the 21-tile exception
   - penalties