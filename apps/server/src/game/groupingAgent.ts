import type { OkeyInfo, TableMeldTile, Tile, TileColor, TileId } from "@okey/shared";
import { assignMeldTiles, validateMeldFromHand } from "./validate.js";
import { isFakeJoker } from "./tileUtils.js";

type GroupType = "run" | "set";

export type TileGrouping = {
  type: GroupType;
  tileIds: TileId[];
  tiles: TableMeldTile[];
  score: number;
};

export type TileGroupingResult = {
  totalScore: number;
  runScore: number;
  setScore: number;
  groups: TileGrouping[];
  unusedTileIds: TileId[];
};

type FixedTile = {
  color: TileColor;
  value: number;
};

type Candidate = {
  mask: number;
  type: GroupType;
  score: number;
};

type SolveState = {
  totalScore: number;
  runScore: number;
  runCount: number;
  groupedTileCount: number;
  groupMasks: number[];
};

const COLORS: TileColor[] = ["red", "black", "blue", "yellow"];

function isWildJoker(tile: Tile, okey: OkeyInfo): boolean {
  return tile.kind === "normal" && tile.color === okey.color && tile.value === okey.value;
}

function resolveFixedTile(tile: Tile, okey: OkeyInfo): FixedTile | null {
  if (isWildJoker(tile, okey)) return null;
  if (isFakeJoker(tile)) return { color: okey.color, value: okey.value };
  if (tile.kind === "normal") return { color: tile.color, value: tile.value };
  throw new Error("UNREACHABLE_TILE_KIND");
}

function tileScoreValue(tile: TableMeldTile, okey: OkeyInfo): number {
  if (tile.assigned) return tile.assigned.value;
  if (tile.kind === "fakeJoker") return okey.value;
  return tile.value;
}

function bitFor(index: number): number {
  return 1 << index;
}

function indicesForMask(mask: number, tileCount: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < tileCount; i++) {
    if ((mask & bitFor(i)) !== 0) out.push(i);
  }
  return out;
}

function combinations(items: number[], pick: number): number[][] {
  if (pick < 0 || pick > items.length) return [];
  if (pick === 0) return [[]];
  const out: number[][] = [];
  const current: number[] = [];

  function visit(start: number) {
    if (current.length === pick) {
      out.push(current.slice());
      return;
    }
    for (let i = start; i <= items.length - (pick - current.length); i++) {
      current.push(items[i]!);
      visit(i + 1);
      current.pop();
    }
  }

  visit(0);
  return out;
}

function compareSolveState(a: SolveState, b: SolveState): number {
  if (a.totalScore !== b.totalScore) return a.totalScore - b.totalScore;
  if (a.runScore !== b.runScore) return a.runScore - b.runScore;
  if (a.runCount !== b.runCount) return a.runCount - b.runCount;
  if (a.groupedTileCount !== b.groupedTileCount) return a.groupedTileCount - b.groupedTileCount;
  return b.groupMasks.length - a.groupMasks.length;
}

export function findBestTileGrouping(tiles: Tile[], okey: OkeyInfo): TileGroupingResult {
  if (tiles.length > 30) throw new Error("TOO_MANY_TILES");

  const tileCount = tiles.length;
  const allMask = (1 << tileCount) - 1;
  const wildIndices = tiles
    .map((tile, index) => (isWildJoker(tile, okey) ? index : -1))
    .filter((index) => index !== -1);

  const fixedByColorValue = new Map<string, number[]>();
  for (let i = 0; i < tileCount; i++) {
    const fixed = resolveFixedTile(tiles[i]!, okey);
    if (!fixed) continue;
    const key = `${fixed.color}:${fixed.value}`;
    const list = fixedByColorValue.get(key) ?? [];
    list.push(i);
    fixedByColorValue.set(key, list);
  }

  function availableIndices(mask: number, indices: number[]): number[] {
    return indices.filter((index) => (mask & bitFor(index)) !== 0);
  }

  function candidateFromMask(mask: number): Candidate | null {
    const groupTiles = indicesForMask(mask, tileCount).map((index) => tiles[index]!);
    const validation = validateMeldFromHand(groupTiles, okey);
    if (!validation.valid || (validation.type !== "run" && validation.type !== "set")) return null;
    const assigned = assignMeldTiles(groupTiles, okey);
    const score = assigned.reduce((sum, tile) => sum + tileScoreValue(tile, okey), 0);
    return { mask, type: validation.type, score };
  }

  function buildSetCandidates(mask: number, anchorIndex: number): Candidate[] {
    const anchorTile = tiles[anchorIndex]!;
    const anchorFixed = resolveFixedTile(anchorTile, okey);
    const anchorIsWild = anchorFixed === null;
    const anchorMask = bitFor(anchorIndex);
    const wildExcludingAnchor = wildIndices.filter(
      (index) => index !== anchorIndex && (mask & bitFor(index)) !== 0
    );
    const targetValues = anchorFixed ? [anchorFixed.value] : Array.from({ length: 13 }, (_, i) => i + 1);
    const seen = new Set<number>();
    const candidates: Candidate[] = [];

    for (const targetValue of targetValues) {
      const colorOptions = new Map<TileColor, number[]>();
      for (const color of COLORS) {
        const key = `${color}:${targetValue}`;
        const options = availableIndices(mask, fixedByColorValue.get(key) ?? []).filter(
          (index) => index !== anchorIndex
        );
        colorOptions.set(color, options);
      }

      const fixedChoices: number[][] = [[]];
      for (const color of COLORS) {
        if (anchorFixed && color === anchorFixed.color) continue;
        const next: number[][] = [];
        const options = colorOptions.get(color) ?? [];
        for (const choice of fixedChoices) {
          next.push(choice);
          for (const option of options) next.push([...choice, option]);
        }
        fixedChoices.splice(0, fixedChoices.length, ...next);
      }

      for (const size of [3, 4]) {
        for (const chosenFixed of fixedChoices) {
          const fixedCount = chosenFixed.length + (anchorFixed ? 1 : 0);
          const requiredWild = size - fixedCount - (anchorIsWild ? 1 : 0);
          if (requiredWild < 0) continue;
          if (requiredWild > wildExcludingAnchor.length) continue;
          if (fixedCount === 0) continue;

          for (const extraWilds of combinations(wildExcludingAnchor, requiredWild)) {
            let groupMask = anchorMask;
            for (const index of chosenFixed) groupMask |= bitFor(index);
            for (const index of extraWilds) groupMask |= bitFor(index);
            if (seen.has(groupMask)) continue;
            seen.add(groupMask);
            const candidate = candidateFromMask(groupMask);
            if (candidate?.type === "set") candidates.push(candidate);
          }
        }
      }
    }

    return candidates;
  }

  function buildRunCandidates(mask: number, anchorIndex: number): Candidate[] {
    const anchorTile = tiles[anchorIndex]!;
    const anchorFixed = resolveFixedTile(anchorTile, okey);
    const anchorIsWild = anchorFixed === null;
    const anchorMask = bitFor(anchorIndex);
    const wildExcludingAnchor = wildIndices.filter(
      (index) => index !== anchorIndex && (mask & bitFor(index)) !== 0
    );
    const seen = new Set<number>();
    const candidates: Candidate[] = [];
    const colors = anchorFixed ? [anchorFixed.color] : COLORS;

    for (const color of colors) {
      const anchorValue = anchorFixed?.value;
      const los = anchorValue ? Array.from({ length: anchorValue }, (_, i) => i + 1) : Array.from({ length: 13 }, (_, i) => i + 1);

      for (const lo of los) {
        const hiStart = anchorValue ? Math.max(anchorValue, lo + 2) : lo + 2;
        for (let hi = hiStart; hi <= 13; hi++) {
          if (anchorValue && (anchorValue < lo || anchorValue > hi)) continue;
          const values = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
          if (values.length < 3) continue;

          const optionGroups = values.map((value) => {
            if (anchorFixed && value === anchorValue) return [anchorIndex];
            const key = `${color}:${value}`;
            return availableIndices(mask, fixedByColorValue.get(key) ?? []).filter(
              (index) => index !== anchorIndex
            );
          });

          const chosenFixedSets: number[][] = [[]];
          for (let valueIdx = 0; valueIdx < values.length; valueIdx++) {
            const next: number[][] = [];
            const options = optionGroups[valueIdx]!;
            const mustUseAnchor = anchorFixed && values[valueIdx] === anchorValue;
            for (const choice of chosenFixedSets) {
              if (!mustUseAnchor) next.push(choice);
              for (const option of options) next.push([...choice, option]);
            }
            chosenFixedSets.splice(0, chosenFixedSets.length, ...next);
          }

          for (const chosenFixed of chosenFixedSets) {
            const fixedCount = chosenFixed.length;
            if (anchorFixed && !chosenFixed.includes(anchorIndex)) continue;
            if (anchorIsWild && fixedCount === 0) continue;

            const requiredWildTotal = values.length - fixedCount;
            if (anchorFixed) {
              if (requiredWildTotal > wildExcludingAnchor.length) continue;
              for (const extraWilds of combinations(wildExcludingAnchor, requiredWildTotal)) {
                let groupMask = 0;
                for (const index of chosenFixed) groupMask |= bitFor(index);
                for (const index of extraWilds) groupMask |= bitFor(index);
                if (seen.has(groupMask)) continue;
                seen.add(groupMask);
                const candidate = candidateFromMask(groupMask);
                if (candidate?.type === "run") candidates.push(candidate);
              }
            } else {
              if (requiredWildTotal < 1) continue;
              const extraWildNeeded = requiredWildTotal - 1;
              if (extraWildNeeded > wildExcludingAnchor.length) continue;
              for (const extraWilds of combinations(wildExcludingAnchor, extraWildNeeded)) {
                let groupMask = anchorMask;
                for (const index of chosenFixed) groupMask |= bitFor(index);
                for (const index of extraWilds) groupMask |= bitFor(index);
                if (seen.has(groupMask)) continue;
                seen.add(groupMask);
                const candidate = candidateFromMask(groupMask);
                if (candidate?.type === "run") candidates.push(candidate);
              }
            }
          }
        }
      }
    }

    return candidates;
  }

  const candidateCache = new Map<string, Candidate[]>();

  function candidatesForAnchor(mask: number, anchorIndex: number): Candidate[] {
    const cacheKey = `${mask}:${anchorIndex}`;
    const cached = candidateCache.get(cacheKey);
    if (cached) return cached;
    const candidates = [...buildSetCandidates(mask, anchorIndex), ...buildRunCandidates(mask, anchorIndex)];
    candidateCache.set(cacheKey, candidates);
    return candidates;
  }

  const memo = new Map<number, SolveState>();

  function solve(mask: number): SolveState {
    const cached = memo.get(mask);
    if (cached) return cached;
    if (mask === 0) {
      const base: SolveState = {
        totalScore: 0,
        runScore: 0,
        runCount: 0,
        groupedTileCount: 0,
        groupMasks: []
      };
      memo.set(mask, base);
      return base;
    }

    let anchorIndex = -1;
    for (let i = 0; i < tileCount; i++) {
      if ((mask & bitFor(i)) !== 0) {
        anchorIndex = i;
        break;
      }
    }
    if (anchorIndex === -1) throw new Error("INVALID_MASK");

    let best = solve(mask & ~bitFor(anchorIndex));
    for (const candidate of candidatesForAnchor(mask, anchorIndex)) {
      if ((candidate.mask & mask) !== candidate.mask) continue;
      const tail = solve(mask & ~candidate.mask);
      const next: SolveState = {
        totalScore: candidate.score + tail.totalScore,
        runScore: (candidate.type === "run" ? candidate.score : 0) + tail.runScore,
        runCount: (candidate.type === "run" ? 1 : 0) + tail.runCount,
        groupedTileCount: indicesForMask(candidate.mask, tileCount).length + tail.groupedTileCount,
        groupMasks: [candidate.mask, ...tail.groupMasks]
      };
      if (compareSolveState(next, best) > 0) best = next;
    }

    memo.set(mask, best);
    return best;
  }

  const solved = solve(allMask);
  const candidateByMask = new Map<number, Candidate>();
  for (const mask of solved.groupMasks) {
    const candidate = candidateFromMask(mask);
    if (candidate) candidateByMask.set(mask, candidate);
  }

  const groups: TileGrouping[] = solved.groupMasks.map((mask) => {
    const indices = indicesForMask(mask, tileCount);
    const groupTiles = indices.map((index) => tiles[index]!);
    const assigned = assignMeldTiles(groupTiles, okey);
    const candidate = candidateByMask.get(mask);
    if (!candidate) throw new Error("MISSING_CANDIDATE");
    return {
      type: candidate.type,
      tileIds: indices.map((index) => tiles[index]!.id),
      tiles: assigned,
      score: candidate.score
    };
  });

  const usedMask = solved.groupMasks.reduce((acc, mask) => acc | mask, 0);
  const unusedTileIds = indicesForMask(allMask & ~usedMask, tileCount).map((index) => tiles[index]!.id);
  const setScore = solved.totalScore - solved.runScore;

  return {
    totalScore: solved.totalScore,
    runScore: solved.runScore,
    setScore,
    groups,
    unusedTileIds
  };
}
