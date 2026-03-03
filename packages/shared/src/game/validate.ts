import type { Tile, OkeyInfo, TileColor, TileValue } from "../types/ids.js";
import type { TableMeldTile } from "../types/gameState.js";
import { isFakeJoker, isNormalTile } from "./tileUtils.js";

type ValidateResult = { valid: boolean; type?: "run" | "set" | "pair"; reason?: string };

function isJoker(tile: Tile, okey: OkeyInfo) {
  return isNormalTile(tile) && (tile as any).color === okey.color && (tile as any).value === okey.value;
}

type TileResolution = { color: string; value: number; kind: "normal" | "fakeJoker" | "joker" };

const COLOR_ORDER: TileColor[] = ["red", "black", "blue", "yellow"];

function resolveTile(tile: Tile, okey: OkeyInfo): TileResolution {
  if (isFakeJoker(tile)) return { color: okey.color as any, value: okey.value as any, kind: "fakeJoker" };
  if (isJoker(tile, okey)) return { color: okey.color as any, value: okey.value as any, kind: "joker" };
  return { color: (tile as any).color as string, value: (tile as any).value as number, kind: "normal" };
}

function splitTiles(tiles: Tile[], okey: OkeyInfo) {
  const fixed: TileResolution[] = [];
  let jokers = 0;
  for (const t of tiles) {
    const r = resolveTile(t, okey);
    if (r.kind === "joker") jokers++;
    else fixed.push(r);
  }
  return { fixed, jokers };
}

function runIsValid(fixed: TileResolution[], jokers: number): boolean {
  if (fixed.length === 0) return false;
  const color = fixed[0]!.color;
  if (!fixed.every((t) => t.color === color)) return false;
  const vals = fixed.map((t) => t.value).sort((a, b) => a - b);
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] === vals[i - 1]) return false;
  }
  let gaps = 0;
  for (let i = 1; i < vals.length; i++) {
    gaps += (vals[i]! - vals[i - 1]! - 1);
  }
  if (gaps > jokers) return false;
  const remaining = jokers - gaps;
  const min = vals[0]!;
  const max = vals[vals.length - 1]!;
  const available = (min - 1) + (13 - max);
  return available >= remaining;
}

function runMaxSum(fixed: TileResolution[], jokers: number): number {
  const total = fixed.length + jokers;
  const vals = fixed.map((t) => t.value).sort((a, b) => a - b);
  const min = vals[0]!;
  const max = vals[vals.length - 1]!;
  const hi = Math.min(13, min + total - 1);
  const hiBounded = hi < max ? max : hi;
  const lo = hiBounded - total + 1;
  return (total * (lo + hiBounded)) / 2;
}

function runAssignmentRange(fixed: TileResolution[], jokers: number): { lo: number; hi: number } {
  const total = fixed.length + jokers;
  const vals = fixed.map((t) => t.value).sort((a, b) => a - b);
  const min = vals[0]!;
  const max = vals[vals.length - 1]!;
  const hi = Math.min(13, min + total - 1);
  const hiBounded = hi < max ? max : hi;
  const lo = hiBounded - total + 1;
  return { lo, hi: hiBounded };
}

export function validateMeldFromHand(tiles: Tile[], okey: OkeyInfo): ValidateResult {
  if (tiles.length === 0) return { valid: false, reason: "empty meld" };

  // Pairs: exactly 2 tiles identical color+value (fake jokers may represent okey)
  if (tiles.length === 2) {
    const { fixed, jokers } = splitTiles(tiles, okey);
    if (jokers === 2) return { valid: true, type: "pair" };
    if (jokers === 1) return { valid: true, type: "pair" };
    if (fixed.length === 2 && fixed[0]!.color === fixed[1]!.color && fixed[0]!.value === fixed[1]!.value) {
      return { valid: true, type: "pair" };
    }
    return { valid: false, reason: "not a pair" };
  }

  // Sets: 3-4 tiles same value, different colors
  if (tiles.length === 3 || tiles.length === 4) {
    const { fixed, jokers } = splitTiles(tiles, okey);
    let isSet = true;
    if (fixed.length > 0) {
      const value = fixed[0]!.value;
      if (!fixed.every((t) => t.value === value)) isSet = false;
    }
    const colors = new Set(fixed.map((t) => t.color));
    if (colors.size !== fixed.length) isSet = false;
    if (colors.size + jokers > 4) isSet = false;
    if (isSet) return { valid: true, type: "set" };
  }

  // Runs: >=3 consecutive same color (1 is low only). Not allowing 12-13-1 wrap.
  if (tiles.length >= 3) {
    const { fixed, jokers } = splitTiles(tiles, okey);
    if (!runIsValid(fixed, jokers)) return { valid: false, reason: "not consecutive run" };
    return { valid: true, type: "run" };
  }

  return { valid: false, reason: "unknown meld type" };
}

export function validateMeldSet(melds: Tile[][], okey: OkeyInfo): { ok: boolean; mode?: "runsSets" | "pairs" } {
  if (melds.length === 0) return { ok: false };
  const types = melds.map((m) => validateMeldFromHand(m, okey)).filter((r) => r.valid);
  if (types.length !== melds.length) return { ok: false };
  const allPairs = types.every((t) => t.type === "pair");
  if (allPairs) return { ok: true, mode: "pairs" };
  const allRunsSets = types.every((t) => t.type === "run" || t.type === "set");
  if (allRunsSets) return { ok: true, mode: "runsSets" };
  return { ok: false };
}

export function validateOpeningRequirements(melds: Tile[][], okey: OkeyInfo, fromHandOnly = true): { ok: boolean; reason?: string } {
  if (melds.length === 0) return { ok: false, reason: "no melds" };

  // Check if this is pairs opening: all melds are pairs and count >=5
  const allPairs = melds.every((m) => m.length === 2);
  if (allPairs) {
    if (melds.length >= 5) return { ok: true };
    return { ok: false, reason: "pairs opening requires at least 5 pairs" };
  }

  // Otherwise runs/sets opening: sum values >=101. Jokers are treated as best-case values within each meld.
  let total = 0;
  let totalTiles = 0;
  for (const m of melds) {
    const vr = validateMeldFromHand(m, okey);
    if (!vr.valid) return { ok: false, reason: `invalid meld: ${vr.reason ?? "unknown"}` };
    total += meldMaxSum(m, okey, vr.type!);
    totalTiles += m.length;
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

  if (tv.type === "set" || tv.type === "run") {
    const combined = tableMeld.concat(tiles);
    const vr = validateMeldFromHand(combined, okey);
    if (!vr.valid || vr.type !== tv.type) return { ok: false, reason: "invalid layoff" };
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

export function assignMeldTiles(tiles: Tile[], okey: OkeyInfo): TableMeldTile[] {
  const vr = validateMeldFromHand(tiles, okey);
  if (!vr.valid) return tiles as TableMeldTile[];
  const jokerTiles = tiles.filter((t) => isJoker(t, okey));
  const base: TableMeldTile[] = tiles.map((t) => t as TableMeldTile);
  if (jokerTiles.length === 0) {
    if (vr.type === "run") {
      return base.slice().sort((a, b) => resolveTile(a as any, okey).value - resolveTile(b as any, okey).value);
    }
    if (vr.type === "set" || vr.type === "pair") {
      return base
        .slice()
        .sort(
          (a, b) =>
            COLOR_ORDER.indexOf(resolveTile(a as any, okey).color as TileColor) -
            COLOR_ORDER.indexOf(resolveTile(b as any, okey).color as TileColor)
        );
    }
    return base;
  }

  const assignments = new Map<string, { color: TileColor; value: TileValue }>();
  if (vr.type === "pair") {
    const fixed = tiles.filter((t) => !isJoker(t, okey)).map((t) => resolveTile(t, okey));
    const target = fixed.length > 0 ? fixed[0]! : { color: okey.color, value: okey.value };
    for (const t of jokerTiles) {
      assignments.set(t.id, { color: target.color as TileColor, value: target.value as TileValue });
    }
  } else if (vr.type === "set") {
    const fixed = tiles.filter((t) => !isJoker(t, okey)).map((t) => resolveTile(t, okey));
    const targetValue = fixed.length > 0 ? fixed[0]!.value : (okey.value as TileValue);
    const usedColors = new Set(fixed.map((f) => f.color as TileColor));
    const availableColors = COLOR_ORDER.filter((c) => !usedColors.has(c));
    let idx = 0;
    for (const t of jokerTiles) {
      const color = availableColors[idx] ?? okey.color;
      assignments.set(t.id, { color, value: targetValue as TileValue });
      idx++;
    }
  } else if (vr.type === "run") {
    const fixed = tiles.filter((t) => !isJoker(t, okey)).map((t) => resolveTile(t, okey));
    if (fixed.length > 0) {
      const color = fixed[0]!.color as TileColor;
      const fixedVals = fixed.map((f) => f.value).sort((a, b) => a - b);
      const fixedSet = new Set(fixedVals);
      const { lo, hi } = runAssignmentRange(fixed, jokerTiles.length);
      const missing: number[] = [];
      for (let v = lo; v <= hi; v++) {
        if (!fixedSet.has(v)) missing.push(v);
      }
      for (let i = 0; i < jokerTiles.length; i++) {
        const v = missing[i] ?? fixedVals[0]!;
        assignments.set(jokerTiles[i]!.id, { color, value: v as TileValue });
      }
    }
  }

  const assignedTiles = tiles.map((t) => {
    const assigned = assignments.get(t.id);
    return assigned ? ({ ...t, assigned } as TableMeldTile) : (t as TableMeldTile);
  });
  if (vr.type === "run") {
    return assignedTiles.slice().sort((a, b) => {
      const av = a.assigned?.value ?? resolveTile(a as any, okey).value;
      const bv = b.assigned?.value ?? resolveTile(b as any, okey).value;
      return av - bv;
    });
  }
  if (vr.type === "set" || vr.type === "pair") {
    return assignedTiles.slice().sort((a, b) => {
      const ac = a.assigned?.color ?? resolveTile(a as any, okey).color;
      const bc = b.assigned?.color ?? resolveTile(b as any, okey).color;
      return COLOR_ORDER.indexOf(ac as TileColor) - COLOR_ORDER.indexOf(bc as TileColor);
    });
  }
  return assignedTiles;
}

function meldMaxSum(tiles: Tile[], okey: OkeyInfo, type: "run" | "set" | "pair"): number {
  const { fixed, jokers } = splitTiles(tiles, okey);
  if (type === "pair") {
    if (fixed.length === 0) return 13 * 2;
    return fixed[0]!.value * 2;
  }
  if (type === "set") {
    const value = fixed.length > 0 ? fixed[0]!.value : 13;
    return value * (fixed.length + jokers);
  }
  return runMaxSum(fixed, jokers);
}
