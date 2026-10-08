const api = globalThis.browser ?? chrome;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const pct = v => v == null ? '–' : `${Math.round(v)} %`;
const num = (v, d = 0) => v == null ? '–' : v.toFixed(d);
const signed = (v, d = 0) => `<span class="${v > 0 ? 'win' : v < 0 ? 'loss' : ''}">${v > 0 ? '+' : ''}${v.toFixed(d)}</span>`;
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const card1 = c => c === '??' ? '<span class="cd x">?</span>' : `<span class="cd ${c[1]}">${c[0] === 'T' ? '10' : c[0]}${SUIT[c[1]]}</span>`;
const cards = cs => (cs?.length ? cs : ['??', '??']).map(card1).join('');
const STREET_FR = { preflop: 'Préflop', flop: 'Flop', turn: 'Turn', river: 'River' };
const ACT_TU = { fold: 'te couches', check: 'checkes', call: 'paies', bet: 'mises', raise: 'relances' };
const ACT_FR = { fold: 'se couche', check: 'check', call: 'paie', bet: 'mise', raise: 'relance', blind: 'blinde' };
const POS_ORDER = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'BTN/SB'];
const fmtDate = t => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

let hands = [], imported = [], importedFetch = {}, store = {}, notes = {};
const spotCache = new Map();
const spotsOf = h => spotCache.get(h.id) ?? (spotCache.set(h.id, heroSpots([h], 1500)), spotCache.get(h.id));
const META = () => store.handMeta || {};
const gambitStat = name => { try { return JSON.parse(store['f:' + name] ?? importedFetch[name]); } catch { return null; } };

async function load() {
  store = await api.storage.local.get(null);
  notes = Object.fromEntries(Object.keys(store).filter(k => k.startsWith('n:')).map(k => [k.slice(2), store[k]]));
  const byId = new Map();
  for (const h of [...Object.keys(store).filter(k => /^h\w/.test(k)).map(k => thaw(store[k])), ...imported]) byId.set(h.id, h);
  hands = [...byId.values()].filter(isPlayable).sort((a, b) => a.t - b.t);
  render();
  if (!imported.length) autoBackup();
}

// ---------- tabs ----------
const renderers = { overview: renderOverview, review: renderReview, hands: renderHands, preflop: renderGrid, players: renderPlayers, leaks: renderLeaks, training: renderTraining };
const current = () => document.querySelector('.tab.on').id;
$('#tabs').onclick = e => {
  const t = e.target.dataset.tab;
  if (!t) return;
  document.querySelectorAll('#tabs button, .tab').forEach(x => x.classList.toggle('on', x.dataset.tab === t || x.id === t));
  ls.set('tab', t);
  safe(renderers[t]);
};
const render = () => safe(renderers[current()]);
// one broken panel must not blank the whole dashboard
function safe(fn) {
  try { return fn(); } catch (e) {
    console.error(e);
    document.querySelector('.tab.on')?.insertAdjacentHTML('afterbegin', `<div class="card loss">⚠️ Erreur d'affichage : ${esc(e.message)}. Envoie-moi ce message et ta sauvegarde JSON.</div>`);
  }
}

// ================= OVERVIEW =================
function renderOverview() {
  const hs = heroStats(hands), st = hs.all, g = gambitStat('GetPlayerStats');
  const tile = (k, v, r = '') => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="r">${r}</div></div>`;
  $('#tiles').innerHTML = !hands.length ? '<div class="empty card">Aucune main enregistrée. Joue une partie sur gambit.com puis clique sur Actualiser.</div>' : [
    tile('Mains', st.n, `${sessions(hands, META()).length} session(s)`),
    tile('Résultat', signed(st.net), 'jetons'),
    tile('BB / 100', signed(st.bb100, 1), 'repère : > 0'),
    tile('VPIP', pct(st.vpip), 'repère : 22-28 %'),
    tile('PFR', pct(st.pfr), 'repère : 17-23 %'),
    tile('3-bet', pct(st.threeBet), 'repère : 6-10 %'),
    tile('Agression', num(st.af, 2), 'repère : 2-3'),
    tile('C-bet', pct(st.cbet), 'repère : 50-65 %'),
    tile('Fold to c-bet', pct(st.foldCbet), 'repère : 40-50 %'),
    tile('WTSD', pct(st.wtsd), 'repère : 26-32 %'),
  ].join('');

  // coaching: Gambit's lifetime stats win when our own sample is small
  const useG = g && (st?.n ?? 0) < 200;
  $('#coachSrc').textContent = useG
    ? `(d'après tes ${g.totalHands} dernières mains sur Gambit, lues sur ton profil Gambit${st?.n ? '' : ' : l\'extension n\'a encore enregistré aucune main'})`
    : `(d'après tes ${st.n} mains enregistrées par l'extension)`;
  const items = coaching(useG ? null : st, useG ? g : null, hs.byPos, outsideGrid());
  $('#coaching').innerHTML = !hands.length && !g ? '<p class="muted">Joue quelques mains pour obtenir des conseils.</p>'
    : !items.length ? '<p>👌 Rien de grave détecté. Continue à jouer pour affiner.</p>'
    : items.map(i => `<div class="advice sev${i.sev}"><div class="at">${i.title}</div><div class="aw">${i.why}</div><div class="af">👉 ${i.fix}</div></div>`).join('');

  renderChart();
  renderProgress();
  const ss = sessions(hands, META()).reverse();
  $('#sessions').innerHTML = !ss.length ? '<tr><td class="muted">Aucune session.</td></tr>' :
    `<thead><tr><th>Partie</th><th>Début</th><th class="num">Durée</th><th class="num">Mains</th><th class="num">Jetons</th><th class="num">BB/100</th></tr></thead>` +
    ss.map(s => `<tr><td><span class="pill">${s.kind}</span>${s.placement ? ` <span class="muted">${s.placement}e</span>` : ''}</td><td>${fmtDate(s.start)}</td><td class="num">${Math.max(1, Math.round((s.end - s.start) / 60e3))} min</td><td class="num">${s.hands.length}</td>
      <td class="num">${signed(s.net)}</td><td class="num">${signed(s.bb100, 1)}</td></tr>`).join('');
  renderGambit(g);
}

// cumulative result, main by main. chips = true for tournaments (blinds change, chips are the natural unit)
function renderChart(el = $('#chart'), list = hands, chips = false) {
  const unit = chips ? 'jetons' : 'BB', val = h => chips ? h.players[h.hero].net : h.players[h.hero].net / (h.bb || 2);
  if (list.length < 2) { el.innerHTML = '<div class="empty">Il faut au moins 2 mains.</div>'; return; }
  let cum = chips ? list[0].players[list[0].hero].start : 0; // tournaments: stack in chips, starting from the first stack
  const pts = [cum, ...list.map(h => (cum += val(h)))];
  const W = el.clientWidth || 800, H = 260, L = 48, R = 12, T = 12, B = 26;
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), span = hi - lo || 1;
  const x = i => L + (W - L - R) * i / (pts.length - 1);
  const y = v => T + (H - T - B) * (hi - v) / span;
  const mag = Math.pow(10, Math.floor(Math.log10(span)));
  const step = mag * (span / mag > 5 ? 2 : span / mag > 2 ? 1 : 0.5);
  let grid = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step)
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>`;
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Résultat cumulé : ${pts.at(-1).toFixed(1)} ${unit} après ${list.length} mains">
    ${grid}<line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
    <path class="area" d="${line}L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z"/><path class="line" d="${line}"/>
    <text x="${L}" y="${H - 6}">main 0</text><text x="${W - R}" y="${H - 6}" text-anchor="end">main ${list.length}</text>
    <line class="cross" y1="${T}" y2="${H - B}" hidden/><circle class="dot" r="5" hidden/></svg>`;
  const svg = el.querySelector('svg'), cross = svg.querySelector('.cross'), dot = svg.querySelector('.dot'), tip = $('#tip');
  let hover = 0;
  svg.onmousemove = e => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(1, Math.min(pts.length - 1, Math.round(((e.clientX - r.left) * W / r.width - L) / (W - L - R) * (pts.length - 1))));
    const h = list[i - 1];
    hover = i;
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.hidden = false;
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(pts[i])); dot.hidden = false;
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 220) + 'px'; tip.style.top = e.clientY + 14 + 'px';
    tip.innerHTML = `Main ${i} · ${cards(h.players[h.hero].cards)} ${h.players[h.hero].pos}<br>${chips && h.bb ? `blindes ${h.bb / 2}/${h.bb} · ` : ''}ce coup ${(pts[i] - pts[i - 1]).toFixed(chips ? 0 : 1)} ${unit} · ${chips ? 'tapis' : 'cumul'} ${pts[i].toFixed(chips ? 0 : 1)} ${unit}<br><span style="opacity:.7">clic = rejouer la main</span>`;
  };
  svg.onmouseleave = () => { cross.hidden = dot.hidden = tip.hidden = true; };
  svg.onclick = () => hover && openReplay(list[hover - 1]);
}

function renderGambit(p) {
  $('#gambit').innerHTML = !p ? '<p class="muted">Ouvre ton profil ou la page de stats sur Gambit pour les récupérer automatiquement.</p>' : `
    <table><tbody>
      <tr><td>Mains</td><td class="num">${p.totalHands}</td><td class="muted">${esc(p.archetypeEmoji)} ${esc(p.archetypeLabel)}</td></tr>
      <tr><td>VPIP / PFR</td><td class="num">${pct(p.vpip)} / ${pct(p.pfr)}</td><td class="muted">repère 22-28 / 17-23</td></tr>
      <tr><td>3-bet</td><td class="num">${num(p.threeBet, 1)} %</td><td class="muted">repère 6-10</td></tr>
      <tr><td>Agression</td><td class="num">${num(p.aggression, 2)}</td><td class="muted">repère 2-3</td></tr>
      <tr><td>C-bet</td><td class="num">${pct(p.cbet)}</td><td class="muted">repère 50-65</td></tr>
      <tr><td>Fold to c-bet</td><td class="num">${pct(p.foldToCbet)}</td><td class="muted">repère 40-50</td></tr>
      <tr><td>WTSD</td><td class="num">${pct(p.wtsd)}</td><td class="muted">repère 26-32</td></tr>
      <tr><td>Gagné quand flop vu</td><td class="num">${pct(p.wwsf)}</td><td class="muted">repère 45-50</td></tr>
    </tbody></table>`;
  const sh = gambitStat('GetStartingHandStats');
  if (!sh) { $('#starting').innerHTML = '<p class="muted">Pas encore récupéré (ouvre tes stats sur Gambit).</p>'; return; }
  const st = sh.stats.filter(x => x.count >= 8).sort((a, b) => +a.netChipsSum - +b.netChipsSum);
  const rows = xs => xs.map(x => `<tr><td><b>${esc(x.key)}</b></td><td class="num">${x.count}×</td><td class="num">${signed(+x.netChipsSum)}</td></tr>`).join('');
  $('#starting').innerHTML = `<div class="split">
    <div><h3 class="loss">Te coûtent le plus</h3><table>${rows(st.slice(0, 8))}</table></div>
    <div><h3 class="win">Te rapportent le plus</h3><table>${rows(st.slice().reverse().slice(0, 8))}</table></div></div>`;
}

// share of hands hero played (VPIP) from an opening position that are outside the opening chart
function outsideGrid() {
  const played = hands.filter(h => h.players[h.hero].cards && OPEN[h.players[h.hero].pos] && playerLine(h, h.hero).vpip);
  const out = played.filter(h => !OPEN[h.players[h.hero].pos].has(handKey(h.players[h.hero].cards)));
  return { n: played.length, pct: played.length ? 100 * out.length / played.length : 0 };
}

// ================= HANDS =================
function filtered() {
  const pos = $('#fPos').value, res = $('#fRes').value, street = $('#fStreet').value, withNote = $('#fNote').checked;
  const key = $('#fKey').value.trim().toUpperCase().replace(/S$/, 's').replace(/O$/, 'o');
  return hands.filter(h => {
    const me = h.players[h.hero], line = playerLine(h, h.hero);
    if (pos && me.pos !== pos) return false;
    if (res === 'win' && me.net <= 0) return false;
    if (res === 'loss' && me.net >= 0) return false;
    if (res === 'big' && Math.abs(me.net) < 20 * (h.bb || 2)) return false;
    if (street === 'flop' && !line.sawFlop) return false;
    if (street === 'sd' && !line.showdown) return false;
    if (street === 'pre' && h.board.length) return false;
    if (withNote && !notes[h.id]) return false;
    if (key && !(me.cards && handKey(me.cards).startsWith(key))) return false;
    return true;
  });
}

// 🧠 badge in the hand list once the solver has looked at the hand: total EV lost
function gtoBadge(h) {
  const r = store['g:' + h.id];
  if (!r) return '';
  const ds = ['flop', 'turn', 'river'].flatMap(st => r[st]?.decisions || []).filter(d => d.reliable);
  if (!ds.length) return '';
  const lost = ds.reduce((t, d) => t + d.evLoss, 0);
  return ` <span class="pill ${lost >= 1 ? 'bad' : lost >= 0.15 ? 'meh' : ''}" title="Analyse GTO : ${lost.toFixed(2)} BB perdus par rapport au jeu parfait">🧠 ${lost < 0.15 ? '✓' : '−' + lost.toFixed(1)}</span>`;
}

function renderHands() {
  const sel = $('#fPos');
  if (sel.options.length === 1) POS_ORDER.forEach(p => sel.add(new Option(p, p)));
  const list = filtered();
  $('#fCount').textContent = `${list.length} main(s)`;
  if (!list.length) { $('#handTable').innerHTML = '<tr><td class="empty">Aucune main.</td></tr>'; return; }
  $('#handTable').innerHTML = `<thead><tr><th>Heure</th><th>Main</th><th>Pos.</th><th>Board</th><th>Partie</th><th class="num">Résultat</th><th></th></tr></thead><tbody>` +
    list.slice().reverse().slice(0, 500).map(h => {
      const me = h.players[h.hero];
      return `<tr class="row" data-id="${esc(h.id)}"><td>${fmtDate(h.t)}</td>
        <td>${cards(me.cards)}</td><td><span class="pill">${me.pos}</span></td><td>${h.board.length ? cards(h.board) : '<span class="muted">–</span>'}</td>
        <td class="muted">${h.table.startsWith('solo:') ? 'Bots' : h.table.startsWith('tournament:') ? 'Tournoi' : 'Table'}${h.rated === false ? ' · non classée' : ''}</td>
        <td class="num">${signed(me.net)} <span class="muted">(${(me.net / (h.bb || 2)).toFixed(1)} BB)</span></td>
        <td>${notes[h.id] ? '📝' : ''}${gtoBadge(h)}</td></tr>`;
    }).join('') + '</tbody>';
}
['#fPos', '#fRes', '#fStreet', '#fNote'].forEach(s => $(s).onchange = renderHands);
$('#fKey').oninput = renderHands;

$('#handTable').onclick = e => {
  const tr = e.target.closest('tr.row');
  if (!tr) return;
  if (tr.nextElementSibling?.classList.contains('detail')) { tr.nextElementSibling.remove(); return; }
  const h = hands.find(x => x.id === tr.dataset.id);
  tr.insertAdjacentHTML('afterend', `<tr class="detail"><td colspan="7">${handDetail(h)}</td></tr>`);
  const d = tr.nextElementSibling;
  d.querySelector('.copy').onclick = ev => { navigator.clipboard.writeText(toPokerStars(h)); ev.target.textContent = 'Copié ✓'; };
  d.querySelector('.replay').onclick = () => openReplay(h);
  d.querySelector('.gto').onclick = () => runGto(h, d.querySelector('.gtobox'));
  if (gtoJobs(h).jobs.length) queueGto(h, d.querySelector('.gtobox')); // analyse straight away (turn/river: a few seconds)
  d.querySelector('textarea').onchange = ev => {
    const v = ev.target.value.trim();
    notes[h.id] = v;
    v ? api.storage.local.set({ ['n:' + h.id]: v }) : api.storage.local.remove('n:' + h.id);
    tr.lastElementChild.textContent = v ? '📝' : '';
  };
};

function handDetail(h) {
  const byStreet = {};
  for (const a of h.actions) (byStreet[a.street] ||= []).push(a);
  const boardFor = { flop: h.board.slice(0, 3), turn: h.board.slice(3, 4), river: h.board.slice(4, 5) };
  const streets = Object.entries(byStreet).map(([st, as]) => `<div class="st">${STREET_FR[st]}</div><div>
    ${boardFor[st] ? `<span class="boardchip">${cards(boardFor[st])}</span>` : ''}${as.map(a => {
      const who = a.seat === h.hero ? 'Moi' : esc(h.players[a.seat].name);
      const what = a.blind ? 'blinde' : ACT_FR[a.type] ?? a.type;
      const amt = a.type === 'raise' ? ` à ${a.to}` : a.amount ? ` ${a.amount}` : '';
      return `<span class="act ${a.seat === h.hero ? 'me' : ''} ${a.type === 'bet' || a.type === 'raise' ? 'agg' : ''}">${who} <b>${what}${amt}</b>${a.allin ? ' (tapis)' : ''}</span>`;
    }).join('')}</div>`).join('');
  const me = h.players[h.hero];
  const shown = Object.values(h.players).filter(p => p.seat !== h.hero && p.cards)
    .map(p => `<span class="act">${esc(p.name)} ${cards(p.cards)}${h.folded.has(p.seat) ? ' <span class="muted">(couché)</span>' : ''}</span>`).join('');
  const spots = spotsOf(h).map(s => `<tr><td>${STREET_FR[s.a.street]}</td><td>${ACT_FR[s.a.type]} ${s.a.amount}</td><td>${equityBar(s.eq, s.need)}</td>
    <td class="num">${pct(100 * s.eq)}</td><td class="muted">${s.need != null ? `cote demandée : ${pct(100 * s.need)} ${s.eq >= s.need ? '✅' : '❌'}` : ''}</td></tr>`).join('');
  const fOpen = me.cards && CHARTS.open[me.pos] ? CHARTS.open[me.pos].get(handKey(me.cards)) || 0 : null;
  const pre = fOpen == null ? '' : fOpen > 0
    ? `✅ GTO ouvre ${handKey(me.cards)} depuis ${me.pos} ${Math.round(100 * fOpen)} % du temps.`
    : `⚠️ ${handKey(me.cards)} ne s'ouvre jamais depuis ${me.pos} (la grille ouvre ${OPEN_PCT[me.pos]} % des mains).`;
  const made = me.cards && h.board.length >= 3 ? `Ta main finale : <b>${handName([...me.cards, ...h.board])}</b>. ` : '';
  return `<div class="detail-grid">
    <div>
      <div class="streets">${streets}</div>
      ${shown ? `<p><span class="muted">Cartes adverses :</span> ${shown}</p>` : ''}
      <p class="muted">${made}${pre}</p>
      ${spots ? `<h3>Ton équité à chaque mise <small class="muted">(contre les vraies cartes)</small></h3><table class="compact">${spots}</table>` : ''}
    </div>
    <div class="side">
      <button class="replay primary">▶ Rejouer la main</button>
      <button class="gto">🧠 Analyse GTO (solveur)</button>
      <button class="copy">Copier au format PokerStars</button>
      <label class="note">Note perso<textarea rows="4" placeholder="Ex : j'aurais dû me coucher au turn">${esc(notes[h.id] || '')}</textarea></label>
    </div></div>
    <div class="gtobox"></div>`;
}

const equityBar = (eq, need) => `<span class="bar"><i style="width:${100 * eq}%"></i>${need != null ? `<u style="left:${100 * need}%"></u>` : ''}</span>`;

// ================= GTO SOLVER =================
// Each street where you acted is solved in a Web Worker (WASM build of postflop-solver).
// Streets are chained: the river starts from the ranges that reached it in the turn solve (and the turn from the flop when it is solved).
const gtoRes = id => (store['g:' + id] ||= {});
const PREV_STREET = { turn: 'flop', river: 'turn' };
let gtoQueue = Promise.resolve(); // one solver at a time (memory)

function runGto(h, box, opts = {}) {
  const res = gtoRes(h.id);
  const precise = opts.precise ?? !!res.precise, withFlop = opts.flop ?? !!res.flop;
  const { jobs, error, skipped = [] } = gtoJobs(h, { precise });
  if (!jobs.length) { box.innerHTML = `<div class="gto-card"><p class="muted">🧠 ${error}</p></div>`; return Promise.resolve(); }
  box._worker?.terminate();
  if (opts.force) for (const j of jobs) delete res[j.street];
  res.precise = precise; res.flop = withFlop;
  let todo = jobs.filter(j => !res[j.street] && (j.street !== 'flop' || withFlop));
  todo = todo.map(j => { const p = res[PREV_STREET[j.street]]; return p?.next && !todo.some(t => t.street === PREV_STREET[j.street]) ? chainJob(j, p.next) : j; });
  let status = todo.length ? { street: todo[0].street, progress: 0 } : null;
  const draw = () => {
    if (!box.isConnected) return;
    box.innerHTML = renderGto(jobs, res, status, withFlop, precise, skipped);
    box.querySelector('.gto-flop')?.addEventListener('click', () => runGto(h, box, { flop: true, force: true }));
    box.querySelector('.gto-precise')?.addEventListener('change', e => runGto(h, box, { precise: e.target.checked, force: true }));
    box.querySelector('.gto-cancel')?.addEventListener('click', () => { box._worker?.terminate(); status = null; draw(); });
  };
  draw();
  if (!todo.length) return Promise.resolve();
  return new Promise(done => {
    const w = box._worker = new Worker('solver-worker.js');
    const finish = () => { w.terminate(); status = null; draw(); done(); };
    w.onmessage = ({ data }) => {
      if (data.error) { finish(); box.insertAdjacentHTML('beforeend', `<p class="loss">Erreur du solveur : ${esc(data.error)}</p>`); return; }
      if (data.result) { res[data.street] = data.result; api.storage.local.set({ ['g:' + h.id]: res }); }
      if (data.progress != null) status = { street: data.street, progress: data.progress, ex: data.exploitability };
      if (data.done) return finish();
      draw();
    };
    const terminate = w.terminate.bind(w);
    w.terminate = () => { terminate(); done(); };
    w.postMessage({ jobs: todo, chain: true });
  });
}
// queue for batch analyses (session review): never two solvers at once
const queueGto = (h, box, opts) => (gtoQueue = gtoQueue.then(() => runGto(h, box, opts)));

function renderGto(jobs, res, status, withFlop, precise, skipped = []) {
  const block = j => {
    const r = res[j.street];
    const head = `<h3>${STREET_FR[j.street]} <span class="muted">${cards(j.board.match(/../g))} · pot ${(j.pot / 100).toFixed(1)} BB</span>${r?.chained ? ' <span class="pill" title="Les ranges de départ viennent du calcul de la street précédente">enchaîné</span>' : ''}</h3>`;
    if (r) return head + (r.decisions.map(gtoDecision).join('') || '<p class="muted">Aucune décision analysable.</p>')
      + (r.approx ? `<p class="muted">⚠️ ${r.approx}</p>` : '') + (r.note ? `<p class="muted">${r.note}</p>` : '') + `<p class="muted small">Précision : la stratégie est exploitable de ${r.exploitability.toFixed(1)} % du pot (${r.iterations} itérations).</p>`;
    if (status?.street === j.street) return head + `<div class="gto-progress"><span class="bar wide"><i style="width:${(100 * status.progress).toFixed(0)}%"></i></span>
      Résolution… ${Math.round(100 * status.progress)} %${status.ex != null && Number.isFinite(status.ex) ? ` · précision actuelle ${status.ex.toFixed(1)} % du pot` : ''} <button class="gto-cancel ghost">Annuler</button></div>`;
    if (j.street === 'flop' && !withFlop) return head + `<p><button class="gto-flop">Résoudre aussi le flop</button> <span class="muted">Environ 2 à 3 minutes et 500 Mo. La turn et la river seront recalculées en partant du flop : c'est l'analyse la plus juste.</span></p>`;
    return head + '<p class="muted">En attente…</p>';
  };
  return `<div class="gto-card"><div class="gto-head"><h2>🧠 Analyse GTO <small>(solveur)</small></h2>
      <label class="chk" title="Plus de tailles de mise à la turn et à la river. Turn : environ 40 s au lieu de 5 s."><input type="checkbox" class="gto-precise" ${precise ? 'checked' : ''} ${status ? 'disabled' : ''}> Analyse précise</label></div>
    ${['flop', 'turn', 'river'].map(st => { const j = jobs.find(x => x.street === st), sk = skipped.find(x => x.street === st);
      return j ? block(j) : sk ? `<h3>${STREET_FR[st]}</h3><p class="muted">⏭️ Non analysé : ${sk.reason}</p>` : ''; }).join('')}
    <details class="muted"><summary>Comment lire cette analyse ?</summary>
      <p><b>GTO avec ta main</b> : ce qu'une stratégie d'équilibre ferait avec tes cartes exactes. Une répartition (ex. 60 % / 40 %) veut dire que les deux choix se valent presque.</p>
      <p><b>EV</b> : ce que rapporte chaque option en moyenne, en grosses blindes, si les deux joueurs jouent parfaitement ensuite. La différence entre la meilleure option et la tienne est le <b>coût</b> de ton choix.</p>
      <p><b>Toute la range</b> : ce que fait l'ensemble des mains possibles à cette position, utile pour comprendre la stratégie globale.</p>
      <p><b>Enchaîné</b> : la street part des mains qui l'atteignent vraiment d'après le calcul de la street précédente (plus juste). Sinon elle part des grilles préflop.</p>
      <p>Limites : grilles préflop approximatives, tailles de mise réduites. Le solveur ne calcule que les coups à <b>deux joueurs</b> : quand 3 joueurs ou plus voient le flop, seules les streets où il n'en reste que deux sont analysées. Pour les autres, l'onglet Fuites donne ton équité contre les vraies cartes.</p>
    </details></div>`;
}

function gtoDecision(d) {
  const played = d.options[d.played];
  const verdict = !d.reliable ? ['ℹ️', 'Indicatif', 'Après ton action précédente, la stratégie GTO n\'arriverait presque jamais ici avec cette main : chiffres peu fiables.']
    : d.evLoss < 0.15 ? ['✅', 'Bon choix', played.freq > 0.05 ? 'C\'est une des actions jouées par la stratégie GTO.' : 'Pas l\'action GTO, mais quasiment aussi rentable.']
    : d.evLoss < 1 ? ['⚠️', 'Imprécision', `Ça coûte environ ${d.evLoss.toFixed(2)} BB par rapport au meilleur choix.`]
    : ['❌', 'Erreur', `Ça coûte environ ${d.evLoss.toFixed(1)} BB par rapport au meilleur choix.`];
  const best = d.options.reduce((a, b) => (b.freq > a.freq ? b : a));
  return `<div class="gto-dec ${verdict[1] === 'Erreur' ? 'bad' : verdict[1] === 'Imprécision' ? 'meh' : ''}">
    <div class="at">${verdict[0]} Tu as joué <b>${played.label}</b> — ${verdict[1]}</div>
    <p>${verdict[2]} La stratégie GTO joue surtout <b>${best.label}</b> avec ta main.</p>
    ${d.context && d.reliable ? `<p class="why-gto">💬 ${explainDecision(d)}</p>` : ''}
    <table class="compact"><thead><tr><th>Option</th><th>GTO avec ta main</th><th class="num">EV (BB)</th><th>Toute la range</th></tr></thead>
    ${d.options.map((o, i) => `<tr class="${i === d.played ? 'mine' : ''}"><td>${i === d.played ? '👉 ' : ''}${o.label}</td>
      <td>${equityBar(o.freq)} ${pct(100 * o.freq)}</td><td class="num">${o.ev.toFixed(2)}</td><td class="muted">${pct(100 * o.rangeFreq)}</td></tr>`).join('')}</table></div>`;
}

// ================= REPLAYER =================
let rp = null;
function openReplay(h) {
  rp = { h, step: 0, max: h.actions.length + 1 };
  $('#replay').hidden = false;
  drawReplay();
}
// solver decision matching hero's action at index i (n-th hero action on that street)
function replayDecision(h, i) {
  const a = h.actions[i], r = store['g:' + h.id]?.[a.street];
  if (!r) return null;
  const n = h.actions.slice(0, i + 1).filter(b => b.seat === h.hero && b.street === a.street).length;
  const d = r.decisions[n - 1];
  return d?.reliable ? d : null;
}
function replayState(h, step) {
  const st = { commit: {}, street: {}, folded: new Set(), last: {}, pot: 0, cur: 'preflop' };
  for (const a of h.actions.slice(0, Math.min(step, h.actions.length))) {
    if (a.street !== st.cur) { st.cur = a.street; st.street = {}; st.last = {}; }
    st.commit[a.seat] = (st.commit[a.seat] || 0) + a.amount;
    st.street[a.seat] = (st.street[a.seat] || 0) + a.amount;
    st.pot += a.amount;
    if (a.type === 'fold') st.folded.add(a.seat);
    st.last[a.seat] = a;
  }
  return st;
}
function drawReplay() {
  const { h, step, max } = rp, st = replayState(h, step), end = step === max;
  const seats = h.order.slice();
  const heroIdx = seats.indexOf(h.hero);
  const ordered = [...seats.slice(heroIdx), ...seats.slice(0, heroIdx)]; // hero first = bottom
  const board = end ? h.board : h.board.slice(0, { preflop: 0, flop: 3, turn: 4, river: 5 }[st.cur]);
  const show = $('#rShow').checked;
  const html = ordered.map((s, i) => {
    const p = h.players[s], ang = Math.PI / 2 + 2 * Math.PI * i / ordered.length;
    const x = 50 + 42 * Math.cos(ang), y = 50 + 38 * Math.sin(ang);
    const bx = 50 + 26 * Math.cos(ang), by = 50 + 22 * Math.sin(ang);
    const stack = end ? p.start + p.net : p.start - (st.commit[s] || 0);
    const visible = s === h.hero || (show && p.cards);
    const last = st.last[s];
    return `<div class="seat ${st.folded.has(s) ? 'folded' : ''} ${s === h.hero ? 'hero' : ''} ${h.actions[step - 1]?.seat === s && !end ? 'acting' : ''}" style="left:${x}%;top:${y}%">
        <div class="sc">${visible ? cards(p.cards) : '<span class="cd back"></span><span class="cd back"></span>'}</div>
        <div class="sn">${s === h.hero ? 'Moi' : esc(p.name)} <span class="pill">${p.pos}</span></div>
        <div class="ss">${stack}</div>
        ${end && p.net ? `<div class="sr">${signed(p.net)}</div>` : last && !last.blind ? `<div class="sa">${ACT_FR[last.type]}${last.amount ? ' ' + last.amount : ''}</div>` : ''}
      </div>
      ${st.street[s] && !end ? `<div class="chip" style="left:${bx}%;top:${by}%">${st.street[s]}</div>` : ''}`;
  }).join('');
  $('#rTable').innerHTML = `${html}<div class="center"><div>${board.length ? cards(board) : '<span class="muted">' + STREET_FR[st.cur] + '</span>'}</div><div class="pot">Pot ${end ? finalPot(h) : st.pot}</div></div>`;
  $('#rStep').textContent = `${step} / ${max}`;
  const a = h.actions[step - 1];
  let txt = step === 0 ? 'Début de la main. Utilise ▶ ou les flèches du clavier.' : end ? resultText(h) : '';
  if (a && !end) {
    const who = a.seat === h.hero ? 'Tu' : esc(h.players[a.seat].name);
    txt = `<b>${STREET_FR[a.street]}</b> · ${who} ${a.blind ? (a.seat === h.hero ? 'poses la blinde' : 'pose la blinde') : a.seat === h.hero ? ACT_TU[a.type] : ACT_FR[a.type]}${a.type === 'raise' ? ` à ${a.to}` : a.amount && !a.blind ? ` ${a.amount}` : a.blind ? ` (${a.amount})` : ''}${a.allin ? ' — tapis !' : ''}.`;
    const gd = a.seat === h.hero && a.street !== 'preflop' && replayDecision(h, step - 1);
    if (gd) txt += `<div class="rp-gto">🧠 ${gd.evLoss < 0.15 ? '✅ Bon choix' : gd.evLoss < 1 ? `⚠️ Imprécision (−${gd.evLoss.toFixed(2)} BB)` : `❌ Erreur (−${gd.evLoss.toFixed(1)} BB)`} · le solveur joue surtout <b>${gd.options.reduce((x, y) => (y.freq > x.freq ? y : x)).label}</b><br><span class="muted">${explainDecision(gd)}</span></div>`;
    else if (a.seat === h.hero && a.street !== 'preflop' && gtoJobs(h).jobs.some(j => j.street === a.street)) txt += `<div class="muted">🧠 ${a.street === 'flop' ? 'Le flop n\'est pas analysé par défaut (plus long) : bouton « Résoudre aussi le flop » dans l\'analyse de la main.' : 'Ouvre la main dans l\'onglet Mains : l\'analyse du solveur se lance toute seule.'}</div>`;
    const sp = a.seat === h.hero && spotsOf(h).find(s => s.a === a);
    if (sp) txt += ` Ton équité réelle à ce moment : <b>${pct(100 * sp.eq)}</b>${sp.need != null ? `, la cote demandait ${pct(100 * sp.need)} ${sp.eq >= sp.need ? '✅' : '❌'}` : ''}.`;
    if (a.toCall > 0 && a.seat === h.hero && a.type === 'fold') txt += ` Il fallait payer ${a.toCall} dans un pot de ${a.potBefore}.`;
  }
  $('#rText').innerHTML = txt;
}
function resultText(h) {
  const winners = Object.values(h.players).filter(p => p.net > 0);
  const me = h.players[h.hero];
  return `<b>Résultat</b> · ${winners.map(p => `${p.seat === h.hero ? 'Tu gagnes' : esc(p.name) + ' gagne'} ${p.net}`).join(', ')}.
    ${me.net < 0 ? `Tu perds ${-me.net} (${(-me.net / (h.bb || 2)).toFixed(1)} BB).` : ''}
    ${h.board.length >= 3 && me.cards ? `Ta main : ${handName([...me.cards, ...h.board])}.` : ''}`;
}
const rgo = d => { if (!rp) return; rp.step = Math.max(0, Math.min(rp.max, d)); drawReplay(); };
$('#rFirst').onclick = () => rgo(0);
$('#rPrev').onclick = () => rgo(rp.step - 1);
$('#rNext').onclick = () => rgo(rp.step + 1);
$('#rLast').onclick = () => rgo(rp.max);
$('#rShow').onchange = () => rp && drawReplay();
$('#rClose').onclick = () => { $('#replay').hidden = true; rp = null; };
$('#replay').onclick = e => { if (e.target.id === 'replay') $('#rClose').onclick(); };
addEventListener('keydown', e => {
  if (!rp) return;
  if (e.key === 'ArrowRight') rgo(rp.step + 1);
  if (e.key === 'ArrowLeft') rgo(rp.step - 1);
  if (e.key === 'Escape') $('#rClose').onclick();
});

// ================= PREFLOP GRID =================
const RANKS_DESC = 'AKQJT98765432';
function gridKey(i, j) {
  const a = RANKS_DESC[i], b = RANKS_DESC[j];
  return i === j ? a + b : i < j ? a + b + 's' : b + a + 'o';
}
// scenario -> { raise: Map, call: Map, label }
function gridScenario(v) {
  const [kind, key] = v.split(':');
  if (kind === 'open') return { raise: CHARTS.open[key], call: new Map(), pos: key, title: `Ouverture depuis ${key}`, rLabel: 'Relance' };
  const [hero, opener] = key.split('>');
  return { ...CHARTS.vsOpen[key], pos: hero, opener, title: `${hero} face à une ouverture de ${opener}`, rLabel: '3-bet' };
}
(() => {
  const sel = $('#gPos');
  sel.innerHTML = `<optgroup label="Ouvrir (personne n'a relancé)">${['UTG', 'HJ', 'CO', 'BTN', 'SB'].map(p => `<option value="open:${p}" ${p === 'CO' ? 'selected' : ''}>${p}</option>`).join('')}</optgroup>
    <optgroup label="Face à une ouverture">${Object.keys(CHARTS.vsOpen).sort().map(k => `<option value="vs:${k}">${k.replace('>', ' face à ')}</option>`).join('')}</optgroup>`;
})();
function renderGrid() {
  const sc = gridScenario($('#gPos').value);
  const stats = {};
  if (!sc.opener) for (const h of hands) { // personal results only for unopened pots at this position
    const me = h.players[h.hero];
    if (!me.cards || me.pos !== sc.pos || h.actions.some(a => a.street === 'preflop' && aggr(a) && a.seat !== h.hero && h.actions.indexOf(a) < h.actions.findIndex(x => x.seat === h.hero && !x.blind))) continue;
    const st = (stats[handKey(me.cards)] ||= { dealt: 0, played: 0, net: 0 });
    st.dealt++;
    if (playerLine(h, h.hero).vpip) { st.played++; st.net += me.net / (h.bb || 2); }
  }
  let html = '';
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const k = gridKey(i, j), st = stats[k], r = sc.raise.get(k) || 0, c = sc.call.get(k) || 0;
    const bg = r + c ? `background: linear-gradient(90deg, var(--raise) 0 ${100 * r}%, var(--call) ${100 * r}% ${100 * (r + c)}%, var(--surface2) ${100 * (r + c)}%)` : '';
    html += `<div class="hc ${r + c ? 'in' : ''} ${st?.played && !(r + c) ? 'out' : ''} ${st?.played ? 'played' : ''}" style="${bg}" data-k="${k}"><b>${k}</b>${st ? `<small>${st.played}/${st.dealt}</small>` : ''}</div>`;
  }
  $('#grid').innerHTML = html;
  const all = Object.values(stats), dealt = all.reduce((t, x) => t + x.dealt, 0), played = all.reduce((t, x) => t + x.played, 0);
  const outside = Object.entries(stats).filter(([k, x]) => x.played && !sc.raise.get(k) && !sc.call.get(k)).reduce((t, [, x]) => t + x.played, 0);
  $('#gInfo').innerHTML = `<span class="sw raise"></span> ${sc.rLabel} ${Math.round(rangePct(sc.raise))} % ${sc.call.size ? `· <span class="sw call"></span> Payer ${Math.round(rangePct(sc.call))} %` : ''} · <span class="sw"></span> Fold`
    + (sc.opener ? '' : ` · Toi : ${dealt ? `${pct(100 * played / dealt)} jouées sur ${dealt}, dont ${outside} hors grille` : 'aucune main encore'}`);
  $('#grid').onmouseover = e => {
    const k = e.target.closest('.hc')?.dataset.k;
    if (!k) return;
    const st = stats[k], r = sc.raise.get(k) || 0, c = sc.call.get(k) || 0;
    $('#gDetail').innerHTML = `<b style="font-size:20px">${k}</b> <span class="muted">${sc.title}</span><br><br>
      ${sc.rLabel} : <b>${pct(100 * r)}</b><br>${sc.call.size ? `Payer : <b>${pct(100 * c)}</b><br>` : ''}Fold : <b>${pct(100 * (1 - r - c))}</b><br><br>`
      + (r > 0.05 && r < 0.95 || (c > 0.05 && c < 0.95) ? '<span class="muted">Main mixte : la stratégie d\'équilibre alterne entre plusieurs actions. Pour simplifier, joue l\'action la plus fréquente.</span><br><br>' : '')
      + (sc.opener ? '' : st ? `Reçue ${st.dealt} fois, jouée ${st.played} fois.${st.played ? `<br>Résultat quand jouée : ${signed(st.net, 1)} BB` : ''}` : 'Jamais reçue à cette position.');
  };
}
$('#gPos').onchange = renderGrid;

// ================= PLAYERS =================
function renderPlayers() {
  const pos = heroStats(hands).byPos.sort((a, b) => POS_ORDER.indexOf(a.key) - POS_ORDER.indexOf(b.key));
  $('#posTable').innerHTML = !pos.length ? '<tr><td class="muted">Aucune main.</td></tr>' :
    `<thead><tr><th>Position</th><th class="num">Mains</th><th class="num">VPIP</th><th class="num">PFR</th><th class="num">3-bet</th><th class="num">C-bet</th><th class="num">Jetons</th><th class="num">BB/100</th><th>Conseillé (ouverture)</th></tr></thead>` +
    pos.map(p => `<tr><td><span class="pill">${p.key}</span></td><td class="num">${p.n}</td><td class="num">${pct(p.vpip)}</td><td class="num">${pct(p.pfr)}</td>
      <td class="num">${pct(p.threeBet)}</td><td class="num">${pct(p.cbet)}</td><td class="num">${signed(p.net)}</td><td class="num">${signed(p.bb100, 1)}</td>
      <td class="muted">${OPEN_PCT[p.key] != null ? `~${OPEN_PCT[p.key]} % des mains` : p.key === 'BB' ? 'défense' : ''}</td></tr>`).join('');
  const bots = botStats(hands).sort((a, b) => a.vsMe - b.vsMe);
  $('#botTable').innerHTML = !bots.length ? '<tr><td class="muted">Aucun adversaire.</td></tr>' :
    `<thead><tr><th>Joueur</th><th>Profil</th><th class="num">Mains</th><th class="num">VPIP</th><th class="num">PFR</th><th class="num">3-bet</th><th class="num">AF</th><th class="num">C-bet</th><th class="num">WTSD</th><th class="num">Mon bilan</th></tr></thead>` +
    bots.map(b => {
      const p = profile(b);
      return `<tr class="row" data-name="${esc(b.name)}"><td><b>${esc(b.name)}</b> ${b.isBot ? '<span class="muted">bot</span>' : ''}</td><td title="${esc(p.tip)}"><span class="pill">${p.label}</span></td>
      <td class="num">${b.n}</td><td class="num">${pct(b.vpip)}</td><td class="num">${pct(b.pfr)}</td><td class="num">${pct(b.threeBet)}</td><td class="num">${num(b.af, 2)}</td>
      <td class="num">${pct(b.cbet)}</td><td class="num">${pct(b.wtsd)}</td><td class="num">${signed(b.vsMe)}</td></tr>
      <tr class="subrow"><td colspan="10" class="muted">${p.tip}</td></tr>`;
    }).join('');
}

$('#botTable').onclick = e => {
  const name = e.target.closest('tr.row')?.dataset.name;
  if (name) { renderDossier(name); $('#dossier').scrollIntoView({ behavior: 'smooth' }); }
};

function renderDossier(name) {
  const b = botStats(hands).find(x => x.name === name);
  if (!b) return;
  const p = profile(b), ex = exploits(b), c = b.counts;
  const stat = (label, v, n, help) => `<tr><td>${label}</td><td class="num"><b>${v}</b></td><td class="muted">${n != null ? `sur ${n} occasion(s)` : ''}</td><td class="muted">${help}</td></tr>`;
  const range = openRange(hands, name);
  let grid = '';
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const k = gridKey(i, j), r = range[k];
    const f = r ? r.opened / r.dealt : 0, l = r ? r.limped / r.dealt : 0;
    grid += `<div class="hc ${r ? 'played' : ''}" title="${k} : ${r ? `ouvert ${r.opened}/${r.dealt}${r.limped ? `, limpé ${r.limped}` : ''}` : 'jamais vu'}"
      style="${r ? `background: linear-gradient(90deg, var(--raise) 0 ${100 * f}%, var(--call) ${100 * f}% ${100 * (f + l)}%, var(--surface2) ${100 * (f + l)}%)` : ''}"><b>${k}</b>${r ? `<small>${r.opened}/${r.dealt}</small>` : ''}</div>`;
  }
  $('#dossier').innerHTML = `<div class="card"><h2>Fiche : ${esc(name)} <span class="pill">${p.label}</span> <small>${b.n} mains ensemble</small></h2>
    <p>${p.tip}</p>
    <h3>Comment l'exploiter</h3>
    ${ex.length ? ex.map(x => `<div class="advice sev0"><div class="at">👉 ${x.tip}</div><div class="aw">${x.why}</div></div>`).join('') : '<p class="muted">Pas encore assez de mains pour dégager une faiblesse fiable. Il faut quelques dizaines de mains contre lui.</p>'}
    <div class="grid2">
      <div><h3>Ses statistiques</h3><table class="compact wrap">
        ${stat('VPIP / PFR', `${pct(b.vpip)} / ${pct(b.pfr)}`, null, 'mains jouées / relancées')}
        ${stat('Limp', pct(b.limp), null, 'entre en payant 1 BB')}
        ${stat('3-bet', pct(b.threeBet), c.threeBet, 'sur-relance face à une ouverture')}
        ${stat('Fold face à 3-bet', pct(b.foldTo3bet), c.foldTo3bet, 'abandonne quand on le sur-relance')}
        ${stat('C-bet', pct(b.cbet), c.cbet, 'mise au flop après avoir relancé')}
        ${stat('Fold face à c-bet', pct(b.foldCbet), c.foldCbet, '')}
        ${stat('Deuxième mise (turn)', pct(b.barrel), c.barrel, 'remise à la turn après sa c-bet')}
        ${stat('Fold face à mise turn', pct(b.foldTurn), c.foldTurn, '')}
        ${stat('Mise à la river', pct(b.riverBet), c.riverBet, 'quand il arrive à la river')}
        ${stat('…avec paire ou moins', pct(b.weakRiver), c.weakRiver, 'part de ses mises river faites avec une main faible')}
        ${stat('Agression', num(b.af, 2), null, 'mises ÷ calls après le flop')}
        ${stat('WTSD / gagné à l\'abattage', `${pct(b.wtsd)} / ${pct(b.wsd)}`, c.sd, '')}
      </table></div>
      <div><h3>Ce qu'il ouvre vraiment <small class="muted">(cartes révélées en fin de main)</small></h3>
        <p class="muted small"><span class="sw raise"></span> ouvert <span class="sw call"></span> limpé · nombres = ouvertures / fois où il a pu ouvrir avec cette main</p>
        <div class="hgrid small-grid">${grid}</div></div>
    </div></div>`;
}

// ================= LEAKS (heavy: computed in chunks so the page stays responsive) =================
let leakRun = 0;
async function renderLeaks() {
  renderBatch();
  const run = ++leakRun, out = $('#leakList');
  const all = [];
  for (let i = 0; i < hands.length; i++) {
    if (run !== leakRun) return;
    all.push(...spotsOf(hands[i]));
    if (i % 5 === 0) { out.innerHTML = `<div class="empty">Calcul des équités… ${i + 1}/${hands.length}</div>`; await new Promise(r => setTimeout(r)); }
  }
  const leaks = all.filter(s => (s.need != null && s.bb >= 3 && s.eq < s.need) || (s.need == null && s.bb >= 10 && s.eq < 0.35)).sort((a, b) => b.cost - a.cost);
  out.innerHTML = !leaks.length ? '<div class="empty">Rien de suspect. 👌</div>' : leaks.map(s => {
    const h = s.h, me = h.players[h.hero];
    const why = s.need != null
      ? `Tu as payé ${s.a.amount} avec ${pct(100 * s.eq)} d'équité alors que la cote demandait ${pct(100 * s.need)}. À long terme, ce call perd environ ${Math.round(s.a.amount - s.eq * (s.a.potBefore + s.a.amount))} jetons.`
      : `${s.a.type === 'raise' ? 'Relance' : 'Mise'} de ${s.a.amount} (${s.bb.toFixed(0)} BB${s.a.allin ? ', tapis' : ''}) avec ${pct(100 * s.eq)} d'équité. C'est un bluff : il ne marche que si l'adversaire se couche assez souvent.`;
    return `<div class="leak" data-id="${esc(h.id)}"><div>${cards(me.cards)} <span class="pill">${me.pos}</span> ${STREET_FR[s.a.street]} ${h.board.length && s.a.street !== 'preflop' ? cards(h.board.slice(0, { flop: 3, turn: 4, river: 5 }[s.a.street])) : ''}
      <div class="why">${why}</div></div><div class="num">${equityBar(s.eq, s.need)}<div class="muted">main ${signed(me.net)}</div><button class="ghost">▶ Rejouer</button></div></div>`;
  }).join('');
}
// ---------- batch GTO analysis of every hand ----------
const solvedDecisions = () => hands.flatMap(h => ['flop', 'turn', 'river'].flatMap(st => (store['g:' + h.id]?.[st]?.decisions || []).filter(d => d.reliable).map(d => ({ h, d }))));
const isAnalysed = h => { const { jobs } = gtoJobs(h); return jobs.filter(j => j.street !== 'flop').every(j => store['g:' + h.id]?.[j.street]); };
let batch = null; // { done, total, stop, box }
function renderBatch() {
  const el = $('#batch');
  if (!el) return;
  const eligible = hands.filter(h => gtoJobs(h).jobs.some(j => j.street !== 'flop'));
  const todo = eligible.filter(h => !isAnalysed(h));
  const all = hands.filter(h => h.players[h.hero].cards && h.actions.some(a => a.seat === h.hero && a.street !== 'preflop'));
  const decs = solvedDecisions(), errs = decs.filter(x => x.d.evLoss >= 0.15).sort((a, b) => b.d.evLoss - a.d.evLoss);
  const lost = errs.reduce((t, x) => t + x.d.evLoss, 0);
  const byStreet = st => { const ds = decs.filter(x => x.d.street === st); return ds.length ? `${STREET_FR[st]} : ${ds.filter(x => x.d.evLoss < 0.15).length}/${ds.length} bons choix` : ''; };
  el.innerHTML = `
    <p>${eligible.length} main(s) analysable(s) sur ${all.length} jouées après le flop
      <span class="muted">(les autres ont toutes leurs streets à 3 joueurs ou plus, ou finissent au flop)</span> · <b>${eligible.length - todo.length}</b> déjà analysée(s).</p>
    ${batch ? `<div class="gto-progress"><span class="bar wide"><i style="width:${(100 * batch.done / Math.max(1, batch.total)).toFixed(0)}%"></i></span>
        ${batch.done} / ${batch.total} · reste environ ${Math.ceil((batch.total - batch.done) * 6 / 60)} min <button id="batchStop" class="ghost">Arrêter</button></div>`
      : todo.length ? `<p><button id="batchGo" class="primary">🧠 Analyser ${todo.length} main(s)</button> <span class="muted">≈ ${Math.max(1, Math.ceil(todo.length * 6 / 60))} min</span></p>` : '<p>✅ Toutes tes mains analysables sont analysées.</p>'}
    ${decs.length ? `<h3>Bilan</h3>
      <p>Sur <b>${decs.length}</b> décisions analysées, <b>${decs.length - errs.length}</b> sont des bons choix (moins de 0,15 BB d'écart avec le GTO).
        Au total tu as laissé environ <b>${lost.toFixed(1)} BB</b>, soit ${(lost / Math.max(1, eligible.length - todo.length)).toFixed(2)} BB par main analysée.</p>
      <p class="muted">${['flop', 'turn', 'river'].map(byStreet).filter(Boolean).join(' · ')}</p>
      ${errs.length ? `<h3>Tes 10 décisions les plus coûteuses</h3><table class="compact wrap">${errs.slice(0, 10).map(({ h, d }) => `<tr>
        <td>${cards(h.players[h.hero].cards)}</td><td>${STREET_FR[d.street]} ${cards(d.context?.board.match(/../g) ?? [])}</td>
        <td>Tu as joué <b>${d.options[d.played].label}</b>, GTO : <b>${d.options.reduce((a, b) => (b.ev > a.ev ? b : a)).label}</b></td>
        <td class="num loss">−${d.evLoss.toFixed(1)} BB</td><td><button class="ghost" data-show="${esc(h.id)}">Voir</button></td></tr>`).join('')}</table>` : ''}` : ''}`;
  $('#batchGo')?.addEventListener('click', () => runBatch(todo));
  $('#batchStop')?.addEventListener('click', () => { batch.stop = true; batch.box?._worker?.terminate(); });
  el.onclick = e => { const id = e.target.dataset.show; if (id) showHand(id); };
}
async function runBatch(list) {
  batch = { done: 0, total: list.length, stop: false };
  renderBatch();
  for (const h of list) {
    if (batch.stop) break;
    batch.box = document.createElement('div'); // off-screen: results go to storage
    await queueGto(h, batch.box);
    batch.done++;
    if (current() === 'leaks') renderBatch();
  }
  batch = null;
  if (current() === 'leaks') renderBatch();
}

$('#leakList').onclick = e => { const id = e.target.closest('button') && e.target.closest('.leak')?.dataset.id; if (id) openReplay(hands.find(h => h.id === id)); };

// ================= TRAINING =================
// 3 modes: random preflop spots, my own preflop mistakes (until answered right twice), postflop decisions already solved by the solver.
let quiz = null, quizScore = ls.get('quiz', { ok: 0, n: 0 }), mastered = ls.get('mastered', {});
const DECK52 = [...'23456789TJQKA'].flatMap(r => [...'shdc'].map(s => r + s));
const mistakeId = d => `${d.h.id}:${d.raises}`;
const myMistakes = () => hands.flatMap(preflopDecisions).filter(d => d.mistake && (mastered[mistakeId(d)] || 0) < 2);
const solvedSpots = () => hands.flatMap(h => ['flop', 'turn', 'river'].flatMap(st => (store['g:' + h.id]?.[st]?.decisions || [])
  .filter(d => d.reliable && d.context).map(d => ({ h, d }))));
const preflopOptions = raises => raises === 0 ? ['Fold', 'Relance'] : raises === 1 ? ['Fold', 'Payer', '3-bet'] : ['Fold', 'Payer', '4-bet'];
const scenarioText = q => q.raises === 0 ? (q.limpers ? `${q.limpers} joueur(s) ont limpé (payé 1 BB) avant toi.` : 'Tout le monde s\'est couché avant toi.')
  : q.raises === 1 ? `<b>${q.opener ?? '?'}</b> a ouvert (relance) devant toi.`
  : q.heroOpened ? `Tu as ouvert et <b>${q.threeBettor ?? '?'}</b> t'a sur-relancé (3-bet).` : 'Il y a déjà une relance et une sur-relance avant toi.';
const randomPick = xs => xs[Math.floor(Math.random() * xs.length)];

function newQuiz() {
  const mode = $('#qMode').value;
  if (mode === 'mistakes') {
    const d = randomPick(myMistakes());
    quiz = d ? { mode, ...d, stackBB: d.adv.stackBB, options: d.adv.short ? ['Fold', d.adv.short] : preflopOptions(d.raises) } : { mode, empty: 'Aucune erreur préflop à retravailler. 🎉 Joue d\'autres mains ou reviens plus tard.' };
    return;
  }
  if (mode === 'postflop') {
    const x = randomPick(solvedSpots());
    quiz = x ? { mode, ...x } : { mode, empty: 'Aucune décision analysée pour l\'instant. Lance une revue de session ou l\'analyse GTO d\'une main pour alimenter ce mode.' };
    return;
  }
  const pick = () => DECK52[Math.floor(Math.random() * 52)];
  let a = pick(), b = pick();
  while (b === a) b = pick();
  const r = Math.random();
  if (r < 0.2) { // short stack, tournament style
    const pos = randomPick(['UTG', 'HJ', 'CO', 'BTN', 'SB']), stackBB = randomPick([8, 10, 12, 15]);
    quiz = { mode, cards: [a, b], pos, raises: 0, stackBB, options: ['Fold', 'Tapis'], adv: preflopAdvice([a, b], pos, 0, 0, 2, 2, null, false, null, stackBB) };
  } else if (r < 0.65) {
    const pos = ['UTG', 'HJ', 'CO', 'BTN', 'SB'][Math.floor(Math.random() * 5)];
    quiz = { mode, cards: [a, b], pos, raises: 0, options: preflopOptions(0), adv: preflopAdvice([a, b], pos, 0, 0, 2, pos === 'SB' ? 1 : 2) };
  } else {
    const [pos, opener] = randomPick(Object.keys(CHARTS.vsOpen)).split('>');
    quiz = { mode, cards: [a, b], pos, opener, raises: 1, options: preflopOptions(1), adv: preflopAdvice([a, b], pos, 1, 0, 2, pos === 'BB' ? 3 : 4, opener) };
  }
}
const freqOf = (adv, o) => adv.mix.find(m => m.a === o)?.f ?? 0;

function renderTraining() {
  if (!quiz || quiz.mode !== $('#qMode').value) newQuiz();
  const q = quiz;
  $('#qMode').options[1].text = `Préflop : mes erreurs (${myMistakes().length})`;
  $('#qMode').options[2].text = `Après le flop : mes mains analysées (${solvedSpots().length})`;
  $('#qScore').textContent = quizScore.n ? `(${quizScore.ok}/${quizScore.n} · ${Math.round(100 * quizScore.ok / quizScore.n)} %)` : '';
  if (q.empty) { $('#quiz').innerHTML = `<p class="muted">${q.empty}</p>`; return; }
  if (q.mode === 'postflop') return renderPostflopQuiz(q);
  const best = q.adv.best, chosenF = q.answered ? freqOf(q.adv, q.answered) : 0;
  const verdict = !q.answered ? null : q.answered === best ? ['sev0', '✅ Parfait : c\'est l\'action la plus fréquente.']
    : chosenF >= 0.25 ? ['sev1', `👍 Acceptable : la stratégie GTO le fait ${Math.round(100 * chosenF)} % du temps, mais « ${best} » est plus fréquent.`]
    : ['sev3', `❌ La stratégie GTO joue « ${best} »${chosenF > 0 ? ` (ton choix seulement ${Math.round(100 * chosenF)} % du temps)` : ''}.`];
  $('#quiz').innerHTML = `<div class="qhand">${cards(q.cards)}</div>
    <p>Tu es <b>${q.pos}</b>${q.stackBB ? ` avec <b>${q.stackBB} BB</b> (tournoi)` : ''}. ${scenarioText(q)} Que fais-tu ?</p>
    <div class="qopts">${q.options.map(o => `<button data-o="${o}" class="${q.answered ? (o === best ? 'good' : o === q.answered && chosenF < 0.25 ? 'bad' : '') : ''}" ${q.answered ? 'disabled' : ''}>${o}</button>`).join('')}</div>
    ${q.answered ? `<div class="mixbar">${q.adv.mix.map(m => `<span style="flex:${m.f}" class="m-${m.a === 'Fold' ? 'f' : m.a === 'Payer' ? 'c' : 'r'}">${m.a} ${Math.round(100 * m.f)} %</span>`).join('')}</div>
      <div class="advice ${verdict[0]}"><div class="at">${verdict[1]}</div><div class="aw">${q.adv.why}</div>
      ${q.mode === 'mistakes' ? `<div class="af">En vrai, le ${fmtDate(q.h.t)}, tu avais joué <b>${q.played === 'Limp' ? 'limp (payer 1 BB)' : q.played}</b>. ${chosenF >= 0.25 ? `Encore ${Math.max(0, 2 - (mastered[mistakeId(q)] || 0))} bonne(s) réponse(s) et ce spot sera considéré comme acquis.` : ''}</div>` : ''}</div>
      <button id="qNext" class="primary">Suivant →</button>` : ''}
    <p class="muted" style="margin-top:14px">Grilles à fréquences pour 6 joueurs avec 100 BB (approximation des solutions GTO). Une réponse jouée au moins 25 % du temps compte comme juste. Raccourcis : 1, 2, 3 · Entrée = suivant.</p>`;
}

function renderPostflopQuiz(q) {
  const { d, h } = q, c = d.context;
  const board = c.board.match(/../g);
  $('#quiz').innerHTML = `<div class="qhand">${cards(c.hand.match(/../g))}</div>
    <p>${STREET_FR[d.street]} : ${cards(board)} · pot <b>${c.pot.toFixed(1)} BB</b><br>
    Tu es <b>${c.heroPos}</b> contre <b>${c.villainPos}</b>. ${c.before.length ? c.before.join(', ') + '.' : 'Tu parles en premier.'} Que fais-tu ?</p>
    <div class="qopts">${d.options.map((o, i) => `<button data-p="${i}" ${q.answered != null ? 'disabled' : ''} class="${q.answered != null ? (o.freq === Math.max(...d.options.map(x => x.freq)) ? 'good' : i === q.answered && d.options[i].ev < Math.max(...d.options.map(x => x.ev)) - 0.15 ? 'bad' : '') : ''}">${o.label}</button>`).join('')}</div>
    ${q.answered != null ? gtoDecision({ ...d, played: q.answered, evLoss: Math.max(0, Math.max(...d.options.map(o => o.ev)) - d.options[q.answered].ev) })
      + `<p class="muted">En vrai (main du ${fmtDate(h.t)}), tu avais joué <b>${d.options[d.played].label}</b>.</p><button id="qNext" class="primary">Suivant →</button>` : ''}
    <p class="muted" style="margin-top:14px">Correction calculée par le solveur sur tes propres mains. Une réponse qui coûte moins de 0,15 BB compte comme juste.</p>`;
}

$('#qMode').onchange = () => { newQuiz(); renderTraining(); };
$('#quiz').onclick = e => {
  const o = e.target.dataset.o, p = e.target.dataset.p;
  if (o && !quiz.answered) {
    quiz.answered = o;
    const ok = freqOf(quiz.adv, o) >= 0.25;
    quizScore = { ok: quizScore.ok + ok, n: quizScore.n + 1 };
    if (quiz.mode === 'mistakes' && ok) { mastered[mistakeId(quiz)] = (mastered[mistakeId(quiz)] || 0) + 1; ls.set('mastered', mastered); }
    ls.set('quiz', quizScore);
    renderTraining();
  }
  if (p != null && quiz.answered == null) {
    quiz.answered = +p;
    const best = Math.max(...quiz.d.options.map(x => x.ev));
    quizScore = { ok: quizScore.ok + (best - quiz.d.options[+p].ev < 0.15), n: quizScore.n + 1 };
    ls.set('quiz', quizScore);
    renderTraining();
  }
  if (e.target.id === 'qNext') { newQuiz(); renderTraining(); }
};
addEventListener('keydown', e => {
  if (current() !== 'training' || rp || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const btns = [...document.querySelectorAll('#quiz .qopts button')];
  if (/^[1-9]$/.test(e.key) && btns[e.key - 1] && !btns[0].disabled) btns[e.key - 1].click();
  if (e.key === 'Enter' && $('#qNext')) $('#qNext').click();
});

const parseCards = s => [...(s || '').replace(/10/g, 'T').matchAll(/([2-9tjqka])([shdc])/gi)].map(m => m[1].toUpperCase() + m[2].toLowerCase());
$('#cGo').onclick = () => {
  const hero = parseCards($('#cHero').value), board = parseCards($('#cBoard').value);
  const opps = [...document.querySelectorAll('.cOpp')].map((el, i) => {
    const v = el.value.trim();
    if (!v) return i === 0 ? null : undefined;
    const c = parseCards(v);
    return c.length === 2 ? c : null;
  }).filter(o => o !== undefined);
  const all = [...hero, ...board, ...opps.flat().filter(Boolean)];
  const err = hero.length !== 2 ? 'Entre exactement 2 cartes pour ta main (ex : Ah Kd).'
    : ![0, 3, 4, 5].includes(board.length) ? 'Le board doit avoir 0, 3, 4 ou 5 cartes.'
    : new Set(all).size !== all.length ? 'Une même carte apparaît deux fois.' : '';
  if (err) { $('#cOut').innerHTML = `<p class="loss">${err}</p>`; return; }
  const eq = equity(hero, opps, board, 20000);
  const o = outs(hero, board);
  $('#cOut').innerHTML = `<div class="calcres">
    <div>${cards(hero)} ${board.length ? ' sur ' + cards(board) : ''}</div>
    <div class="big">${pct(100 * eq)}</div>
    ${equityBar(eq)}
    <p>contre ${opps.map(x => x ? cards(x) : 'une main au hasard').join(', ')}</p>
    ${board.length >= 3 ? `<p>Ta main actuelle : <b>${handName([...hero, ...board])}</b></p>` : ''}
    ${o.length ? `<p>${o.length} outs pour une quinte ou mieux (≈ ${o.length * (board.length === 3 ? 4 : 2)} % avec la règle du ${board.length === 3 ? 4 : 2}).</p>` : ''}
    <p class="muted">Pour payer une mise, il te faut une équité supérieure à : mise ÷ (pot + mise). Ex : 50 dans un pot de 100 → 50 ÷ 200 = 25 %.</p></div>`;
};

// ================= PROGRESS (small multiples, one stat per chart, one point per session) =================
const PROGRESS = [
  ['vpip', 'VPIP', '%', 22, 28], ['pfr', 'PFR', '%', 17, 23], ['af', 'Agression', '', 2, 3],
  ['cbet', 'C-bet', '%', 50, 65], ['wtsd', 'WTSD', '%', 26, 32], ['bb100', 'BB/100', '', 0, null],
];
function renderProgress() {
  const ser = sessionSeries(hands, 10, META());
  const el = $('#progress');
  if (ser.length < 2) { el.innerHTML = `<p class="muted">Il faut au moins 2 sessions d'au moins 10 mains (tu en as ${ser.length}).</p>`; return; }
  const W = 260, H = 110, L = 34, R = 8, T = 8, B = 18;
  el.innerHTML = PROGRESS.map(([k, label, unit, lo, hi]) => {
    const pts = ser.map(x => x[k]).map(v => v ?? null);
    const vals = pts.filter(v => v != null);
    if (!vals.length) return '';
    let min = Math.min(...vals, lo ?? Infinity), max = Math.max(...vals, hi ?? -Infinity);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1; min -= pad; max += pad;
    const x = i => L + (W - L - R) * (ser.length === 1 ? 0.5 : i / (ser.length - 1)), y = v => T + (H - T - B) * (max - v) / (max - min);
    const band = hi != null ? `<rect class="band" x="${L}" width="${W - L - R}" y="${y(hi)}" height="${y(lo) - y(hi)}"/>` : `<line class="zero" x1="${L}" x2="${W - R}" y1="${y(lo)}" y2="${y(lo)}"/>`;
    const path = pts.map((v, i) => v == null ? '' : `${i && pts[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const last = vals.at(-1), first = vals[0];
    const dots = pts.map((v, i) => v == null ? '' : `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="4"><title>${fmtDate(ser[i].start)} · ${ser[i].n} mains · ${label} ${v.toFixed(k === 'af' ? 2 : 0)}${unit}</title></circle>`).join('');
    return `<figure><figcaption>${label} <b>${last.toFixed(k === 'af' ? 2 : 0)}${unit}</b> <span class="muted">(1re session : ${first.toFixed(k === 'af' ? 2 : 0)}${unit}${hi != null ? ` · visé ${lo}-${hi}${unit}` : ''})</span></figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label} par session">${band}
      <text x="${L - 6}" y="${y(max - pad) + 4}" text-anchor="end">${(max - pad).toFixed(0)}</text><text x="${L - 6}" y="${y(min + pad) + 4}" text-anchor="end">${(min + pad).toFixed(0)}</text>
      <path class="line" d="${path}"/>${dots}</svg></figure>`;
  }).join('');
}

// ================= SESSION REVIEW =================
const reviewSessions = () => sessions(hands, META()).reverse();
function renderReview() {
  const ss = reviewSessions(), sel = $('#rvSession');
  if (!ss.length) { sel.innerHTML = ''; $('#rvBody').innerHTML = '<div class="card empty">Aucune session enregistrée.</div>'; return; }
  const prev = sel.value;
  sel.innerHTML = ss.map(x => `<option value="${x.start}">${x.kind} · ${fmtDate(x.start)} · ${x.hands.length} mains · ${x.net > 0 ? '+' : ''}${x.net}${x.placement ? ` · ${x.placement}e` : ''}</option>`).join('');
  if (prev && ss.some(x => String(x.start) === prev)) sel.value = prev;
  const sess = ss.find(x => String(x.start) === sel.value) || ss[0];
  const sh = sess.hands, all = heroStats(hands).all, me = heroStats(sh).all;
  const cmp = (label, a, b, d = 0, unit = ' %') => `<div class="tile"><div class="k">${label}</div><div class="v">${a == null ? '–' : a.toFixed(d) + unit}</div><div class="r">en général : ${b == null ? '–' : b.toFixed(d) + unit}</div></div>`;
  const mistakes = sh.flatMap(preflopDecisions).filter(d => d.mistake);
  const decisions = sh.flatMap(preflopDecisions).filter(d => d.played !== 'Check');
  const big = sh.filter(h => gtoJobs(h).jobs.length).sort((a, b) => Math.abs(b.players[b.hero].net) - Math.abs(a.players[a.hero].net)).slice(0, 5);
  $('#rvBody').innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="k">Mains</div><div class="v">${sh.length}</div><div class="r">${Math.max(1, Math.round((sess.end - sess.start) / 60e3))} min</div></div>
      <div class="tile"><div class="k">Résultat</div><div class="v">${signed(sess.net)}</div><div class="r">${signed(sess.bb100, 1)} BB/100</div></div>
      ${cmp('VPIP', me.vpip, all.vpip)}${cmp('PFR', me.pfr, all.pfr)}${cmp('Agression', me.af, all.af, 2, '')}${cmp('WTSD', me.wtsd, all.wtsd)}
    </div>
    <div class="card"><h2>${sess.kind}${sess.placement ? ` · terminé ${sess.placement}e` : ''} <small>${sess.tournament ? '(tapis en jetons, main par main · clic = rejouer)' : '(résultat cumulé en BB, main par main · clic = rejouer)'}</small></h2>
      <div id="rvChart" class="chart"></div></div>
    <div class="card"><h2>🏁 Résumé <small>(mis à jour au fil des analyses)</small></h2><div id="rvSummary"></div></div>
    <div class="card"><h2>Préflop : ${mistakes.length} écart(s) sur ${decisions.length} décisions</h2>
      <p class="muted">Décisions que la stratégie GTO ne prend (presque) jamais avec ta main dans cette situation.</p>
      ${mistakes.length ? `<table class="compact wrap">${mistakes.slice(0, 12).map(d => `<tr><td>${cards(d.cards)}</td><td><span class="pill">${d.pos}</span></td>
        <td>${scenarioText(d).replace(/<\/?b>/g, '')}</td><td>Tu as joué <b>${d.played === 'Limp' ? 'limp' : d.played}</b></td>
        <td class="muted">GTO : ${d.adv.mix.map(m => `${m.a.toLowerCase()} ${Math.round(100 * m.f)} %`).join(', ')}</td></tr>`).join('')}</table>
        ${mistakes.length > 12 ? `<p class="muted">… et ${mistakes.length - 12} autre(s).</p>` : ''}
        <p><button id="rvDrill" class="primary">🎯 M'entraîner sur ces erreurs</button></p>` : '<p>👌 Aucun écart préflop.</p>'}
    </div>
    <div class="card"><h2>Les plus gros pots <small>(analysés par le solveur)</small></h2>
      ${big.length ? big.map(h => `<div class="rv-hand" data-id="${esc(h.id)}"><div class="rv-head">${cards(h.players[h.hero].cards)} <span class="pill">${h.players[h.hero].pos}</span> ${cards(h.board)}
        <b>${signed(h.players[h.hero].net)}</b> <span class="muted">(${(h.players[h.hero].net / (h.bb || 2)).toFixed(1)} BB)</span>
        <button class="ghost rv-open">Voir la main</button> <button class="ghost rv-replay">▶ Rejouer</button></div><div class="gtobox"></div></div>`).join('')
        : '<p class="muted">Aucun pot à deux joueurs avec un flop dans cette session.</p>'}
    </div>`;
  renderChart($('#rvChart'), sh, sess.tournament);
  $('#rvDrill')?.addEventListener('click', () => { $('#qMode').value = 'mistakes'; quiz = null; $('#tabs [data-tab=training]').click(); });
  for (const el of document.querySelectorAll('.rv-hand')) {
    const h = hands.find(x => x.id === el.dataset.id);
    el.querySelector('.rv-open').onclick = () => showHand(h.id);
    el.querySelector('.rv-replay').onclick = () => openReplay(h);
    queueGto(h, el.querySelector('.gtobox')).then(() => reviewSummary(sess, mistakes, big));
  }
  reviewSummary(sess, mistakes, big);
}

// "Your 3 most expensive mistakes": solver EV losses first, then preflop deviations.
function reviewSummary(sess, mistakes, big) {
  const el = $('#rvSummary');
  if (!el) return;
  const gto = big.flatMap(h => ['flop', 'turn', 'river'].flatMap(st => (store['g:' + h.id]?.[st]?.decisions || []).filter(d => d.reliable).map(d => ({ h, d }))));
  const errs = gto.filter(x => x.d.evLoss >= 0.15).sort((a, b) => b.d.evLoss - a.d.evLoss);
  const lost = errs.reduce((t, x) => t + x.d.evLoss, 0);
  const items = [
    ...errs.slice(0, 3).map(({ h, d }) => `<li>${cards(h.players[h.hero].cards)} ${STREET_FR[d.street]} : tu as joué <b>${d.options[d.played].label}</b>, le solveur préfère <b>${d.options.reduce((a, b) => (b.ev > a.ev ? b : a)).label}</b> → coût ≈ <b>${d.evLoss.toFixed(1)} BB</b></li>`),
    ...mistakes.slice(0, Math.max(0, 3 - errs.length)).map(d => `<li>${cards(d.cards)} ${d.pos} préflop : <b>${d.played === 'Limp' ? 'limp' : d.played}</b> au lieu de <b>${d.adv.best}</b></li>`),
  ];
  const pending = big.length - big.filter(h => gtoJobs(h).jobs.filter(j => j.street !== 'flop').every(j => store['g:' + h.id]?.[j.street])).length;
  el.innerHTML = `${items.length ? `<p>Tes erreurs les plus coûteuses :</p><ol>${items.join('')}</ol>` : '<p>👌 Pas d\'erreur notable détectée.</p>'}
    ${gto.length ? `<p class="muted">Sur les ${gto.length} décisions analysées après le flop, tu as laissé environ <b>${lost.toFixed(1)} BB</b> par rapport au jeu GTO.</p>` : ''}
    ${pending ? `<p class="muted">⏳ Analyse en cours : encore ${pending} main(s).</p>` : ''}`;
}
$('#rvSession').onchange = renderReview;

// open one hand in the Mains tab
function showHand(id) {
  ['#fPos', '#fRes', '#fStreet'].forEach(x => ($(x).value = ''));
  $('#fKey').value = ''; $('#fNote').checked = false;
  $('#tabs [data-tab=hands]').click();
  const tr = document.querySelector(`#handTable tr.row[data-id="${CSS.escape(id)}"]`);
  if (tr) { tr.click(); tr.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

// ================= AUTO BACKUP (weekly JSON download when the dashboard is opened) =================
function autoBackup() {
  const last = store.lastBackup || 0, week = 7 * 864e5;
  $('#backupInfo').textContent = `Sauvegarde automatique chaque semaine (fichier JSON dans tes téléchargements) · dernière : ${last ? fmtDate(last) : 'jamais'}. Pour restaurer : bouton Importer.`;
  if (!hands.length || Date.now() - last < week) return;
  download(JSON.stringify(hands.map(freeze)), `gambitracker-sauvegarde-${day()}.json`, 'application/json');
  store.lastBackup = Date.now();
  api.storage.local.set({ lastBackup: store.lastBackup });
  $('#backupInfo').textContent = `Sauvegarde automatique faite à l'instant (${hands.length} mains) dans tes téléchargements.`;
}

// ================= HEADER =================
$('#reload').onclick = load;
$('#import').onchange = async e => {
  for (const f of e.target.files) {
    const data = JSON.parse(await f.text());
    if (data[0]?.kind) { // raw log from v0.1
      imported.push(...parseHands(data));
      for (const m of data) if (m.kind === 'fetch') for (const n of ['GetPlayerStats', 'GetStartingHandStats']) if (m.url.includes('/' + n)) importedFetch[n] = m.data;
    } else imported.push(...data.map(thaw));
  }
  load();
};
const download = (text, name, type) => Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name }).click();
const day = () => new Date().toISOString().slice(0, 10);
$('#exportPS').onclick = () => download(hands.map(toPokerStars).join('\n\n'), `gambit-hands-${day()}.txt`, 'text/plain');
$('#exportJSON').onclick = () => download(JSON.stringify(hands.map(freeze)), `gambitracker-${day()}.json`, 'application/json');
addEventListener('resize', () => current() === 'overview' ? renderChart() : current() === 'review' && renderReview());
api.storage.onChanged.addListener(ch => { if (Object.keys(ch).some(k => /^h\w/.test(k))) load(); });

const startTab = ls.get('tab', 'overview');
if (renderers[startTab]) document.querySelectorAll('#tabs button, .tab').forEach(x => x.classList.toggle('on', x.dataset.tab === startTab || x.id === startTab));
load();
