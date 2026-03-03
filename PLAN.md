# Okey101 Project Plan (Todo List)
Last updated: 2026-03-03

## Snapshot
- (x) Baseline: full-stack TypeScript monorepo with Socket.IO server and React client.
- (x) Baseline: core turn loop exists.
- (x) Baseline: prior validation was conservative around jokers, runs, and layoffs.

## Phase 1: Rules-Correct Domain Model
- (x) Track per-player opening state (`openedBy`).
- (x) Enforce meld style after opening (pairs vs runs/sets) for `OPEN_MELD` and `TAKE_AND_MELD`.
- (x) Enforce discard-take rule: `DRAW` from `prevDiscard` enters must-meld state with return option.
- (x) Require `TAKE_AND_MELD` to include the taken discard tile.
- (x) Require opening requirements in `TAKE_AND_MELD` when player has not opened.
- (x) Runs validation: same color; 1 is low only; no 12-13-1 wrap; jokers can fill gaps.
- (x) Sets validation: unique colors; jokers allowed; no duplicate colors.
- (x) Layoff validation uses combined meld validation (multi-tile run/set extensions).
- (x) Failed opening attempt applies +101 and keeps state unchanged.
- (x) Client UI: removed “Take Discard” draw-to-hand button.
- (x) Tests updated: discard-take rejection, joker in runs/sets, mixed-color run rejection, 12-13-1 wrap invalid.
- (x) False jokers remain fixed to current okey tile in validation and counting.
- (x) Represent wild okey tiles with assigned (color,value) in melds (persisted in state).
- ( ) Enforce opening-mode restrictions for any future meld actions beyond `OPEN_MELD`/`TAKE_AND_MELD` as needed.
- (x) Expose opening mode in client UI.

## Phase 2: End Conditions & Scoring
- (x) Win on discard of last tile.
- (x) Deck empty (indicator only) ends hand.
- (x) All four players opened with pairs ends hand.
- (x) End-of-round penalties: no-open = 202, opened hand sum, pairs double.
- (x) Persist per-hand results in room state.
- (x) Dealer rotation and new deal flow.
- (x) Match flow: 11 rounds, auto-start on all-ready, reset after match end.

## Phase 3: UX & Gameplay Loop
- (x) Show opening mode and whether player has opened.
- (x) Table meld UX: show meld owner and resolved joker values.
- (x) Highlight legal layoffs and extendable tiles.
- (x) End-of-hand summary UI with scores and penalties.
- (x) Discard piles positioned between adjacent players (seat-relative layout).
- (x) Drag-and-drop discard/draw using deck and correct discard pile targets.
- (x) Free-form hand layout (no fixed grid slots; non-overlapping placement).
- (x) Bots: host can add bots in lobby; bots draw from deck only and discard drawn tile (if okey, discard a random non-okey).
- (x) Discard-take flow: take discard into must-meld state with return tile button.
- (x) Grouping UI: hide grouped tiles, show group totals and pair counts, restore on clear/return/discard.
- (x) Draw drop positioning: place drawn tile at drop location when empty.
- (x) Team mode (2v2): lobby toggle, opposite seating, team-based scoring UI.
- (x) Lobby seat selection: four slots with seat-specific join and team grouping.

## Phase 4: Quality & Cleanup
- ( ) Consolidate duplicated deck/indicator logic into `tileUtils`.
- (x) Align event names using `C2S_EVENT`/`C2S_EXTRA_EVENT` constants consistently.
- (x) Add Zod schema for `GameStateClient` payloads.
- (x) Tests: opening >=101 and 21-tile exception.
- (x) Tests: discard-take must be melded.
- (x) Tests: mixed-color run rejection.
- (x) Tests: joker as wild in layoffs.
- (x) Tests: multi-tile layoff acceptance.

## Nice-to-Have Features
- ( ) Game log/history and replay of last turn.
- (x) Auto-sort hand (by normal / pair order with lobby toggle).
- (x) Exact tile grouping agent for optimal run/set grouping with joker support.
- ( ) Basic anti-stall (soft timers) and reconnect indicators.
- ( ) Allow removing/replacing bots when a human joins.
