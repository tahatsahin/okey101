import type { Tile, TileColor, TileValue, OkeyInfo } from "../types/ids.js";

export const COLORS: TileColor[] = ["red", "black", "blue", "yellow"];
export const VALUES: TileValue[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export function nextValue(v: TileValue): TileValue {
  return (v === 13 ? 1 : ((v + 1) as TileValue));
}

export function makeDeck(): Tile[] {
  const deck: Tile[] = [];

  for (const color of COLORS) {
    for (const value of VALUES) {
      deck.push({ id: `n-${color}-${value}-1`, kind: "normal", color, value, copy: 1 } as unknown as Tile);
      deck.push({ id: `n-${color}-${value}-2`, kind: "normal", color, value, copy: 2 } as unknown as Tile);
    }
  }

  deck.push({ id: "fj-1", kind: "fakeJoker", copy: 1 } as unknown as Tile);
  deck.push({ id: "fj-2", kind: "fakeJoker", copy: 2 } as unknown as Tile);

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

export function isFakeJoker(t: Tile): boolean {
  return (t as any).kind === "fakeJoker";
}

export function isNormalTile(t: Tile): boolean {
  return (t as any).kind === "normal";
}

export function resolveOkeyFromIndicator(indicator: Tile): OkeyInfo {
  if (!isNormalTile(indicator)) throw new Error("INDICATOR_MUST_BE_NORMAL");
  return { color: (indicator as any).color as TileColor, value: nextValue((indicator as any).value as TileValue) };
}

export function pickIndicatorAndOkey(deck: Tile[]): { indicator: Tile; okey: OkeyInfo } {
  const MAX_ATTEMPTS = 50;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = deck.pop();
    if (!candidate) throw new Error("DECK_EMPTY");

    if (isNormalTile(candidate)) {
      const okey = resolveOkeyFromIndicator(candidate);
      return { indicator: candidate, okey };
    }

    // fake joker -> put back and reshuffle remaining deck
    deck.push(candidate);
    shuffleInPlace(deck);
  }

  throw new Error("FAILED_TO_PICK_INDICATOR");
}

export function dealHands(playerIds: string[], deck: Tile[], dealerIndex: number) {
  const n = playerIds.length;
  if (n !== 4) throw new Error("DEALING_REQUIRES_4_PLAYERS");

  // targets: every player 21, player to dealer's right gets 22
  const targets: Record<string, number> = Object.fromEntries(
    playerIds.map((id) => [id, 21])
  );

  const firstIdx = (dealerIndex - 1 + n) % n;
  const firstPlayer = playerIds[firstIdx]!;
  targets[firstPlayer] = 22;

  const hands: Record<string, Tile[]> = Object.fromEntries(playerIds.map((id) => [id, [] as Tile[]]));

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
      if (!t) throw new Error("DECK_EMPTY_DURING_DEAL");
      hands[pid].push(t);
    }

    cur = (cur + 1) % n;
  }

  return { hands, deck };
}
