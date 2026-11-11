/**
 * LinkedIn Toolkit — website bridge (docs/compose-from-websites.md).
 *
 * Runs only on sites the person has connected from the popup. The page talks to
 * it with window.postMessage:
 *
 *   page   → { source: 'lit-page', type: 'hello' }
 *   bridge → { source: 'lit-bridge', type: 'ready', version }          (also sent once on load)
 *   page   → { source: 'lit-page', type: 'compose', id, draft: { text, file?: { name, type, title?, data } } }
 *   bridge → { source: 'lit-bridge', type: 'composed', id, ok, error? }
 *
 * `file.data` may be an ArrayBuffer, a Blob or base64. The toolkit then opens
 * LinkedIn's post box with the draft in it; the person presses Post.
 */
(() => {
  if (window.__litWebBridge) return;
  window.__litWebBridge = true;

  const version = (() => {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return '';
    }
  })();

  function reply(msg) {
    window.postMessage({ source: 'lit-bridge', ...msg }, location.origin);
  }

  function toBase64(bytes) {
    let out = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(out);
  }

  async function fileData(data) {
    if (typeof data === 'string') return data.replace(/^data:[^,]*,/, '');
    // by tag, not instanceof: the buffer may come from another script context (the page's)
    if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return toBase64(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) return toBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (data && typeof data.arrayBuffer === 'function') return toBase64(new Uint8Array(await data.arrayBuffer()));
    return '';
  }

  async function compose(id, draft) {
    try {
      const d = draft && typeof draft === 'object' ? draft : {};
      const out = { text: typeof d.text === 'string' ? d.text : '' };
      if (d.file) {
        out.file = { name: d.file.name, type: d.file.type, title: d.file.title, data: await fileData(d.file.data) };
      }
      const res = await chrome.runtime.sendMessage({ type: 'LIT_COMPOSE', draft: out });
      reply({ type: 'composed', id, ok: Boolean(res && res.ok), error: res && !res.ok ? res.error : undefined });
    } catch (e) {
      reply({ type: 'composed', id, ok: false, error: 'LinkedIn Toolkit could not take the post: ' + e.message });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== 'lit-page') return;
    if (msg.type === 'hello') reply({ type: 'ready', version });
    else if (msg.type === 'compose') compose(msg.id, msg.draft);
  });

  reply({ type: 'ready', version });
})();
