import type { Server } from "socket.io";
import { C2S, C2S_EVENT, S2C_EVENT, C2S_EXTRA, C2S_EXTRA_EVENT } from "@okey/shared";
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
      io.to(socketId).emit(S2C_EVENT.gameState, {
        state: view,
        version: roomRegistry.getRoomVersion(roomId),
        youPlayerId: meta.playerId
      });
    }
  }

  roomRegistry.setNotifier(emitGameStateToRoom);

  io.on("connection", (socket) => {
    socket.on(C2S_EVENT.roomJoin, (payload, ack) => {
      const parsed = C2S.roomJoin.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const { roomId, name, token, seatIndex } = parsed.data;

      const joinArgs =
        token === undefined
          ? { roomId, socketId: socket.id, name, seatIndex }
          : { roomId, socketId: socket.id, name, token, seatIndex };

      const result = roomRegistry.joinRoom(joinArgs);
      if (!result.ok) return ack?.({ ok: false, error: result.error });

      socket.join(roomId);

      emitGameStateToRoom(roomId);
      ack?.({ ok: true, playerId: result.playerId, roomId, token: result.token });
    });

    socket.on(C2S_EVENT.roomReady, (payload, ack) => {
      const parsed = C2S.roomReady.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.setReady(socket.id, parsed.data.ready);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on(C2S_EVENT.roomSetOptions, (payload, ack) => {
      const parsed = C2S.roomSetOptions.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.setOptions(socket.id, parsed.data);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on(C2S_EVENT.roomAddBot, (_payload, ack) => {
      const parsed = C2S.roomAddBot.safeParse(_payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.addBot(socket.id);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on(C2S_EVENT.gameStart, (_payload, ack) => {
      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.startGame(socket.id);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on(C2S_EVENT.moveDraw, (payload, ack) => {
      const parsed = C2S.moveDraw.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.draw(socket.id, parsed.data.source);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on(C2S_EVENT.moveDiscard, (payload, ack) => {
      const parsed = C2S.moveDiscard.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.discard(socket.id, parsed.data.tileId);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on(C2S_EVENT.moveReturnDiscard, (payload, ack) => {
      const parsed = C2S.moveReturnDiscard.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.returnTakenDiscard(socket.id);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    // --- new meld/layoff/take-and-meld handlers ---

    socket.on(C2S_EXTRA_EVENT.moveOpen, (payload, ack) => {
      const parsed = C2S_EXTRA.moveOpen.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.openMeld(socket.id, parsed.data.melds);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on(C2S_EXTRA_EVENT.moveLayoff, (payload, ack) => {
      const parsed = C2S_EXTRA.moveLayoff.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.layoff(socket.id, parsed.data.tableMeldId, parsed.data.tileIds);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on(C2S_EXTRA_EVENT.moveTakeAndMeld, (payload, ack) => {
      const parsed = C2S_EXTRA.moveTakeAndMeld.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.takeAndMeld(socket.id, parsed.data.fromPlayerId, parsed.data.melds);
      if (!res.ok) return ack?.(res);

      emitGameStateToRoom(meta.roomId);
      ack?.({ ok: true });
    });

    socket.on(C2S_EXTRA_EVENT.moveReorder, (payload, ack) => {
      const parsed = C2S_EXTRA.moveReorder.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: "INVALID_PAYLOAD" });

      const meta = roomRegistry.getPlayerMeta(socket.id);
      if (!meta) return ack?.({ ok: false, error: "NOT_IN_ROOM" });

      const res = roomRegistry.reorderHand(socket.id, parsed.data.tileIds);
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
