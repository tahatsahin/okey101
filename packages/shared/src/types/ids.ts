export type RoomId = string;
export type PlayerId = string;

export type TileColor = "red" | "black" | "blue" | "yellow";
export type TileKind = "normal" | "fakeJoker";

/** Unique id per physical tile so discard/removal is unambiguous */
export type TileId = string;

export type TileValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export type Tile =
  | {
      id: TileId;
      kind: "normal";
      color: TileColor;
      value: TileValue;
      copy: 1 | 2; // two copies of each tile
    }
  | {
      id: TileId;
      kind: "fakeJoker";
      copy: 1 | 2; // two fake jokers
    };

export type OkeyInfo = {
  color: TileColor;
  value: TileValue;
};
