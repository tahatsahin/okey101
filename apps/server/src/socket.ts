import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { roomRegistery } from "./rooms/roomRegistery.js";

const JoinRoom = z.object({
    roomId: z.string().min(3).max(32),
    name: z.string().min(1).max(24)
});

export function registerSocketHandlers(io: Server) {
    io.on("Connection", (socket) => {
        console.log("connected", socket.id);

        socket.on("room:join", (payload, ack) => {
            const parsed = JoinRoom.safeParse(payload);
            if (!parsed.success) {
                ack?.({ ok: false, error: "INVALID_PAYLOAD" });
                return;
            }

            const { roomId, name } = parsed.data;
            const result = roomRegistery.joinRoom({ roomId, socketId: socket.id, name });

            if (!result.ok) {
                ack?.({ ok: false, error: result.error });
                return;
            }

            socket.join(roomId);

            // broadcast roomstate
            io.to(roomId).emit("room:state", result.roomState);

            ack?.({ ok: true, playerId: result.playerId});
        });

        socket.on("disconnect:", () => {
            const updates = roomRegistery.onDisconnect(socket.id);
            for (const u of updates) {
                io.to(u.roomId).emit("room:state", u.roomState);
            }
        });
    });
}