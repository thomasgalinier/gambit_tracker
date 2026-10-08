// Pure analysis code (no DOM): parsing Gambit snapshots, hand evaluation, equity, stats, PokerStars export.
// Loaded by dashboard.html and by test.js under node.

const RANKS = '23456789TJQKA';
const card = c => [RANKS.indexOf(c[0]) + 2, c[1]];

// ---------- hand evaluator: higher score = better 7-card hand ----------
function straightHigh(mask) {
  if (mask & (1 << 14)) mask |= 1 << 1; // ace plays low
  for (let hi = 14; hi >= 5; hi--) {
    let ok = true;
    for (let r = hi; r > hi - 5; r--) if (!(mask & (1 << r))) { ok = false; break; }
    if (ok) return hi;
  }
  return 0;
}

function score(cat, ks) {
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (ks[i] || 0);
  return s;
}

function evaluate(cards) {
  const cs = cards.map(card);
  const bySuit = {};
  const count = new Array(15).fill(0);
  let mask = 0;
  for (const [r, s] of cs) {
    count[r]++;
    mask |= 1 << r;
    (bySuit[s] ||= []).push(r);
  }
  const flush = Object.values(bySuit).find(x => x.length >= 5);
  if (flush) {
    const sf = straightHigh(flush.reduce((m, r) => m | (1 << r), 0));
    if (sf) return score(8, [sf]);
  }
  // ranks grouped by (count desc, rank desc)
  const groups = [];
  for (let r = 14; r >= 2; r--) if (count[r]) groups.push([count[r], r]);
  groups.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kickers = (except, n) => groups.map(g => g[1]).filter(r => !except.includes(r)).sort((a, b) => b - a).slice(0, n);
  const [g0, g1] = groups;
  if (g0[0] === 4) return score(7, [g0[1], ...kickers([g0[1]], 1)]);
  if (g0[0] === 3 && g1 && g1[0] >= 2) return score(6, [g0[1], g1[1]]);
  if (flush) return score(5, flush.sort((a, b) => b - a));
  const st = straightHigh(mask);
  if (st) return score(4, [st]);
  if (g0[0] === 3) return score(3, [g0[1], ...kickers([g0[1]], 2)]);
  if (g0[0] === 2 && g1[0] === 2) return score(2, [g0[1], g1[1], ...kickers([g0[1], g1[1]], 1)]);
  if (g0[0] === 2) return score(1, [g0[1], ...kickers([g0[1]], 3)]);
  return score(0, kickers([], 5));
}

// ---------- equity: hero vs opponents (null cards = unknown, dealt at random) ----------
const DECK = [...RANKS].flatMap(r => [...'shdc'].map(s => r + s));

// ponytail: always Monte Carlo (±1.5% at 4000 iters); exact enumeration on turn/river if precision matters
function equity(hero, opps, board, iters = 4000) {
  const known = new Set([...hero, ...board, ...opps.flat().filter(Boolean)]);
  const rest = DECK.filter(c => !known.has(c));
  let total = 0;
  for (let i = 0; i < iters; i++) {
    const deck = rest.slice();
    let n = 0;
    const draw = () => {
      const j = n + Math.floor(Math.random() * (deck.length - n));
      [deck[n], deck[j]] = [deck[j], deck[n]];
      return deck[n++];
    };
    const os = opps.map(o => o || [draw(), draw()]);
    const b = board.slice();
    while (b.length < 5) b.push(draw());
    const h = evaluate([...hero, ...b]);
    const best = Math.max(...os.map(o => evaluate([...o, ...b])));
    if (h > best) total += 1;
    else if (h === best) total += 1 / (1 + os.filter(o => evaluate([...o, ...b]) === h).length);
  }
  return total / iters;
}

// ---------- beginner helpers: hand names, outs, preflop charts ----------
const RANK_FR = { 2: 'Deux', 3: 'Trois', 4: 'Quatre', 5: 'Cinq', 6: 'Six', 7: 'Sept', 8: 'Huit', 9: 'Neuf', 10: 'Dix', 11: 'Valets', 12: 'Dames', 13: 'Rois', 14: 'As' };
const CAT_FR = ['Hauteur', 'Paire', 'Double paire', 'Brelan', 'Quinte', 'Couleur', 'Full', 'Carré', 'Quinte flush'];
const category = sc => Math.floor(sc / 15 ** 5);

function handName(cards) {
  const sc = evaluate(cards), cat = category(sc), top = Math.floor(sc / 15 ** 4) % 15;
  if (cat === 0) return `Hauteur ${{ 14: 'As', 13: 'Roi', 12: 'Dame', 11: 'Valet' }[top] ?? RANK_FR[top]}`;
  if (cat === 1) return `Paire de ${RANK_FR[top]}`;
  if (cat === 2) return `Double paire (${RANK_FR[top]} et ${RANK_FR[Math.floor(sc / 15 ** 3) % 15]})`;
  if (cat === 3) return `Brelan de ${RANK_FR[top]}`;
  return CAT_FR[cat];
}

// Cards that would give hero a straight or better (the classic "draw" outs), only before the river.
function outs(hero, board) {
  if (board.length < 3 || board.length > 4) return [];
  if (category(evaluate([...hero, ...board])) >= 4) return [];
  const known = new Set([...hero, ...board]);
  return DECK.filter(c => !known.has(c) && category(evaluate([...hero, ...board, c])) >= 4);
}

// "AKs", "T9o", "77" from two hole cards
function handKey([a, b]) {
  let [r1, r2] = [RANKS.indexOf(a[0]), RANKS.indexOf(b[0])];
  if (r1 < r2) [r1, r2] = [r2, r1];
  return r1 === r2 ? RANKS[r1] + RANKS[r2] : RANKS[r1] + RANKS[r2] + (a[1] === b[1] ? 's' : 'o');
}

// "TT+, ATs+, KQo, A5s-A2s" -> Set of hand keys
function range(str) {
  const out = new Set();
  for (const tok of str.split(',').map(x => x.trim()).filter(Boolean)) {
    const [from, to] = tok.replace('+', '').split('-');
    const hi = RANKS.indexOf(from[0]), lo = RANKS.indexOf(from[1]), sfx = from[2] || '';
    if (hi === lo) { // pairs
      const end = tok.endsWith('+') ? 12 : to ? RANKS.indexOf(to[0]) : hi;
      for (let r = Math.min(hi, end); r <= Math.max(hi, end); r++) out.add(RANKS[r] + RANKS[r]);
    } else {
      const end = tok.endsWith('+') ? hi - 1 : to ? RANKS.indexOf(to[1]) : lo;
      for (let r = Math.min(lo, end); r <= Math.max(lo, end); r++) out.add(RANKS[hi] + RANKS[r] + sfx);
    }
  }
  return out;
}

// "AA, KQs:0.5, A5s-A2s:0.3" -> Map handKey -> frequency. Same PioSOLVER-like syntax as the postflop solver.
function wrange(str) {
  const m = new Map();
  for (const tok of str.split(',').map(x => x.trim()).filter(Boolean)) {
    const [r, w] = tok.split(':');
    for (const k of range(r)) {
      if (m.has(k)) throw new Error(`duplicate ${k} in "${str}"`);
      m.set(k, w ? +w : 1);
    }
  }
  return m;
}
const combos = k => k.length === 2 ? 6 : k[2] === 's' ? 4 : 12;
const rangePct = m => 100 * [...m].reduce((t, [k, w]) => t + combos(k) * w, 0) / 1326;

// Preflop charts, 6-max, 100 BB, open 2.5 BB (SB 3 BB), no rake. Mixed frequencies modelled on published GTO solutions.
// ponytail: hand-written approximation of solver charts, not an actual solver run; replace these strings with exported solver ranges if you have some
const CHART_SRC = {
  open: {
    UTG: '66+, 55:0.5, A9s+, A8s:0.5, A5s, A4s:0.5, KTs+, K9s:0.5, QTs+, JTs, T9s:0.5, AJo+, ATo:0.5, KQo, KJo:0.3',
    HJ: '55+, 44:0.5, 33:0.3, A7s+, A6s:0.5, A5s-A3s, A2s:0.5, K9s+, K8s:0.5, Q9s+, J9s+, T9s, T8s:0.4, 98s:0.6, 87s:0.3, ATo+, A9o:0.3, KJo+, KTo:0.4, QJo:0.5',
    CO: '33+, 22:0.6, A2s+, K7s+, K6s:0.6, K5s:0.4, Q8s+, J8s+, T8s+, 97s+, 87s, 76s:0.8, 65s:0.6, 54s:0.4, A9o+, A8o:0.5, KTo+, K9o:0.3, QTo+, JTo, T9o:0.3',
    BTN: '22+, A2s+, K2s+, Q4s+, Q3s:0.5, J6s+, J5s:0.5, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, 53s:0.5, 43s:0.3, A2o+, K8o+, K7o:0.5, Q9o+, Q8o:0.5, J9o+, J8o:0.4, T8o+, 98o, 87o:0.4',
    SB: '22+, A2s+, K4s+, K3s:0.5, Q6s+, J7s+, T7s+, 97s+, 86s+, 75s+, 65s, 54s, A4o+, A3o:0.5, K9o+, K8o:0.5, Q9o+, J9o+, T9o, 98o:0.4',
  },
  // key "hero>opener": 3-bet / call frequencies facing a single open
  vsOpen: {
    'HJ>UTG': ['QQ+, JJ:0.4, AKs, AQs:0.5, A5s:0.5, A4s:0.3, KQs:0.3, AKo, AQo:0.2',
      'JJ:0.6, TT-77, 66:0.5, AQs:0.5, AJs:0.7, ATs:0.6, KQs:0.6, KJs:0.6, QJs:0.5, JTs:0.5, T9s:0.3, AQo:0.3'],
    'CO>HJ': ['QQ+, JJ:0.5, AKs, AQs:0.6, AJs:0.3, A5s-A4s:0.6, KQs:0.4, KJs:0.2, AKo, AQo:0.4',
      'JJ:0.5, TT-66, 55:0.5, AQs:0.4, AJs:0.7, ATs, A9s:0.4, KQs:0.6, KJs:0.8, KTs:0.6, QJs:0.8, QTs:0.5, JTs:0.8, T9s:0.6, 98s:0.4, AQo:0.4, AJo:0.3'],
    'BTN>UTG': ['QQ+, JJ:0.3, AKs, AQs:0.4, A5s:0.4, KQs:0.2, AKo, AQo:0.2',
      'JJ:0.7, TT-55, 44:0.5, AQs:0.6, AJs, ATs, A9s:0.4, KQs:0.8, KJs, KTs:0.6, QJs, QTs:0.5, JTs, T9s:0.7, 98s:0.5, 87s:0.4, 76s:0.3, AQo:0.6, AJo:0.3, KQo:0.3'],
    'BTN>HJ': ['QQ+, JJ:0.4, AKs, AQs:0.5, AJs:0.3, A5s-A4s:0.5, KQs:0.3, K9s:0.2, 76s:0.2, AKo, AQo:0.3',
      'JJ:0.6, TT-33, 22:0.5, AQs:0.5, AJs:0.7, ATs-A6s, A3s-A2s:0.6, KQs:0.7, KJs-KTs, K9s:0.6, QTs+, Q9s:0.5, J9s+, T8s+, 97s+, 87s, 76s:0.6, 65s:0.5, AQo:0.7, AJo, ATo:0.4, KQo:0.7, KJo:0.3'],
    'BTN>CO': ['JJ+, TT:0.4, AJs+, ATs:0.3, A5s-A4s:0.6, A3s:0.4, KQs:0.6, KJs:0.4, K9s:0.3, Q9s:0.2, 76s:0.3, 65s:0.3, AKo, AQo:0.7, AJo:0.3, KQo:0.3',
      'TT:0.6, 99-22, ATs:0.7, A9s-A6s, A3s:0.6, A2s, KQs:0.4, KJs:0.6, KTs, K9s:0.7, K8s:0.5, QJs-QTs, Q9s:0.8, J9s+, J8s:0.5, T8s+, 97s+, 86s+, 76s:0.7, 75s:0.5, 65s:0.7, 54s:0.6, AQo:0.3, AJo:0.7, ATo, KQo:0.7, KJo, QJo:0.6, JTo:0.3'],
    'SB>UTG': ['TT+, 99:0.4, AJs+, ATs:0.5, A5s:0.6, A4s:0.4, KQs:0.7, KJs:0.3, AKo, AQo:0.5', ''],
    'SB>HJ': ['99+, 88:0.5, ATs+, A9s:0.4, A5s-A4s, A3s:0.4, KJs+, KTs:0.4, QJs:0.4, AQo+, AJo:0.4, KQo:0.4', ''],
    'SB>CO': ['77+, 66:0.5, A8s+, A5s-A3s, A2s:0.5, KTs+, K9s:0.4, QTs+, JTs, T9s:0.4, AJo+, ATo:0.5, KQo, KJo:0.4', ''],
    'SB>BTN': ['55+, 44:0.5, A2s+, K9s+, K8s:0.5, Q9s+, J9s+, T9s, 98s:0.5, 87s:0.3, ATo+, A9o:0.5, KJo+, KTo:0.4, QJo:0.5', ''],
    'BB>UTG': ['QQ+, AKs, AKo:0.7, A5s:0.4, KQs:0.2',
      'JJ-22, AQs-A6s, A5s:0.6, A4s-A2s, KJs, KQs:0.8, KTs-K9s, Q9s+, J9s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, AKo:0.3, AQo-ATo, KQo, KJo:0.5, QJo:0.3'],
    'BB>HJ': ['JJ+, AQs+, A5s:0.5, A4s:0.4, KQs:0.4, AKo',
      'TT-22, AJs-A6s, A5s:0.5, A4s:0.6, A3s-A2s, KQs:0.6, KJs-K8s, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 64s+, 54s, AQo-A9o, KJo+, QJo, JTo:0.4'],
    'BB>CO': ['TT+, AJs+, A5s-A4s, KQs, K9s:0.3, 76s:0.3, 65s:0.3, AQo+',
      '99-22, ATs-A6s, A3s-A2s, KJs-KTs, K9s:0.7, K8s-K6s, Q7s+, J7s+, T7s+, 96s+, 85s+, 76s:0.7, 75s, 74s, 65s:0.7, 64s, 63s, 54s, 53s, 43s, AJo-A8o, KTo+, QTo+, JTo, T9o:0.5'],
    'BB>BTN': ['99+, ATs+, A5s-A2s:0.5, KJs+, K9s:0.4, Q9s:0.3, 87s:0.3, 76s:0.3, AJo+, KQo:0.5',
      '88-22, A9s-A6s, A5s-A2s:0.5, KTs, K9s:0.6, K8s-K2s, QTs+, Q9s:0.7, Q8s-Q4s, J6s+, T6s+, 95s+, 87s:0.7, 86s, 85s, 76s:0.7, 75s, 74s, 63s+, 52s+, 42s+, ATo-A2o, KQo:0.5, KJo-K7o, Q8o+, J8o+, T8o+, 98o, 87o:0.6'],
    'BB>SB': ['88+, ATs+, A5s-A4s, KTs+, QJs, J9s:0.4, T9s:0.4, A9o+, KJo+, QJo:0.4',
      '77-22, A9s-A6s, A3s-A2s, K9s-K2s, QTs-Q2s, J9s:0.6, J8s-J4s, T9s:0.6, T8s-T6s, 96s+, 85s+, 74s+, 63s+, 53s+, 43s, A8o-A2o, KTo-K5o, QTo-Q7o, QJo:0.6, J8o+, T8o+, 97o+, 87o, 76o:0.5'],
  },
  // opener facing a 3-bet: out of position, in position, or cold (did not open)
  vs3bet: {
    oop: ['KK+, QQ:0.5, AKs, AKo:0.6, A5s:0.4', 'QQ:0.5, JJ-88, AQs, AJs:0.7, ATs:0.4, KQs, KJs:0.5, QJs:0.5, JTs:0.5, T9s:0.4, AKo:0.4, AQo:0.4'],
    ip: ['QQ+, AKs, AKo, A5s:0.5, A4s:0.4', 'JJ-55, AQs-A6s, A3s-A2s:0.5, K9s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, AQo-ATo, KQo:0.8, KJo:0.5'],
    cold: ['KK+, AKs', 'QQ, JJ:0.5, AKo:0.5, AQs:0.5'],
  },
};
CHART_SRC.vsOpen['CO>UTG'] = CHART_SRC.vsOpen['HJ>UTG'];
const CHARTS = {
  open: Object.fromEntries(Object.entries(CHART_SRC.open).map(([k, v]) => [k, wrange(v)])),
  vsOpen: Object.fromEntries(Object.entries(CHART_SRC.vsOpen).map(([k, [r, c]]) => [k, { raise: wrange(r), call: wrange(c) }])),
  vs3bet: Object.fromEntries(Object.entries(CHART_SRC.vs3bet).map(([k, [r, c]]) => [k, { raise: wrange(r), call: wrange(c) }])),
};
CHARTS.open['BTN/SB'] = CHARTS.open.BTN;
const OPEN = Object.fromEntries(Object.entries(CHARTS.open).map(([k, m]) => [k, new Set([...m.keys()])])); // any frequency > 0
const OPEN_PCT = Object.fromEntries(Object.entries(CHARTS.open).map(([k, m]) => [k, Math.round(rangePct(m))]));
const POSTFLOP_ORDER = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];
const LIMPED = {
  limper: wrange('22-TT, A2s-AJs, K2s+, Q5s+, J7s+, T7s+, 97s+, 86s+, 75s+, 65s, 54s, A2o-AJo, K8o+, Q9o+, J9o+, T9o, 98o'),
  bb: wrange('22-JJ, A2s-AQs, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 42s+, 32s, A2o-AQo, K2o+, Q2o+, J2o+, T2o+, 92o+, 82o+, 72o+, 62o+, 52o+, 42o+, 32o'),
};
const inPosition = (a, b) => POSTFLOP_ORDER.indexOf(a) > POSTFLOP_ORDER.indexOf(b);

// Short stacks (tournaments): push/fold ranges modelled on Nash push/fold charts (no ante), 6-max.
// ponytail: approximate, two stack depths only (10 and 15 BB); a full ICM-aware chart set would be more precise
const SHORT_SRC = {
  push10: { UTG: '22+, A2s+, A7o+, K9s+, KJo+, QTs+, JTs', HJ: '22+, A2s+, A5o+, K8s+, KTo+, Q9s+, QJo, J9s+, T9s',
    CO: '22+, A2s+, A2o+, K6s+, K9o+, Q8s+, QTo+, J8s+, JTo, T8s+, 98s',
    BTN: '22+, A2s+, A2o+, K2s+, K7o+, Q5s+, Q9o+, J7s+, J9o+, T7s+, T9o, 97s+, 87s, 76s',
    SB: '22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q6o+, J4s+, J8o+, T6s+, T8o+, 96s+, 98o, 85s+, 75s+, 64s+, 54s' },
  push15: { UTG: '55+, A8s+, ATo+, KTs+, KQo', HJ: '33+, A5s+, A9o+, KTs+, KJo+, QTs+',
    CO: '22+, A2s+, A8o+, K9s+, KTo+, Q9s+, QJo, J9s+, T9s', BTN: '22+, A2s+, A4o+, K7s+, K9o+, Q8s+, QTo+, J8s+, JTo, T8s+, 98s',
    SB: '22+, A2s+, A2o+, K4s+, K8o+, Q6s+, Q9o+, J7s+, J9o+, T7s+, T9o, 97s+, 86s+, 76s, 65s' },
  call10: '33+, A2s+, A7o+, K9s+, KQo', call15: '66+, A8s+, ATo+, KQs',
  reshove25: '77+, ATs+, AJo+, KQs, A5s-A4s', // facing an open with 16-25 BB: all-in or fold
};
const SHORT = {
  push10: Object.fromEntries(Object.entries(SHORT_SRC.push10).map(([k, v]) => [k, wrange(v)])),
  push15: Object.fromEntries(Object.entries(SHORT_SRC.push15).map(([k, v]) => [k, wrange(v)])),
  call10: wrange(SHORT_SRC.call10), call15: wrange(SHORT_SRC.call15), reshove25: wrange(SHORT_SRC.reshove25),
};

// closest chart for hero facing an open from `opener` (unknown opener -> CO)
function vsOpenChart(hero, opener) {
  hero = hero === 'BTN/SB' ? 'SB' : hero;
  const order = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];
  let o = order.includes(opener) ? opener : 'CO';
  for (let i = order.indexOf(o); i >= 0; i--) if (CHARTS.vsOpen[`${hero}>${order[i]}`]) return { chart: CHARTS.vsOpen[`${hero}>${order[i]}`], key: `${hero}>${order[i]}` };
  for (const x of order) if (CHARTS.vsOpen[`${hero}>${x}`]) return { chart: CHARTS.vsOpen[`${hero}>${x}`], key: `${hero}>${x}` };
  return { chart: CHARTS.vsOpen['BTN>CO'], key: 'BTN>CO' };
}

const MIX_FR = f => f >= 0.95 ? 'toujours' : f <= 0.05 ? 'jamais' : `${Math.round(100 * f)} % du temps`;

// The chart that applies to a preflop spot (same logic as preflopAdvice): { raise, call, title, rLabel } or null.
function chartFor(pos, raises, opener, heroOpened, threeBettor, stackBB = 100, facingAllin = false) {
  const p = pos === 'BTN/SB' ? 'SB' : pos, none = new Map();
  if (stackBB <= 25) {
    const depth = stackBB <= 12 ? 10 : 15;
    if (raises === 0 && stackBB <= 18 && SHORT['push' + depth][p]) return { raise: SHORT['push' + depth][p], call: none, title: `${p} · tapis ou fold (${Math.round(stackBB)} BB)`, rLabel: 'Tapis' };
    if (raises >= 1 && facingAllin) return { raise: none, call: SHORT['call' + depth], title: `Payer un tapis (${Math.round(stackBB)} BB)`, rLabel: 'Tapis' };
    if (raises === 1) return { raise: SHORT.reshove25, call: none, title: `${p} face à une ouverture · tapis ou fold`, rLabel: 'Tapis' };
  }
  if (raises === 0) return CHARTS.open[p] ? { raise: CHARTS.open[p], call: none, title: `Ouverture depuis ${p}`, rLabel: 'Relance' } : null;
  if (raises === 1) { const { chart, key } = vsOpenChart(p, opener); return { ...chart, title: key.replace('>', ' face à '), rLabel: '3-bet' }; }
  const c = !heroOpened ? CHARTS.vs3bet.cold : inPosition(p, threeBettor) ? CHARTS.vs3bet.ip : CHARTS.vs3bet.oop;
  return { ...c, title: heroOpened ? 'Face à une 3-bet' : 'Face à relance + 3-bet', rLabel: '4-bet' };
}

// { action, best, mix: [{a, f}], why } for a preflop spot.
// raises = raises so far (0 = unopened); opener = position of the first raiser; heroOpened = hero made the first raise
function preflopAdvice(cards, pos, raises, limpers, bb, toCall, opener, heroOpened, threeBettor, stackBB = 100, facingAllin = false) {
  const k = handKey(cards);
  let mix, ctx;
  // short stack: push/fold instead of the 100 BB charts
  if (stackBB <= 25 && !(pos === 'BB' && raises === 0 && toCall === 0)) {
    const depth = stackBB <= 12 ? 10 : 15, p = pos === 'BTN/SB' ? 'SB' : pos;
    let f = 0, act = 'Tapis', why;
    if (raises === 0 && stackBB <= 18) {
      f = SHORT['push' + depth][p]?.get(k) ? 1 : 0;
      why = `Avec ${Math.round(stackBB)} BB, relancer puis te coucher te coûterait trop : on joue « tapis ou fold ». Depuis ${p}, on part à tapis avec ~${Math.round(rangePct(SHORT['push' + depth][p] || new Map()))} % des mains.`;
    } else if (raises >= 1 && facingAllin) {
      f = SHORT['call' + depth].get(k) ? 1 : 0; act = 'Payer';
      why = `Face à un tapis, il faut une main nettement plus forte que pour pousser soi-même : on paie avec ~${Math.round(rangePct(SHORT['call' + depth]))} % des mains.`;
    } else if (raises === 1) {
      f = SHORT.reshove25.get(k) ? 1 : 0;
      why = `Avec ${Math.round(stackBB)} BB face à une ouverture, on répond « tapis ou fold » : payer laisse trop peu de jetons pour jouer après le flop.`;
    }
    if (why) {
      mix = [{ a: act, f }, { a: 'Fold', f: 1 - f }].filter(x => x.f > 0.001);
      const best = mix[0].a;
      return { short: act, stackBB: Math.round(stackBB), action: best === 'Tapis' ? `Tapis (${Math.round(stackBB)} BB)` : best === 'Payer' ? `Payer ${toCall}` : 'Fold', best, mix,
        why: `${why} Ici : ${best.toLowerCase()} avec ${k}. Grilles « tapis ou fold » approximatives (sans ante ni ICM).` };
    }
  }
  if (raises === 0) {
    if (pos === 'BB' && toCall === 0) return { action: 'Check', best: 'Check', mix: [{ a: 'Check', f: 1 }], why: 'Tu es en grosse blinde et personne n\'a relancé : tu vois le flop gratuitement.' };
    const m = CHARTS.open[pos];
    if (!m) return { action: '?', best: '?', mix: [], why: '' };
    const w = m.get(k) || 0;
    mix = [{ a: 'Relance', f: w }, { a: 'Fold', f: 1 - w }];
    ctx = `Depuis ${pos}, on ouvre ~${OPEN_PCT[pos]} % des mains${limpers ? ' (ici il y a des limpers : relance un peu plus gros, +1 BB par limper)' : ''}.`;
  } else if (raises === 1) {
    const { chart, key } = vsOpenChart(pos, opener);
    const r = chart.raise.get(k) || 0, c = chart.call.get(k) || 0;
    mix = [{ a: '3-bet', f: r }, { a: 'Payer', f: c }, { a: 'Fold', f: Math.max(0, 1 - r - c) }];
    ctx = `Grille « ${key.replace('>', ' face à une ouverture de ')} ». ${pos === 'SB' ? 'De la petite blinde on joue surtout « 3-bet ou fold » : payer hors de position est difficile.' : pos === 'BB' ? 'En grosse blinde tu as déjà mis 1 BB et tu as un bon prix : tu peux défendre large.' : ''}`;
  } else {
    const chart = !heroOpened ? CHARTS.vs3bet.cold : inPosition(pos, threeBettor) ? CHARTS.vs3bet.ip : CHARTS.vs3bet.oop;
    const r = chart.raise.get(k) || 0, c = chart.call.get(k) || 0;
    mix = [{ a: '4-bet', f: r }, { a: 'Payer', f: c }, { a: 'Fold', f: Math.max(0, 1 - r - c) }];
    ctx = heroOpened ? `Tu as ouvert et on te sur-relance${threeBettor ? ` (${threeBettor})` : ''} : ${inPosition(pos, threeBettor) ? 'tu seras en position, tu peux payer plus large.' : 'tu seras hors de position, sois sélectif.'}` : 'Il y a déjà une relance et une sur-relance avant toi : il faut une très grosse main.';
  }
  mix = mix.filter(x => x.f > 0.001);
  const best = mix.reduce((a, b) => (b.f > a.f ? b : a)).a;
  const sizes = { Relance: `Relance à ${Math.round((pos === 'SB' ? 3 : 2.5 + limpers) * bb)}`, '3-bet': `3-bet (~${['SB', 'BB'].includes(pos) ? 4 : 3}× la relance)`, '4-bet': '4-bet (~2,2× la sur-relance)', Payer: `Payer ${toCall}`, Fold: 'Fold', Check: 'Check' };
  const mixTxt = mix.map(x => `${x.a.toLowerCase()} ${MIX_FR(x.f)}`).join(', ');
  const pure = mix.length === 1;
  return {
    action: sizes[best] ?? best, best, mix,
    why: `${pure ? `Les solutions GTO jouent ${k} toujours de la même façon ici : ${best.toLowerCase()}.` : `Les solutions GTO mélangent avec ${k} : ${mixTxt}. Une main « mixte » est à la frontière : les deux choix se valent presque. Pour un débutant, prends l'action la plus fréquente.`} ${ctx}`,
  };
}

// ---------- parsing ----------
const POS = { 2: ['BTN/SB', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['BTN', 'SB', 'BB', 'CO'], 5: ['BTN', 'SB', 'BB', 'HJ', 'CO'], 6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] };
const STREETS = ['preflop', 'flop', 'turn', 'river'];
const boardAt = (board, street) => board.slice(0, [0, 3, 4, 5][STREETS.indexOf(street)]);

function snapshots(msgs) {
  const seen = new Set();
  const out = [];
  for (const m of msgs) {
    if (m.kind !== 'ws-in' || !m.data.startsWith('{"type":"snapshot"') || seen.has(m.data)) continue;
    seen.add(m.data);
    out.push({ t: m.t, s: JSON.parse(m.data).snapshot });
  }
  return out.sort((a, b) => a.t - b.t);
}

function parseHands(msgs) {
  const hands = new Map();
  for (const { t, s } of snapshots(msgs)) {
    let h = hands.get(s.handId);
    if (!h) {
      if (s.street !== 'preflop') { hands.set(s.handId, { broken: true }); continue; } // joined mid-hand
      const live = s.seats.filter(x => !x.isDealtOut).map(x => x.seat);
      const btn = s.seats.find(x => x.isDealer)?.seat ?? live[0];
      const order = [...live.slice(live.indexOf(btn)), ...live.slice(0, live.indexOf(btn))];
      h = {
        id: s.handId, table: s.tableId, t, hero: s.youSeat, btn, order,
        players: Object.fromEntries(s.seats.filter(x => !x.isDealtOut).map(x => [x.seat, {
          seat: x.seat, name: x.name, isBot: x.isBot, start: x.stack + x.bet, pos: POS[order.length]?.[order.indexOf(x.seat)] ?? '?',
        }])),
        actions: [], keys: new Set(), folded: new Set(), pot: 0, commit: {}, max: 0, street: 'preflop', bb: 0,
      };
      hands.set(s.handId, h);
    }
    if (h.broken) continue;
    if (s.street !== h.street && STREETS.indexOf(s.street) > STREETS.indexOf(h.street)) {
      h.street = s.street; h.commit = {}; h.max = 0;
    }
    // new actions in this snapshot, in acting order (blinds first)
    const fresh = s.seats.filter(x => x.lastAction && h.players[x.seat]).filter(x => {
      const a = x.lastAction;
      // ponytail: a seat repeating the exact same action twice on one street is seen once
      const key = `${a.type === 'fold' ? '*' : s.street}|${x.seat}|${a.type}|${a.amount}|${a.to}`;
      if (h.keys.has(key)) return false;
      h.keys.add(key);
      return true;
    }).sort((a, b) => ((h.order.indexOf(a.seat) + h.order.length - 1) % h.order.length) - ((h.order.indexOf(b.seat) + h.order.length - 1) % h.order.length));
    for (const x of fresh) {
      const a = x.lastAction;
      const amt = a.amount || 0;
      const before = h.commit[x.seat] || 0;
      const toCall = h.max - before;
      const potBefore = h.pot;
      let type = a.type;
      if (type === 'allin') type = before + amt > h.max ? (h.max ? 'raise' : 'bet') : 'call';
      if (type === 'raise' && !h.max) type = 'bet';
      h.commit[x.seat] = before + amt;
      h.pot += amt;
      if (a.type === 'blind') h.bb = Math.max(h.bb, amt);
      if (a.type === 'fold') h.folded.add(x.seat);
      h.actions.push({
        street: h.street, seat: x.seat, type, allin: a.type === 'allin', blind: a.type === 'blind',
        amount: amt, to: before + amt, raiseBy: before + amt - h.max, toCall, potBefore,
        alive: Object.keys(h.players).map(Number).filter(p => !h.folded.has(p) && p !== x.seat),
      });
      h.max = Math.max(h.max, before + amt);
    }
    if (s.phase === 'handComplete') {
      h.done = true;
      h.board = s.board;
      h.result = s.handResult;
      for (const x of s.seats) if (h.players[x.seat]) {
        h.players[x.seat].cards = x.cards;
        h.players[x.seat].net = s.handResult?.chipsWonBySeat?.[x.seat - 1] ?? 0;
      }
    }
  }
  return [...hands.values()].filter(h => h.done && isPlayable(h)).sort((a, b) => a.t - b.t);
}

// hero seated (not a spectated table or a scripted Gambit lesson like "ace-board-call")
function isPlayable(h) {
  return h.hero != null && !!h.players?.[h.hero] && !/^ace-/.test(h.table || '');
}

// ---------- stats ----------
const vol = a => a.street === 'preflop' && !a.blind && ['call', 'bet', 'raise'].includes(a.type);
const aggr = a => ['bet', 'raise'].includes(a.type) && !a.blind;

function playerLine(h, seat) {
  const mine = h.actions.filter(a => a.seat === seat);
  const pre = mine.filter(a => a.street === 'preflop');
  const raisesBefore = i => h.actions.slice(0, i).filter(a => a.street === 'preflop' && aggr(a)).length;
  // c-bet: the last preflop raiser bets the flop before anyone else bets
  const pfa = h.actions.filter(a => a.street === 'preflop' && aggr(a)).at(-1)?.seat;
  const flop = h.actions.filter(a => a.street === 'flop');
  const firstBet = flop.findIndex(aggr);
  const myFirst = flop.findIndex(a => a.seat === seat);
  const cbetMade = firstBet >= 0 && flop[firstBet].seat === pfa;
  const myAfterCbet = cbetMade ? flop.slice(firstBet + 1).find(a => a.seat === seat) : null;
  // limp: first voluntary preflop action is a call while nobody raised
  const firstVol = h.actions.findIndex(a => a.seat === seat && a.street === 'preflop' && !a.blind);
  const limp = firstVol >= 0 && h.actions[firstVol].type === 'call' && raisesBefore(firstVol) === 0;
  // fold to 3-bet: seat made the first raise, someone re-raised, seat's next action
  const preAggr = h.actions.filter(a => a.street === 'preflop' && aggr(a));
  const opened = preAggr[0]?.seat === seat;
  const reply3 = opened && preAggr[1] ? h.actions.slice(h.actions.indexOf(preAggr[1]) + 1).find(a => a.seat === seat && a.street === 'preflop') : null;
  // turn barrel after own c-bet; facing a bet on the turn
  const turn = h.actions.filter(a => a.street === 'turn');
  const myTurnFirst = turn.findIndex(a => a.seat === seat);
  const turnBetBefore = myTurnFirst >= 0 && turn.slice(0, myTurnFirst).some(aggr);
  const facedTurn = turn.findIndex((a, i) => aggr(a) && a.seat !== seat && turn.slice(i + 1).some(b => b.seat === seat));
  const turnReply = facedTurn >= 0 ? turn.slice(facedTurn + 1).find(b => b.seat === seat) : null;
  // river bets and how strong the hand was (cards are revealed at the end of every Gambit hand)
  const riverMine = mine.filter(a => a.street === 'river');
  const riverAggr = riverMine.some(aggr);
  const cards = h.players[seat]?.cards;
  const weakRiver = riverAggr && cards && h.board.length === 5 ? category(evaluate([...cards, ...h.board])) <= 1 : null;
  const sd = !h.folded.has(seat) && Object.keys(h.players).length - h.folded.size > 1;
  return {
    limp,
    foldTo3betChance: !!reply3, foldTo3bet: reply3?.type === 'fold',
    barrelChance: seat === pfa && cbetMade && myTurnFirst >= 0 && !turnBetBefore, barrel: seat === pfa && cbetMade && myTurnFirst >= 0 && !turnBetBefore && aggr(turn[myTurnFirst]),
    foldTurnChance: !!turnReply, foldTurn: turnReply?.type === 'fold',
    riverChance: riverMine.length > 0, riverBet: riverAggr,
    weakRiverChance: weakRiver != null, weakRiver: !!weakRiver,
    wonSd: sd && (h.players[seat]?.net ?? 0) > 0,
    cbetChance: seat === pfa && myFirst >= 0 && (firstBet < 0 || firstBet >= myFirst),
    cbet: seat === pfa && cbetMade,
    foldCbetChance: seat !== pfa && !!myAfterCbet,
    foldCbet: seat !== pfa && myAfterCbet?.type === 'fold',
    vpip: pre.some(vol),
    pfr: pre.some(aggr),
    threeBetChance: h.actions.some((a, i) => a.seat === seat && a.street === 'preflop' && !a.blind && raisesBefore(i) === 1),
    threeBet: h.actions.some((a, i) => a.seat === seat && a.street === 'preflop' && aggr(a) && raisesBefore(i) === 1),
    sawFlop: h.board.length >= 3 && !pre.some(a => a.type === 'fold'),
    showdown: !h.folded.has(seat) && Object.keys(h.players).length - h.folded.size > 1,
    postAggr: mine.filter(a => a.street !== 'preflop' && aggr(a)).length,
    postCalls: mine.filter(a => a.street !== 'preflop' && a.type === 'call').length,
  };
}

function summarize(lines) {
  const n = lines.length || 1;
  const pct = k => 100 * lines.filter(l => l[k]).length / n;
  const flops = lines.filter(l => l.sawFlop);
  const tbc = lines.filter(l => l.threeBetChance);
  const calls = lines.reduce((s, l) => s + l.postCalls, 0);
  const rate = (chance, k) => { const c = lines.filter(l => l[chance]); return c.length ? 100 * c.filter(l => l[k]).length / c.length : null; };
  const count = chance => lines.filter(l => l[chance]).length;
  const sds = lines.filter(l => l.showdown);
  return {
    limp: pct('limp'), foldTo3bet: rate('foldTo3betChance', 'foldTo3bet'), barrel: rate('barrelChance', 'barrel'),
    foldTurn: rate('foldTurnChance', 'foldTurn'), riverBet: rate('riverChance', 'riverBet'), weakRiver: rate('weakRiverChance', 'weakRiver'),
    wsd: sds.length ? 100 * sds.filter(l => l.wonSd).length / sds.length : null,
    counts: { cbet: count('cbetChance'), foldCbet: count('foldCbetChance'), foldTo3bet: count('foldTo3betChance'), barrel: count('barrelChance'),
      foldTurn: count('foldTurnChance'), riverBet: count('riverChance'), weakRiver: count('weakRiverChance'), sd: sds.length, threeBet: tbc.length },
    cbet: rate('cbetChance', 'cbet'), foldCbet: rate('foldCbetChance', 'foldCbet'),
    n: lines.length, vpip: pct('vpip'), pfr: pct('pfr'),
    threeBet: tbc.length ? 100 * tbc.filter(l => l.threeBet).length / tbc.length : null,
    af: calls ? lines.reduce((s, l) => s + l.postAggr, 0) / calls : null,
    wtsd: flops.length ? 100 * flops.filter(l => l.showdown).length / flops.length : null,
  };
}

function heroStats(hands) {
  const rows = hands.map(h => ({ h, p: h.players[h.hero], line: playerLine(h, h.hero) }));
  const group = key => {
    const m = {};
    for (const r of rows) (m[key(r)] ||= []).push(r);
    return Object.entries(m).map(([k, rs]) => {
      const net = rs.reduce((s, r) => s + r.p.net, 0);
      const bbs = rs.reduce((s, r) => s + r.p.net / (r.h.bb || 2), 0);
      return { key: k, ...summarize(rs.map(r => r.line)), net, bb100: 100 * bbs / rs.length };
    });
  };
  return { all: group(() => 'Total')[0], byPos: group(r => r.p.pos) };
}

// Who takes my chips: hero losses split among winners by share of winnings, hero wins split among losers.
function botStats(hands) {
  const m = {};
  for (const h of hands) {
    const me = h.players[h.hero];
    const others = Object.values(h.players).filter(p => p.seat !== h.hero);
    const winners = others.filter(p => p.net > 0), losers = others.filter(p => p.net < 0);
    const wSum = winners.reduce((s, p) => s + p.net, 0), lSum = -losers.reduce((s, p) => s + p.net, 0);
    for (const p of others) {
      const b = (m[p.name] ||= { name: p.name, isBot: p.isBot, lines: [], vsMe: 0 });
      b.lines.push(playerLine(h, p.seat));
      if (me.net < 0 && p.net > 0) b.vsMe += me.net * p.net / wSum;
      if (me.net > 0 && p.net < 0) b.vsMe += me.net * -p.net / lSum;
    }
  }
  return Object.values(m).map(b => ({ name: b.name, isBot: b.isBot, ...summarize(b.lines), vsMe: Math.round(b.vsMe) }));
}

// How to exploit a player, from his stats. Each rule needs a minimum sample.
function exploits(st) {
  const out = [], c = st.counts || {};
  const add = (tip, why) => out.push({ tip, why });
  if (st.n >= 20 && st.vpip > 40) add('Isole-le : relance plus large quand il limpe ou paie', `Il joue ${Math.round(st.vpip)} % des mains : sa range est faible en moyenne.`);
  if (st.n >= 20 && st.limp > 15) add('Relance ses limps', `Il limpe ${Math.round(st.limp)} % du temps, souvent avec des mains moyennes.`);
  if (c.foldTo3bet >= 5 && st.foldTo3bet > 60) add('3-bet le plus souvent, même en bluff', `Il se couche ${Math.round(st.foldTo3bet)} % du temps face à une 3-bet.`);
  if (c.foldCbet >= 6 && st.foldCbet > 55) add('C-bet presque toujours contre lui', `Il se couche ${Math.round(st.foldCbet)} % du temps face à une c-bet.`);
  if (c.foldCbet >= 6 && st.foldCbet < 30) add('Ne le bluffe pas au flop, mise pour la valeur', `Il ne se couche que ${Math.round(st.foldCbet)} % du temps face à une c-bet.`);
  if (c.cbet >= 6 && st.cbet > 75) add('Paie ou relance ses c-bets plus large', `Il fait une c-bet ${Math.round(st.cbet)} % du temps : beaucoup sont des bluffs.`);
  if (c.barrel >= 5 && st.barrel < 35) add('S\'il checke la turn après sa c-bet, mise : il abandonne souvent', `Il ne remise à la turn que ${Math.round(st.barrel)} % du temps.`);
  if (c.foldTurn >= 5 && st.foldTurn > 55) add('Mise la turn quand il a payé le flop', `Il se couche ${Math.round(st.foldTurn)} % du temps face à une mise à la turn.`);
  if (c.weakRiver >= 5 && st.weakRiver > 35) add('Paie ses mises river plus large', `${Math.round(st.weakRiver)} % de ses mises river sont faites avec une paire ou moins.`);
  if (c.weakRiver >= 5 && st.weakRiver < 12) add('Couche-toi face à ses mises river sans très bonne main', `Il ne mise la river avec une paire ou moins que ${Math.round(st.weakRiver)} % du temps : quand il mise, il a du jeu.`);
  if (c.sd >= 8 && st.wtsd > 40) add('Ne le bluffe pas : il va trop souvent à l\'abattage', `WTSD de ${Math.round(st.wtsd)} %.`);
  if (st.af != null && st.n >= 30 && st.af < 1) add('Respecte ses relances après le flop', `Agression ${st.af.toFixed(2)} : quand un joueur passif relance, il a presque toujours une grosse main.`);
  return out;
}

// What a player really opened with, per hand class (cards are revealed in every Gambit hand).
function openRange(hands, name) {
  const m = {};
  for (const h of hands) {
    const p = Object.values(h.players).find(x => x.name === name);
    if (!p?.cards) continue;
    const first = h.actions.find(a => a.street === 'preflop' && aggr(a));
    const iFirstVol = h.actions.findIndex(a => a.seat === p.seat && a.street === 'preflop' && !a.blind);
    if (iFirstVol < 0 || (first && h.actions.indexOf(first) < iFirstVol)) continue; // somebody opened before him
    const s = (m[handKey(p.cards)] ||= { dealt: 0, opened: 0, limped: 0 });
    s.dealt++;
    if (first?.seat === p.seat) s.opened++;
    else if (h.actions[iFirstVol].type === 'call') s.limped++;
  }
  return m;
}

// Hero's preflop decisions compared with the charts.
function preflopDecisions(h) {
  const me = h.players[h.hero];
  if (!me?.cards) return [];
  const out = [];
  const pos = s => h.players[s]?.pos;
  h.actions.forEach((a, i) => {
    if (a.seat !== h.hero || a.street !== 'preflop' || a.blind) return;
    const before = h.actions.slice(0, i).filter(b => b.street === 'preflop');
    const raises = before.filter(aggr);
    const limpers = raises.length ? 0 : before.filter(b => b.type === 'call' && !b.blind).length;
    const heroOpened = raises[0]?.seat === h.hero;
    const three = raises.filter(b => b.seat !== h.hero).at(-1);
    const others = Object.values(h.players).filter(p => p.seat !== h.hero);
    const stackBB = Math.min(me.start, Math.max(...others.map(p => p.start))) / (h.bb || 2); // effective stack
    const facingAllin = raises.some(b => b.allin);
    const adv = preflopAdvice(me.cards, me.pos === 'BTN/SB' ? 'SB' : me.pos, raises.length, limpers, h.bb || 2, a.toCall, raises[0] && pos(raises[0].seat), heroOpened, three && pos(three.seat), stackBB, facingAllin);
    const played = a.type === 'fold' ? 'Fold' : a.type === 'check' ? 'Check' : a.type === 'call' ? (raises.length ? 'Payer' : 'Limp')
      : a.allin && adv.mix.some(m => m.a === 'Tapis') ? 'Tapis' : ['Relance', '3-bet', '4-bet'][Math.min(raises.length, 2)];
    const f = adv.mix.find(m => m.a === played)?.f ?? 0;
    out.push({ h, cards: me.cards, key: handKey(me.cards), pos: me.pos, raises: raises.length, opener: raises[0] && pos(raises[0].seat),
      heroOpened, threeBettor: three && pos(three.seat), limpers, toCall: a.toCall, played, f, adv, mistake: f < 0.15 && played !== 'Check' });
  });
  return out;
}

// Stats per session (for the progress charts). Sessions with fewer than `min` hands are skipped.
function sessionSeries(hands, min = 10, meta = {}) {
  return sessions(hands, meta).filter(s => s.hands.length >= min).map(s => ({
    start: s.start, n: s.hands.length, bb100: s.bb100, ...summarize(s.hands.map(h => playerLine(h, h.hero))),
  }));
}

// Every time hero put chips in: hindsight equity vs the opponents' revealed cards.
function heroSpots(hands, iters) {
  const out = [];
  for (const h of hands) {
    const me = h.players[h.hero];
    if (!me.cards) continue;
    for (const a of h.actions) {
      if (a.seat !== h.hero || a.blind || !a.amount) continue;
      const i = h.actions.indexOf(a);
      const foldsLater = s => a.type === 'call' && h.actions.some((b, j) => j > i && b.seat === s && b.type === 'fold' && b.street === a.street);
      const opps = a.alive.filter(s => !foldsLater(s)).map(s => h.players[s].cards || null);
      if (!opps.length) continue;
      const eq = equity(me.cards, opps, boardAt(h.board, a.street), iters);
      const need = a.type === 'call' ? a.amount / (a.potBefore + a.amount) : null;
      out.push({ h, a, eq, need, bb: a.amount / (h.bb || 2), cost: a.amount * (1 - eq) });
    }
  }
  return out;
}

// ---------- storage: parsed hands are stored instead of raw messages ----------
const freeze = h => ({ id: h.id, table: h.table, t: h.t, hero: h.hero, btn: h.btn, order: h.order, players: h.players,
  actions: h.actions, folded: [...h.folded], board: h.board, result: h.result, bb: h.bb, rated: h.rated });
const thaw = h => ({ ...h, folded: new Set(h.folded) });

// ---------- sessions: hands separated by more than 30 min ----------
// meta[handId] = { sessionId, type, format, placement, friend } from Gambit's own hand history (GetHands)
const tourneyId = h => /^tournament:(\d+)/.exec(h.table || '')?.[1];
function gameKey(h, meta) {
  return meta?.[h.id]?.sessionId || (tourneyId(h) ? 'T' + tourneyId(h) : h.table);
}
function sessionKind(h, meta) {
  const m = meta?.[h.id];
  if (m?.format === 'sit_and_go') return 'Sit & Go';
  if (m?.type === 'tournament' || tourneyId(h)) return 'Tournoi';
  if (m?.type === 'bot' || /^solo:/.test(h.table)) return 'Contre les bots';
  if (m?.friend) return 'Entre amis';
  return 'Partie en ligne';
}

// One session = one game: a tournament, a sit & go, a run against the bots, an online table.
// Outside tournaments, a pause of more than 30 min also starts a new session.
function sessions(hands, meta = {}) {
  const out = [];
  for (const h of hands) {
    const cur = out.at(-1), key = gameKey(h, meta);
    const same = cur && cur.key === key && (key.startsWith('T') || meta[h.id]?.sessionId || h.t - cur.end < 30 * 60e3);
    if (same) { cur.hands.push(h); cur.end = h.t; } else out.push({ key, start: h.t, end: h.t, hands: [h], kind: sessionKind(h, meta) });
  }
  return out.map(s => {
    const net = s.hands.reduce((t, h) => t + h.players[h.hero].net, 0);
    const bbs = s.hands.reduce((t, h) => t + h.players[h.hero].net / (h.bb || 2), 0);
    const placement = s.hands.map(h => meta[h.id]?.placement).filter(Boolean).at(-1);
    return { ...s, net, bb100: 100 * bbs / s.hands.length, placement, tournament: ['Tournoi', 'Sit & Go'].includes(s.kind) };
  });
}

// ---------- player profiles ----------
function profile(st) {
  if (!st || st.n < 15) return { label: 'Inconnu', tip: `Pas assez de mains (${st?.n ?? 0}/15) pour juger ce joueur.` };
  const loose = st.vpip > 30, aggressive = st.pfr / Math.max(st.vpip, 1) > 0.6 || (st.af ?? 0) > 2;
  if (!loose && aggressive) return { label: 'Serré-agressif (TAG)', tip: 'Joue peu de mains mais les joue fort. Respecte ses relances, vole-lui les blindes quand il est passif.' };
  if (loose && aggressive) return { label: 'Large-agressif (LAG)', tip: 'Relance souvent avec des mains moyennes. Paie-le plus large avec de bonnes mains et laisse-le bluffer.' };
  if (!loose) return { label: 'Serré-passif (Rock)', tip: 'Joue peu et rarement fort. Quand il mise ou relance, il a presque toujours une très bonne main : couche-toi.' };
  return { label: 'Large-passif (Calling station)', tip: 'Paie avec tout mais relance rarement. Ne le bluffe pas ; mise pour la valeur dès que tu as une bonne main.' };
}

// ---------- "points à travailler" ----------
function coaching(st, g, byPos, outside) {
  const out = [];
  const add = (sev, title, why, fix) => out.push({ sev, title, why, fix });
  const vpip = g?.vpip ?? st?.vpip, pfr = g?.pfr ?? st?.pfr, af = g?.aggression ?? st?.af, wtsd = g?.wtsd ?? st?.wtsd;
  const cbet = g?.cbet ?? st?.cbet, foldCbet = g?.foldToCbet ?? st?.foldCbet, threeBet = g?.threeBet ?? st?.threeBet;
  if (vpip > 32) add(3, `Tu joues trop de mains (VPIP ${Math.round(vpip)} %)`, 'Un bon joueur à 6 entre dans 22 à 28 % des coups. Plus tu joues de mains faibles, plus tu te retrouves avec une paire moyenne contre une meilleure main.', 'Suis la grille de l\'onglet Préflop : fold les mains dépareillées faibles (Q9o, J8o, A4o…) sauf au bouton.');
  if (vpip - pfr > 10) add(3, `Tu paies trop avant le flop (écart VPIP-PFR de ${Math.round(vpip - pfr)} points)`, 'Payer une relance ou limper donne l\'initiative à l\'adversaire : tu dois toucher le flop pour gagner, alors qu\'en relançant tu peux gagner tout de suite.', 'Règle simple : avant le flop, relance ou couche-toi. Ne paie qu\'avec les petites paires et les mains assorties connectées.');
  if (af != null && af < 1.5) add(2, `Trop passif après le flop (agression ${af.toFixed(2)})`, 'Tu paies plus souvent que tu ne mises. Le joueur passif ne gagne que s\'il a la meilleure main à l\'abattage ; le joueur agressif gagne aussi quand l\'autre se couche.', 'Quand tu as une bonne main, mise (ne check pas pour « piéger »). Avec un tirage, essaie le semi-bluff.');
  if (cbet != null && cbet < 40) add(2, `Pas assez de c-bets (${Math.round(cbet)} %)`, 'Quand tu as relancé avant le flop, l\'adversaire rate le flop environ 2 fois sur 3. Une mise de continuation gagne souvent le pot directement.', 'Après avoir relancé préflop, mise 1/3 à 1/2 du pot au flop la plupart du temps, surtout contre un seul adversaire.');
  if (wtsd != null && wtsd > 35) add(2, `Tu vas trop souvent à l'abattage (WTSD ${Math.round(wtsd)} %)`, 'Tu paies jusqu\'à la river avec des mains moyennes. Les bots qui misent turn et river ont souvent une main forte.', 'Face à deux grosses mises (turn + river), couche une simple paire sauf si tu as une bonne raison de croire au bluff.');
  if (foldCbet != null && foldCbet > 60) add(1, `Tu te couches trop face aux c-bets (${Math.round(foldCbet)} %)`, 'Les adversaires peuvent miser n\'importe quoi au flop et gagner.', 'Paie une c-bet avec une paire, un tirage, ou deux cartes hautes sur un board sec.');
  if (threeBet != null && threeBet < 4) add(1, `Pas assez de 3-bets (${threeBet.toFixed(1)} %)`, 'Tu laisses les relanceurs jouer sans pression.', 'Sur-relance au moins QQ+, AK, et parfois A5s/A4s au bouton.');
  const worst = (byPos || []).filter(p => p.n >= 20).sort((a, b) => a.bb100 - b.bb100)[0];
  if (worst && worst.bb100 < -20) add(2, `Ta position la plus coûteuse : ${worst.key} (${worst.bb100.toFixed(0)} BB/100)`, `Sur ${worst.n} mains, c'est là que tu perds le plus.`, `Regarde dans l'onglet Préflop les mains que tu joues en ${worst.key} hors de la grille conseillée.`);
  if (outside && outside.n >= 20 && outside.pct > 25) add(2, `${Math.round(outside.pct)} % des mains que tu ouvres sont hors de la grille`, 'Ces mains sont en moyenne perdantes à long terme.', 'Utilise le quiz de l\'onglet Entraînement pour mémoriser les ranges d\'ouverture.');
  return out.sort((a, b) => b.sev - a.sev);
}

// [seat, chips] of the bet nobody called on the last street (returned to its owner)
function uncalled(h) {
  const last = h.actions.filter(a => a.street === h.actions.at(-1)?.street);
  const commit = {};
  for (const a of last) commit[a.seat] = (commit[a.seat] || 0) + a.amount;
  const [top, second] = Object.entries(commit).sort((a, b) => b[1] - a[1]);
  return top ? [+top[0], top[1] - (second?.[1] || 0)] : [null, 0];
}
const finalPot = h => h.actions.reduce((t, a) => t + a.amount, 0) - uncalled(h)[1];

// ---------- GTO postflop analysis (heads-up only) with the WASM solver ----------
const rangeStr = m => [...m].filter(([, w]) => w > 0.001).map(([k, w]) => (w >= 0.999 ? k : `${k}:${+w.toFixed(3)}`)).join(',');
// Tree sizes per starting street: deliberately small so it runs in a browser tab.
const GTO_TREES = {
  flop: ['33%, 75%', '', '66%', '', '75%, a', ''],
  turn: ['50%, 100%', '3x', '50%, 100%', '3x', '75%, a', ''],
  river: ['33%, 75%, 150%, a', '2.5x', '33%, 75%, 150%, a', '2.5x', '33%, 75%, 150%, a', '2.5x'],
};
GTO_TREES.flop[0] = '33%';
// "Analyse précise": more sizes on turn and river (flop stays small: the flop tree dominates the cost)
const GTO_TREES_PRECISE = {
  flop: GTO_TREES.flop,
  turn: ['33%, 66%, 125%', '3x', '33%, 66%, 125%', '3x', '33%, 75%, 150%, a', '2.5x'],
  river: ['25%, 50%, 75%, 125%, a', '2.5x', '25%, 50%, 75%, 125%, a', '2.5x', '25%, 50%, 75%, 125%, a', '2.5x'],
}; // ponytail: one flop size keeps the flop solve at ~3 min / 500 MB; add '75%' when a faster solver is available

// Preflop ranges of the two players who saw the flop, from the preflop action. null = unsupported spot.
function gtoSetup(h, street = 'flop') {
  const i0 = h.actions.findIndex(a => a.street === street);
  if (i0 < 0) return { error: `Pas de ${street} dans cette main.` };
  // players still in at the start of this street: a 3-way flop can become heads-up on the turn
  const alive = Object.values(h.players).filter(p => !h.actions.slice(0, i0).some(a => a.seat === p.seat && a.type === 'fold'));
  if (alive.length > 2) return { error: `${alive.length} joueurs encore dans le coup : le solveur ne calcule que le tête-à-tête.`, multiway: true };
  if (alive.length < 2) return { error: 'Plus d\'adversaire.' };
  const raises = h.actions.filter(a => a.street === 'preflop' && aggr(a));
  const pos = s => { const p = h.players[s].pos; return p === 'BTN/SB' ? 'BTN' : p; };
  if (raises.length > 2) return { error: 'Pot 4-bet ou plus : non pris en charge.' };
  const [a, b] = alive.map(p => p.seat);
  const oop = inPosition(pos(a), pos(b)) ? b : a, ip = oop === a ? b : a;
  if (raises.length === 0) {
    // limped pot: nobody showed strength. ponytail: rough ranges (limper ~ wide button range, BB = anything that did not raise); real limp charts would be better
    const limpRange = s => pos(s) === 'BB' ? LIMPED.bb : LIMPED.limper;
    return { oop, ip, ranges: { [a]: limpRange(a), [b]: limpRange(b) }, approx: 'Pot limpé : ranges approximatives (personne n\'a relancé avant le flop).' };
  }
  // preflop range of each player from his role: opener, caller of the open, 3-bettor, caller of the 3-bet
  const opener = raises[0].seat, three = raises[1]?.seat;
  const rangeOf = seat => roleRange(seat) ?? LIMPED.limper; // unknown role (e.g. BB raising limpers): wide range
  const roleRange = seat => {
    if (!three) {
      if (seat === opener) return CHARTS.open[pos(opener)];
      const ch = vsOpenChart(pos(seat), pos(opener)).chart;
      return ch.call.size ? ch.call : vsOpenChart('BB', pos(opener)).chart.call; // SB flats are rare: borrow the BB calling range
    }
    if (seat === three) return vsOpenChart(pos(three), pos(opener)).chart.raise;
    if (seat === opener) return (inPosition(pos(opener), pos(three)) ? CHARTS.vs3bet.ip : CHARTS.vs3bet.oop).call;
    return CHARTS.vs3bet.cold.call; // cold call of a 3-bet
  };
  const known = roleRange(a) && roleRange(b);
  return { oop, ip, ranges: { [a]: rangeOf(a), [b]: rangeOf(b) }, approx: known ? null : 'Situation préflop inhabituelle : ranges approximatives.' };
}

// One solver job per street where hero acted, each solved from the start of that street.
// ponytail: each street starts from the preflop ranges (not narrowed by earlier streets) — chain the solves if accuracy matters
function gtoJobs(h, { precise = false } = {}) {
  const me = h.players[h.hero];
  if (!me?.cards || !h.actions.some(a => a.seat === h.hero && a.street !== 'preflop')) return { error: 'Tu n\'as pas joué ce coup après le flop.', jobs: [], skipped: [] };
  const scale = 100 / (h.bb || 2); // solver units: 1 BB = 100
  const jobs = [], skipped = [];
  for (const street of ['flop', 'turn', 'river']) {
    const i0 = h.actions.findIndex(a => a.street === street);
    if (i0 < 0 || !h.actions.some(a => a.street === street && a.seat === h.hero && !a.blind)) continue;
    const setup = gtoSetup(h, street);
    if (setup.error) { skipped.push({ street, reason: setup.error, multiway: setup.multiway }); continue; }
    const before = h.actions.slice(0, i0);
    const inv = s => before.filter(a => a.seat === s).reduce((t, a) => t + a.amount, 0);
    const pot = before.reduce((t, a) => t + a.amount, 0);
    const stack = Math.min(...[setup.oop, setup.ip].map(s => h.players[s].start - inv(s)));
    if (stack <= 0) continue;
    const range = s => {
      let m = setup.ranges[s];
      if (s === h.hero && !(m.get(handKey(me.cards)) > 0)) return rangeStr(m) + ',' + [...me.cards].sort((a, b) => RANKS.indexOf(b[0]) - RANKS.indexOf(a[0])).join(''); // hero's actual hand must be in his range
      return rangeStr(m);
    };
    jobs.push({
      id: h.id, precise, street, hand: [...me.cards].sort((a, b) => RANKS.indexOf(b[0]) - RANKS.indexOf(a[0])).join(''), heroIsOop: h.hero === setup.oop, scale, // solver wants the higher card first
      oopRange: range(setup.oop), ipRange: range(setup.ip),
      board: boardAt(h.board, street).join(''),
      pot: Math.round(pot * scale), stack: Math.round(stack * scale), sizes: (precise ? GTO_TREES_PRECISE : GTO_TREES)[street],
      nextCard: h.board[{ flop: 3, turn: 4 }[street]] ?? null, heroPos: me.pos, villainPos: h.players[h.hero === setup.oop ? setup.ip : setup.oop].pos,
      approx: setup.approx || null,
      line: h.actions.slice(i0).filter(a => a.street === street && (a.seat === setup.oop || a.seat === setup.ip))
        .map(a => ({ street: a.street, hero: a.seat === h.hero, type: a.type, to: Math.round(a.to * scale), allin: a.allin })),
    });
  }
  const why = skipped[0]?.reason ?? 'Aucune décision de ta part après le flop.';
  return { jobs, skipped, error: jobs.length ? null : why };
}

// Pick the solver action closest to what was actually played. labels: "Check|Bet:120|Call|..."
function matchAction(labels, a) {
  const acts = labels.split('|').map(x => { const [k, v] = x.split(':'); return { k, v: +v || 0 }; });
  const find = k => acts.findIndex(x => x.k === k);
  if (a.type === 'fold') return find('Fold');
  if (a.type === 'check') return find('Check');
  if (a.type === 'call') return find('Call');
  if (a.allin && find('AllIn') >= 0) return find('AllIn');
  let best = -1, d = Infinity;
  acts.forEach((x, i) => { if (['Bet', 'Raise', 'AllIn'].includes(x.k) && Math.abs(x.v - a.to) < d) { d = Math.abs(x.v - a.to); best = i; } });
  return best;
}

const ACTION_FR = lbl => {
  const [k, v] = lbl.split(':');
  const bb = v ? ` ${(+v / 100).toFixed(1)} BB` : '';
  return { Fold: 'Fold', Check: 'Check', Call: 'Payer', Bet: 'Miser' + bb, Raise: 'Relancer à' + bb, AllIn: 'Tapis' + bb }[k] ?? lbl;
};

// Solve one job and walk the actual line. progress(fraction, exploitability%) is called between batches.
// Returns the decisions of hero: GTO frequencies for his hand, EV of each option (BB) and what he did.
async function runGtoJob(job, Solver, progress = () => {}, opts = {}) {
  const maxIters = opts.maxIters ?? (job.street === 'flop' ? 40 : 300); // flop: ~3.5 s/iteration in WASM
  const target = opts.target ?? (job.street === 'flop' ? 0.02 : 0.01); // exploitability goal, fraction of the pot
  const s = new Solver(job.oopRange, job.ipRange, job.board, job.pot, job.stack, ...job.sizes);
  s.allocate(job.street === 'flop');
  let it = 0, ex = Infinity, shown = 0;
  const batch = job.street === 'flop' ? 2 : 10;
  while (it < maxIters) {
    ex = s.run(batch);
    it += batch;
    const exPct = 100 * ex / job.pot;
    shown = Math.max(shown, Math.min(1, it / maxIters, 1), Math.min(1, target * 100 / Math.max(exPct, 1e-9))); // never goes backwards
    await progress(shown, exPct);
    if (exPct <= target * 100) break;
  }
  s.finalize();
  try { return walkGto(s, job, ex, it); } finally { s.free?.(); }
}

function walkGto(s, job, ex, it) {
  const decisions = [], before = [];
  const street = job.street;
  for (const a of job.line) { // only this street: later streets get their own job
    if (s.is_terminal() || s.is_chance()) break;
    const labels = s.actions();
    const idx = matchAction(labels, a);
    if (idx < 0) return { decisions, exploitability: 100 * ex / job.pot, iterations: it, note: `Action « ${a.type} » absente de l'arbre simplifié : analyse arrêtée ici.` };
    if (a.hero) {
      const strat = [...s.hand_strategy(job.hand)], evs = [...s.hand_action_evs(job.hand)], range = [...s.range_strategy()];
      const [eqHand] = s.hand_values(job.heroIsOop ? 0 : 1, job.hand);
      const opts2 = labels.split('|').map((l, i) => ({ label: ACTION_FR(l), freq: strat[i] ?? 0, ev: (evs[i] ?? 0) / 100, rangeFreq: range[i] ?? 0 }));
      const bestEv = Math.max(...opts2.map(o => o.ev));
      // after an earlier off-strategy move of hero on this street, his hand may have zero reach: numbers become meaningless
      const reached = Number.isFinite(eqHand) && evs.some(v => v !== 0);
      const [b0, b1] = [...s.total_bet()];
      decisions.push({ street, options: opts2, played: idx, equity: eqHand, evLoss: Math.max(0, bestEv - opts2[idx].ev), reliable: reached,
        context: { hand: job.hand, board: job.board, pot: (job.pot + b0 + b1) / 100, toCall: Math.abs(b0 - b1) / 100, made: handName([...job.hand.match(/../g), ...job.board.match(/../g)]),
          before: before.slice(), heroPos: job.heroPos, villainPos: job.villainPos } });
    }
    before.push(`${a.hero ? 'Toi' : 'Adversaire'} : ${ACTION_FR(labels.split('|')[idx]).replace(/^./, c => c.toLowerCase())}`);
    s.play(idx);
  }
  // ranges that reach the next street, to chain the next solve
  let next = null;
  if (job.nextCard && s.is_chance()) {
    try { s.deal(job.nextCard); next = { oop: s.range_at(0), ip: s.range_at(1) }; } catch { /* card blocked or not dealt */ }
  }
  return { decisions, exploitability: 100 * ex / job.pot, iterations: it, next };
}

// Plain-French reason for the solver's preferred action, from equity vs range, pot odds and the action type.
function explainDecision(d) {
  const c = d.context || {}, eq = d.equity;
  const best = d.options.reduce((a, b) => (b.freq > a.freq ? b : a)), kind = best.label.split(' ')[0]; // what the strategy actually plays
  const eqTxt = `${Math.round(100 * eq)} %`, made = c.made ? `Tu as ${c.made.toLowerCase().replace(/^hauteur/, 'une simple hauteur')}` : 'Ta main';
  const need = c.toCall > 0 ? c.toCall / (c.pot + c.toCall) : null;
  const strength = eq >= 0.65 ? 'forte' : eq >= 0.45 ? 'moyenne' : eq >= 0.3 ? 'faible' : 'très faible';
  const base = `${made} : contre les mains que l'adversaire peut avoir ici, ton équité est de ${eqTxt} (main ${strength}).`;
  if (kind === 'Fold') return need != null && eq >= need
    ? `${base} La cote ne demande que ${Math.round(100 * need)} %, mais cette équité suppose d'aller jusqu'au bout gratuitement : il reste des cartes et des mises à venir, et tu devras souvent payer encore contre mieux ou abandonner. Le solveur préfère se coucher tout de suite.`
    : `${base} Il faut payer ${c.toCall?.toFixed(1)} BB pour un pot de ${c.pot?.toFixed(1)} BB, donc il te faudrait au moins ${Math.round(100 * (need ?? 0))} % : se coucher perd le moins.`;
  if (kind === 'Payer') return `${base} ${need != null ? `La cote demande ${Math.round(100 * need)} % : ` : ''}payer est rentable. Relancer ne servirait à rien : les mains moins bonnes se coucheraient et seules les meilleures paieraient.`;
  if (kind === 'Check') return eq >= 0.55
    ? `${base} Ta main est bonne mais miser ferait surtout coucher les mains plus faibles : check pour laisser l'adversaire miser ou voir la carte suivante gratuitement.`
    : `${base} Miser n'est pas rentable : les mains moins bonnes se coucheraient et les meilleures paieraient. Check pour contrôler la taille du pot.`;
  if (eq >= 0.6) return `${base} Ta main est devant une grande partie de la range adverse : ${best.label.toLowerCase()} pour te faire payer par des mains moins bonnes (mise de valeur).`;
  if (eq < 0.35) return `${base} Ta main gagne rarement à l'abattage, mais ${best.label.toLowerCase()} peut faire coucher de meilleures mains : c'est un bluff rentable ici.`;
  return `${base} ${best.label} protège ta main et met la pression : l'adversaire doit payer pour voir la suite avec ses tirages et mains moyennes.`;
}

// Next-street job using the ranges that really reached it (hero's combo kept even if GTO would never be there).
function chainJob(job, next) {
  if (!next?.oop || !next?.ip) return job;
  const keepHero = str => {
    const parts = str.split(',').filter(Boolean);
    const same = c => c.slice(0, 4) === job.hand || c.slice(0, 4) === job.hand.slice(2) + job.hand.slice(0, 2);
    const mine = parts.find(same);
    const w = Math.max(+(mine?.split(':')[1] ?? 0), 0.02);
    return [...parts.filter(c => !same(c)), `${job.hand}:${w.toFixed(3)}`].join(',');
  };
  return { ...job, chained: true, oopRange: job.heroIsOop ? keepHero(next.oop) : next.oop, ipRange: job.heroIsOop ? next.ip : keepHero(next.ip) };
}

// ---------- PokerStars hand history ----------
function pad(n) { return String(n).padStart(2, '0'); }

function toPokerStars(h) {
  const P = h.players, name = s => P[s].name;
  const d = new Date(h.t);
  const sb = h.actions.find(a => a.blind && a.amount < h.bb)?.amount ?? h.bb / 2;
  const L = [
    `PokerStars Hand #${parseInt(h.id.slice(0, 12), 16)}:  Hold'em No Limit (${sb}/${h.bb}) - ${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    `Table 'Gambit ${h.table}' ${h.order.length <= 6 ? 6 : 9}-max Seat #${h.btn} is the button`,
    ...Object.values(P).map(p => `Seat ${p.seat}: ${p.name} (${p.start} in chips)`),
  ];
  const head = { flop: '*** FLOP ***', turn: '*** TURN ***', river: '*** RIVER ***' };
  const streetLine = st => `${head[st]} [${boardAt(h.board, st).slice(0, st === 'flop' ? 3 : -1).join(' ')}]${st === 'flop' ? '' : ` [${boardAt(h.board, st).at(-1)}]`}`;
  let street = 'preflop', holes = false;
  const hole = () => {
    if (holes) return;
    holes = true;
    L.push('*** HOLE CARDS ***');
    if (P[h.hero].cards) L.push(`Dealt to ${name(h.hero)} [${P[h.hero].cards.join(' ')}]`);
  };
  for (const a of h.actions) {
    if (a.blind) { L.push(`${name(a.seat)}: posts ${a.amount < h.bb ? 'small' : 'big'} blind ${a.amount}`); continue; }
    hole();
    if (a.street !== street) { street = a.street; L.push(streetLine(street)); }
    const allin = a.allin ? ' and is all-in' : '';
    L.push(`${name(a.seat)}: ` + ({
      fold: 'folds', check: 'checks', call: `calls ${a.amount}${allin}`, bet: `bets ${a.amount}${allin}`,
      raise: `raises ${a.raiseBy} to ${a.to}${allin}`,
    }[a.type] ?? a.type));
  }
  hole();
  // board run out without action (all-in)
  for (const st of STREETS.slice(STREETS.indexOf(street) + 1)) if (boardAt(h.board, st).length > boardAt(h.board, street).length) L.push(streetLine(st));

  const [topSeat, returned] = uncalled(h);
  const top = [topSeat];
  const invested = s => h.actions.filter(a => a.seat === s).reduce((t, a) => t + a.amount, 0);
  const alive = Object.values(P).filter(p => !h.folded.has(p.seat));
  if (alive.length > 1) {
    L.push('*** SHOW DOWN ***');
    for (const p of alive) if (p.cards) L.push(`${p.name}: shows [${p.cards.join(' ')}]`);
  }
  if (returned > 0) L.push(`Uncalled bet (${returned}) returned to ${name(+top[0])}`);
  let total = 0;
  for (const p of Object.values(P)) {
    if (p.net <= 0) continue;
    const back = returned > 0 && +top[0] === p.seat ? returned : 0;
    const got = p.net + invested(p.seat) - back;
    total += got;
    L.push(`${p.name} collected ${got} from pot`);
  }
  L.push('*** SUMMARY ***', `Total pot ${total} | Rake 0`);
  if (h.board.length) L.push(`Board [${h.board.join(' ')}]`);
  return L.join('\n') + '\n';
}

if (typeof module !== 'undefined') module.exports = { chartFor, sessionKind, SHORT, isPlayable, explainDecision, chainJob, exploits, openRange, preflopDecisions, sessionSeries, gtoSetup, gtoJobs, runGtoJob, matchAction, evaluate, equity, parseHands, heroStats, botStats, heroSpots, toPokerStars, handName, outs, handKey, finalPot, range, wrange, rangePct, CHARTS, CHART_SRC, vsOpenChart, inPosition, preflopAdvice, OPEN_PCT, OPEN, freeze, thaw, sessions, profile, coaching, playerLine };
