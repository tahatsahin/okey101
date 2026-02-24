import { randomUUID } from "crypto";
import type { RoomId, PlayerId, Tile, GameStateServer } from "@okey/shared";
import { startTurnGame } from "../game/gameLogic.js";
import type { LobbyPlayer } from "./roomTypes.js";


type JoinArgs = { roomId: RoomId; socketId: string; name: string };

type RoomRuntime = {
  roomId: RoomId;
  players: LobbyPlayer[];
  state: GameStateServer;
  version: number;
};


type JoinResult =
  | { ok: true; playerId: PlayerId; roomId: RoomId }
  | { ok: false; error: "ROOM_FULL" | "NAME_TAKEN" };

type ReadyResult =
  | { ok: true }
  | { ok: false; error: "NOT_IN_ROOM" };

type StartResult =
  | { ok: true }
  | { ok: false; error: "NOT_IN_ROOM" | "NOT_HOST" | "NEED_4_PLAYERS" | "NOT_ALL_READY" | "BAD_PHASE" };

type DrawResult =
  | { ok: true }
  | { ok: false; error: "NOT_IN_ROOM" | "BAD_PHASE" | "NOT_YOUR_TURN" | "INVALID_STEP" | "DECK_EMPTY" };

type DiscardResult =
  | { ok: true }
  | { ok: false; error: "NOT_IN_ROOM" | "BAD_PHASE" | "NOT_YOUR_TURN" | "INVALID_STEP" | "TILE_NOT_IN_HAND" };

export class RoomRegistry {
  private rooms = new Map<RoomId, RoomRuntime>();
  private socketToPlayer = new Map<string, { roomId: RoomId; playerId: PlayerId }>();

  private getOrCreate(roomId: RoomId): RoomRuntime {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        roomId,
        players: [],
        state: { phase: "lobby", roomId, players: [] },
        version: 0
      };
      this.rooms.set(roomId, room);
    }
    return room;
  }

  joinRoom(args: JoinArgs): JoinResult {
    const room = this.getOrCreate(args.roomId);

    if (room.players.length >= 4) return { ok: false, error: "ROOM_FULL" };
    if (room.players.some((p) => p.name === args.name)) return { ok: false, error: "NAME_TAKEN" };

    const playerId = randomUUID();
    const player: LobbyPlayer = {
      playerId,
      name: args.name,
      socketId: args.socketId,
      ready: false
    };

    room.players.push(player);
    this.socketToPlayer.set(args.socketId, { roomId: room.roomId, playerId });

    // keep state players in sync
    room.state = {
      phase: "lobby",
      roomId: room.roomId,
      players: room.players.map((p) => ({ playerId: p.playerId, name: p.name, ready: p.ready }))
    };

    return { ok: true, playerId, roomId: room.roomId };
  }

  setReady(socketId: string, ready: boolean): ReadyResult {
    const meta = this.socketToPlayer.get(socketId);
    if (!meta) return { ok: false, error: "NOT_IN_ROOM" };

    const room = this.rooms.get(meta.roomId);
    if (!room) return { ok: false, error: "NOT_IN_ROOM" };

    const p = room.players.find((x) => x.playerId === meta.playerId);
    if (!p) return { ok: false, error: "NOT_IN_ROOM" };

    p.ready = ready;

    // sync lobby state
    if (room.state.phase === "lobby") {
      room.state = {
        phase: "lobby",
        roomId: room.roomId,
        players: room.players.map((pl) => ({ playerId: pl.playerId, name: pl.name, ready: pl.ready }))
      };
    } else {
      // also keep player readiness mirrored in turn state
      room.state = {
        ...room.state,
        players: room.players.map((pl) => ({ playerId: pl.playerId, name: pl.name, ready: pl.ready }))
      } as GameStateServer;
    }

    room.version++;
    return { ok: true };
  }

  startGame(socketId: string): StartResult {
    const meta = this.socketToPlayer.get(socketId);
    if (!meta) return { ok: false, error: "NOT_IN_ROOM" };

    const room = this.rooms.get(meta.roomId);
    if (!room) return { ok: false, error: "NOT_IN_ROOM" };

    const hostId = room.players[0]?.playerId;
    if (!hostId) return { ok: false, error: "NEED_4_PLAYERS" };
    if (meta.playerId !== hostId) return { ok: false, error: "NOT_HOST" };

    if (room.state.phase !== "lobby") return { ok: false, error: "BAD_PHASE" };
    if (room.players.length !== 4) return { ok: false, error: "NEED_4_PLAYERS" };
    if (!room.players.every((p) => p.ready)) return { ok: false, error: "NOT_ALL_READY" };

    room.state = startTurnGame(room.state);
    room.version++;
    return { ok: true };
  }

  draw(socketId: string): DrawResult {
    const meta = this.socketToPlayer.get(socketId);
    if (!meta) return { ok: false, error: "NOT_IN_ROOM" };

    const room = this.rooms.get(meta.roomId);
    if (!room) return { ok: false, error: "NOT_IN_ROOM" };

    const state = room.state;
    if (state.phase !== "turn") return { ok: false, error: "BAD_PHASE" };
    if (state.currentPlayerId !== meta.playerId) return { ok: false, error: "NOT_YOUR_TURN" };
    if (state.turnStep !== "mustDraw") return { ok: false, error: "INVALID_STEP" };

    const tile = state.deck.pop();
    if (tile == null) return { ok: false, error: "DECK_EMPTY" };

    state.hands[meta.playerId]!.push(tile);
    state.turnStep = "mustDiscard";

    room.version++;
    return { ok: true };
  }

  discard(socketId: string, tile: Tile): DiscardResult {
    const meta = this.socketToPlayer.get(socketId);
    if (!meta) return { ok: false, error: "NOT_IN_ROOM" };

    const room = this.rooms.get(meta.roomId);
    if (!room) return { ok: false, error: "NOT_IN_ROOM" };

    const state = room.state;
    if (state.phase !== "turn") return { ok: false, error: "BAD_PHASE" };
    if (state.currentPlayerId !== meta.playerId) return { ok: false, error: "NOT_YOUR_TURN" };
    if (state.turnStep !== "mustDiscard") return { ok: false, error: "INVALID_STEP" };

    const hand = state.hands[meta.playerId]!;
    const idx = hand.indexOf(tile);
    if (idx === -1) return { ok: false, error: "TILE_NOT_IN_HAND" };

    hand.splice(idx, 1);
    state.discardPile.push(tile);

    // advance to next player in seating order
    const order = state.players.map((p) => p.playerId);
    const curIdx = order.indexOf(state.currentPlayerId);
    const next = order[(curIdx + 1) % order.length]!;
    state.currentPlayerId = next;
    state.turnStep = "mustDraw";

    room.version++;
    return { ok: true };
  }

  onDisconnect(socketId: string): Array<{ roomId: RoomId }> {
    const meta = this.socketToPlayer.get(socketId);
    if (!meta) return [];

    const room = this.rooms.get(meta.roomId);
    if (!room) return [];

    room.players = room.players.filter((p) => p.socketId !== socketId);
    this.socketToPlayer.delete(socketId);

    // if room empty, delete it
    if (room.players.length === 0) {
      this.rooms.delete(meta.roomId);
      return [];
    }

    // reset to lobby if someone leaves during game (simple MVP)
    room.state = {
      phase: "lobby",
      roomId: room.roomId,
      players: room.players.map((p) => ({ playerId: p.playerId, name: p.name, ready: false }))
    };
    room.players.forEach((p) => (p.ready = false));
    room.version++;

    return [{ roomId: room.roomId }];
  }

  getRoomState(roomId: RoomId): GameStateServer | undefined {
    return this.rooms.get(roomId)?.state;
  }

  getRoomVersion(roomId: RoomId): number {
    return this.rooms.get(roomId)?.version ?? 0;
  }

  getPlayerMeta(socketId: string): { roomId: RoomId; playerId: PlayerId } | undefined {
    return this.socketToPlayer.get(socketId);
  }

  getRoomSockets(roomId: RoomId): string[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return room.players.map((p) => p.socketId);
  }
}

export const roomRegistry = new RoomRegistry();