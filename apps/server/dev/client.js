import { io } from "socket.io-client";
import readline from "node:readline";
const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3001";
const ROOM_ID = process.env.ROOM_ID ?? "room1";
const NAME = process.env.NAME ?? `p-${Math.floor(Math.random() * 1000)}`;
const TOKEN = process.env.TOKEN; // optional reconnect token
const socket = io(SERVER_URL, { transports: ["websocket"] });
let last = null;
let myToken = TOKEN;
socket.on("connect", () => {
    log(`connected socket.id=${socket.id}`);
    joinRoom();
});
socket.on("game:state", (payload) => {
    last = payload;
    log(`game:state v=${last?.version ?? "?"}`);
    pretty(last?.state);
});
function joinRoom() {
    socket.emit("room:join", { roomId: ROOM_ID, name: NAME, token: myToken }, (ack) => {
        log(`join ack: ${JSON.stringify(ack)}`);
        if (ack.ok) {
            myToken = ack.token;
            log(`SAVE THIS TOKEN for reconnect: ${myToken}`);
            help();
        }
    });
}
function help() {
    console.log(`
Commands:
  help
  ready on|off
  start
  draw
  hand
  discard <tileId>
  quit

Tip:
  - Use 'hand' to see tile ids.
  - Discard uses tileId now (e.g. discard n-red-5-1)
`);
}
function log(msg) {
    console.log(`[${NAME}] ${msg}`);
}
function pretty(obj) {
    console.dir(obj, { depth: 6, colors: true });
}
function fmtTile(t) {
    if (t.kind === "fakeJoker")
        return `${t.id} (fakeJoker)`;
    return `${t.id} (${t.color} ${t.value})`;
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", (line) => {
    const [cmd, arg] = line.trim().split(/\s+/, 2);
    if (!cmd)
        return;
    switch (cmd) {
        case "help":
            help();
            break;
        case "ready": {
            const ready = arg === "on" ? true : arg === "off" ? false : null;
            if (ready == null)
                return log("usage: ready on|off");
            socket.emit("room:ready", { ready }, (ack) => log(`ready ack: ${JSON.stringify(ack)}`));
            break;
        }
        case "start":
            socket.emit("game:start", {}, (ack) => log(`start ack: ${JSON.stringify(ack)}`));
            break;
        case "draw":
            socket.emit("move:draw", {}, (ack) => log(`draw ack: ${JSON.stringify(ack)}`));
            break;
        case "hand": {
            const s = last?.state;
            if (!s)
                return log("no state yet");
            if (s.phase !== "turn")
                return log(`phase=${s.phase} (no hand)`);
            console.log(s.yourHand.map(fmtTile).join("\n"));
            break;
        }
        case "discard": {
            if (!arg)
                return log("usage: discard <tileId>");
            socket.emit("move:discard", { tileId: arg }, (ack) => log(`discard ack: ${JSON.stringify(ack)}`));
            break;
        }
        case "quit":
        case "exit":
            rl.close();
            socket.disconnect();
            process.exit(0);
        default:
            log(`unknown command: ${cmd}`);
    }
});
