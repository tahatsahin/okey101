Progress notes

- 2026-02-24: Created agent support directory and initial files.
- 2026-02-24: Implemented `apps/server/src/game/tileUtils.ts` containing deck creation, shuffle, indicator selection, okey resolution, and dealing helper.
- Next: implement `validate.ts` for meld/open/layoff validation and add unit tests.
 - 2026-02-24: Implemented `apps/server/src/game/validate.ts` with basic validators: `validateMeldFromHand`, `validateOpeningRequirements`, `validateLayoff`, `canExtendAnyMeld`.
 - Next: add unit tests for `tileUtils` and `validate` (edge cases per AGENTS.md).
 - 2026-02-24: Added unit tests in `apps/server/test` for `tileUtils` and `validate`.
- 2026-02-24: Added Zod schemas (C2S_EXTRA, S2C_EXTRA), extended reducer with OPEN_MELD/LAYOFF/TAKE_AND_MELD.
- 2026-02-24: Wired socket handlers for new intents. Added roomRegistry dispatch methods.
- 2026-02-24: Enforced penalties in DISCARD (joker +101, extendable +101). Added 21 reducer tests.
- 2026-02-24: Added minimal client emit helpers + tile selection UI in App.tsx.
- 2026-02-24: Integration playtest: lobby→start→3 full turns. 49 tests passing.
- Next: Game-specific frontend creation (board, tiles, meld builder, score display).
