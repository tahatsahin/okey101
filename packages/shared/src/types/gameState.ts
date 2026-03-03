import type { PlayerId, RoomId, Tile, OkeyInfo, TileColor, TileValue, TeamId } from "./ids.js";

export type LobbyPlayerPublic = {
  playerId: PlayerId;
  name: string;
  ready: boolean;
  isBot?: boolean;
  teamId?: TeamId;
  seatIndex?: number;
};

export type GameOptions = {
  teamMode: boolean;
};

export type LobbyState = {
  phase: "lobby";
  roomId: RoomId;
  players: LobbyPlayerPublic[];
  options: GameOptions;
};

export type TurnStep = "mustDraw" | "mustDiscard" | "mustMeldDiscard";

export type TableMeldTile = Tile & {
  assigned?: { color: TileColor; value: TileValue };
};

export type Penalty = { playerId: PlayerId; points: number; reason?: string };

export type HandEndReason = "WIN" | "DECK_EMPTY" | "ALL_PAIRS";

export type HandResult = {
  reason: HandEndReason;
  winnerId?: PlayerId;
  penalties: Penalty[];
};

export type TurnStateServer = {
  phase: "turn";
  roomId: RoomId;
  players: LobbyPlayerPublic[];
  options: GameOptions;
  currentPlayerId: PlayerId;
  turnStep: TurnStep;
  takenDiscard?: { fromPlayerId: PlayerId; tile: Tile };
  openedBy: Record<PlayerId, "none" | "runsSets" | "pairs">;
  handHistory: HandResult[];
  dealerIndex: number;

  deck: Tile[];

  discardPiles: Record<PlayerId, Tile[]>;
  hands: Record<PlayerId, Tile[]>;

  indicator: Tile;
  okey: OkeyInfo;
  tableMelds?: { meldId: string; playerId: PlayerId; tiles: TableMeldTile[] }[];
  penalties?: Penalty[];
};

export type HandEndState = {
  phase: "handEnd";
  roomId: RoomId;
  players: LobbyPlayerPublic[];
  options: GameOptions;
  result: HandResult;
  handHistory: HandResult[];
  dealerIndex: number;
  roundNumber: number;
  maxRounds: number;
  matchOver: boolean;
};

export type GameStateServer = LobbyState | TurnStateServer | HandEndState;

export type TurnStateClient = {
  phase: "turn";
  roomId: RoomId;
  players: LobbyPlayerPublic[];
  options: GameOptions;
  currentPlayerId: PlayerId;
  turnStep: TurnStep;
  takenDiscard?: { fromPlayerId: PlayerId; tile: Tile };
  openedBy: Record<PlayerId, "none" | "runsSets" | "pairs">;
  dealerIndex: number;

  deckCount: number;

  discardPiles: Record<PlayerId, Tile[]>;
  yourHand: Tile[];
  otherHandCounts: Record<PlayerId, number>;

  indicator: Tile;
  okey: OkeyInfo;
  tableMelds: { meldId: string; playerId: PlayerId; tiles: TableMeldTile[] }[];
  penalties: Penalty[];
};

export type GameStateClient = LobbyState | TurnStateClient | HandEndState;
