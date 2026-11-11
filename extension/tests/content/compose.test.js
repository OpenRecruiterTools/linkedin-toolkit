// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://platform.example.com/studio/brand/"}
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  jsdom has no DataTransfer and only accepts a real FileList; stand in */
/* ------------------------------------------------------------------ */
class FakeDataTransfer {
  constructor() {
    const list = [];
    this.items = { add: (f) => list.push(f) };
    this.files = list;
  }
}
globalThis.DataTransfer = FakeDataTransfer;

await import('../../src/content/compose-linkedin.js');
const C = globalThis.LITKCompose;

function fileInputFor(accept) {
  const input = document.createElement('input');
  input.type = 'file';
  input.setAttribute('accept', accept);
  let files = [];
  Object.defineProperty(input, 'files', { get: () => files, set: (v) => { files = v; } });
  return input;
}

/** A small stand-in for LinkedIn's post box. Clicking the add buttons behaves like LinkedIn's. */
function postBox({ media = true, documents = true, moreMenu = false } = {}) {
  document.body.innerHTML = `
    <div role="dialog" id="box">
      <div class="ql-editor" contenteditable="true" role="textbox"></div>
      ${media ? '<button aria-label="Add media" id="add-media"></button>' : ''}
      ${documents && !moreMenu ? '<button aria-label="Add a document" id="add-doc"></button>' : ''}
      ${moreMenu ? '<button aria-label="More" id="more"></button>' : ''}
      <button id="post">Post</button>
    </div>`;
  const posted = vi.fn();
  document.getElementById('post').addEventListener('click', posted);
  const showEditor = (accept, withTitle) => {
    const ed = document.createElement('div');
    ed.setAttribute('role', 'dialog');
    ed.id = 'media-editor';
    const input = fileInputFor(accept);
    input.addEventListener('change', () => {
      if (withTitle) {
        const t = document.createElement('input');
        t.type = 'text';
        t.placeholder = 'Add a descriptive title';
        t.id = 'doc-title';
        ed.appendChild(t);
      }
      const done = document.createElement('button');
      done.textContent = withTitle ? 'Done' : 'Next';
      done.addEventListener('click', () => ed.remove());
      ed.appendChild(done);
    });
    ed.appendChild(input);
    document.body.appendChild(ed);
  };
  const m = document.getElementById('add-media');
  if (m) m.addEventListener('click', () => showEditor('image/*,video/*', false));
  const d = document.getElementById('add-doc');
  if (d) d.addEventListener('click', () => showEditor('application/pdf', true));
  const more = document.getElementById('more');
  if (more) {
    more.addEventListener('click', () => {
      const b = document.createElement('button');
      b.textContent = 'Add a document';
      b.addEventListener('click', () => showEditor('application/pdf', true));
      document.body.appendChild(b);
    });
  }
  return { posted, editor: () => document.querySelector('#box .ql-editor') };
}

/** What a real browser delivers for the page's own window.postMessage (jsdom leaves source and origin empty). */
function pagePost(data) {
  window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: window }));
}

const IMAGE = { name: 'launch.png', type: 'image/png', kind: 'image', data: btoa('png-bytes'), title: '' };
const PDF = { name: 'brief.pdf', type: 'application/pdf', kind: 'document', data: btoa('%PDF'), title: 'Chief Operating Officer' };

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('never presses Post', () => {
  it('knows the publish buttons and refuses to click them', () => {
    const { posted } = postBox();
    expect(C.isPublish(document.getElementById('post'))).toBe(true);
    expect(C.safeClick(document.getElementById('post'))).toBe(false);
    expect(posted).not.toHaveBeenCalled();
    expect(C.buttonByLabel(document, /post/i)).toBe(null);
  });
});

describe('filling the post box', () => {
  it('attaches an image, types the text, and leaves Post to the person', async () => {
    const { posted, editor } = postBox();
    const saveFile = vi.fn();
    const out = await C.fill(document, { text: 'We are hiring\n\nGet in touch', file: IMAGE }, saveFile);
    expect(out.ok).toBe(true);
    expect(editor().textContent).toContain('We are hiring');
    expect(editor().querySelectorAll('p').length).toBe(3);
    expect(saveFile).not.toHaveBeenCalled();
    expect(posted).not.toHaveBeenCalled();
  });

  it('adds a PDF as a document with its title, through the More menu when LinkedIn hides it there', async () => {
    let titleSeen = '';
    document.addEventListener('input', (e) => { if (e.target.id === 'doc-title') titleSeen = e.target.value; }, true);
    const { posted } = postBox({ moreMenu: true });
    const out = await C.fill(document, { text: 'The brief', file: PDF }, vi.fn());
    expect(out.ok).toBe(true);
    expect(titleSeen).toBe('Chief Operating Officer');
    expect(posted).not.toHaveBeenCalled();
  });

  it('when the file cannot be attached it is saved to Downloads and the text still goes in', async () => {
    const { editor } = postBox({ media: false });
    const saveFile = vi.fn();
    const out = await C.fill(document, { text: 'Text only', file: IMAGE }, saveFile);
    expect(out.ok).toBe(false);
    expect(out.step).toBe('file');
    expect(out.message).toMatch(/Downloads/);
    expect(saveFile).toHaveBeenCalledWith(IMAGE);
    expect(editor().textContent).toContain('Text only');
  });
});

describe('website bridge', () => {
  it('answers hello and passes a draft with an ArrayBuffer file on as base64', async () => {
    const sent = [];
    globalThis.chrome = {
      runtime: {
        getManifest: () => ({ version: '2.2.0' }),
        sendMessage: vi.fn(async (msg) => { sent.push(msg); return { ok: true }; }),
      },
    };
    const replies = [];
    window.addEventListener('message', (e) => { if (e.data && e.data.source === 'lit-bridge') replies.push(e.data); });
    await import('../../src/content/web-bridge.js');
    pagePost({ source: 'lit-page', type: 'hello' });
    await vi.waitFor(() => expect(replies.some((r) => r.type === 'ready' && r.version === '2.2.0')).toBe(true));

    const bytes = new TextEncoder().encode('%PDF-1.4');
    pagePost({ source: 'lit-page', type: 'compose', id: 'a1',
      draft: { text: 'Hello', file: { name: 'b.pdf', type: 'application/pdf', title: 'Role', data: bytes.buffer } } });
    await vi.waitFor(() => expect(replies.some((r) => r.type === 'composed' && r.id === 'a1' && r.ok)).toBe(true));
    expect(sent[0].type).toBe('LIT_COMPOSE');
    expect(atob(sent[0].draft.file.data)).toBe('%PDF-1.4');
  });

  it('ignores messages that are not from the page itself', async () => {
    const before = globalThis.chrome.runtime.sendMessage.mock.calls.length;
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'lit-page', type: 'compose', id: 'x', draft: { text: 'hi' } },
      origin: 'https://evil.example', source: null }));
    await new Promise((r) => setTimeout(r, 20));
    expect(globalThis.chrome.runtime.sendMessage.mock.calls.length).toBe(before);
  });
});
