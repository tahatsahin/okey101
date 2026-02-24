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
  const set = [tile('s1','red',5), tile('s2','black',5), tile('s3','blue',5)];
  const pair = [tile('p1','blue',7), tile('p2','blue',7)];

  simpleAssert(validateMeldFromHand(run, okey).valid, 'run valid');
  simpleAssert(validateMeldFromHand(set, okey).valid, 'set valid');
  simpleAssert(validateMeldFromHand(pair, okey).valid, 'pair valid');
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
