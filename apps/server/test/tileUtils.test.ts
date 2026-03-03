import assert from 'assert';
import { makeDeck, pickIndicatorAndOkey, dealHands } from '@okey/shared';

function simpleAssert(condition: boolean, msg: string) {
  if (!condition) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

(function testMakeDeck() {
  const deck = makeDeck();
  simpleAssert(deck.length === 106, 'makeDeck produces 106 tiles');
})();

(function testPickIndicator() {
  const deck = makeDeck();
  // shuffle by simple rotate
  const { indicator, okey } = pickIndicatorAndOkey(deck);
  simpleAssert(indicator.kind === 'normal', 'indicator is normal tile');
  simpleAssert(typeof okey.value === 'number', 'okey has numeric value');
})();

(function testDealHands() {
  const deck = makeDeck();
  const players = ['p1','p2','p3','p4'];
  // dealer index 0 => first player is dealer's right ((0-1+4)%4=3)
  const { hands } = dealHands(players, deck, 0);
  simpleAssert(hands['p1'].length === 21, 'p1 has 21 tiles');
  simpleAssert(hands['p2'].length === 21, 'p2 has 21 tiles');
  simpleAssert(hands['p3'].length === 21, 'p3 has 21 tiles');
  simpleAssert(hands['p4'].length === 22, 'p4 (dealer-right) has 22 tiles');
})();
