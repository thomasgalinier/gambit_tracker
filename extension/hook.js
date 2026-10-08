// Runs in the page's world: wraps WebSocket and fetch, forwards every message to relay.js.
(() => {
  const b64 = buf => {
    let s = '';
    for (const c of new Uint8Array(buf)) s += String.fromCharCode(c);
    return btoa(s);
  };
  const post = (kind, url, data) => {
    const t = Date.now();
    const send = d => window.postMessage({ __gt: 1, t, kind, url: String(url), data: d }, '*');
    // Never store auth tokens (JWTs) in the log.
    if (typeof data === 'string') send(data.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>'));
    else if (data instanceof Blob) data.arrayBuffer().then(b => send({ b64: b64(b) }));
    else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) send({ b64: b64(data.buffer ?? data) });
    else send(String(data));
  };

  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    constructor(...args) {
      super(...args);
      post('ws-open', this.url, '');
      this.addEventListener('message', e => post('ws-in', this.url, e.data));
      this.addEventListener('close', e => post('ws-close', this.url, `${e.code} ${e.reason}`));
    }
    send(d) { post('ws-out', this.url, d); return super.send(d); }
  };

  // Hand review / history probably comes over fetch: keep JSON responses too.
  const f = window.fetch;
  window.fetch = async (...args) => {
    const res = await f(...args);
    if ((res.headers.get('content-type') || '').includes('json'))
      res.clone().text().then(txt => post('fetch', res.url, txt), () => {});
    return res;
  };
})();
