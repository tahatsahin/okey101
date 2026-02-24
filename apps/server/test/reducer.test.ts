import type { PlayerId, Tile, TileValue, TileColor, OkeyInfo, TurnStateServer, LobbyPlayerPublic } from '@okey/shared';
import { reduce } from '../src/game/reducer.js';

function simpleAssert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else { console.log('ok:', msg); }
}

function tile(id: string, color: TileColor, value: TileValue): Tile {
  return { id, kind: 'normal', color, value, copy: 1 } as Tile;
}

function fj(id: string): Tile {
  return { id, kind: 'fakeJoker', copy: 1 } as Tile;
}

function makeBaseTurnState(overrides?: Partial<TurnStateServer>): TurnStateServer {
  const players: LobbyPlayerPublic[] = [
    { playerId: 'p1', name: 'A', ready: true },
    { playerId: 'p2', name: 'B', ready: true },
    { playerId: 'p3', name: 'C', ready: true },
    { playerId: 'p4', name: 'D', ready: true },
  ];
  const okey: OkeyInfo = { color: 'red', value: 2 };

  return {
    phase: 'turn',
    roomId: 'test-room',
    players,
    currentPlayerId: 'p1',
    turnStep: 'mustDiscard',
    deck: [tile('deck-1', 'blue', 5)],
    discardPiles: { p1: [], p2: [], p3: [], p4: [tile('dp4-1', 'yellow', 3)] },
    hands: {
      p1: [
        tile('h1', 'red', 1), tile('h2', 'red', 2), tile('h3', 'red', 3),
        tile('h4', 'blue', 7),
      ],
      p2: [tile('h5', 'black', 5)],
      p3: [tile('h6', 'yellow', 9)],
      p4: [tile('h7', 'blue', 12)],
    },
    indicator: tile('ind', 'red', 1),
    okey,
    tableMelds: [],
    penalties: [],
    ...overrides,
  };
}

// --- DRAW tests ---
(function testDrawFromDeck() {
  const state = makeBaseTurnState({ turnStep: 'mustDraw' });
  const next = reduce(state, { type: 'DRAW', playerId: 'p1', source: 'deck' }) as TurnStateServer;
  simpleAssert(next.turnStep === 'mustDiscard', 'draw from deck -> mustDiscard');
  simpleAssert(next.hands.p1.length === 5, 'hand grew by 1 after draw');
  simpleAssert(next.deck.length === 0, 'deck shrunk by 1');
})();

(function testDrawFromPrevDiscard() {
  // p1 is current; p4 is previous (order: p1,p2,p3,p4 -> prev of p1 is p4)
  const state = makeBaseTurnState({ turnStep: 'mustDraw' });
  const next = reduce(state, { type: 'DRAW', playerId: 'p1', source: 'prevDiscard' }) as TurnStateServer;
  simpleAssert(next.turnStep === 'mustDiscard', 'draw from prevDiscard -> mustDiscard');
  simpleAssert(next.hands.p1.some((t) => t.id === 'dp4-1'), 'hand contains taken discard tile');
  simpleAssert((next.discardPiles.p4 ?? []).length === 0, 'prev discard pile shrunk');
})();

// --- DISCARD penalty: joker ---
(function testDiscardJokerPenalty() {
  // okey is red-2; discarding a normal red-2 tile is discarding the joker
  const jokerTile = tile('joker1', 'red', 2);
  const state = makeBaseTurnState({
    hands: { p1: [jokerTile, tile('safe', 'blue', 5)], p2: [], p3: [], p4: [] },
  });
  const next = reduce(state, { type: 'DISCARD', playerId: 'p1', tileId: 'joker1' }) as TurnStateServer;
  const pen = (next.penalties ?? []).find((p) => p.playerId === 'p1' && p.reason === 'DISCARD_JOKER');
  simpleAssert(!!pen, 'penalty applied for discarding joker');
  simpleAssert(pen!.points === 101, 'penalty is +101');
})();

// --- DISCARD penalty: extendable tile ---
(function testDiscardExtendablePenalty() {
  // table has a run blue 3-4-5; discarding blue-6 should trigger penalty
  const state = makeBaseTurnState({
    tableMelds: [
      { meldId: 'm1', playerId: 'p2', tiles: [tile('t1','blue',3), tile('t2','blue',4), tile('t3','blue',5)] },
    ],
    hands: {
      p1: [tile('ext','blue',6), tile('safe','yellow',1)],
      p2: [], p3: [], p4: [],
    },
  });
  const next = reduce(state, { type: 'DISCARD', playerId: 'p1', tileId: 'ext' }) as TurnStateServer;
  const pen = (next.penalties ?? []).find((p) => p.reason === 'DISCARD_EXTENDABLE');
  simpleAssert(!!pen, 'penalty applied for discarding extendable tile');
})();

// --- DISCARD: finishing discard should NOT trigger extendable penalty ---
(function testFinishingDiscardNoPenalty() {
  const state = makeBaseTurnState({
    tableMelds: [
      { meldId: 'm1', playerId: 'p2', tiles: [tile('t1','blue',3), tile('t2','blue',4), tile('t3','blue',5)] },
    ],
    hands: {
      p1: [tile('last','blue',6)],  // only 1 tile left; discarding finishes
      p2: [], p3: [], p4: [],
    },
  });
  const next = reduce(state, { type: 'DISCARD', playerId: 'p1', tileId: 'last' }) as TurnStateServer;
  const pen = (next.penalties ?? []).find((p) => p.reason === 'DISCARD_EXTENDABLE');
  simpleAssert(!pen, 'no extendable penalty on finishing discard');
})();

// --- DISCARD: non-joker, non-extendable = no penalty ---
(function testNormalDiscardNoPenalty() {
  const state = makeBaseTurnState();
  const next = reduce(state, { type: 'DISCARD', playerId: 'p1', tileId: 'h4' }) as TurnStateServer;
  simpleAssert((next.penalties ?? []).length === 0, 'no penalty for normal discard');
})();

// --- OPEN_MELD: valid opening ---
(function testOpenMeldValid() {
  // runs/sets totaling >= 101: 10+11+12+13 = 46 per run; need two runs: 46+46=92 < 101;
  // use higher: 11+12+13=36 * 3 = 108 > 101 with 3 runs
  const hand: Tile[] = [
    tile('a1','red',11), tile('a2','red',12), tile('a3','red',13),
    tile('b1','blue',11), tile('b2','blue',12), tile('b3','blue',13),
    tile('c1','black',11), tile('c2','black',12), tile('c3','black',13),
    tile('extra','yellow',1),
  ];
  const state = makeBaseTurnState({
    hands: { p1: hand, p2: [], p3: [], p4: [] },
  });
  const next = reduce(state, {
    type: 'OPEN_MELD',
    playerId: 'p1',
    melds: [['a1','a2','a3'], ['b1','b2','b3'], ['c1','c2','c3']],
  }) as TurnStateServer;
  simpleAssert((next.tableMelds ?? []).length === 3, 'three melds on table after opening');
  simpleAssert(next.hands.p1.length === 1, 'hand has 1 tile left after opening');
  simpleAssert(next.turnStep === 'mustDiscard', 'after open meld must discard');
})();

// --- OPEN_MELD: insufficient total should fail ---
(function testOpenMeldInsufficientFails() {
  const hand: Tile[] = [
    tile('a1','red',1), tile('a2','red',2), tile('a3','red',3),
    tile('extra','yellow',1),
  ];
  const state = makeBaseTurnState({
    hands: { p1: hand, p2: [], p3: [], p4: [] },
  });
  let threw = false;
  try {
    reduce(state, { type: 'OPEN_MELD', playerId: 'p1', melds: [['a1','a2','a3']] });
  } catch (e: any) {
    threw = true;
    simpleAssert(e.message === 'OPENING_REQUIREMENTS_NOT_MET', 'correct error for insufficient opening');
  }
  simpleAssert(threw, 'reducer throws on insufficient opening');
})();

// --- TAKE_AND_MELD: taken tile must be used ---
(function testTakeAndMeldMustUseTaken() {
  const state = makeBaseTurnState({
    currentPlayerId: 'p1',
    turnStep: 'mustDraw',
    discardPiles: { p1: [], p2: [], p3: [], p4: [tile('dp-top','yellow',3)] },
    hands: {
      p1: [tile('h1','yellow',4), tile('h2','yellow',5), tile('h3','blue',9)],
      p2: [], p3: [], p4: [],
    },
  });

  // meld that does NOT include dp-top should fail
  let threw = false;
  try {
    reduce(state, { type: 'TAKE_AND_MELD', playerId: 'p1', fromPlayerId: 'p4', melds: [['h1','h2','h3']] });
  } catch (e: any) {
    threw = true;
  }
  simpleAssert(threw, 'take-and-meld fails when taken tile not used in meld');

  // meld that includes dp-top should succeed
  const next = reduce(state, {
    type: 'TAKE_AND_MELD', playerId: 'p1', fromPlayerId: 'p4',
    melds: [['dp-top','h1','h2']],
  }) as TurnStateServer;
  simpleAssert((next.tableMelds ?? []).length === 1, 'meld created on table');
  simpleAssert(next.turnStep === 'mustDiscard', 'must discard after take-and-meld');
})();

// --- Wrong turn / wrong step errors ---
(function testNotYourTurn() {
  const state = makeBaseTurnState({ currentPlayerId: 'p2' });
  let threw = false;
  try { reduce(state, { type: 'DISCARD', playerId: 'p1', tileId: 'h1' }); } catch { threw = true; }
  simpleAssert(threw, 'throws NOT_YOUR_TURN when wrong player acts');
})();

(function testWrongStep() {
  const state = makeBaseTurnState({ turnStep: 'mustDraw' });
  let threw = false;
  try { reduce(state, { type: 'DISCARD', playerId: 'p1', tileId: 'h1' }); } catch { threw = true; }
  simpleAssert(threw, 'throws INVALID_STEP when discarding in mustDraw');
})();
