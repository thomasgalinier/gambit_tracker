// Isolated world: turns the raw traffic from hook.js into parsed hands in extension storage.
// Stored keys: h<handId> = one hand, f:<Method> = latest Gambit stats response. Everything else is dropped.
const api = globalThis.browser ?? chrome;
const KEEP_FETCH = ['GetPlayerStats', 'GetStartingHandStats'];
const pending = {}; // handId -> raw snapshot messages
const done = new Set(); // Gambit repeats the final snapshot: never re-parse a finished hand
let unrated = false;

// one-time purge of the old raw-log format (l<timestamp> keys)
api.storage.local.get(null).then(s => {
  const old = Object.keys(s).filter(k => /^l\d/.test(k));
  if (old.length) api.storage.local.remove(old);
});

// Gambit's hand history tells which session / tournament each hand belongs to
async function saveMeta(json) {
  let list;
  try { list = JSON.parse(json).hands; } catch { return; }
  if (!Array.isArray(list)) return;
  const { handMeta = {} } = await api.storage.local.get('handMeta');
  for (const x of list) handMeta[x.handId] = { sessionId: x.sessionId, type: x.sessionType, format: x.tournamentFormat || null, placement: x.tournamentPlacement || null, friend: x.friendTableMode || null };
  api.storage.local.set({ handMeta });
}

window.addEventListener('message', e => {
  if (e.source !== window || !e.data?.__gt || typeof e.data.data !== 'string') return;
  const m = e.data;
  if (m.kind === 'ws-out' && /"(join_table|set_unrated_practice)"/.test(m.data)) {
    const j = JSON.parse(m.data);
    unrated = !!(j.type === 'join_table' ? j.payload.unratedPractice : j.payload.enabled);
  }
  if (m.kind === 'fetch') {
    const name = KEEP_FETCH.find(n => m.url.includes('/' + n));
    if (name) api.storage.local.set({ ['f:' + name]: m.data });
    if (m.url.includes('/GetHands')) saveMeta(m.data);
  }
  if (m.kind !== 'ws-in' || !m.data.startsWith('{"type":"snapshot"')) return;
  const id = m.data.match(/"handId":"(\w+)"/)?.[1];
  if (!id || done.has(id)) return;
  const buf = (pending[id] ||= []);
  if (buf.at(-1)?.data !== m.data) buf.push({ t: m.t, kind: 'ws-in', data: m.data });
  if (m.data.includes('"phase":"handComplete"')) {
    const [h] = parseHands(buf);
    delete pending[id];
    done.add(id);
    if (h && isPlayable(h)) api.storage.local.set({ ['h' + id]: freeze({ ...h, rated: !unrated }) });
  }
});
