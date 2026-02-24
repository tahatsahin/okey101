import type { Tile, OkeyInfo } from "@okey/shared";
import { isFakeJoker, isNormalTile } from "./tileUtils.js";

type ValidateResult = { valid: boolean; type?: "run" | "set" | "pair"; reason?: string };

function isJoker(tile: Tile, okey: OkeyInfo) {
  return isNormalTile(tile) && (tile as any).color === okey.color && (tile as any).value === okey.value;
}

function tileValueForCount(tile: Tile, okey: OkeyInfo) {
  if (isNormalTile(tile)) return (tile as any).value as number;
  // fake joker represents the okey tile value when counted in openings
  if (isFakeJoker(tile)) return okey.value as number;
  return 0;
}

export function validateMeldFromHand(tiles: Tile[], okey: OkeyInfo): ValidateResult {
  if (tiles.length === 0) return { valid: false, reason: "empty meld" };

  // Pairs: exactly 2 tiles identical color+value (fake jokers may represent okey)
  if (tiles.length === 2) {
    const a = tiles[0] as any;
    const b = tiles[1] as any;
    if (a.kind === b.kind && a.color === b.color && a.value === b.value) return { valid: true, type: "pair" };
    return { valid: false, reason: "not a pair" };
  }

  // Sets: 3-4 tiles same value, different colors
  if (tiles.length === 3 || tiles.length === 4) {
    const values = new Set<number>();
    const colors = new Set<string>();
    let hasFake = false;
    for (const t of tiles) {
      if (isFakeJoker(t)) hasFake = true;
      if (isNormalTile(t)) {
        values.add((t as any).value as number);
        colors.add((t as any).color as string);
      } else if (isFakeJoker(t)) {
        // fake joker represents okey tile value/color
        values.add(okey.value as number);
        colors.add(okey.color as string);
      }
    }
    if (values.size === 1 && colors.size === tiles.length) return { valid: true, type: "set" };
  }

  // Runs: >=3 consecutive same color (1 is low only). Not allowing 12-13-1 wrap.
  if (tiles.length >= 3) {
    // all same color (fake jokers count as joker color -> which is okey.color; conservatively reject mixed cases with fake)
    const color = (tiles.find((t) => isNormalTile(t)) as any)?.color;
    if (!color) return { valid: false, reason: "cannot determine run color" };

    // Collect numeric values, treat fake joker as okey.value
    const vals = tiles.map((t) => (isNormalTile(t) ? (t as any).value as number : okey.value as number));
    vals.sort((a, b) => a - b);

    // Quick consecutive check (allow jokers to fill gaps is TODO — conservative: require exact consecutive values)
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1] + 1) return { valid: false, reason: "not consecutive run (jokers fill gaps not implemented)" };
    }

    return { valid: true, type: "run" };
  }

  return { valid: false, reason: "unknown meld type" };
}

export function validateOpeningRequirements(melds: Tile[][], okey: OkeyInfo, fromHandOnly = true): { ok: boolean; reason?: string } {
  if (melds.length === 0) return { ok: false, reason: "no melds" };

  // Check if this is pairs opening: all melds are pairs and count >=5
  const allPairs = melds.every((m) => m.length === 2);
  if (allPairs) {
    if (melds.length >= 5) return { ok: true };
    return { ok: false, reason: "pairs opening requires at least 5 pairs" };
  }

  // Otherwise runs/sets opening: sum values >=101. Fake jokers count as okey.value. NOTE: wild jokers should be represented by caller.
  let total = 0;
  let totalTiles = 0;
  for (const m of melds) {
    const vr = validateMeldFromHand(m, okey);
    if (!vr.valid) return { ok: false, reason: `invalid meld: ${vr.reason ?? "unknown"}` };
    for (const t of m) {
      total += tileValueForCount(t, okey);
      totalTiles++;
    }
  }

  if (total >= 101) return { ok: true };

  // Exception: if laying down 21 tiles at once from hand (no layoff), allow finish even if total < 101
  if (totalTiles >= 21 && fromHandOnly) return { ok: true };

  return { ok: false, reason: `opening total ${total} < 101` };
}

export function validateLayoff(tableMeld: Tile[], tiles: Tile[], okey: OkeyInfo): { ok: boolean; reason?: string } {
  // Pairs cannot be laid off onto
  if (tableMeld.length === 2) return { ok: false, reason: "cannot layoff onto pairs" };

  const tv = validateMeldFromHand(tableMeld, okey);
  if (!tv.valid) return { ok: false, reason: "invalid table meld" };

  if (tv.type === "set") {
    // can add same value with a new color
    const value = isNormalTile(tableMeld[0]) ? (tableMeld[0] as any).value as number : okey.value as number;
    for (const t of tiles) {
      const v = isNormalTile(t) ? (t as any).value as number : (isFakeJoker(t) ? okey.value as number : -1);
      if (v !== value) return { ok: false, reason: "tile value mismatch for set layoff" };
    }
    return { ok: true };
  }

  if (tv.type === "run") {
    // allow extending by adjacent values on either side
    // conservative implementation: check each tile continues the color and is adjacent to min-1 or max+1
    const color = (tableMeld.find((t) => isNormalTile(t)) as any).color as string;
    const vals = tableMeld.map((t) => (isNormalTile(t) ? (t as any).value as number : okey.value as number));
    vals.sort((a, b) => a - b);
    const min = vals[0];
    const max = vals[vals.length - 1];

    for (const t of tiles) {
      const c = isNormalTile(t) ? (t as any).color as string : okey.color as string;
      const v = isNormalTile(t) ? (t as any).value as number : okey.value as number;
      if (c !== color) return { ok: false, reason: "color mismatch for run layoff" };
      if (!(v === min - 1 || v === max + 1)) return { ok: false, reason: "tile not adjacent for run layoff" };
    }
    return { ok: true };
  }

  return { ok: false, reason: "unsupported table meld type" };
}

export function canExtendAnyMeld(tableMelds: Tile[][], tile: Tile, okey: OkeyInfo): boolean {
  for (const m of tableMelds) {
    const r = validateLayoff(m, [tile], okey);
    if (r.ok) return true;
  }
  return false;
}
