import type { GameStateServer, HandEndState, HandResult, Penalty, PlayerId, TileId, Tile, TurnStateServer } from "@okey/shared";
import { startTurnGame } from "./gameLogic.js";
import { validateMeldFromHand, validateOpeningRequirements, validateLayoff, canExtendAnyMeld, validateMeldSet, assignMeldTiles } from "./validate.js";
import { randomUUID } from "crypto";

function isOkeyTile(tile: Tile, okey: { color: string; value: number }): boolean {
  return tile.kind === "normal" && tile.color === okey.color && tile.value === okey.value;
}

function isFinishingDiscard(hand: Tile[]): boolean {
  // hand after removing discarded tile will be empty => finishing
  return hand.length === 0;
}

function jokerInHandPenalties(state: TurnStateServer): Penalty[] {
  const penalties: Penalty[] = [];
  for (const p of state.players) {
    const hand = state.hands[p.playerId] ?? [];
    const count = hand.filter((t) => isOkeyTile(t, state.okey)).length;
    if (count > 0) {
      penalties.push({ playerId: p.playerId, points: 101 * count, reason: "JOKER_IN_HAND" });
    }
  }
  return penalties;
}

function endHand(state: TurnStateServer, result: HandResult): HandEndState {
  const handHistory = [...(state.handHistory ?? []), result];
  return {
    phase: "handEnd",
    roomId: state.roomId,
    players: state.players,
    result,
    handHistory,
    dealerIndex: state.dealerIndex
  };
}

function allPairsOpened(openedBy: Record<PlayerId, "none" | "runsSets" | "pairs">): boolean {
  const vals = Object.values(openedBy);
  return vals.length === 4 && vals.every((v) => v === "pairs");
}

export type GameAction =
  | { type: "SET_READY"; playerId: PlayerId; ready: boolean }
  | { type: "START_GAME"; playerId: PlayerId }
  | { type: "DRAW"; playerId: PlayerId; source: "deck" | "prevDiscard" }
  | { type: "DISCARD"; playerId: PlayerId; tileId: TileId }
  | { type: "OPEN_MELD"; playerId: PlayerId; melds: TileId[][]; fromDiscard?: boolean }
  | { type: "LAYOFF"; playerId: PlayerId; tableMeldId: string; tileIds: TileId[] }
  | { type: "TAKE_AND_MELD"; playerId: PlayerId; fromPlayerId: PlayerId; melds: TileId[][] }
  | { type: "REORDER_HAND"; playerId: PlayerId; tileIds: TileId[] };

export function reduce(state: GameStateServer, action: GameAction): GameStateServer {
  switch (action.type) {
    case "SET_READY": {
      // readiness is lobby feature, but keep it mirrored even in turn for simplicity
      if (state.phase === "lobby") {
        return {
          ...state,
          players: state.players.map((p) =>
            p.playerId === action.playerId ? { ...p, ready: action.ready } : p
          )
        };
      }
      if (state.phase === "turn") {
        return {
          ...state,
          players: state.players.map((p) =>
            p.playerId === action.playerId ? { ...p, ready: action.ready } : p
          )
        };
      }
      return state;
    }

    case "START_GAME": {
      if (state.phase !== "lobby" && state.phase !== "handEnd") throw new Error("BAD_PHASE");

      if (state.phase === "lobby") {
        const hostId = state.players[0]?.playerId;
        if (!hostId) throw new Error("NEED_4_PLAYERS");
        if (action.playerId !== hostId) throw new Error("NOT_HOST");
      }
      if (state.players.length !== 4) throw new Error("NEED_4_PLAYERS");
      if (!state.players.every((p) => p.ready)) throw new Error("NOT_ALL_READY");

      return startTurnGame(state);
    }

    case "DRAW": {
      if (state.phase !== "turn") throw new Error("BAD_PHASE");
      if (state.currentPlayerId !== action.playerId) throw new Error("NOT_YOUR_TURN");
      if (state.turnStep !== "mustDraw") throw new Error("INVALID_STEP");

      let drawnTile: any = null;
      let nextDeck = state.deck;
      let nextDiscardPiles = state.discardPiles;

      const order = state.players.map((p) => p.playerId);
      const curIdx = order.indexOf(state.currentPlayerId);
      const prevPlayerId = order[(curIdx - 1 + order.length) % order.length]!;

      if (action.source === "deck") {
        const tile = state.deck[state.deck.length - 1];
        if (!tile) throw new Error("DECK_EMPTY");
        drawnTile = tile;
        nextDeck = state.deck.slice(0, -1);
      } else {
        // Taking previous discard into hand is not allowed; must use TAKE_AND_MELD.
        throw new Error("TAKE_DISCARD_MUST_MELD");
      }

      return {
        ...state,
        deck: nextDeck,
        discardPiles: nextDiscardPiles,
        hands: {
          ...state.hands,
          [action.playerId]: [...(state.hands[action.playerId] ?? []), drawnTile]
        },
        turnStep: "mustDiscard"
      };
    }

    case "OPEN_MELD": {
      if (state.phase !== "turn") throw new Error("BAD_PHASE");
      if (state.currentPlayerId !== action.playerId) throw new Error("NOT_YOUR_TURN");

      if (state.turnStep !== "mustDiscard") throw new Error("INVALID_STEP");

      const hand = state.hands[action.playerId] ?? [];

      const openedMode = state.openedBy?.[action.playerId] ?? "none";

      // resolve tile objects for each meld
      const meldObjs: any[] = [];
      for (const m of action.melds) {
        const tiles = m.map((id) => {
          const t = hand.find((h) => h.id === id);
          if (!t) throw new Error("TILE_NOT_IN_HAND");
          return t;
        });

        const vr = validateMeldFromHand(tiles, state.okey);
        if (!vr.valid) throw new Error("INVALID_MELD");
        meldObjs.push(tiles);
      }

      const meldSet = validateMeldSet(meldObjs, state.okey);
      if (!meldSet.ok) throw new Error("INVALID_MELD_SET");

      if (openedMode === "none") {
        // validate opening requirements
        const openRes = validateOpeningRequirements(meldObjs, state.okey, true);
        if (!openRes.ok) {
          const penalties = (state.penalties ?? []).concat({
            playerId: action.playerId,
            points: 101,
            reason: "FAILED_OPENING"
          });
          return { ...state, penalties };
        }
      } else if (meldSet.mode !== openedMode) {
        throw new Error("MELD_STYLE_MISMATCH");
      }

      // remove tiles from hand and add to tableMelds
      const newHands = { ...state.hands };
      for (const tiles of meldObjs) {
        for (const t of tiles) {
          newHands[action.playerId] = newHands[action.playerId].filter((x) => x.id !== t.id);
        }
      }

      const nextMelds = (state.tableMelds ?? []).slice();
      for (const tiles of meldObjs) {
        nextMelds.push({ meldId: randomUUID(), playerId: action.playerId, tiles: assignMeldTiles(tiles, state.okey) });
      }

      const openedBy = { ...(state.openedBy ?? {}) };
      if (openedMode === "none") openedBy[action.playerId] = meldSet.mode;

      // after opening, player must discard
      const nextState: TurnStateServer = { ...state, hands: newHands, tableMelds: nextMelds, turnStep: "mustDiscard", openedBy };
      if (allPairsOpened(openedBy)) {
        const penalties = (nextState.penalties ?? []).concat(jokerInHandPenalties(nextState));
        return endHand(nextState, { reason: "ALL_PAIRS", penalties });
      }
      return nextState;
    }

    case "LAYOFF": {
      if (state.phase !== "turn") throw new Error("BAD_PHASE");
      if (state.currentPlayerId !== action.playerId) throw new Error("NOT_YOUR_TURN");
      if (state.turnStep !== "mustDiscard") throw new Error("INVALID_STEP");

      if ((state.openedBy?.[action.playerId] ?? "none") === "none") throw new Error("MUST_OPEN_FIRST");

      const table = (state.tableMelds ?? []).find((m) => m.meldId === action.tableMeldId);
      if (!table) throw new Error("NO_SUCH_TABLE_MELD");

      const hand = state.hands[action.playerId] ?? [];
      const tiles = action.tileIds.map((id) => {
        const t = hand.find((h) => h.id === id);
        if (!t) throw new Error("TILE_NOT_IN_HAND");
        return t;
      });

      const vr = validateLayoff(table.tiles, tiles, state.okey);
      if (!vr.ok) throw new Error("INVALID_LAYOFF");

      // remove from hand and append to table meld
      const newHands = { ...state.hands };
      for (const t of tiles) newHands[action.playerId] = newHands[action.playerId].filter((x) => x.id !== t.id);

      const newMelds = (state.tableMelds ?? []).map((m) => {
        if (m.meldId !== table.meldId) return m;
        const combined = m.tiles.concat(tiles);
        return { ...m, tiles: assignMeldTiles(combined, state.okey) };
      });

      return { ...state, hands: newHands, tableMelds: newMelds };
    }

    case "TAKE_AND_MELD": {
      if (state.phase !== "turn") throw new Error("BAD_PHASE");
      if (state.currentPlayerId !== action.playerId) throw new Error("NOT_YOUR_TURN");
      if (state.turnStep !== "mustDraw") throw new Error("INVALID_STEP");

      const order = state.players.map((p) => p.playerId);
      const curIdx = order.indexOf(state.currentPlayerId);
      const prevPlayerId = order[(curIdx - 1 + order.length) % order.length]!;

      if (prevPlayerId !== action.fromPlayerId) throw new Error("INVALID_FROM_PLAYER");

      const prevPile = state.discardPiles[prevPlayerId] ?? [];
      const top = prevPile[prevPile.length - 1];
      if (!top) throw new Error("PREV_DISCARD_EMPTY");

      // ensure melds include the taken tile id
      const includesTop = action.melds.some((m) => m.includes(top.id));
      if (!includesTop) throw new Error("TAKEN_TILE_MUST_BE_USED_IN_MELD");

      // build meld objects using tile ids from hand plus the taken tile
      const hand = state.hands[action.playerId] ?? [];
      const meldObjs: any[] = [];
      for (const m of action.melds) {
        const tiles: any[] = [];
        for (const id of m) {
          if (id === top.id) {
            tiles.push(top);
            continue;
          }
          const t = hand.find((h) => h.id === id);
          if (!t) throw new Error("TILE_NOT_IN_HAND");
          tiles.push(t);
        }

        const vr = validateMeldFromHand(tiles, state.okey);
        if (!vr.valid) throw new Error("INVALID_MELD");
        meldObjs.push(tiles);
      }

      const openedMode = state.openedBy?.[action.playerId] ?? "none";
      const meldSet = validateMeldSet(meldObjs, state.okey);
      if (!meldSet.ok) throw new Error("INVALID_MELD_SET");
      if (openedMode === "none") {
        const openRes = validateOpeningRequirements(meldObjs, state.okey, false);
        if (!openRes.ok) {
          const penalties = (state.penalties ?? []).concat({
            playerId: action.playerId,
            points: 101,
            reason: "FAILED_OPENING"
          });
          return { ...state, penalties };
        }
      } else if (meldSet.mode !== openedMode) {
        throw new Error("MELD_STYLE_MISMATCH");
      }

      // remove taken tile from prev pile and remove other tiles from hand
      const newDiscardPiles = { ...state.discardPiles, [prevPlayerId]: prevPile.slice(0, -1) };
      const newHands = { ...state.hands };
      for (const tiles of meldObjs) {
        for (const t of tiles) {
          if (t.id === top.id) continue;
          newHands[action.playerId] = newHands[action.playerId].filter((x) => x.id !== t.id);
        }
      }

      const nextMelds = (state.tableMelds ?? []).slice();
      for (const tiles of meldObjs) nextMelds.push({ meldId: randomUUID(), playerId: action.playerId, tiles: assignMeldTiles(tiles, state.okey) });

      const openedBy = { ...(state.openedBy ?? {}) };
      if (openedMode === "none") openedBy[action.playerId] = meldSet.mode;

      const nextState: TurnStateServer = {
        ...state,
        discardPiles: newDiscardPiles,
        hands: newHands,
        tableMelds: nextMelds,
        turnStep: "mustDiscard",
        openedBy
      };
      if (allPairsOpened(openedBy)) {
        const penalties = (nextState.penalties ?? []).concat(jokerInHandPenalties(nextState));
        return endHand(nextState, { reason: "ALL_PAIRS", penalties });
      }
      return nextState;
    }

    case "DISCARD": {
      if (state.phase !== "turn") throw new Error("BAD_PHASE");
      if (state.currentPlayerId !== action.playerId) throw new Error("NOT_YOUR_TURN");
      if (state.turnStep !== "mustDiscard") throw new Error("INVALID_STEP");

      const hand = state.hands[action.playerId] ?? [];
      const idx = hand.findIndex((t) => t.id === action.tileId);
      if (idx === -1) throw new Error("TILE_NOT_IN_HAND");

      const tile = hand[idx]!;
      const newHand = hand.slice(0, idx).concat(hand.slice(idx + 1));

      // --- Penalty checks ---
      const penalties = (state.penalties ?? []).slice();
      const finishing = isFinishingDiscard(newHand);

      // 1) Discarding a joker (okey tile) => +101
      if (isOkeyTile(tile, state.okey)) {
        penalties.push({ playerId: action.playerId, points: 101, reason: "DISCARD_JOKER" });
      }

      // 2) Discarding a tile that could extend any set/run on table => +101 (unless finishing)
      if (!finishing) {
        const tableMelds = (state.tableMelds ?? []).map((m) => m.tiles);
        if (tableMelds.length > 0 && canExtendAnyMeld(tableMelds, tile, state.okey)) {
          penalties.push({ playerId: action.playerId, points: 101, reason: "DISCARD_EXTENDABLE" });
        }
      }

      const order = state.players.map((p) => p.playerId);
      const curIdx = order.indexOf(state.currentPlayerId);
      const next = order[(curIdx + 1) % order.length]!;
      const nextState: TurnStateServer = {
        ...state,
        hands: { ...state.hands, [action.playerId]: newHand },
        discardPiles: {
          ...state.discardPiles,
          [action.playerId]: [...(state.discardPiles[action.playerId] ?? []), tile]
        },
        penalties,
        currentPlayerId: next,
        turnStep: "mustDraw"
      };
      if (finishing) {
        return endHand(nextState, { reason: "WIN", winnerId: action.playerId, penalties });
      }
      if (nextState.deck.length === 0) {
        const endPenalties = penalties.concat(jokerInHandPenalties(nextState));
        return endHand(nextState, { reason: "DECK_EMPTY", penalties: endPenalties });
      }
      return nextState;
    }

    case "REORDER_HAND": {
      if (state.phase !== "turn") throw new Error("BAD_PHASE");
      const hand = state.hands[action.playerId] ?? [];
      // Validate: tileIds must be a permutation of the current hand ids
      if (action.tileIds.length !== hand.length) throw new Error("INVALID_REORDER");
      const handIdSet = new Set(hand.map((t) => t.id));
      const reorderSet = new Set(action.tileIds);
      if (reorderSet.size !== handIdSet.size) throw new Error("INVALID_REORDER");
      for (const id of action.tileIds) {
        if (!handIdSet.has(id)) throw new Error("INVALID_REORDER");
      }
      // Build new hand in the requested order
      const tileById = new Map(hand.map((t) => [t.id, t]));
      const newHand = action.tileIds.map((id) => tileById.get(id)!);
      return { ...state, hands: { ...state.hands, [action.playerId]: newHand } };
    }

    default:
      return state;
  }
}
