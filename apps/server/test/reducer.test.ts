import type { PlayerId, Tile, TileValue, TileColor, OkeyInfo, TurnStateServer, LobbyPlayerPublic, HandEndState } from '@okey/shared';
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
    options: {
      teamMode: false,
      increasingMeldLimit: false,
      penaltyDiscardJoker: 101,
      penaltyDiscardExtendable: 101,
      penaltyFailedOpening: 101,
      penaltyNoOpen: 202,
      pairsMultiplier: 2
    },
    currentPlayerId: 'p1',
    turnStep: 'mustDiscard',
    openedBy: { p1: 'none', p2: 'none', p3: 'none', p4: 'none' },
    openingLimit: 100,
    notice: undefined,
    handHistory: [],
    dealerIndex: 0,
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
  simpleAssert(next.turnStep === 'mustMeldDiscard', 'draw from prevDiscard -> mustMeldDiscard');
  simpleAssert(!!next.takenDiscard, 'takenDiscard stored');
  simpleAssert((next.discardPiles.p4 ?? []).length === 0, 'prev discard pile reduced');
})();

(function testReturnTakenDiscard() {
  const state = makeBaseTurnState({ turnStep: 'mustDraw' });
  const taken = reduce(state, { type: 'DRAW', playerId: 'p1', source: 'prevDiscard' }) as TurnStateServer;
  const next = reduce(taken, { type: 'RETURN_TAKEN_DISCARD', playerId: 'p1' }) as TurnStateServer;
  simpleAssert(next.turnStep === 'mustDraw', 'return tile -> mustDraw');
  simpleAssert(!next.takenDiscard, 'takenDiscard cleared after return');
  simpleAssert((next.discardPiles.p4 ?? []).length === 1, 'discard pile restored after return');
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

// --- End conditions ---
(function testWinEndsHand() {
  const state = makeBaseTurnState({
    hands: { p1: [tile('last','blue',6)], p2: [], p3: [], p4: [] },
  });
  const next = reduce(state, { type: 'DISCARD', playerId: 'p1', tileId: 'last' }) as HandEndState;
  simpleAssert(next.phase === 'handEnd', 'win ends hand');
  simpleAssert(next.result.reason === 'WIN', 'hand end reason WIN');
  simpleAssert(next.result.winnerId === 'p1', 'winnerId set on WIN');
})();

(function testDeckEmptyEndsHand() {
  const state = makeBaseTurnState({
    deck: [],
    hands: {
      p1: [tile('a','blue',6), tile('b','yellow',7)],
      p2: [tile('joker','red',2)],
      p3: [],
      p4: [],
    },
  });
  const next = reduce(state, { type: 'DISCARD', playerId: 'p1', tileId: 'a' }) as HandEndState;
  simpleAssert(next.phase === 'handEnd', 'deck empty ends hand');
  simpleAssert(next.result.reason === 'DECK_EMPTY', 'hand end reason DECK_EMPTY');
  const pen = next.result.penalties.find((p) => p.playerId === 'p2' && p.reason === 'NO_OPEN');
  simpleAssert(!!pen, 'no-open penalty applied at deck empty');
})();

(function testAllPairsEndsHand() {
  const hand: Tile[] = [
    tile('p1a','red',1), tile('p1b','red',1),
    tile('p2a','blue',2), tile('p2b','blue',2),
    tile('p3a','black',3), tile('p3b','black',3),
    tile('p4a','yellow',4), tile('p4b','yellow',4),
    tile('p5a','red',5), tile('p5b','red',5),
  ];
  const state = makeBaseTurnState({
    hands: { p1: hand, p2: [tile('joker','red',2)], p3: [], p4: [] },
    openedBy: { p1: 'none', p2: 'pairs', p3: 'pairs', p4: 'pairs' },
  });
  const next = reduce(state, {
    type: 'OPEN_MELD',
    playerId: 'p1',
    melds: [['p1a','p1b'], ['p2a','p2b'], ['p3a','p3b'], ['p4a','p4b'], ['p5a','p5b']],
  }) as HandEndState;
  simpleAssert(next.phase === 'handEnd', 'all pairs ends hand');
  simpleAssert(next.result.reason === 'ALL_PAIRS', 'hand end reason ALL_PAIRS');
  const pen = next.result.penalties.find((p) => p.playerId === 'p2' && p.reason === 'HAND_SUM_PAIRS');
  simpleAssert(!!pen, 'pairs hand-sum penalty applied at all pairs');
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
  const next = reduce(state, { type: 'OPEN_MELD', playerId: 'p1', melds: [['a1','a2','a3']] }) as TurnStateServer;
  const pen = (next.penalties ?? []).find((p) => p.playerId === 'p1' && p.reason === 'FAILED_OPENING');
  simpleAssert(!!pen, 'penalty applied for insufficient opening');
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
    openedBy: { p1: 'runsSets', p2: 'none', p3: 'none', p4: 'none' },
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
