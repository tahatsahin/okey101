import { validateMeldFromHand, validateOpeningRequirements, validateLayoff, canExtendAnyMeld } from '../src/game/validate.js';

function tile(id: string, color: any, value: any): any {
  return { id, kind: 'normal', color, value, copy: 1 };
}
function fj(id: string) { return { id, kind: 'fakeJoker', copy: 1 }; }

function simpleAssert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else { console.log('ok:', msg); }
}

const okey = { color: 'red', value: 2 };

(function testMelds() {
  const run = [tile('t1','red',1), tile('t2','red',2), tile('t3','red',3)];
  const wrap = [tile('w1','red',12), tile('w2','red',13), tile('w3','red',1)];
  const set = [tile('s1','red',5), tile('s2','black',5), tile('s3','blue',5)];
  const pair = [tile('p1','blue',7), tile('p2','blue',7)];

  simpleAssert(validateMeldFromHand(run, okey).valid, 'run valid');
  simpleAssert(!validateMeldFromHand(wrap, okey).valid, '12-13-1 wrap invalid');
  simpleAssert(validateMeldFromHand(set, okey).valid, 'set valid');
  simpleAssert(validateMeldFromHand(pair, okey).valid, 'pair valid');
})();

(function testJokerMelds() {
  // okey is red-2; a normal red-2 is a wild joker
  const joker = tile('j1', 'red', 2);
  const runWithJoker = [tile('r1','red',1), joker, tile('r3','red',3)];
  simpleAssert(validateMeldFromHand(runWithJoker, okey).valid, 'run valid with joker filling gap');

  const setWithJoker = [tile('s1','red',5), tile('s2','black',5), joker];
  simpleAssert(validateMeldFromHand(setWithJoker, okey).valid, 'set valid with joker');

  const fakeJoker = fj('fj1');
  const badRun = [tile('b1','blue',3), tile('b2','blue',4), fakeJoker];
  simpleAssert(!validateMeldFromHand(badRun, okey).valid, 'fake joker wrong color invalid in run');
})();

(function testOpening21Exception() {
  // 7 runs of 3 tiles = 21 tiles total, total value < 101 but should be allowed
  const runs = [] as any[];
  for (let i = 0; i < 7; i++) {
    runs.push([tile(`r${i}a`,'red',1), tile(`r${i}b`,'red',2), tile(`r${i}c`,'red',3)]);
  }
  const res = validateOpeningRequirements(runs, okey, true);
  simpleAssert(res.ok, '21-tile exception allows opening even if total < 101');
})();

(function testLayoffAndExtend() {
  const table = [tile('t1','blue',3), tile('t2','blue',4), tile('t3','blue',5)];
  const extender = tile('t4','blue',6);
  simpleAssert(validateLayoff(table, [extender], okey).ok, 'can layoff extending run at high end');
  simpleAssert(canExtendAnyMeld([table], extender, okey), 'canExtendAnyMeld detects extension');
})();

(function testMultiTileLayoff() {
  const table = [tile('t1','red',3), tile('t2','red',4), tile('t3','red',5)];
  const tiles = [tile('t4','red',6), tile('t5','red',7)];
  simpleAssert(validateLayoff(table, tiles, okey).ok, 'multi-tile run layoff accepted');
})();

(function testJokerLayoff() {
  // okey is red-2, normal red-2 is wild joker
  const table = [tile('t1','red',3), tile('t2','red',4), tile('t3','red',5)];
  const joker = tile('j1','red',2);
  simpleAssert(validateLayoff(table, [joker], okey).ok, 'joker can be used in run layoff');

  const blueTable = [tile('b1','blue',3), tile('b2','blue',4), tile('b3','blue',5)];
  const fake = fj('fj1'); // fake joker resolves to red-2, wrong color
  simpleAssert(!validateLayoff(blueTable, [fake], okey).ok, 'fake joker wrong color invalid in run layoff');
})();
