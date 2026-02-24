import type {
  GameStateServer,
  GameStateClient,
  PlayerId,
  Tile,
  TurnStateServer,
  TurnStateClient
} from "@shared/index.js";

export function makeDeck(): Tile[] {
  const deck: Tile[] = [];
  for (let i = 1; i <= 106; i++) deck.push(i);
  return deck;
}

export function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

export function startTurnGame(prev: GameStateServer): TurnStateServer {
  if (prev.phase !== "lobby") throw new Error("Cannot start game unless in lobby");

  const playerIds = prev.players.map((p) => p.playerId);
  if (playerIds.length !== 4) throw new Error("Need 4 players");
  if (!prev.players.every((p) => p.ready)) throw new Error("All players must be ready");

  const deck = makeDeck();
  shuffleInPlace(deck);

  const hands: Record<PlayerId, Tile[]> = Object.fromEntries(playerIds.map((id) => [id, []]));

  for (let round = 0; round < 14; round++) {
    for (const pid of playerIds) {
      const t = deck.pop();
      if (t == null) throw new Error("Deck ran out while dealing");
      hands[pid].push(t);
    }
  }

  const currentPlayerId = playerIds[0]!;

  return {
    phase: "turn",
    roomId: prev.roomId,
    players: prev.players,
    currentPlayerId,
    turnStep: "mustDraw",
    deck,
    discardPile: [],
    hands
  };
}

export function toClientView(state: GameStateServer, you: PlayerId): GameStateClient {
  if (state.phase === "lobby") return state;

  const s = state;
  const yourHand = s.hands[you] ?? [];
  const otherHandCounts: Record<PlayerId, number> = {};

  for (const p of s.players) {
    otherHandCounts[p.playerId] = (s.hands[p.playerId] ?? []).length;
  }

  const view: TurnStateClient = {
    phase: "turn",
    roomId: s.roomId,
    players: s.players,
    currentPlayerId: s.currentPlayerId,
    turnStep: s.turnStep,
    deckCount: s.deck.length,
    discardPile: s.discardPile,
    yourHand,
    otherHandCounts
  };

  return view;
}
