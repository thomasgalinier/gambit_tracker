const api = globalThis.browser ?? chrome;
// every part of the coach panel can be hidden (keys used by live.js)
const SHOW = [['hand', 'Ta main'], ['board', 'Board'], ['position', 'Position'], ['pot', 'Pot et montant à payer'], ['equity', 'Équité'],
  ['odds', 'Cote du pot'], ['outs', 'Outs (tirages)'], ['spr', 'SPR'], ['advice', 'Conseil'], ['mix', 'Fréquences GTO (barre)'],
  ['grid', 'Grille préflop'], ['opponents', 'Profil des bots'], ['exploits', 'Comment exploiter les bots'], ['explain', 'Explications détaillées']];
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const cards = cs => (cs || []).map(c => `<span class="cd ${c[1]}">${c[0] === 'T' ? '10' : c[0]}${SUIT[c[1]]}</span>`).join('');
const signed = v => `<span class="${v > 0 ? 'win' : v < 0 ? 'loss' : ''}">${v > 0 ? '+' : ''}${Math.round(v)}</span>`;

async function refresh() {
  const s = await api.storage.local.get(null);
  const settings = { coach: true, side: 'right', ...s.settings };
  sCoach.checked = settings.coach;
  sSide.value = settings.side;
  sCompact.checked = !!settings.compact;
  sRecap.checked = settings.recap !== false;
  const show = settings.show || {};
  document.querySelector('.show-list').innerHTML = SHOW.map(([k, label]) =>
    `<label><input type="checkbox" data-k="${k}" ${(show[k] ?? (k === 'grid' ? settings.grid !== false : true)) ? 'checked' : ''}> ${label}</label>`).join('');
  const st = s.state;
  document.querySelector('.settings').hidden = !COACH_ENABLED;
  coach.innerHTML = !COACH_ENABLED ? '🎓 Coach <b>désactivé dans le code</b> (config.js). Les mains sont enregistrées.'
    : !settings.coach ? '🎓 Coach <b>désactivé</b> (coche ci-dessous pour l\'activer).'
    : !st ? '🎓 Coach : ouvre une table contre les bots sur gambit.com.'
    : st.coach === 'on' ? '🎓 Coach <b class="win">actif</b> : table contre les bots.'
    : `🎓 Coach <b>coupé</b> : ${st.reason}. Les mains sont quand même enregistrées.`;
  const midnight = new Date().setHours(0, 0, 0, 0);
  const hands = Object.keys(s).filter(k => /^h\w/.test(k)).map(k => thaw(s[k])).filter(h => h.t >= midnight).sort((a, b) => a.t - b.t);
  const sum = heroStats(hands).all;
  const tile = (k, v) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  today.innerHTML = tile("Aujourd'hui", `${hands.length} <small class="muted">mains</small>`) + tile('Résultat', signed(sum?.net ?? 0))
    + tile('VPIP / PFR', hands.length ? `${Math.round(sum.vpip)}/${Math.round(sum.pfr)}` : '–');
  last.innerHTML = hands.slice(-5).reverse().map(h => {
    const me = h.players[h.hero];
    return `<tr><td>${cards(me.cards)}</td><td><span class="pill">${me.pos}</span></td><td class="num">${signed(me.net)}</td></tr>`;
  }).join('') || '<tr><td class="muted">Aucune main aujourd\'hui.</td></tr>';
}

const saveSettings = () => api.storage.local.set({ settings: { coach: sCoach.checked, side: sSide.value, compact: sCompact.checked, recap: sRecap.checked, show: Object.fromEntries([...document.querySelectorAll('.show-list input')].map(i => [i.dataset.k, i.checked])) } }).then(refresh);
sCoach.onchange = sCompact.onchange = sRecap.onchange = saveSettings;
document.querySelector('.show-list').onchange = saveSettings;
sSide.onchange = () => api.storage.local.remove('coachPos').then(saveSettings);
clr.onclick = async () => { if (confirm('Effacer toutes les mains, notes et réglages ?')) { await api.storage.local.clear(); refresh(); } };
dash.onclick = () => api.tabs.create({ url: api.runtime.getURL('dashboard.html') });
refresh();
