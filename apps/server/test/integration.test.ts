/**
 * Integration playtest: simulates a multi-turn flow through the reducer.
 * lobby -> start -> first-player open-meld -> discard -> next draw -> discard -> ...
 */
import type { GameStateServer, TurnStateServer, LobbyPlayerPublic, PlayerId} from '@okey/shared';
import { reduce } from '../src/game/reducer.js';

function simpleAssert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else { console.log('ok:', msg); }
}

// --- Build lobby and start game ---
const players: LobbyPlayerPublic[] = [
  { playerId: 'p1', name: 'Alice', ready: false },
  { playerId: 'p2', name: 'Bob', ready: false },
  { playerId: 'p3', name: 'Carol', ready: false },
  { playerId: 'p4', name: 'Dave', ready: false },
];

let state: GameStateServer = { phase: 'lobby', roomId: 'int-test', players, options: { teamMode: false } };

// Ready up all players
for (const p of players) {
  state = reduce(state, { type: 'SET_READY', playerId: p.playerId, ready: true });
}
simpleAssert(state.phase === 'lobby', 'still in lobby after readying');

// Start game (p1 is host)
state = reduce(state, { type: 'START_GAME', playerId: 'p1' });
simpleAssert(state.phase === 'turn', 'phase is turn after start');

const ts = state as TurnStateServer;
simpleAssert(ts.tableMelds !== undefined, 'tableMelds initialized');
simpleAssert(ts.penalties !== undefined, 'penalties initialized');
simpleAssert(typeof ts.dealerIndex === 'number', 'dealerIndex initialized');

// Verify dealing: first player (dealer-right) has 22, others 21
const firstPlayer = ts.currentPlayerId;
const others = players.map(p => p.playerId).filter(id => id !== firstPlayer);
simpleAssert(ts.hands[firstPlayer].length === 22, `first player ${firstPlayer} has 22 tiles`);
for (const pid of others) {
  simpleAssert(ts.hands[pid].length === 21, `player ${pid} has 21 tiles`);
}

// First player starts with 22 tiles and mustDiscard (per AGENTS.md: no initial draw)
simpleAssert(ts.turnStep === 'mustDiscard', 'first player starts at mustDiscard');

// --- First player discards without drawing (has 22 tiles) ---
const firstTile = ts.hands[firstPlayer][ts.hands[firstPlayer].length - 1]!;
state = reduce(state, { type: 'DISCARD', playerId: firstPlayer, tileId: firstTile.id });
const afterDiscard = state as TurnStateServer;
simpleAssert(afterDiscard.currentPlayerId !== firstPlayer, 'turn moved to next player');
simpleAssert(afterDiscard.turnStep === 'mustDraw', 'next player must draw');
simpleAssert(afterDiscard.hands[firstPlayer].length === 21, 'first player has 21 after discard');

// --- Second player draws from deck and discards ---
const secondPlayer = afterDiscard.currentPlayerId;
state = reduce(state, { type: 'DRAW', playerId: secondPlayer, source: 'deck' });
const s2draw = state as TurnStateServer;
simpleAssert(s2draw.hands[secondPlayer].length === 22, 'second player has 22 after draw');

const s2tile = s2draw.hands[secondPlayer][0]!;
state = reduce(state, { type: 'DISCARD', playerId: secondPlayer, tileId: s2tile.id });
const s2discard = state as TurnStateServer;
simpleAssert(s2discard.currentPlayerId !== secondPlayer, 'turn moved after second player discard');

// --- Third player draws from deck and discards ---
const thirdPlayer = s2discard.currentPlayerId;
state = reduce(state, { type: 'DRAW', playerId: thirdPlayer, source: 'deck' });
const s3draw = state as TurnStateServer;
simpleAssert(s3draw.hands[thirdPlayer].length === 22, 'third player has 22 after draw');

const s3tile = s3draw.hands[thirdPlayer][0]!;
state = reduce(state, { type: 'DISCARD', playerId: thirdPlayer, tileId: s3tile.id });
const s3discard = state as TurnStateServer;
simpleAssert(s3discard.currentPlayerId !== thirdPlayer, 'turn moved after third player discard');

// --- Verify penalty accumulation doesn't explode ---
simpleAssert(Array.isArray(s3discard.penalties), 'penalties array is intact');

console.log(`\nIntegration: ${players.length} players completed ${3} turns without errors.`);

// --- End first hand and start next ---
const endPlayer = s3discard.currentPlayerId;
const endReady: TurnStateServer = {
  ...(s3discard as TurnStateServer),
  currentPlayerId: endPlayer,
  turnStep: 'mustDiscard',
  hands: { ...s3discard.hands, [endPlayer]: [s3discard.hands[endPlayer][0]!] },
};
const handEndState = reduce(endReady, {
  type: 'DISCARD',
  playerId: endPlayer,
  tileId: endReady.hands[endPlayer][0]!.id,
}) as any;
simpleAssert(handEndState.phase === 'handEnd', 'handEnd reached after finishing discard');
let readyState: any = handEndState;
for (const p of players) {
  readyState = reduce(readyState, { type: 'SET_READY', playerId: p.playerId, ready: true });
}
const newStart = readyState as TurnStateServer;
simpleAssert(newStart.phase === 'turn', 'new hand started from handEnd on all-ready');
simpleAssert(newStart.dealerIndex === (ts.dealerIndex + 1) % 4, 'dealerIndex rotated');
