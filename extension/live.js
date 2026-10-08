// Training coach overlay. Only active on solo tables where every opponent is a bot.
// Off as soon as a human sits down (multi tables, friends, tournaments): then only the logger runs.
// Never uses the bots' hidden cards.
(() => {
  if (!COACH_ENABLED) return; // see config.js
  const api = globalThis.browser ?? chrome;
  let unrated = false, collapsed = false, bbByHand = {}, eqCache = {}, lastState = '', lastHand = '';
  let settings = { coach: true, side: 'right', compact: false, recap: true, grid: true, show: {} }, prof = {};
  // what to show in the coach (popup checkboxes); missing = shown
  const on = k => (settings.show || {})[k] ?? (k === 'grid' ? settings.grid !== false : true);
  let html = '';
  const add = (k, part) => { if (on(k)) html += part; };

  const loadSettings = s => { settings = { ...settings, ...(s.settings || {}) }; };
  const loadProfiles = s => {
    const hands = Object.keys(s).filter(k => /^h\w/.test(k)).map(k => thaw(s[k]));
    prof = Object.fromEntries(botStats(hands).map(b => [b.name, b]));
  };
  api.storage.local.get(null).then(s => { loadSettings(s); loadProfiles(s); });
  api.storage.onChanged.addListener(ch => {
    if (ch.settings) loadSettings({ settings: ch.settings.newValue });
    if (Object.keys(ch).some(k => /^h\w/.test(k))) api.storage.local.get(null).then(loadProfiles);
  });

  const POS_FR = {
    UTG: 'Premier à parler : 5 joueurs parlent après toi, joue serré.',
    HJ: 'Début-milieu de parole : encore 4 joueurs après toi.',
    CO: 'Cut-off : avant-dernière place, tu peux ouvrir plus large.',
    BTN: 'Bouton : la meilleure place, tu parles en dernier après le flop.',
    SB: 'Petite blinde : tu parleras en premier après le flop, place difficile.',
    BB: 'Grosse blinde : tu as déjà mis 1 BB, tu peux défendre un peu plus large.',
    'BTN/SB': 'Tête-à-tête : tu es bouton et petite blinde.',
  };

  // ---------- shadow-DOM panel ----------
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host { all: initial; }
    .p { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 360px; max-height: 80vh; overflow: auto;
         font: 13px/1.45 system-ui, sans-serif; color: #e9efe9; background: #17211cf2; border: 1px solid #2f4a3c; border-radius: 12px;
         box-shadow: 0 10px 30px #0006; }
    .p.left { right: auto; left: 20px; }
    .h { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; cursor: move; user-select: none; touch-action: none; font-weight: 650; border-bottom: 1px solid #2f4a3c; }
    #tg { cursor: pointer; padding: 0 6px; font-size: 16px; }
    .h small { color: #8fa598; font-weight: 400; }
    .b { padding: 14px 16px 16px; display: grid; gap: 13px; }
    .collapsed .b { display: none; } .collapsed .h { border: 0; }
    .row { display: grid; grid-template-columns: 86px 1fr; gap: 10px; }
    .k { color: #8fa598; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding-top: 2px; }
    .cd { display: inline-block; min-width: 24px; padding: 0 4px; margin-right: 2px; border-radius: 4px; background: #f4f1e8; font-weight: 700; text-align: center; }
    .s { color: #1d2320; } .hh { color: #d23a3a; } .d { color: #2563c9; } .c { color: #1f8a4c; }
    .muted { color: #8fa598; font-size: 12px; }
    .bar { height: 7px; background: #2a3a32; border-radius: 4px; position: relative; margin: 4px 0 2px; }
    .bar i { position: absolute; inset: 0 auto 0 0; background: #3cc489; border-radius: 4px; }
    .bar u { position: absolute; top: -3px; bottom: -3px; width: 2px; background: #fff; }
    .adv { background: #1f3a2d; border: 1px solid #3cc489; border-radius: 10px; padding: 12px 14px; }
    .mix { display: flex; gap: 2px; margin: 8px 0; border-radius: 6px; overflow: hidden; font-size: 11px; font-weight: 650; }
    .mix span { padding: 3px 6px; white-space: nowrap; overflow: hidden; color: #10201a; }
    .m-r { background: #f08a7a; } .m-c { background: #7ff0bc; } .m-f { background: #9fb3aa; }
    .compact { display: grid; grid-template-columns: auto auto 1fr; gap: 4px 10px; align-items: center; }
    .compact b { font-size: 20px; }
    .compact .bar { margin: 0; }
    .compact .muted { grid-column: 1 / -1; }
    .recap { display: grid; gap: 10px; }
    .rc { background: #1d2a24; border-radius: 8px; padding: 8px 10px; }
    .rc-h { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 4px; }
    .mg-wrap { display: grid; gap: 6px; }
    .mg { display: grid; grid-template-columns: repeat(13, 1fr); gap: 1px; }
    .mg i { aspect-ratio: 1; border-radius: 2px; font: 700 8px/1 system-ui; font-style: normal; color: #10201a; display: grid; place-items: center; overflow: hidden; }
    .mg i.me { outline: 2px solid #fff; outline-offset: 0; z-index: 1; }
    .mg-leg { font-size: 11px; } .sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; background: #2a3a32; margin: 0 3px 0 8px; } .sw.r { background: #e8826f; } .sw.c { background: #4fc48e; }
    .dim { color: #8fa598; font-size: 12px; }
    .opp { padding: 8px 10px; border-radius: 8px; background: #1d2a24; margin-bottom: 6px; }
    .ex { margin-top: 6px; font-size: 12px; color: #f5d27a; }
    .ex .muted { font-size: 11px; }
    .tag { display: inline-block; padding: 0 7px; border-radius: 99px; background: #2f4a3c; font-size: 11px; margin-left: 4px; }
    .adv b { font-size: 15px; color: #7ff0bc; }
    .off { color: #b6c2ba; }
  </style><div class="p"><div class="h"><span title="Glisse pour déplacer · double-clic pour remettre en place · Alt+C pour cacher/afficher">🎓 Coach <small id="sub"></small></span><span id="tg" title="Réduire / agrandir">–</span></div><div class="b" id="body"></div></div>`;
  const $ = s => root.getElementById(s);
  const panel = root.querySelector('.p'), head = root.querySelector('.h');
  $('tg').onclick = () => {
    collapsed = !collapsed;
    panel.classList.toggle('collapsed', collapsed);
    $('tg').textContent = collapsed ? '+' : '–';
  };

  // drag the panel by its header; position saved across pages, double-click = back to the default corner
  let pos = null; // top-left in px, null = docked bottom-left/right
  const place = () => {
    if (!pos) { Object.assign(panel.style, { left: '', top: '', right: '', bottom: '', maxHeight: '' }); return; }
    const x = Math.min(Math.max(0, pos.x), innerWidth - panel.offsetWidth), y = Math.min(Math.max(0, pos.y), innerHeight - 48);
    Object.assign(panel.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto', maxHeight: innerHeight - y - 10 + 'px' });
  };
  head.onpointerdown = e => {
    if (e.button !== 0 || e.target.id === 'tg') return;
    const r = panel.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    head.onpointermove = m => { pos = { x: m.clientX - dx, y: m.clientY - dy }; place(); };
    head.onpointerup = () => { head.onpointermove = head.onpointerup = null; if (pos) api.storage.local.set({ coachPos: pos }); };
  };
  head.ondblclick = e => { if (e.target.id !== 'tg') { pos = null; place(); api.storage.local.remove('coachPos'); } };
  addEventListener('resize', place);
  // Alt+C: hide / show the panel (it keeps updating in the background)
  let hiddenByKey = false;
  addEventListener('keydown', e => {
    if (!e.altKey || e.code !== 'KeyC' || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    hiddenByKey = !hiddenByKey;
    host.style.display = hiddenByKey ? 'none' : '';
  }, true);
  api.storage.local.get('coachPos').then(s => { pos = s.coachPos || null; place(); });
  api.storage.onChanged.addListener(ch => { if (ch.coachPos) { pos = ch.coachPos.newValue || null; place(); } });
  const show = () => { if (!host.isConnected) { document.documentElement.appendChild(host); place(); } };

  const SUIT = { s: ['♠', 's'], h: ['♥', 'hh'], d: ['♦', 'd'], c: ['♣', 'c'] };
  const cards = cs => cs.map(c => `<span class="cd ${SUIT[c[1]][1]}">${c[0] === 'T' ? '10' : c[0]}${SUIT[c[1]][0]}</span>`).join('');
  const pct = v => `${Math.round(100 * v)} %`;
  const row = (k, v) => `<div class="row"><div class="k">${k}</div><div>${v}</div></div>`;
  const bar = (eq, need) => `<div class="bar"><i style="width:${100 * eq}%"></i>${need != null ? `<u style="left:${100 * need}%"></u>` : ''}</div>`;

  const RD = 'AKQJT98765432';
  // 13x13 chart: red = raise / all-in, green = call, hero's hand outlined
  function miniGrid(ch, mine) {
    let g = '';
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
      const k = i === j ? RD[i] + RD[j] : i < j ? RD[i] + RD[j] + 's' : RD[j] + RD[i] + 'o';
      const r = ch.raise.get(k) || 0, c = ch.call.get(k) || 0;
      g += `<i class="${k === mine ? 'me' : ''}" title="${k} : ${ch.rLabel.toLowerCase()} ${Math.round(100 * r)} %${c ? `, payer ${Math.round(100 * c)} %` : ''}"
        style="background:linear-gradient(90deg,#e8826f 0 ${100 * r}%,#4fc48e ${100 * r}% ${100 * (r + c)}%,#2a3a32 ${100 * (r + c)}%)">${k === mine || i === j ? k : ''}</i>`; // pair labels on the diagonal help to find a hand
    }
    return `<div class="mg">${g}</div>`;
  }

  function gate(s) {
    const me = s.seats.find(x => x.seat === s.youSeat);
    const others = s.seats.filter(x => x.seat !== s.youSeat && !x.isDealtOut);
    if (!me) return 'tu n\'es pas assis à la table';
    if (!String(s.tableId).startsWith('solo:')) return 'table multijoueur ou tournoi';
    if (others.some(x => !x.isBot)) return 'un humain est à la table';
    return null;
  }

  // ---------- post-hand recap: every game mode, but only once the hand is over ----------
  // Nothing is shown while a hand is played against humans; the recap only reviews a finished hand.
  const pending = {}, recaps = {};
  const ACT_TU = { fold: 'Tu te couches', check: 'Tu checkes', call: 'Tu paies', bet: 'Tu mises', raise: 'Tu relances' };
  function recap(handId) {
    if (recaps[handId] != null) return recaps[handId];
    const [h] = parseHands(pending[handId] || []);
    delete pending[handId];
    if (!h || !isPlayable(h) || !h.players[h.hero].cards) return (recaps[handId] = '');
    const me = h.players[h.hero];
    const rows = h.actions.filter(a => a.seat === h.hero && !a.blind).map(a => {
      const opps = a.alive.map(x => h.players[x]);
      const unknown = opps.filter(p => !p.cards).length;
      const eq = equity(me.cards, opps.map(p => p.cards || null), boardAt(h.board, a.street), 1500);
      const need = a.type === 'call' && a.amount ? a.amount / (a.potBefore + a.amount) : null;
      const vs = !opps.length ? '' : unknown ? `contre ${opps.length} adversaire(s), dont ${unknown} aux cartes cachées (main au hasard)` : `contre les vraies cartes de ${opps.length} adversaire(s)`;
      return `<div class="rc"><div class="rc-h"><span class="k">${{ preflop: 'Préflop', flop: 'Flop', turn: 'Turn', river: 'River' }[a.street]}</span>
          ${boardAt(h.board, a.street).length ? cards(boardAt(h.board, a.street)) : ''} <span>${ACT_TU[a.type] ?? a.type}${a.amount ? ' ' + a.amount : ''}</span></div>
        ${opps.length ? `<div><b>${pct(eq)}</b> d'équité ${need != null ? `· la cote demandait ${pct(need)} ${eq >= need ? '✅' : '❌'}` : ''}${bar(eq, need)}<span class="muted">${vs}</span></div>` : ''}</div>`;
    });
    return (recaps[handId] = `<div class="recap"><div>${cards(me.cards)} <b>${me.net > 0 ? '+' : ''}${me.net}</b> <span class="muted">${me.pos}</span></div>
      ${rows.join('') || '<div class="muted">Aucune décision de ta part.</div>'}
      <div class="muted">Analyse complète (solveur) : icône de l'extension → Ouvrir l'analyse → Mains.</div></div>`);
  }

  function render(s) {
    if (s.handId !== lastHand) { lastHand = s.handId; eqCache = {}; }
    if (s.phase === 'handComplete' && settings.recap !== false && s.youSeat != null) {
      const html = recap(s.handId);
      if (html) { show(); $('sub').textContent = 'récap de la main'; $('body').innerHTML = html; return; }
    }
    const off = settings.coach ? gate(s) : 'désactivé dans les réglages de l\'extension';
    if (!settings.coach) { host.remove(); if (lastState !== (lastState = off)) api.storage.local.set({ state: { coach: 'off', reason: off } }); return; }
    panel.classList.toggle('left', settings.side === 'left');
    if (lastState !== (lastState = off || 'on')) api.storage.local.set({ state: { coach: off ? 'off' : 'on', reason: off } });
    show();
    if (off) {
      $('sub').textContent = 'coupé';
      $('body').innerHTML = `<div class="off">Pas d'aide pendant la main : ${off}.<br><span class="muted">${settings.recap !== false ? 'Le récap de ta main (équité à chaque décision) s\'affichera dès qu\'elle sera terminée.' : 'Les mains sont enregistrées pour l\'analyse après la partie.'}</span></div>`;
      return;
    }
    $('sub').textContent = unrated ? 'entraînement non classé' : 'contre les bots · classée';
    const me = s.seats.find(x => x.seat === s.youSeat);
    if (!me.cards || s.phase !== 'betting' || me.status === 'folded') {
      $('body').innerHTML = `<div class="muted">${s.phase === 'handComplete' ? 'Main terminée. Ouvre l\'analyse depuis l\'icône de l\'extension pour la revoir.' : 'En attente de la prochaine main…'}</div>`;
      return;
    }

    // position
    const live = s.seats.filter(x => !x.isDealtOut).map(x => x.seat);
    const btn = s.seats.find(x => x.isDealer)?.seat ?? live[0];
    const order = [...live.slice(live.indexOf(btn)), ...live.slice(0, live.indexOf(btn))];
    const pos = POS[order.length]?.[order.indexOf(me.seat)] ?? '?';

    const bbSeat = s.seats.find(x => x.isBB);
    if (bbSeat?.lastAction?.type === 'blind') bbByHand[s.handId] = bbSeat.lastAction.amount;
    const bb = bbByHand[s.handId] || 2;
    const opps = s.seats.filter(x => x.seat !== me.seat && !x.isDealtOut && x.status !== 'folded');
    const maxBet = Math.max(...s.seats.map(x => x.bet));
    const toCall = s.allowed?.call ?? Math.max(0, maxBet - me.bet);
    const need = toCall > 0 ? toCall / (s.pot + toCall) : null;
    const myTurn = s.toActSeat === me.seat;

    // equity vs random hands (never the bots' hidden cards)
    // preflop: only players who already put money in voluntarily (the others will mostly fold)
    const vs = s.street === 'preflop'
      ? Math.max(1, opps.filter(x => ['call', 'raise', 'allin'].includes(x.lastAction?.type)).length)
      : opps.length;
    const key = [...me.cards, ...s.board, vs].join();
    const eq = eqCache[key] ??= equity(me.cards, Array(vs).fill(null), s.board, 1500);
    const made = s.board.length && handName([...me.cards, ...s.board]);
    const onBoard = made && s.board.length >= 3 && handName(s.board) === made;
    const o = outs(me.cards, s.board);

    if (settings.compact) { // "équité seulement": hand, equity bar, nothing else
      $('body').innerHTML = `<div class="compact"><span>${cards(me.cards)}</span><b>${pct(eq)}</b>${bar(eq, need)}<span class="muted">${s.board.length ? made : handKey(me.cards)} · contre ${vs} main${vs > 1 ? 's' : ''} au hasard</span></div>`;
      return;
    }
    html = ''; // shared with add()
    add('hand', row('Ta main', `${cards(me.cards)} ${s.board.length ? `<b>${made}</b>${onBoard ? ' <span class="muted">— entièrement sur le board : tout le monde l\'a, ça ne compte pas comme une vraie main.</span>' : ''}` : `<b>${handKey(me.cards)}</b>`}`));
    if (s.board.length) add('board', row('Board', cards(s.board)));
    add('position', row('Position', `<b>${pos}</b> <span class="muted">${POS_FR[pos] ?? ''}</span>`));
    add('pot', row('Pot', `${s.pot} <span class="dim">(${(s.pot / bb).toFixed(1)} BB)</span>${toCall ? `<br>À payer : <b>${toCall}</b>` : ''}`));
    add('equity', row('Équité', `<b>${pct(eq)}</b> contre ${vs} main${vs > 1 ? 's' : ''} au hasard
      ${bar(eq, need)}<span class="muted">Ta chance de gagner si tout le monde va jusqu'au bout${s.street === 'preflop' ? ' (contre les joueurs déjà engagés)' : ''}. Face à un bot qui mise fort, enlève 10 à 15 points.</span>`));
    if (need != null)
      add('odds', row('Cote', `Tu paies ${toCall} pour gagner ${s.pot} → il te faut <b>${pct(need)}</b> d'équité.<br><span class="muted">${s.street === 'preflop' ? 'Avant le flop, fie-toi plutôt au conseil ci-dessous : il tient compte de ta position et de ce que jouent vraiment les adversaires.' : eq >= need ? '✅ Ton équité dépasse la cote : payer est rentable à long terme.' : '❌ Ton équité est sous la cote : payer perd de l\'argent à long terme.'}</span>`));
    if (o.length) {
      const toCome = s.board.length === 3 ? 2 : 1;
      add('outs', row('Outs', `<b>${o.length}</b> cartes te donnent quinte ou mieux.<br><span class="muted">Règle du ${toCome === 2 ? '4' : '2'} : ${o.length} × ${toCome === 2 ? 4 : 2} ≈ ${Math.min(100, o.length * (toCome === 2 ? 4 : 2))} % de toucher ${toCome === 2 ? 'd\'ici la river' : 'à la prochaine carte'}.</span>`));
    }
    if (s.board.length) {
      const spr = me.stack / Math.max(1, s.pot);
      add('spr', row('SPR', `${spr.toFixed(1)} <span class="muted">(ton tapis / le pot). ${spr < 3 ? 'Faible : avec une bonne main, tu peux être prêt à tout miser.' : spr > 8 ? 'Élevé : sois prudent avec une seule paire.' : 'Moyen.'}</span>`));
    }

    // preflop context: raisers ordered by size (first = opener, second = 3-bettor), effective stack
    let pre = null;
    if (s.street === 'preflop') {
      const raisers = s.seats.filter(x => ['raise', 'allin'].includes(x.lastAction?.type) && x.bet > bb).sort((a, b) => a.bet - b.bet);
      const posOf = x => POS[order.length]?.[order.indexOf(x.seat)];
      const others = raisers.filter(x => x.seat !== me.seat);
      pre = {
        raisers, limpers: raisers.length ? 0 : s.seats.filter(x => x.lastAction?.type === 'call' && x.bet === bb).length,
        heroOpened: raisers[0]?.seat === me.seat, opener: raisers[0] && posOf(raisers[0]), threeBettor: others.at(-1) && posOf(others.at(-1)),
        stackBB: Math.min(me.stack + me.bet, Math.max(...s.seats.filter(x => x.seat !== me.seat && x.status !== 'folded' && !x.isDealtOut).map(x => x.stack + x.bet))) / bb,
        facingAllin: raisers.some(x => x.lastAction?.type === 'allin'),
      };
    }
    if (myTurn) {
      let adv;
      if (s.street === 'preflop') {
        const { raisers, limpers, heroOpened, opener, threeBettor, stackBB, facingAllin } = pre;
        adv = preflopAdvice(me.cards, pos, raisers.length, limpers, bb, toCall, opener, heroOpened, threeBettor, stackBB, facingAllin);
      } else if (toCall > 0) {
        adv = eq > 0.65 && eq >= need + 0.25 ? { action: 'Relancer pour la valeur', why: `Avec ${pct(eq)} d'équité, tu es souvent devant : fais payer plus cher.` }
          : eq >= need ? { action: `Payer ${toCall}`, why: `Ton équité (${pct(eq)}) couvre la cote (${pct(need)}).` }
          : { action: 'Fold', why: `Il te faut ${pct(need)} mais tu n'as que ${pct(eq)}. Coucher une main perdante, c'est économiser des jetons.` };
      } else {
        const pot = s.pot;
        adv = eq > 0.65 ? { action: `Miser ~${Math.round(pot * 2 / 3)} (2/3 du pot)`, why: 'Ta main est probablement la meilleure : mise pour que les moins bonnes mains paient.' }
          : o.length >= 8 ? { action: `Semi-bluff ~${Math.round(pot / 2)} (1/2 pot) ou check`, why: `Tu as un tirage (${o.length} outs) : en misant, tu peux gagner tout de suite, ou toucher plus tard.` }
          : eq > 0.45 ? { action: `Check ou petite mise ~${Math.round(pot / 3)}`, why: 'Main moyenne : contrôle la taille du pot.' }
          : { action: 'Check', why: 'Main faible : pas besoin de mettre des jetons, regarde la suite gratuitement si possible.' };
      }
      const mix = adv.mix?.length > 1 ? `<div class="mix">${adv.mix.map(m => `<span style="flex:${m.f}" class="m-${m.a === 'Fold' ? 'f' : m.a === 'Payer' || m.a === 'Check' ? 'c' : 'r'}">${m.a} ${Math.round(100 * m.f)} %</span>`).join('')}</div>` : '';
      add('advice', `<div class="adv">💡 <b>${adv.action}</b>${on('mix') ? mix : ''}${on('explain') ? adv.why : ''}</div>`);
    } else {
      add('advice', `<div class="muted">Ce n'est pas encore à toi de parler.</div>`);
    }
    if (pre && on('grid')) {
      const ch = chartFor(pos, pre.raisers.length, pre.opener, pre.heroOpened, pre.threeBettor, pre.stackBB, pre.facingAllin);
      if (ch) html += `<div class="mg-wrap"><div class="muted">Grille : ${ch.title}</div>${miniGrid(ch, handKey(me.cards))}
        <div class="muted mg-leg"><span class="sw r"></span>${ch.rLabel} <span class="sw c"></span>Payer <span class="sw"></span>Fold · ta main est encadrée</div></div>`;
    }
    // what the history says about the bots still in the hand
    const esc = x => String(x).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    const engaged = s.street === 'preflop' ? opps.filter(x => ['call', 'raise', 'allin'].includes(x.lastAction?.type)) : opps;
    const known = engaged.map(x => {
      const st = prof[x.name], p = profile(st);
      const act = x.lastAction && !['blind', 'fold'].includes(x.lastAction.type) ? ` · <i>${x.lastAction.type}</i>` : '';
      const nums = st ? `<span class="dim">${st.n} mains · VPIP ${Math.round(st.vpip)} / PFR ${Math.round(st.pfr)}</span>` : '<span class="dim">jamais croisé</span>';
      const aggressor = ['bet', 'raise', 'allin'].includes(x.lastAction?.type);
      // the 2 most relevant ways to exploit this bot, from the history
      const ex = st && on('exploits') ? exploits(st).slice(0, 2).map(e => `<div class="ex">🎯 ${e.tip} <span class="muted">(${e.why})</span></div>`).join('') : '';
      return `<div class="opp"><b>${esc(x.name)}</b><span class="tag">${p.label}</span>${act}<br>${nums}${aggressor && !ex ? `<br><span class="muted">${p.tip}</span>` : ''}${ex}</div>`;
    }).join('');
    if (known) add('opponents', row('Adversaires', known));
    if (!on('explain')) html = html.replace(/<span class="muted">[^<]*(<b>[^<]*<\/b>[^<]*)*<\/span>/g, ''); // short mode: no explanations
    if (!html) html = '<div class="muted">Tout est masqué : choisis quoi afficher dans la popup de l\'extension.</div>';
    $('body').innerHTML = html;
  }

  window.addEventListener('message', e => {
    if (e.source !== window || !e.data?.__gt || typeof e.data.data !== 'string') return;
    const { kind, data } = e.data;
    if (kind === 'ws-out' && /"(join_table|set_unrated_practice)"/.test(data)) {
      const m = JSON.parse(data);
      unrated = !!(m.type === 'join_table' ? m.payload.unratedPractice : m.payload.enabled);
    }
    if (kind === 'ws-in' && data.startsWith('{"type":"snapshot"')) {
      const snap = JSON.parse(data).snapshot;
      if (recaps[snap.handId] == null) { const buf = (pending[snap.handId] ||= []); if (buf.at(-1)?.data !== data) buf.push({ t: Date.now(), kind, data }); }
      render(snap);
    }
  });
})();
