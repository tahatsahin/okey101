import type { PlayerId, RoomId, Tile, OkeyInfo } from "./ids.js";

export type LobbyPlayerPublic = {
  playerId: PlayerId;
  name: string;
  ready: boolean;
};

export type LobbyState = {
  phase: "lobby";
  roomId: RoomId;
  players: LobbyPlayerPublic[];
};

export type TurnStateServer = {
  phase: "turn";
  roomId: RoomId;
  players: LobbyPlayerPublic[];

  currentPlayerId: PlayerId;
  turnStep: "mustDraw" | "mustDiscard";

  deck: Tile[];
  discardPiles: Record<PlayerId, Tile[]>;

  hands: Record<PlayerId, Tile[]>;

  /** opened indicator tile */
  indicator: Tile;
  /** okey derived from indicator */
  okey: OkeyInfo;
};

export type GameStateServer = LobbyState | TurnStateServer;

/** What clients receive (no deck order, no other hands) */
export type TurnStateClient = {
  phase: "turn";
  roomId: RoomId;
  players: LobbyPlayerPublic[];

  currentPlayerId: PlayerId;
  turnStep: "mustDraw" | "mustDiscard";

  deckCount: number;
  discardPiles: Record<PlayerId, Tile[]>;

  yourHand: Tile[];
  otherHandCounts: Record<PlayerId, number>;

  indicator: Tile;
  okey: OkeyInfo;
};

export type GameStateClient = LobbyState | TurnStateClient;