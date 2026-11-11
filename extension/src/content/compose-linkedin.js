/**
 * LinkedIn Toolkit — fill LinkedIn's post box with a draft from a connected website
 * (docs/compose-from-websites.md).
 *
 * The background opens /feed/?shareActive=true&lit_compose=<id>. This script takes
 * the draft, attaches the file (a PDF as a document, an image or a video as media),
 * types the text and stops. It never presses Post: the person reads the draft and
 * publishes it. LinkedIn changes its markup, so every element is found by what it
 * says (labels and accept types) with fallbacks, and any step that fails leaves the
 * person a plain instruction and the file in their Downloads.
 */
(() => {
  const TIMEOUT = 15000;

  /* ------------------------------------------------------------------ */
  /*  Finding things                                                    */
  /* ------------------------------------------------------------------ */

  function label(el) {
    return `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`.replace(/\s+/g, ' ').trim();
  }

  /** The one button LinkedIn must never be pressed by us. */
  function isPublish(el) {
    const t = label(el).toLowerCase();
    return /^post\b|^post now|^publish|^schedule/.test(t) || (el.getAttribute('aria-label') || '').trim().toLowerCase() === 'post';
  }

  function buttonByLabel(root, re) {
    return [...root.querySelectorAll('button, [role="button"]')].find((b) => re.test(label(b)) && !isPublish(b)) || null;
  }

  function safeClick(el) {
    if (!el || isPublish(el)) return false;
    el.click();
    return true;
  }

  function editorIn(root) {
    return (
      root.querySelector('.ql-editor[contenteditable="true"]') ||
      root.querySelector('[role="textbox"][contenteditable="true"]') ||
      root.querySelector('div[contenteditable="true"]')
    );
  }

  function composer(doc) {
    const dialogs = [...doc.querySelectorAll('[role="dialog"]')];
    return dialogs.find((d) => editorIn(d)) || null;
  }

  function fileInput(doc, kind) {
    const inputs = [...doc.querySelectorAll('input[type="file"]')];
    const want = kind === 'document' ? /pdf|application/ : kind === 'video' ? /video/ : /image/;
    return inputs.filter((i) => want.test(i.getAttribute('accept') || '')).pop() || inputs.pop() || null;
  }

  function titleInput(doc) {
    return (
      doc.querySelector('input[type="text"][placeholder*="title" i]') ||
      doc.querySelector('input[type="text"][aria-label*="title" i]') ||
      doc.querySelector('input[type="text"][id*="title" i]') ||
      doc.querySelector('input[type="text"][name*="title" i]')
    );
  }

  function waitFor(fn, timeout = TIMEOUT, every = 200) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        let found = null;
        try {
          found = fn();
        } catch {
          found = null;
        }
        if (found) return resolve(found);
        if (Date.now() - started >= timeout) return resolve(null);
        setTimeout(tick, every);
      };
      tick();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Doing things                                                      */
  /* ------------------------------------------------------------------ */

  function fromBase64(data) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function setFiles(input, file) {
    const dt = new DataTransfer();
    dt.items.add(new File([fromBase64(file.data)], file.name, { type: file.type }));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** React keeps its own copy of an input's value; set it the way a person typing would. */
  function setValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    if (setter && setter.set) setter.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function typeText(editor, text) {
    editor.focus();
    const lines = String(text || '').split('\n');
    let typed = true;
    lines.forEach((line, i) => {
      if (line && !(document.execCommand && document.execCommand('insertText', false, line))) typed = false;
      if (i < lines.length - 1 && !(document.execCommand && document.execCommand('insertParagraph'))) typed = false;
    });
    if (!typed) {
      // execCommand is not available: write the paragraphs and tell the editor.
      editor.replaceChildren(
        ...lines.map((l) => {
          const p = editor.ownerDocument.createElement('p');
          if (l) p.textContent = l;
          else p.appendChild(editor.ownerDocument.createElement('br'));
          return p;
        }),
      );
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    return true;
  }

  async function finishMediaStep(doc) {
    // After a file, LinkedIn shows an editor with Next or Done before returning to the post box.
    const next = await waitFor(() => buttonByLabel(doc, /^(next|done)\b/i), 20000);
    if (next) safeClick(next);
    return Boolean(await waitFor(() => composer(doc), 20000));
  }

  async function attach(doc, box, file) {
    if (file.kind === 'document') {
      let open = buttonByLabel(box, /add a document/i);
      if (!open) {
        safeClick(buttonByLabel(box, /^more\b|more options/i));
        open = await waitFor(() => buttonByLabel(doc, /add a document|^document$/i), 5000);
      }
      if (!safeClick(open)) return false;
    } else {
      const open = buttonByLabel(box, /add (a )?(media|photo|video|image)/i);
      if (!safeClick(open)) return false;
    }
    const input = await waitFor(() => fileInput(doc, file.kind), 8000);
    if (!input) return false;
    setFiles(input, file);
    if (file.kind === 'document' && file.title) {
      const title = await waitFor(() => titleInput(doc), 15000);
      if (title) setValue(title, file.title);
    }
    return finishMediaStep(doc);
  }

  /* ------------------------------------------------------------------ */
  /*  Telling the person                                                 */
  /* ------------------------------------------------------------------ */

  function banner(doc, lines, tone) {
    const old = doc.getElementById('lit-compose-banner');
    if (old) old.remove();
    const el = doc.createElement('div');
    el.id = 'lit-compose-banner';
    el.setAttribute('role', 'status');
    el.style.cssText = `position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);max-width:520px;
      padding:12px 16px;border-radius:10px;font:14px/1.4 -apple-system,Segoe UI,Arial,sans-serif;color:#fff;
      background:${tone === 'warn' ? '#8a4b00' : '#1f3a2e'};box-shadow:0 6px 24px rgba(0,0,0,.25)`;
    lines.forEach((t, i) => {
      const p = doc.createElement('div');
      p.textContent = t;
      if (i === 0) p.style.fontWeight = '600';
      el.appendChild(p);
    });
    const close = doc.createElement('button');
    close.textContent = 'OK';
    close.style.cssText = 'margin-top:8px;background:#fff;color:#111;border:0;border-radius:6px;padding:4px 12px;cursor:pointer';
    close.onclick = () => el.remove();
    el.appendChild(close);
    doc.body.appendChild(el);
    return el;
  }

  /* ------------------------------------------------------------------ */
  /*  The whole job                                                     */
  /* ------------------------------------------------------------------ */

  async function fill(doc, draft, saveFile) {
    let box = await waitFor(() => composer(doc), 8000);
    if (!box) {
      safeClick(buttonByLabel(doc, /start a post|create a post/i));
      box = await waitFor(() => composer(doc));
    }
    if (!box) {
      if (draft.file) await saveFile(draft.file);
      return { ok: false, step: 'open', message: "LinkedIn's post box did not open. Click Start a post and paste your text" + (draft.file ? '; the file is in your Downloads.' : '.') };
    }
    let fileOk = true;
    if (draft.file) {
      fileOk = await attach(doc, box, draft.file).catch(() => false);
      if (!fileOk) await saveFile(draft.file);
      box = composer(doc) || box;
    }
    if (draft.text) {
      const editor = await waitFor(() => editorIn(composer(doc) || box), 8000);
      if (!editor) return { ok: false, step: 'text', message: 'The text could not be typed in. Paste it into the post box.' };
      typeText(editor, draft.text);
    }
    if (!fileOk) {
      const where = draft.file.kind === 'document' ? 'More, then Add a document' : 'Add media';
      return { ok: false, step: 'file', message: `The file is in your Downloads: add it with ${where}, then check the post and press Post.` };
    }
    return { ok: true, message: 'Your draft is ready. Check it, then press Post when you are happy.' };
  }

  async function run() {
    const params = new URLSearchParams(location.search);
    const id = params.get('lit_compose');
    if (!id) return;
    params.delete('lit_compose');
    history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);
    const res = await chrome.runtime.sendMessage({ type: 'LIT_COMPOSE_TAKE', id });
    if (!res || !res.ok) {
      banner(document, ['LinkedIn Toolkit', (res && res.error) || 'The draft could not be found.'], 'warn');
      return;
    }
    const saveFile = (file) => chrome.runtime.sendMessage({ type: 'LIT_COMPOSE_DOWNLOAD', file }).catch(() => {});
    const out = await fill(document, res.draft, saveFile);
    banner(document, [`From ${new URL(res.site).host}`, out.message], out.ok ? 'ok' : 'warn');
  }

  globalThis.LITKCompose = { fill, attach, composer, editorIn, buttonByLabel, isPublish, safeClick, fileInput, titleInput, typeText, run };
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && /linkedin\.com$/.test(location.hostname)) run();
})();
