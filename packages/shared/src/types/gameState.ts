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

export type TurnStep = "mustDraw" | "mustDiscard";

export type TurnStateServer = {
  phase: "turn";
  roomId: RoomId;
  players: LobbyPlayerPublic[];
  currentPlayerId: PlayerId;
  turnStep: TurnStep;

  deck: Tile[];

  discardPiles: Record<PlayerId, Tile[]>;
  hands: Record<PlayerId, Tile[]>;

  indicator: Tile;
  okey: OkeyInfo;
  tableMelds?: { meldId: string; playerId: PlayerId; tiles: Tile[] }[];
  penalties?: { playerId: PlayerId; points: number; reason?: string }[];
};

export type GameStateServer = LobbyState | TurnStateServer;

export type TurnStateClient = {
  phase: "turn";
  roomId: RoomId;
  players: LobbyPlayerPublic[];
  currentPlayerId: PlayerId;
  turnStep: TurnStep;

  deckCount: number;

  discardPiles: Record<PlayerId, Tile[]>;
  yourHand: Tile[];
  otherHandCounts: Record<PlayerId, number>;

  indicator: Tile;
  okey: OkeyInfo;
  tableMelds: { meldId: string; playerId: PlayerId; tiles: Tile[] }[];
  penalties: { playerId: PlayerId; points: number; reason?: string }[];
};

export type GameStateClient = LobbyState | TurnStateClient;