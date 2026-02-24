import { randomUUID } from "crypto";
import { reduce } from "../game/reducer.js";
export class RoomRegistry {
    rooms = new Map();
    socketToMeta = new Map();
    getOrCreate(roomId) {
        let room = this.rooms.get(roomId);
        if (!room) {
            room = {
                roomId,
                players: [],
                state: { phase: "lobby", roomId, players: [] },
                version: 0,
                tokenToPlayerId: new Map(),
                playerIdToToken: new Map()
            };
            this.rooms.set(roomId, room);
        }
        return room;
    }
    joinRoom(args) {
        const room = this.getOrCreate(args.roomId);
        // Reconnect flow: if token matches, reattach socketId to existing player
        if (args.token) {
            const existingPlayerId = room.tokenToPlayerId.get(args.token);
            if (existingPlayerId) {
                const p = room.players.find((x) => x.playerId === existingPlayerId);
                if (p) {
                    p.socketId = args.socketId;
                    this.socketToMeta.set(args.socketId, { roomId: room.roomId, playerId: existingPlayerId });
                    // keep name as-is or update it (we'll keep existing name)
                    return { ok: true, playerId: existingPlayerId, roomId: room.roomId, token: args.token };
                }
            }
        }
        if (room.players.length >= 4)
            return { ok: false, error: "ROOM_FULL" };
        if (room.players.some((p) => p.name === args.name))
            return { ok: false, error: "NAME_TAKEN" };
        const playerId = randomUUID();
        const token = randomUUID() + randomUUID(); // cheap long token
        room.players.push({
            playerId,
            name: args.name,
            socketId: args.socketId,
            ready: false
        });
        room.tokenToPlayerId.set(token, playerId);
        room.playerIdToToken.set(playerId, token);
        this.socketToMeta.set(args.socketId, { roomId: room.roomId, playerId });
        // sync lobby state from players list
        room.state = {
            phase: "lobby",
            roomId: room.roomId,
            players: room.players.map((p) => ({ playerId: p.playerId, name: p.name, ready: p.ready }))
        };
        room.version++;
        return { ok: true, playerId, roomId: room.roomId, token };
    }
    setReady(socketId, ready) {
        const meta = this.socketToMeta.get(socketId);
        if (!meta)
            return { ok: false, error: "NOT_IN_ROOM" };
        const room = this.rooms.get(meta.roomId);
        if (!room)
            return { ok: false, error: "NOT_IN_ROOM" };
        // mirror readiness into players list (used for host/seat order)
        const p = room.players.find((x) => x.playerId === meta.playerId);
        if (p)
            p.ready = ready;
        try {
            room.state = reduce(room.state, { type: "SET_READY", playerId: meta.playerId, ready });
            room.version++;
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: String(e?.message ?? e) };
        }
    }
    startGame(socketId) {
        const meta = this.socketToMeta.get(socketId);
        if (!meta)
            return { ok: false, error: "NOT_IN_ROOM" };
        const room = this.rooms.get(meta.roomId);
        if (!room)
            return { ok: false, error: "NOT_IN_ROOM" };
        try {
            room.state = reduce(room.state, { type: "START_GAME", playerId: meta.playerId });
            room.version++;
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: String(e?.message ?? e) };
        }
    }
    draw(socketId, source) {
        const meta = this.socketToMeta.get(socketId);
        if (!meta)
            return { ok: false, error: "NOT_IN_ROOM" };
        const room = this.rooms.get(meta.roomId);
        if (!room)
            return { ok: false, error: "NOT_IN_ROOM" };
        try {
            room.state = reduce(room.state, { type: "DRAW", playerId: meta.playerId, source });
            room.version++;
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: String(e?.message ?? e) };
        }
    }
    discard(socketId, tileId) {
        const meta = this.socketToMeta.get(socketId);
        if (!meta)
            return { ok: false, error: "NOT_IN_ROOM" };
        const room = this.rooms.get(meta.roomId);
        if (!room)
            return { ok: false, error: "NOT_IN_ROOM" };
        try {
            room.state = reduce(room.state, { type: "DISCARD", playerId: meta.playerId, tileId });
            room.version++;
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: String(e?.message ?? e) };
        }
    }
    onDisconnect(socketId) {
        const meta = this.socketToMeta.get(socketId);
        if (!meta)
            return [];
        const room = this.rooms.get(meta.roomId);
        if (!room)
            return [];
        // don’t delete player (reconnect), just clear socket binding
        this.socketToMeta.delete(socketId);
        const p = room.players.find((x) => x.playerId === meta.playerId);
        if (p)
            p.socketId = "";
        return [{ roomId: room.roomId }];
    }
    getRoomState(roomId) {
        return this.rooms.get(roomId)?.state;
    }
    getRoomVersion(roomId) {
        return this.rooms.get(roomId)?.version ?? 0;
    }
    getPlayerMeta(socketId) {
        return this.socketToMeta.get(socketId);
    }
    /** sockets currently connected in room */
    getRoomSockets(roomId) {
        const room = this.rooms.get(roomId);
        if (!room)
            return [];
        return room.players.map((p) => p.socketId).filter(Boolean);
    }
}
export const roomRegistry = new RoomRegistry();
