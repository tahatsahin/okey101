import type { GameStateServer, PlayerId, TileId, Tile } from "@okey/shared";
import { startTurnGame } from "./gameLogic.js";
import { validateMeldFromHand, validateOpeningRequirements, validateLayoff, canExtendAnyMeld } from "./validate.js";
import { randomUUID } from "crypto";

function isOkeyTile(tile: Tile, okey: { color: string; value: number }): boolean {
  return tile.kind === "normal" && tile.color === okey.color && tile.value === okey.value;
}

function isFinishingDiscard(hand: Tile[]): boolean {
  // hand after removing discarded tile will be empty => finishing
  return hand.length === 0;
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
      if (state.phase !== "lobby") throw new Error("BAD_PHASE");

      const hostId = state.players[0]?.playerId;
      if (!hostId) throw new Error("NEED_4_PLAYERS");
      if (action.playerId !== hostId) throw new Error("NOT_HOST");
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
        // draw from previous player's discard pile (top tile)
        const prevPile = state.discardPiles[prevPlayerId] ?? [];
        const tile = prevPile[prevPile.length - 1];
        if (!tile) throw new Error("PREV_DISCARD_EMPTY");

        drawnTile = tile;

        nextDiscardPiles = {
          ...state.discardPiles,
          [prevPlayerId]: prevPile.slice(0, -1)
        };
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

      // allow opening when mustDraw (first player) or when mustDiscard (after draw)
      if (!(state.turnStep === "mustDraw" || state.turnStep === "mustDiscard")) throw new Error("INVALID_STEP");

      const hand = state.hands[action.playerId] ?? [];

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

      // validate opening requirements
      const openRes = validateOpeningRequirements(meldObjs, state.okey, true);
      if (!openRes.ok) throw new Error("OPENING_REQUIREMENTS_NOT_MET");

      // remove tiles from hand and add to tableMelds
      const newHands = { ...state.hands };
      for (const tiles of meldObjs) {
        for (const t of tiles) {
          newHands[action.playerId] = newHands[action.playerId].filter((x) => x.id !== t.id);
        }
      }

      const nextMelds = (state.tableMelds ?? []).slice();
      for (const tiles of meldObjs) {
        nextMelds.push({ meldId: randomUUID(), playerId: action.playerId, tiles });
      }

      // after opening, player must discard
      return { ...state, hands: newHands, tableMelds: nextMelds, turnStep: "mustDiscard" };
    }

    case "LAYOFF": {
      if (state.phase !== "turn") throw new Error("BAD_PHASE");
      if (state.currentPlayerId !== action.playerId) throw new Error("NOT_YOUR_TURN");
      if (state.turnStep !== "mustDiscard") throw new Error("INVALID_STEP");

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

      const newMelds = (state.tableMelds ?? []).map((m) => (m.meldId === table.meldId ? { ...m, tiles: m.tiles.concat(tiles) } : m));

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
      for (const tiles of meldObjs) nextMelds.push({ meldId: randomUUID(), playerId: action.playerId, tiles });

      return { ...state, discardPiles: newDiscardPiles, hands: newHands, tableMelds: nextMelds, turnStep: "mustDiscard" };
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
      return {
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