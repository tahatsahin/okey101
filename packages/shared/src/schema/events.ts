import { z } from "zod";

// ---- shared payload schemas ----
const TileColor = z.enum(["red", "black", "blue", "yellow"]);
const TileValue = z.number().int().min(1).max(13);
const TileCopy = z.union([z.literal(1), z.literal(2)]);

const TileNormal = z.object({
  id: z.string().min(1),
  kind: z.literal("normal"),
  color: TileColor,
  value: TileValue,
  copy: TileCopy
});

const TileFakeJoker = z.object({
  id: z.string().min(1),
  kind: z.literal("fakeJoker"),
  copy: TileCopy
});

const Tile = z.discriminatedUnion("kind", [TileNormal, TileFakeJoker]);

const OkeyInfo = z.object({
  color: TileColor,
  value: TileValue
});

const TableMeldTile = Tile.and(
  z.object({
    assigned: z
      .object({
        color: TileColor,
        value: TileValue
      })
      .optional()
  })
);

const LobbyPlayerPublic = z.object({
  playerId: z.string().min(1),
  name: z.string().min(1),
  ready: z.boolean(),
  isBot: z.boolean().optional(),
  teamId: z.enum(["A", "B"]).optional(),
  seatIndex: z.number().int().min(0).max(3).optional()
});

const GameOptions = z.object({
  teamMode: z.boolean(),
  increasingMeldLimit: z.boolean(),
  penaltyDiscardJoker: z.number().int().nonnegative(),
  penaltyDiscardExtendable: z.number().int().nonnegative(),
  penaltyFailedOpening: z.number().int().nonnegative(),
  penaltyNoOpen: z.number().int().nonnegative(),
  pairsMultiplier: z.number().int().positive()
});

const Penalty = z.object({
  playerId: z.string().min(1),
  points: z.number().int(),
  reason: z.string().optional()
});

const HandResult = z.object({
  reason: z.enum(["WIN", "DECK_EMPTY", "ALL_PAIRS"]),
  winnerId: z.string().min(1).optional(),
  penalties: z.array(Penalty)
});

const LobbyState = z.object({
  phase: z.literal("lobby"),
  roomId: z.string().min(1),
  players: z.array(LobbyPlayerPublic),
  options: GameOptions,
  hostId: z.string().min(1).optional()
});

const TurnStateClient = z.object({
  phase: z.literal("turn"),
  roomId: z.string().min(1),
  players: z.array(LobbyPlayerPublic),
  options: GameOptions,
  hostId: z.string().min(1).optional(),
  currentPlayerId: z.string().min(1),
  turnStep: z.enum(["mustDraw", "mustDiscard", "mustMeldDiscard"]),
  takenDiscard: z
    .object({
      fromPlayerId: z.string().min(1),
      tile: Tile
    })
    .optional(),
  openedBy: z.record(z.string().min(1), z.enum(["none", "runsSets", "pairs"])),
  openingLimit: z.number().int().nonnegative(),
  notice: z.lazy(() => TurnNotice).optional(),
  handHistory: z.array(HandResult),
  dealerIndex: z.number().int(),
  deckCount: z.number().int().nonnegative(),
  discardPiles: z.record(z.string().min(1), z.array(Tile)),
  yourHand: z.array(Tile),
  otherHandCounts: z.record(z.string().min(1), z.number().int().nonnegative()),
  indicator: Tile,
  okey: OkeyInfo,
  tableMelds: z.array(
    z.object({
      meldId: z.string().min(1),
      playerId: z.string().min(1),
      tiles: z.array(TableMeldTile)
    })
  ),
  penalties: z.array(Penalty)
});

const HandEndState = z.object({
  phase: z.literal("handEnd"),
  roomId: z.string().min(1),
  players: z.array(LobbyPlayerPublic),
  options: GameOptions,
  hostId: z.string().min(1).optional(),
  result: HandResult,
  handHistory: z.array(HandResult),
  dealerIndex: z.number().int(),
  roundNumber: z.number().int(),
  maxRounds: z.number().int(),
  matchOver: z.boolean()
});

const TurnNotice = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("OPENING_LIMIT"),
    playerId: z.string().min(1),
    required: z.number().int().nonnegative(),
    total: z.number().int().nonnegative()
  })
]);

export const GameStateClientSchema = z.discriminatedUnion("phase", [LobbyState, TurnStateClient, HandEndState]);

// ---- client -> server ----
export const C2S = {
  roomJoin: z.object({
    roomId: z.string().min(3).max(32),
    name: z.string().min(1).max(24),
    token: z.string().min(10).optional(),
    seatIndex: z.number().int().min(0).max(3).optional(),
  }),
  roomReady: z.object({ ready: z.boolean() }),
  roomSetOptions: z.object({
    teamMode: z.boolean(),
    increasingMeldLimit: z.boolean(),
    penaltyDiscardJoker: z.number().int().nonnegative(),
    penaltyDiscardExtendable: z.number().int().nonnegative(),
    penaltyFailedOpening: z.number().int().nonnegative(),
    penaltyNoOpen: z.number().int().nonnegative(),
    pairsMultiplier: z.number().int().positive()
  }),
  roomAddBot: z.object({}),
  gameStart: z.object({}),
  moveDraw: z.object({ source: z.enum(["deck", "prevDiscard"]) }),
  moveDiscard: z.object({ tileId: z.string().min(1) }),
  moveReturnDiscard: z.object({}),
} as const;

// additional intents for melds / layoff
export const C2S_EXTRA = {
  moveOpen: z.object({ melds: z.array(z.array(z.string().min(1))) }),
  moveLayoff: z.object({ tableMeldId: z.string().min(1), tileIds: z.array(z.string().min(1)).min(1) }),
  moveTakeAndMeld: z.object({ fromPlayerId: z.string().min(1), melds: z.array(z.array(z.string().min(1))) }),
  moveReorder: z.object({ tileIds: z.array(z.string().min(1)) }),
} as const;

// ---- server -> client payload schemas ----
export const S2C = {
  gameState: z.object({
    version: z.number().int().nonnegative(),
    state: GameStateClientSchema,
    youPlayerId: z.string().optional(),
  }),
  error: z.object({ code: z.string(), message: z.string().optional() }),
} as const;

export const S2C_EXTRA = {
  meldApplied: z.object({ playerId: z.string(), meldCount: z.number().int() }),
  penaltyApplied: z.object({ playerId: z.string(), points: z.number().int(), reason: z.string().optional() }),
} as const;

export type C2SJoin = z.infer<(typeof C2S)["roomJoin"]>;
export type C2SReady = z.infer<(typeof C2S)["roomReady"]>;
export type C2SDiscard = z.infer<(typeof C2S)["moveDiscard"]>;
