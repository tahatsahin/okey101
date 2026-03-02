# UI Notes (Gameplay Layout & Interactions)

## Table Layout Corrections
- Discard piles should be positioned between adjacent players:
  - Local player discards to the pile between local player and player on the left.
  - Player order is counter-clockwise: local player’s right is next, left is previous.
- Each player has their own board area; table should emphasize seat-relative positions.

## Drag-and-Drop Interactions
- Discard by dragging a tile onto the correct adjacent discard pile (in addition to click+discard).
- Draw by dragging from the deck or from the correct adjacent discard pile into the hand.
- The UI should visually indicate valid drop targets and invalid actions.

## Free-Form Hand Layout
- Remove fixed grid slots in the local hand.
- Allow free placement within the player’s board area:
  - Tiles can be dropped anywhere within the hand zone.
  - Tiles cannot overlap (must avoid dropping onto another tile).
  - Preserve current order when possible; allow manual spatial organization.
