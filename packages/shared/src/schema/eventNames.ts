export const C2S_EVENT = {
  roomJoin: "room:join",
  roomReady: "room:ready",
  roomAddBot: "room:addBot",
  gameStart: "game:start",
  moveDraw: "move:draw",
  moveDiscard: "move:discard",
  moveReturnDiscard: "move:returnDiscard",
} as const;

export const S2C_EVENT = {
  gameState: "game:state",
  error: "error",
} as const;

export type C2SEventName = (typeof C2S_EVENT)[keyof typeof C2S_EVENT];
export type S2CEventName = (typeof S2C_EVENT)[keyof typeof S2C_EVENT];

// new client->server intents for melds and layoff
export const C2S_EXTRA_EVENT = {
  moveMeld: "move:meld",
  moveOpen: "move:open",
  moveLayoff: "move:layoff",
  moveTakeAndMeld: "move:takeAndMeld",
} as const;

// new server->client events
export const S2C_EXTRA_EVENT = {
  meldApplied: "meld:applied",
  penaltyApplied: "penalty:applied",
} as const;
