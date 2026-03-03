export const C2S_EVENT = {
    roomJoin: "room:join",
    roomReady: "room:ready",
    roomAddBot: "room:addBot",
    gameStart: "game:start",
    moveDraw: "move:draw",
    moveDiscard: "move:discard",
    moveReturnDiscard: "move:returnDiscard",
};
export const S2C_EVENT = {
    gameState: "game:state",
    error: "error",
};

export const C2S_EXTRA_EVENT = {
    moveMeld: "move:meld",
    moveOpen: "move:open",
    moveLayoff: "move:layoff",
    moveTakeAndMeld: "move:takeAndMeld",
    moveReorder: "move:reorder",
};

export const S2C_EXTRA_EVENT = {
    meldApplied: "meld:applied",
    penaltyApplied: "penalty:applied",
};
