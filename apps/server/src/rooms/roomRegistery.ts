import { randomUUID } from "crypto";
import type { RoomId, PlayerId, RoomState, LobbyPlayer } from "./roomTypes.js";

type JoinArgs = { roomId: RoomId; socketId: string; name: string };

type JoinResult = 
    | { ok: true; roomState: RoomState; playerId: PlayerId }
    | { ok: false; error: "ROOM_FULL" | "ROOM_NOT_FOUND" | "NAME_TAKEN" };

type DisconnectUpdate = { roomId: RoomId; roomState: RoomState };

class RoomRegistery {
    private rooms = new Map<RoomId, { roomId: RoomId; players: LobbyPlayer[] }>();

    // TODO: change later
    private getOrCreate(roomId: RoomId) {
        let room = this.rooms.get(roomId);
        if (!room) {
            room = { roomId, players: [] };
            this.rooms.set(roomId, room);
        }
        return room;
    }

    joinRoom(args: JoinArgs): JoinResult {
        const room = this.getOrCreate(args.roomId);

        if (room.players.length >= 4) return { ok: false, error: "ROOM_FULL" };
        if (room.players.some((p) => p.name === args.name)) return { ok: false, error: "NAME_TAKEN" };

        const playerId = randomUUID();
        room.players.push({
            playerId,
            name: args.name,
            socketId: args.socketId,
            ready: false
        })
        return { ok: true, playerId, roomState: this.toState(room.roomId) };
    }

    onDisconnect(socketId: string): DisconnectUpdate[] {
        const updates : DisconnectUpdate[] = [];

        for (const room of this.rooms.values()) {
            const before = room.players.length;
            room.players = room.players.filter((p) => p.socketId !== socketId);
            if (room.players.length !== before) {
                updates.push({ roomId: room.roomId, roomState: this.toState(room.roomId) });
            }
        }

        return updates;
    }

    private toState(roomId: RoomId): RoomState {
        const room = this.rooms.get(roomId);
        if (!room) return { roomId, players: [] };
        return { roomId: room.roomId, players: room.players.map((p) => ({ ...p })) };
    }
}

export const roomRegistery = new RoomRegistery();