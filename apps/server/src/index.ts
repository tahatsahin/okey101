import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { registerSocketHandlers } from "./socket.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true
    }
});

app.get("/health", (_req, res) => {
    res.json({ ok: true });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV === "production") {
    const clientDist = path.join(__dirname, "../../web/dist");
    app.use(express.static(clientDist));
    app.get(/.*/, (_req, res) => {
        res.sendFile(path.join(clientDist, "index.html"));
    });
}

registerSocketHandlers(io);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
server.listen(PORT, () => {
    console.log(`server listening on http://localhost:${PORT}`)
});
