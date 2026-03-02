import type {
  GameStateServer,
  GameStateClient,
  PlayerId,
  Tile,
  TileColor,
  TileValue,
  TurnStateServer,
  TurnStateClient,
  OkeyInfo
} from "@okey/shared";

const COLORS: TileColor[] = ["red", "black", "blue", "yellow"];
const VALUES: TileValue[] = [1,2,3,4,5,6,7,8,9,10,11,12,13];

function nextValue(v: TileValue): TileValue {
  return (v === 13 ? 1 : (v + 1)) as TileValue;
}

export function makeDeck(): Tile[] {
  const deck: Tile[] = [];

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

export function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

function pickIndicatorAndOkey(deck: Tile[]): { indicator: Tile; okey: OkeyInfo } {
  // We must not allow indicator to be fake joker.
  // Strategy: pop until normal tile; if fake joker appears, put it back and reshuffle.
  // Safety cap prevents infinite loops if something is wrong.
  const MAX_ATTEMPTS = 20;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = deck.pop();
    if (!candidate) throw new Error("DECK_EMPTY");

    if (candidate.kind === "normal") {
      const okey: OkeyInfo = { color: candidate.color, value: nextValue(candidate.value) };
      return { indicator: candidate, okey };
    }

    // candidate is fake joker -> put it back and reshuffle remaining deck
    deck.push(candidate);
    shuffleInPlace(deck);
  }

  throw new Error("FAILED_TO_PICK_INDICATOR");
}


export function startTurnGame(prev: GameStateServer): TurnStateServer {
  if (prev.phase !== "lobby") throw new Error("BAD_PHASE");

  const playerIds = prev.players.map((p) => p.playerId);
  if (playerIds.length !== 4) throw new Error("NEED_4_PLAYERS");
  if (!prev.players.every((p) => p.ready)) throw new Error("NOT_ALL_READY");

  const deck = makeDeck();
  shuffleInPlace(deck);

  const { indicator, okey } = pickIndicatorAndOkey(deck);

  const hands: Record<PlayerId, Tile[]> = Object.fromEntries(playerIds.map((id) => [id, [] as Tile[]]));

  // Deal according to AGENTS.md: players get 21 tiles, player to dealer's right gets 22
  // Assume dealer is players[0]; first player to act is dealer's right
  const dealerIndex = 0;
  const firstIdx = (dealerIndex - 1 + playerIds.length) % playerIds.length;
  // distribute until targets met
  const targets: Record<PlayerId, number> = Object.fromEntries(playerIds.map((id) => [id, 21]));
  targets[playerIds[firstIdx]!] = 22;

  let cur = firstIdx;
  while (true) {
    let allDone = true;
    for (const pid of playerIds) {
      if (hands[pid].length < targets[pid]) { allDone = false; break; }
    }
    if (allDone) break;

    const pid = playerIds[cur]!;
    if (hands[pid].length < targets[pid]) {
      const t = deck.pop();
      if (!t) throw new Error("DECK_EMPTY");
      hands[pid].push(t);
    }

    cur = (cur + 1) % playerIds.length;
  }

  const currentPlayerId = playerIds[firstIdx]!;

  return {
    phase: "turn",
    roomId: prev.roomId,
    players: prev.players,

    currentPlayerId,
    // First player has 22 tiles — they skip drawing and go straight to discard
    turnStep: "mustDiscard",
    openedBy: Object.fromEntries(playerIds.map((id) => [id, "none"])),

    deck,
    discardPiles: Object.fromEntries(playerIds.map((id) => [id, []])),
    
    hands,

    indicator,
    okey,
    tableMelds: [],
    penalties: []
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
    openedBy: s.openedBy,

    deckCount: s.deck.length,
    discardPiles: s.discardPiles,

    yourHand,
    otherHandCounts,

    indicator: s.indicator,
    okey: s.okey,
    tableMelds: s.tableMelds ?? [],
    penalties: s.penalties ?? []
  };

  return view;
}
