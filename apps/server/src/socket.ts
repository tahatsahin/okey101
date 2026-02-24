import type { Server } from "socket.io";
import { C2S } from "@okey/shared";
import { roomRegistry } from "./rooms/roomRegistry.js";
import { toClientView } from "./game/gameLogic.js";

export function registerSocketHandlers(io: Server) {
  function emitGameStateToRoom(roomId: string) {
    const state = roomRegistry.getRoomState(roomId);
    if (!state) return;

    const sockets = roomRegistry.getRoomSockets(roomId);
    for (const socketId of sockets) {
      const meta = roomRegistry.getPlayerMeta(socketId);
      if (!meta) continue;

      const view = toClientView(state, meta.playerId);
      io.to(socketId).emit("game:state", {
        state: view,
        version: roomRegistry.getRoomVersion(roomId),
        youPlayerId: meta.playerId
      });
    }
  }

  io.on("connection", (socket) => {
    socket.on("room:join", (payload, ack) => {
      const parsed = C2S.roomJoin.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const { roomId, name, token } = parsed.data;

      const joinArgs =
        token === undefined
          ? { roomId, socketId: socket.id, name }
          : { roomId, socketId: socket.id, name, token };

      const result = roomRegistry.joinRoom(joinArgs);
      if (!result.ok) return ack?.({ ok: false, error: result.error });

      socket.join(roomId);

      emitGameStateToRoom(roomId);
      ack?.({ ok: true, playerId: result.playerId, roomId, token: result.token });
    });

    socket.on("room:ready", (payload, ack) => {
      const parsed = C2S.roomReady.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.setReady(socket.id, parsed.data.ready);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on("game:start", (_payload, ack) => {
      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.startGame(socket.id);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on("move:draw", (payload, ack) => {
      const parsed = C2S.moveDraw.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.draw(socket.id, parsed.data.source);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on("move:discard", (payload, ack) => {
      const parsed = C2S.moveDiscard.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.discard(socket.id, parsed.data.tileId);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on("disconnect", () => {
      const updates = roomRegistry.onDisconnect(socket.id);
      for (const u of updates) emitGameStateToRoom(u.roomId);
    });
  });
}