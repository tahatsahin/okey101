import type { GameStateClient } from "@okey/shared";

export type ServerGameStatePayload = {
  version: number;
  state: GameStateClient;
  youPlayerId?: string;
};
