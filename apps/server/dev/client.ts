import { io, type Socket } from "socket.io-client";
import readline from "node:readline";
import type { GameStateClient, Tile } from "@okey/shared";

type JoinAck =
  | { ok: true; playerId: string; roomId: string; token: string }
  | { ok: false; error: string };

type SimpleAck = { ok: true } | { ok: false; error: string };

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3001";
const ROOM_ID = process.env.ROOM_ID ?? "room1";
const NAME = process.env.NAME ?? `p-${Math.floor(Math.random() * 1000)}`;
const TOKEN = process.env.TOKEN; // optional reconnect token

const socket: Socket = io(SERVER_URL, { transports: ["websocket"] });

let last: { version: number; state: GameStateClient; youPlayerId?: string } | null = null;
let myToken: string | undefined = TOKEN;

socket.on("connect", () => {
  log(`connected socket.id=${socket.id}`);
  joinRoom();
});

socket.on("game:state", (payload: unknown) => {
  last = payload as any;
  log(`game:state v=${last?.version ?? "?"}`);
  pretty(last?.state);
});

function joinRoom() {
  socket.emit("room:join", { roomId: ROOM_ID, name: NAME, token: myToken }, (ack: JoinAck) => {
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

function log(msg: string) {
  console.log(`[${NAME}] ${msg}`);
}

function pretty(obj: any) {
  console.dir(obj, { depth: 6, colors: true });
}

function fmtTile(t: Tile): string {
  if (t.kind === "fakeJoker") return `${t.id} (fakeJoker)`;
  return `${t.id} (${t.color} ${t.value})`;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.on("line", (line) => {
  const [cmd, arg] = line.trim().split(/\s+/, 2);
  if (!cmd) return;

  switch (cmd) {
    case "help":
      help();
      break;

    case "ready": {
      const ready = arg === "on" ? true : arg === "off" ? false : null;
      if (ready == null) return log("usage: ready on|off");
      socket.emit("room:ready", { ready }, (ack: SimpleAck) => log(`ready ack: ${JSON.stringify(ack)}`));
      break;
    }

    case "start":
      socket.emit("game:start", {}, (ack: SimpleAck) => log(`start ack: ${JSON.stringify(ack)}`));
      break;

    case "draw":
      socket.emit("move:draw", {}, (ack: SimpleAck) => log(`draw ack: ${JSON.stringify(ack)}`));
      break;

    case "hand": {
      const s = last?.state;
      if (!s) return log("no state yet");
      if (s.phase !== "turn") return log(`phase=${s.phase} (no hand)`);
      console.log(s.yourHand.map(fmtTile).join("\n"));
      break;
    }

    case "discard": {
      if (!arg) return log("usage: discard <tileId>");
      socket.emit("move:discard", { tileId: arg }, (ack: SimpleAck) => log(`discard ack: ${JSON.stringify(ack)}`));
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
