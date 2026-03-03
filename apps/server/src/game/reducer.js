import { startTurnGame } from "./gameLogic.js";
export function reduce(state, action) {
    switch (action.type) {
        case "SET_READY": {
            // readiness is lobby feature, but keep it mirrored even in turn for simplicity
            if (state.phase === "lobby") {
                return {
                    ...state,
                    players: state.players.map((p) => p.playerId === action.playerId ? { ...p, ready: action.ready } : p)
                };
            }
            if (state.phase === "turn") {
                return {
                    ...state,
                    players: state.players.map((p) => p.playerId === action.playerId ? { ...p, ready: action.ready } : p)
                };
            }
            return state;
        }
        case "START_GAME": {
            if (state.phase !== "lobby")
                throw new Error("BAD_PHASE");
            const hostId = state.hostId ?? state.players[0]?.playerId;
            if (!hostId)
                throw new Error("NEED_4_PLAYERS");
            if (action.playerId !== hostId)
                throw new Error("NOT_HOST");
            if (state.players.length !== 4)
                throw new Error("NEED_4_PLAYERS");
            if (!state.players.every((p) => p.ready))
                throw new Error("NOT_ALL_READY");
            return startTurnGame(state);
        }
        case "DRAW": {
            if (state.phase !== "turn")
                throw new Error("BAD_PHASE");
            if (state.currentPlayerId !== action.playerId)
                throw new Error("NOT_YOUR_TURN");
            if (state.turnStep !== "mustDraw")
                throw new Error("INVALID_STEP");
            let drawnTile = null;
            let nextDeck = state.deck;
            let nextDiscardPiles = state.discardPiles;
            const order = state.players.map((p) => p.playerId);
            const curIdx = order.indexOf(state.currentPlayerId);
            const prevPlayerId = order[(curIdx - 1 + order.length) % order.length];
            if (action.source === "deck") {
                const tile = state.deck[state.deck.length - 1];
                if (!tile)
                    throw new Error("DECK_EMPTY");
                drawnTile = tile;
                nextDeck = state.deck.slice(0, -1);
            }
            else {
                // draw from previous player's discard pile (top tile)
                const prevPile = state.discardPiles[prevPlayerId] ?? [];
                const tile = prevPile[prevPile.length - 1];
                if (!tile)
                    throw new Error("PREV_DISCARD_EMPTY");
                drawnTile = tile;
                nextDiscardPiles = {
                    ...state.discardPiles,
                    [prevPlayerId]: prevPile.slice(0, -1)
                };
            }
            return {
                ...state,
                deck: nextDeck,
                discardPiles: nextDiscardPiles,
                hands: {
                    ...state.hands,
                    [action.playerId]: [...(state.hands[action.playerId] ?? []), drawnTile]
                },
                turnStep: "mustDiscard"
            };
        }
        case "DISCARD": {
            if (state.phase !== "turn")
                throw new Error("BAD_PHASE");
            if (state.currentPlayerId !== action.playerId)
                throw new Error("NOT_YOUR_TURN");
            if (state.turnStep !== "mustDiscard")
                throw new Error("INVALID_STEP");
            const hand = state.hands[action.playerId] ?? [];
            const idx = hand.findIndex((t) => t.id === action.tileId);
            if (idx === -1)
                throw new Error("TILE_NOT_IN_HAND");
            const tile = hand[idx];
            const newHand = hand.slice(0, idx).concat(hand.slice(idx + 1));
            const order = state.players.map((p) => p.playerId);
            const curIdx = order.indexOf(state.currentPlayerId);
            const next = order[(curIdx + 1) % order.length];
            return {
                ...state,
                hands: { ...state.hands, [action.playerId]: newHand },
                discardPiles: {
                    ...state.discardPiles,
                    [action.playerId]: [...(state.discardPiles[action.playerId] ?? []), tile]
                },
                currentPlayerId: next,
                turnStep: "mustDraw"
            };
        }
        default:
            return state;
    }
}
