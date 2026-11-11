import { describe, it, expect, beforeEach } from 'vitest';

import {
  COMPOSE_URL,
  PENDING_TTL_MS,
  SITES_KEY,
  _resetCompose,
  connectSite,
  disconnectSite,
  getSites,
  handleComposeMessage,
} from '../../src/background/compose.js';
import { checkDraft, COMPOSE_TEXT_MAX } from '../../src/lib/compose.js';
import '../../src/background/index.js';

const mock = () => globalThis.chrome.__mock;
const SITE = 'https://platform.example.com';
const fromSite = { tab: { id: 9 }, url: `${SITE}/studio/brand/` };
const fromLinkedIn = { tab: { id: 10 }, url: 'https://www.linkedin.com/feed/?shareActive=true' };
const fromPopup = {};
const PDF = { name: 'brief.pdf', type: 'application/pdf', title: 'Chief Operating Officer', data: btoa('%PDF-1.4 test') };

/** Every onMessage listener, as Chrome would call it. */
function dispatch(msg, sender) {
  return new Promise((resolve) => {
    for (const listener of mock().listeners.onMessage) listener(msg, sender, resolve);
  });
}

beforeEach(() => {
  _resetCompose();
});

describe('draft rules', () => {
  it('takes text and one supported file, and names a PDF a document with a title', () => {
    const out = checkDraft({ text: ' Hello\r\nworld ', file: PDF });
    expect(out.ok).toBe(true);
    expect(out.draft.text).toBe('Hello\nworld');
    expect(out.draft.file.kind).toBe('document');
    expect(out.draft.file.title).toBe('Chief Operating Officer');
  });

  it('refuses an empty draft, an over-long post and a file LinkedIn cannot take', () => {
    expect(checkDraft({}).ok).toBe(false);
    expect(checkDraft({ text: 'x'.repeat(COMPOSE_TEXT_MAX + 1) }).ok).toBe(false);
    expect(checkDraft({ text: 'hi', file: { name: 'a.exe', type: 'application/x-msdownload', data: 'AAAA' } }).ok).toBe(false);
  });
});

describe('connected sites', () => {
  it('records a site, registers the bridge there and injects it into the open page', async () => {
    const out = await connectSite(`${SITE}/studio/brand/`, 9);
    expect(out).toEqual({ ok: true, site: SITE });
    expect(await getSites()).toEqual([SITE]);
    expect(mock().executeScriptCalls.at(-1)).toEqual({ target: { tabId: 9 }, files: ['src/content/web-bridge.js'] });
  });

  it('will not connect LinkedIn itself, or a site Chrome gave no access to', async () => {
    expect((await connectSite('https://www.linkedin.com/feed/')).ok).toBe(false);
    mock().grantAllPermissions = false;
    expect((await connectSite(`${SITE}/`)).ok).toBe(false);
    mock().grantAllPermissions = true;
  });

  it('disconnecting removes the site and its permission', async () => {
    await connectSite(`${SITE}/`);
    await disconnectSite(SITE);
    expect(await getSites()).toEqual([]);
  });
});

describe('compose from a site', () => {
  it('a connected site opens the post box and LinkedIn collects the draft once', async () => {
    await chrome.storage.local.set({ [SITES_KEY]: [SITE] });
    const res = await handleComposeMessage({ type: 'LIT_COMPOSE', draft: { text: 'We are hiring', file: PDF } }, fromSite);
    expect(res.ok).toBe(true);
    const tab = [...mock().tabs.values()].at(-1);
    expect(tab.url.startsWith(COMPOSE_URL)).toBe(true);
    const id = decodeURIComponent(tab.url.slice(COMPOSE_URL.length));
    const taken = await handleComposeMessage({ type: 'LIT_COMPOSE_TAKE', id }, fromLinkedIn);
    expect(taken.ok).toBe(true);
    expect(taken.draft.text).toBe('We are hiring');
    expect(taken.site).toBe(SITE);
    expect((await handleComposeMessage({ type: 'LIT_COMPOSE_TAKE', id }, fromLinkedIn)).ok).toBe(false);
  });

  it('a site that is not connected is refused and nothing opens', async () => {
    const before = mock().tabs.size;
    const res = await handleComposeMessage({ type: 'LIT_COMPOSE', draft: { text: 'hi' } }, fromSite);
    expect(res.ok).toBe(false);
    expect(mock().tabs.size).toBe(before);
  });

  it('only LinkedIn can collect a draft, and drafts expire', async () => {
    await chrome.storage.local.set({ [SITES_KEY]: [SITE] });
    await handleComposeMessage({ type: 'LIT_COMPOSE', draft: { text: 'hi' } }, fromSite);
    const id = decodeURIComponent([...mock().tabs.values()].at(-1).url.slice(COMPOSE_URL.length));
    expect((await handleComposeMessage({ type: 'LIT_COMPOSE_TAKE', id }, fromSite)).ok).toBe(false);
    const realNow = Date.now;
    Date.now = () => realNow() + PENDING_TTL_MS + 1000;
    try {
      expect((await handleComposeMessage({ type: 'LIT_COMPOSE_TAKE', id }, fromLinkedIn)).ok).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  it('the site list can only be read or changed from the popup', async () => {
    expect((await handleComposeMessage({ type: 'LIT_SITES_LIST' }, fromSite)).ok).toBe(false);
    expect((await handleComposeMessage({ type: 'LIT_SITES_LIST' }, fromPopup)).ok).toBe(true);
    expect((await handleComposeMessage({ type: 'LIT_SITES_DISCONNECT', site: SITE }, fromSite)).ok).toBe(false);
  });

  it('a file that could not be attached is saved to Downloads, only at LinkedIn’s request', async () => {
    expect((await handleComposeMessage({ type: 'LIT_COMPOSE_DOWNLOAD', file: PDF }, fromSite)).ok).toBe(false);
    expect((await handleComposeMessage({ type: 'LIT_COMPOSE_DOWNLOAD', file: PDF }, fromLinkedIn)).ok).toBe(true);
    expect(mock().downloads.at(-1).filename).toBe('brief.pdf');
  });
});

describe('the router', () => {
  it('a website tab can hand over a draft but cannot run any toolkit action', async () => {
    const res = await dispatch({ action: 'status.get', params: {} }, fromSite);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('UNAUTHORIZED');
  });

  it('the popup still runs toolkit actions as before', async () => {
    const res = await dispatch({ action: 'status.get', params: {} }, fromPopup);
    expect(res.ok).toBe(true);
  });
});

describe('security review fixes', () => {
  it('only https sites (or this computer, for development) can be connected', async () => {
    const { siteOf } = await import('../../src/lib/compose.js');
    expect(siteOf('http://jobs.example.com/x')).toBe(null);
    expect(siteOf('https://jobs.example.com/x')).toBe('https://jobs.example.com');
    expect(siteOf('http://127.0.0.1:8010/studio/')).toBe('http://127.0.0.1:8010');
    expect(siteOf('http://localhost:3000/')).toBe('http://localhost:3000');
    expect((await connectSite('http://jobs.example.com/')).ok).toBe(false);
  });

  it('a file is named after its checked type, whatever name the site gave it', () => {
    const out = checkDraft({ text: 'hi', file: { name: 'invoice.pdf.exe', type: 'application/pdf', data: btoa('%PDF') } });
    expect(out.draft.file.name).toBe('invoice.pdf');
    const img = checkDraft({ text: 'hi', file: { name: 'photo.html', type: 'image/png', data: btoa('png') } });
    expect(img.draft.file.name).toBe('photo.png');
  });

  it('a file to save is checked again, so only a supported type is ever downloaded', async () => {
    const bad = { name: 'run.exe', type: 'application/x-msdownload', data: btoa('MZ') };
    expect((await handleComposeMessage({ type: 'LIT_COMPOSE_DOWNLOAD', file: bad }, fromLinkedIn)).ok).toBe(false);
    const sneaky = { name: 'run.exe', type: 'application/pdf', data: btoa('%PDF') };
    await handleComposeMessage({ type: 'LIT_COMPOSE_DOWNLOAD', file: sneaky }, fromLinkedIn);
    expect(mock().downloads.at(-1).filename).toBe('run.pdf');
  });
});
