const COLORS = ["red", "black", "blue", "yellow"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
function nextValue(v) {
    return (v === 13 ? 1 : (v + 1));
}
export function makeDeck() {
    const deck = [];
    for (const color of COLORS) {
        for (const value of VALUES) {
            deck.push({ id: `n-${color}-${value}-1`, kind: "normal", color, value, copy: 1 });
            deck.push({ id: `n-${color}-${value}-2`, kind: "normal", color, value, copy: 2 });
        }
    }
    deck.push({ id: "fj-1", kind: "fakeJoker", copy: 1 });
    deck.push({ id: "fj-2", kind: "fakeJoker", copy: 2 });
    return deck;
}
export function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
}
function pickIndicatorAndOkey(deck) {
    // We must not allow indicator to be fake joker.
    // Strategy: pop until normal tile; if fake joker appears, put it back and reshuffle.
    // Safety cap prevents infinite loops if something is wrong.
    const MAX_ATTEMPTS = 20;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const candidate = deck.pop();
        if (!candidate)
            throw new Error("DECK_EMPTY");
        if (candidate.kind === "normal") {
            const okey = { color: candidate.color, value: nextValue(candidate.value) };
            return { indicator: candidate, okey };
        }
        // candidate is fake joker -> put it back and reshuffle remaining deck
        deck.push(candidate);
        shuffleInPlace(deck);
    }
    throw new Error("FAILED_TO_PICK_INDICATOR");
}
export function startTurnGame(prev) {
    if (prev.phase !== "lobby")
        throw new Error("BAD_PHASE");
    const playerIds = prev.players.map((p) => p.playerId);
    if (playerIds.length !== 4)
        throw new Error("NEED_4_PLAYERS");
    if (!prev.players.every((p) => p.ready))
        throw new Error("NOT_ALL_READY");
    const deck = makeDeck();
    shuffleInPlace(deck);
    const { indicator, okey } = pickIndicatorAndOkey(deck);
    const hands = Object.fromEntries(playerIds.map((id) => [id, []]));
    // MVP dealing: 14 each
    for (let round = 0; round < 21; round++) {
        for (const pid of playerIds) {
            const t = deck.pop();
            if (!t)
                throw new Error("DECK_EMPTY");
            hands[pid].push(t);
        }
    }
    const currentPlayerId = playerIds[0];
    return {
        phase: "turn",
        roomId: prev.roomId,
        players: prev.players,
        currentPlayerId,
        turnStep: "mustDraw",
        deck,
        discardPiles: Object.fromEntries(playerIds.map((id) => [id, []])),
        hands,
        indicator,
        okey
    };
}
export function toClientView(state, you) {
    if (state.phase === "lobby")
        return state;
    const s = state;
    const yourHand = s.hands[you] ?? [];
    const otherHandCounts = {};
    for (const p of s.players) {
        otherHandCounts[p.playerId] = (s.hands[p.playerId] ?? []).length;
    }
    const view = {
        phase: "turn",
        roomId: s.roomId,
        players: s.players,
        currentPlayerId: s.currentPlayerId,
        turnStep: s.turnStep,
        deckCount: s.deck.length,
        discardPiles: s.discardPiles,
        yourHand,
        otherHandCounts,
        indicator: s.indicator,
        okey: s.okey
    };
    return view;
}
