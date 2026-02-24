import type { PlayerId, RoomId, Tile } from "./ids.js";

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

  deck: Tile[]; // server keeps full deck
  discardPile: Tile[];

  hands: Record<PlayerId, Tile[]>;
};

export type GameStateServer = LobbyState | TurnStateServer;

/** What clients receive (no deck order, no other hands). */
export type TurnStateClient = {
  phase: "turn";
  roomId: RoomId;
  players: LobbyPlayerPublic[];

  currentPlayerId: PlayerId;
  turnStep: "mustDraw" | "mustDiscard";

  deckCount: number;
  discardPile: Tile[];

  yourHand: Tile[];
  otherHandCounts: Record<PlayerId, number>;
};

export type GameStateClient = LobbyState | TurnStateClient;
