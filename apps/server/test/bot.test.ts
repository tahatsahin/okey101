import type { Tile, TurnStateServer } from "@okey/shared";
import { RoomRegistry } from "../src/rooms/roomRegistry.js";

function simpleAssert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

function normalTile(id: string, color: Tile["color"], value: Tile["value"], copy: 1 | 2 = 1): Tile {
  return { id, kind: "normal", color, value, copy };
}

function setupRoomWithBot() {
  const rr = new RoomRegistry();
  const roomId = "bot-test-room";

  rr.joinRoom({ roomId, socketId: "s1", name: "Host" });
  rr.joinRoom({ roomId, socketId: "s2", name: "P2" });
  rr.joinRoom({ roomId, socketId: "s3", name: "P3" });

  const addRes = rr.addBot("s1");
  simpleAssert(addRes.ok, "host can add bot");

  rr.setReady("s1", true);
  rr.setReady("s2", true);
  rr.setReady("s3", true);

  const startRes = rr.startGame("s1");
  simpleAssert(startRes.ok, "game can start with bot");

  const room = (rr as any).rooms.get(roomId);
  return { rr, roomId, room };
}

function setBotTurnState(
  room: any,
  botId: string,
  okey: { color: Tile["color"]; value: Tile["value"] },
  deck: Tile[],
  hand: Tile[]
) {
  const s = room.state as TurnStateServer;
  room.state = {
    ...s,
    currentPlayerId: botId,
    turnStep: "mustDraw",
    okey,
    deck,
    hands: { ...s.hands, [botId]: hand },
    discardPiles: { ...s.discardPiles, [botId]: [] },
    penalties: []
  };
}

// --- addBot permissions ---
{
  const rr = new RoomRegistry();
  const roomId = "bot-perm";
  rr.joinRoom({ roomId, socketId: "h1", name: "Host" });
  rr.joinRoom({ roomId, socketId: "p2", name: "P2" });

  const notHost = rr.addBot("p2");
  simpleAssert(!notHost.ok && notHost.error === "NOT_HOST", "non-host cannot add bot");

  const okHost = rr.addBot("h1");
  simpleAssert(okHost.ok, "host can add bot");

  const state = rr.getRoomState(roomId) as any;
  const bot = state.players.find((p: any) => p.isBot);
  simpleAssert(!!bot, "bot added to lobby");
  simpleAssert(bot.ready === true, "bot is ready by default");
}

// --- bot turn behavior ---
{
  const { rr, roomId, room } = setupRoomWithBot();
  const botId = room.players.find((p: any) => p.isBot)?.playerId;
  simpleAssert(!!botId, "bot id present");
  if (!botId) process.exit(1);

  // Scenario A: draw okey, discard random non-okey (only one non-okey in hand)
  const okey = { color: "red", value: 5 as const };
  const drawnOkey = normalTile("n-red-5-1", "red", 5);
  const leftover = normalTile("n-yellow-3-1", "yellow", 3);
  const nonOkey = normalTile("n-blue-7-1", "blue", 7);
  setBotTurnState(room, botId, okey, [leftover, drawnOkey], [nonOkey]);

  (rr as any).runBotTurn(roomId); // draw
  const afterDrawA = room.state as TurnStateServer;
  simpleAssert(afterDrawA.turnStep === "mustDiscard", "bot draws from deck");

  (rr as any).runBotTurn(roomId); // discard
  const afterDiscardA = room.state as TurnStateServer;
  const botDiscardA = afterDiscardA.discardPiles[botId]?.at(-1);
  simpleAssert(botDiscardA?.id === nonOkey.id, "bot discards non-okey when drawn is okey");

  // Scenario B: draw non-okey, discard drawn tile
  const drawnNonOkey = normalTile("n-black-9-1", "black", 9);
  setBotTurnState(room, botId, okey, [leftover, drawnNonOkey], [nonOkey]);

  (rr as any).runBotTurn(roomId); // draw
  (rr as any).runBotTurn(roomId); // discard
  const afterDiscardB = room.state as TurnStateServer;
  const botDiscardB = afterDiscardB.discardPiles[botId]?.at(-1);
  simpleAssert(botDiscardB?.id === drawnNonOkey.id, "bot discards drawn tile when it is not okey");
}
