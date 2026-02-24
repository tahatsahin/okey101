import { io, type Socket } from "socket.io-client";
import readline from "node:readline";
import type { GameStateClient } from "@okey/shared";


type Ack = (res: any) => void;

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3001";
const ROOM_ID = process.env.ROOM_ID ?? "room1";
const NAME = process.env.NAME ?? `p-${Math.floor(Math.random() * 1000)}`;

const socket: Socket = io(SERVER_URL, {
  transports: ["websocket"], // force websocket, simpler for testing
});

let lastState: { version: number; state: GameStateClient } | null = null;

socket.on("connect", () => {
  log(`connected as socket.id=${socket.id}`);
  joinRoom();
});

socket.on("disconnect", () => {
  log("disconnected");
});

socket.on("connect_error", (err) => {
  log(`connect_error: ${String(err?.message ?? err)}`);
});

socket.on("game:state", (payload) => {
  lastState = payload as { version: number; state: GameStateClient };
  log(`game:state v=${lastState.version}`);
  pretty(lastState.state);
});

function joinRoom() {
  emitWithAck("room:join", { roomId: ROOM_ID, name: NAME }, (res) => {
    log(`join ack: ${JSON.stringify(res)}`);
    help();
  });
}

function emitWithAck(event: string, payload: any, ack?: Ack) {
  socket.emit(event, payload, (res: any) => ack?.(res));
}

function help() {
  console.log(`
Commands:
  help                 show this help
  ready on|off         toggle ready
  start                start game (host only = first joined)
  draw                 draw tile (if your turn and mustDraw)
  discard <n>           discard tile number n (mustDiscard)
  hand                 show yourHand from last state
  state                show last raw state (trimmed)
  quit                 exit
`);
}

function pretty(obj: any) {
  // keep output readable
  console.dir(obj, { depth: 6, colors: true });
}

function log(msg: string) {
  console.log(`[${NAME}] ${msg}`);
}

// ---- CLI ----
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on("line", (line) => {
  const [cmd, a1] = line.trim().split(/\s+/, 2);

  if (!cmd) return;

  switch (cmd) {
    case "help":
      help();
      return;

    case "ready": {
      const on = a1 === "on";
      const off = a1 === "off";
      if (!on && !off) {
        log(`usage: ready on|off`);
        return;
      }
      emitWithAck("room:ready", { ready: on }, (res) => log(`ready ack: ${JSON.stringify(res)}`));
      return;
    }

    case "start":
      emitWithAck("game:start", {}, (res) => log(`start ack: ${JSON.stringify(res)}`));
      return;

    case "draw":
      emitWithAck("move:draw", {}, (res) => log(`draw ack: ${JSON.stringify(res)}`));
      return;

    case "discard": {
      const n = Number(a1);
      if (!Number.isFinite(n)) {
        log(`usage: discard <number>`);
        return;
      }
      emitWithAck("move:discard", { tile: n }, (res) => log(`discard ack: ${JSON.stringify(res)}`));
      return;
    }

    case "hand": {
      const state = lastState?.state;
      if (!state) {
        log("no state yet");
        return;
      }
      if (state.phase !== "turn") {
        log(`not in turn phase (phase=${state.phase})`);
        return;
      }
      log(`yourHand: ${JSON.stringify(state.yourHand)}`);
    }

    case "state": {
      // avoid spamming: print the state only
      pretty(lastState?.state);
      return;
    }

    case "quit":
    case "exit":
      rl.close();
      socket.disconnect();
      process.exit(0);

    default:
      log(`unknown command: ${cmd} (type 'help')`);
  }
});
