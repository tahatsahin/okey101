import { findBestTileGrouping } from "@okey/shared";

function tile(id: string, color: "red" | "black" | "blue" | "yellow", value: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13) {
  return { id, kind: "normal" as const, color, value, copy: 1 as const };
}

function fj(id: string) {
  return { id, kind: "fakeJoker" as const, copy: 1 as const };
}

function simpleAssert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const okey = { color: "yellow" as const, value: 13 as const };

(function testExactOptimizationBeatsGreedyLongRun() {
  const tiles = [
    tile("r1", "red", 1),
    tile("r2", "red", 2),
    tile("r3", "red", 3),
    tile("r4", "red", 4),
    tile("r5", "red", 5),
    tile("b3", "blue", 3),
    tile("k3", "black", 3),
    tile("b4", "blue", 4),
    tile("k4", "black", 4),
  ];
  const result = findBestTileGrouping(tiles, okey);
  simpleAssert(result.totalScore === 21, "solver finds better total than greedy long run");
  simpleAssert(result.groups.length === 2, "solver uses two groups");
  simpleAssert(result.groups.every((group) => group.type === "set"), "best solution uses sets here");
})();

(function testTiePrefersRunOverSet() {
  const tiles = [
    tile("r3", "red", 3),
    tile("r4", "red", 4),
    tile("r5", "red", 5),
    tile("b4", "blue", 4),
    tile("k4", "black", 4),
  ];
  const result = findBestTileGrouping(tiles, okey);
  simpleAssert(result.totalScore === 12, "tie case total score is correct");
  simpleAssert(result.groups.length === 1, "tie case uses one group");
  simpleAssert(result.groups[0]?.type === "run", "tie prefers run over set");
})();

(function testJokerRunAndSetHandling() {
  const tiles = [
    tile("r11", "red", 11),
    tile("r12", "red", 12),
    tile("joker", "yellow", 13),
    tile("b13", "blue", 13),
    tile("k13", "black", 13),
    fj("fj"),
  ];
  const result = findBestTileGrouping(tiles, okey);
  simpleAssert(result.totalScore === 75, "solver maximizes score with joker and false joker");
  simpleAssert(result.groups.length === 2, "joker case forms two groups");
  simpleAssert(result.runScore === 36, "run score is tracked");
  simpleAssert(result.setScore === 39, "set score is tracked");
})();

(function testDoesNotReuseTiles() {
  const tiles = [
    tile("r3", "red", 3),
    tile("r4", "red", 4),
    tile("r5", "red", 5),
    tile("b5", "blue", 5),
    tile("k5", "black", 5),
    tile("y5", "yellow", 5),
  ];
  const result = findBestTileGrouping(tiles, okey);
  const used = new Set(result.groups.flatMap((group) => group.tileIds));
  simpleAssert(used.size === result.groups.flatMap((group) => group.tileIds).length, "no tile reused");
  simpleAssert(result.totalScore === 27, "solver chooses best non-overlapping solution");
})();
