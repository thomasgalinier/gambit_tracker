// node test.js [export.json] — evaluator asserts + parse/export smoke test on a real log.
const assert = require('assert');
const E = require('./engine.js');
const ev = s => E.evaluate(s.split(' '));
assert(ev('As Ks Qs Js Ts 2c 3d') > ev('Ah Ad Ac As Kd 2c 3d'), 'royal > quads');
assert(ev('Ah Ad Ac As Kd 2c 3d') > ev('Ah Ad Ac Ks Kd 2c 3d'), 'quads > full');
assert(ev('2h 4h 6h 8h Th Ac Kd') > ev('5c 6d 7h 8s 9c Ad Kd'), 'flush > straight');
assert(ev('6c 2d 3h 4s 5c Kd Qd') > ev('Ac 2d 3h 4s 5c Kd Qd'), '6-high straight > wheel');
assert(ev('Ac 2d 3h 4s 5c Kd Qd') > ev('Ac Ad Ah Ks Qc 9d 8d'), 'wheel > trips');
assert.strictEqual(ev('Kh Kd Qh Qd 2c 2d Ac'), ev('Ks Kc Qs Qc 3c 3d Ah'), 'two pair, best kicker counts (third pair ignored)');
assert(ev('Kh Kd Qh Qd 2c 2d Ac') > ev('Kh Kd Qh Qd 2c 2d Jc'), 'two pair kicker');
assert(ev('Ah Kd 9c 7s 5h 3c 2d') > ev('Ah Qd 9c 7s 5h 3c 2d'), 'high card kicker');
const aa = E.equity(['Ah', 'Ad'], [['Kc', 'Kd']], [], 3000);
assert(aa > 0.78 && aa < 0.86, 'AA vs KK ~82%: ' + aa);
assert.strictEqual(E.equity(['Ah', 'Kd'], [['Ac', 'Kh']], ['2s', '3s', '4d', '9c', 'Tc'], 50), 0.5, 'chop');
assert.strictEqual(E.equity(['Ah', 'Kd'], [['2c', '2h']], ['2s', '2d', '7h', '9c'], 200), 0, 'drawing dead vs quads');
assert.deepStrictEqual([...E.range('TT+')], ['TT', 'JJ', 'QQ', 'KK', 'AA']);
assert.deepStrictEqual([...E.range('ATs+')], ['ATs', 'AJs', 'AQs', 'AKs']);
assert.deepStrictEqual([...E.range('A5s-A3s')], ['A3s', 'A4s', 'A5s']);
assert.deepStrictEqual([...E.range('22-44')], ['22', '33', '44']);
assert.strictEqual(E.handKey(['6c', 'Ad']), 'A6o');
assert.strictEqual(E.handKey(['Th', '9h']), 'T9s');
assert.strictEqual(E.handName(['Jh', 'Js', '2c', '7d', '9s']), 'Paire de Valets');
assert.strictEqual(E.outs(['9h', '8h'], ['7c', '6d', '2s']).length, 8, 'open-ended: 8 outs');
assert.strictEqual(E.outs(['Ah', 'Kh'], ['7h', '6h', '2s']).length, 9, 'flush draw: 9 outs');
assert.strictEqual(E.preflopAdvice(['Ad', '6c'], 'UTG', 0, 0, 2, 2).action, 'Fold');
assert.strictEqual(E.preflopAdvice(['Ad', 'Ac'], 'HJ', 1, 0, 2, 5, 'UTG').best, '3-bet');
assert.strictEqual(E.preflopAdvice(['7d', '2c'], 'BB', 1, 0, 2, 3, 'BTN').best, 'Fold');
assert.strictEqual(E.preflopAdvice(['Kd', 'Kc'], 'BTN', 2, 0, 2, 15, 'BTN', true, 'BB').best, '4-bet');
assert.strictEqual(E.preflopAdvice(['Ad', '7c'], 'CO', 0, 0, 2, 2, null, false, null, 10).best, 'Tapis', 'A7o CO 10 BB: shove');
assert.strictEqual(E.preflopAdvice(['7d', '6c'], 'UTG', 0, 0, 2, 2, null, false, null, 10).best, 'Fold');
assert.strictEqual(E.preflopAdvice(['Qd', 'Qc'], 'BB', 1, 0, 2, 18, 'BTN', false, null, 10, true).best, 'Payer', 'QQ calls a shove');
assert.strictEqual(E.chartFor('BB', 1, 'BTN').title, 'BB face à BTN');
assert.strictEqual(E.chartFor('CO', 0, null, false, null, 10).rLabel, 'Tapis');
assert.strictEqual(E.preflopAdvice(['Ad', '9c'], 'CO', 0, 0, 2, 2).best, 'Relance', '100 BB unchanged');
for (const [k, v] of [...Object.entries(E.CHARTS.vsOpen), ...Object.entries(E.CHARTS.vs3bet)])
  for (const [h, w] of v.raise) assert(w + (v.call.get(h) || 0) <= 1.0001, `${k} ${h}: raise + call > 100 %`);
// GTO job builder on a heads-up single-raised pot (CO opens, BB calls)
const A = (street, seat, type, amount, to, extra = {}) => ({ street, seat, type, amount, to, ...extra });
const hu = {
  hero: 5, bb: 2, board: ['Ks', '7d', '2c', '5h', '9s'], folded: new Set([1, 2, 4]),
  players: { 1: { seat: 1, pos: 'BTN', start: 200 }, 2: { seat: 2, pos: 'SB', start: 200 }, 3: { seat: 3, pos: 'BB', start: 200 },
    4: { seat: 4, pos: 'UTG', start: 200 }, 5: { seat: 5, pos: 'CO', start: 200, cards: ['Ah', 'Qd'] } },
  actions: [A('preflop', 2, 'blind', 1, 1, { blind: true }), A('preflop', 3, 'blind', 2, 2, { blind: true }), A('preflop', 4, 'fold', 0, 0),
    A('preflop', 5, 'raise', 5, 5), A('preflop', 1, 'fold', 0, 0), A('preflop', 2, 'fold', 0, 1), A('preflop', 3, 'call', 3, 5),
    A('flop', 3, 'check', 0, 0), A('flop', 5, 'bet', 4, 4), A('flop', 3, 'call', 4, 4), A('turn', 3, 'check', 0, 0), A('turn', 5, 'bet', 10, 10),
    A('turn', 3, 'call', 10, 10), A('river', 3, 'check', 0, 0), A('river', 5, 'check', 0, 0)],
};
const { jobs } = E.gtoJobs(hu);
assert.deepStrictEqual(jobs.map(j => [j.street, j.pot, j.stack, j.heroIsOop, j.line.length]),
  [['flop', 550, 9750, false, 3], ['turn', 950, 9550, false, 3], ['river', 1950, 9050, false, 2]], 'pots/stacks in 1/100 BB');
assert(jobs[0].ipRange.includes('AQo') && jobs[0].oopRange.includes('K8s'), 'CO open range vs BB calling range');
// 3-way flop (BTN also calls), BTN folds on the flop -> flop skipped, turn and river solved heads-up
const threeWay = { ...hu, folded: new Set([2, 4, 1]), actions: hu.actions.map(a => a.seat === 1 && a.street === 'preflop' ? { ...a, type: 'call', amount: 5, to: 5 } : a) };
threeWay.actions.splice(10, 0, A('flop', 1, 'fold', 0, 0));
const tj = E.gtoJobs(threeWay);
assert.deepStrictEqual(tj.jobs.map(j => j.street), ['turn', 'river'], 'multiway flop, heads-up turn');
assert(tj.skipped[0].multiway && tj.skipped[0].street === 'flop');
assert.strictEqual(tj.jobs[0].pot, 1200, 'dead money of the folded player stays in the pot');
// limped pot (SB completes, BB checks) is solved with approximate ranges
const limped = { ...hu, hero: 3, folded: new Set([1, 4, 5]), players: { ...hu.players, 3: { ...hu.players[3], cards: ['9h', '8h'] } },
  actions: [A('preflop', 2, 'blind', 1, 1, { blind: true }), A('preflop', 3, 'blind', 2, 2, { blind: true }), A('preflop', 4, 'fold', 0, 0), A('preflop', 5, 'fold', 0, 0),
    A('preflop', 1, 'fold', 0, 0), A('preflop', 2, 'call', 1, 2), A('preflop', 3, 'check', 0, 2), A('flop', 2, 'check', 0, 0), A('flop', 3, 'bet', 2, 2), A('flop', 2, 'fold', 0, 0)] };
const lj = E.gtoJobs(limped);
assert(lj.jobs.length === 1 && lj.jobs[0].approx && lj.jobs[0].pot === 200, 'limped pot job');
assert.strictEqual(E.matchAction('Check|Bet:120|Bet:450|AllIn:9000', { type: 'bet', to: 400 }), 2, 'nearest bet size');
assert.strictEqual(E.matchAction('Fold|Call|Raise:300|AllIn:900', { type: 'raise', to: 900, allin: true }), 3, 'all-in');
const mk = (id, table, t) => ({ id, table, t, hero: 1, bb: 2, players: { 1: { net: 1 } } });
const ss = E.sessions([mk('a', 'solo:1', 0), mk('b', 'solo:1', 60e3), mk('c', 'tournament:9:1', 120e3), mk('d', 'tournament:9:4', 180e3), mk('e', 'solo:1', 240e3), mk('f', 'solo:1', 240e3 + 3600e3)],
  { e: { sessionId: 's1' }, f: { sessionId: 's1' } });
assert.deepStrictEqual(ss.map(s => [s.kind, s.hands.length]), [['Contre les bots', 2], ['Tournoi', 2], ['Contre les bots', 2]], 'one session per game');
console.log('evaluator + helpers ok', E.OPEN_PCT);

if (process.argv[2]) {
  const hands = E.parseHands(require(require('path').resolve(process.argv[2])));
  console.log(hands.length, 'hands');
  for (const h of hands) console.log(E.toPokerStars(h));
  const back = hands.map(h => E.thaw(JSON.parse(JSON.stringify(E.freeze(h)))));
  assert.deepStrictEqual(back.map(E.toPokerStars), hands.map(E.toPokerStars), 'freeze/thaw roundtrip');
  assert.strictEqual(E.finalPot(hands[2]), 99, 'pot without the uncalled shove');
  assert(E.coaching(null, { vpip: 49, pfr: 24, aggression: 1.07, cbet: 19, wtsd: 52, foldToCbet: 41, threeBet: 4.6 }).length >= 4, 'coaching on a loose-passive profile');
  console.log(E.heroStats(hands));
  console.table(E.botStats(hands));
  for (const s of E.heroSpots(hands, 2000)) console.log(s.a.street, s.a.type, s.a.amount, 'eq', s.eq.toFixed(2), 'need', s.need?.toFixed(2));
}
