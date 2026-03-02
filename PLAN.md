# Okey101 Project Plan

## Snapshot
- Full-stack TypeScript monorepo with Socket.IO server and React client.
- Core turn loop exists, but several Okey 101 rules are not yet enforced.
- Validation logic is conservative and incomplete around jokers, runs, and layoffs.

## Phase 1: Rules-Correct Domain Model
1. Model jokers explicitly:
   - Represent wild okey tiles with assigned (color,value) in melds.
   - Keep false jokers fixed to the current okey tile.
2. Track per-player opening state:
   - `openingMode`: `"none" | "runsSets" | "pairs"`.
   - Enforce pair/runs-set restrictions after opening.
3. Enforce discard-take rule:
   - Remove/disable `DRAW` from `prevDiscard`.
   - Use `TAKE_AND_MELD` only, and require the taken tile be used.
   - If player has not opened, validate opening requirements in `TAKE_AND_MELD`.
4. Fix meld validation correctness:
   - Runs require same color; 1 is low only; no 12-13-1 wrap.
   - Sets require unique colors; disallow duplicate colors in layoff.
   - Allow multi-tile run layoffs by validating the entire extension set.
5. Failed opening penalty:
   - Invalid opening attempt applies +101 and leaves state unchanged.

## Phase 2: End Conditions & Scoring
1. End-of-hand detection:
   - Win on discard of last tile.
   - Deck empty (indicator only) ends hand.
   - All four players opened with pairs ends hand.
2. Scoring summary:
   - Apply joker-in-hand penalties.
   - Persist per-hand results in room state.
3. Dealer rotation and new deal flow.

## Phase 3: UX & Gameplay Loop
1. Client actions aligned to rules:
   - Remove “Take Discard” button or make it conditional on immediate meld.
   - Show opening mode and whether player has opened.
2. Table meld UX:
   - Show meld owner and resolved joker values.
   - Highlight legal layoffs and extendable tiles.
3. End-of-hand summary UI with scores and penalties.

## Phase 4: Quality & Cleanup
1. Consolidate duplicated logic:
   - Use `tileUtils` for deck creation/shuffle/indicator selection.
2. Align event names:
   - Use `C2S_EVENT`/`C2S_EXTRA_EVENT` constants consistently.
3. Stronger validation:
   - Add Zod schema for `GameStateClient` payloads.
4. Tests:
   - Joker as wild in runs/sets and layoffs.
   - Mixed-color run rejection.
   - Multi-tile layoff acceptance.
   - Discard-take must be melded.
   - Opening >=101 and 21-tile exception.

## Nice-to-Have Features
- Game log/history and replay of last turn.
- Chat/emotes.
- Spectator mode.
- Auto-sort hand (by color/run) and smart grouping hints.
- Basic anti-stall (soft timers) and reconnect indicators.
