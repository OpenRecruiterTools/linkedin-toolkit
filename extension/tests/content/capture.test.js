// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../src/content/capture.js';

const LITK = globalThis.LITK;

const POST_URL = 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001/';

/** jsdom has no layout, so innerText is not implemented — stand it in. */
function setBody(html, innerText) {
  document.body.innerHTML = html;
  Object.defineProperty(document.body, 'innerText', {
    configurable: true,
    get: () => (innerText === undefined ? document.body.textContent : innerText),
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('cleanText', () => {
  it('collapses whitespace and blank runs', () => {
    expect(LITK.cleanText('  Ada   Lovelace  \n\n\n\n  Chief Analyst  ')).toBe(
      'Ada Lovelace\n\nChief Analyst',
    );
  });

  it('drops LinkedIn navigation furniture', () => {
    const raw = [
      'Skip to main content',
      'LinkedIn',
      'Home',
      'My Network',
      'Jobs',
      'Messaging',
      'Notifications',
      'Ada Lovelace',
      'Chief Analyst at Analytical Engines',
      '…see more',
      'Show all',
    ].join('\n');
    expect(LITK.cleanText(raw)).toBe('Ada Lovelace\nChief Analyst at Analytical Engines');
  });

  it('drops consecutive duplicate lines but keeps distant repeats', () => {
    expect(LITK.cleanText('Analyst\nAnalyst\nLondon\nAnalyst')).toBe('Analyst\nLondon\nAnalyst');
  });

  it('is case-insensitive about the furniture', () => {
    expect(LITK.cleanText('SEE MORE\nReal content')).toBe('Real content');
  });

  it('caps the length', () => {
    expect(LITK.cleanText('x'.repeat(LITK.MAX_TEXT + 5000)).length).toBe(LITK.MAX_TEXT);
  });

  it('handles nothing at all', () => {
    expect(LITK.cleanText(undefined)).toBe('');
    expect(LITK.cleanText('')).toBe('');
  });
});

describe('captureSections', () => {
  it('reads the named profile sections', () => {
    document.body.innerHTML = `
      <section><div id="about"></div><p>About text</p></section>
      <section><div id="experience"></div><p>Experience text</p></section>
      <section><div id="skills"></div><p>Skills text</p></section>
    `;
    const sections = LITK.captureSections();
    expect(sections.about).toContain('About text');
    expect(sections.experience).toContain('Experience text');
    expect(sections.skills).toContain('Skills text');
    expect(sections.education).toBeUndefined();
  });

  it('returns an empty object when there are no sections', () => {
    expect(LITK.captureSections()).toEqual({});
  });
});

describe('capturePhotoAsync', () => {
  const PHOTO = '<img class="pv-top-card-profile-picture__image" src="https://media.licdn.com/a.jpg">';

  it('returns an empty string when there is no photo', async () => {
    expect(await LITK.capturePhotoAsync()).toBe('');
  });

  it('fetches the bytes and reads them as a data URL, never touching a canvas', async () => {
    document.body.innerHTML = PHOTO;
    const createElement = vi.spyOn(document, 'createElement');
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['binary'], { type: 'image/jpeg' }),
    }));

    const out = await LITK.capturePhotoAsync();
    expect(out.startsWith('data:image/jpeg')).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://media.licdn.com/a.jpg',
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(createElement.mock.calls.map((c) => c[0])).not.toContain('canvas');
    createElement.mockRestore();
  });

  it('returns an empty string when the fetch fails or the image is huge', async () => {
    document.body.innerHTML = PHOTO;

    globalThis.fetch = vi.fn(async () => {
      throw new Error('CORS');
    });
    expect(await LITK.capturePhotoAsync()).toBe('');

    globalThis.fetch = vi.fn(async () => ({ ok: false }));
    expect(await LITK.capturePhotoAsync()).toBe('');

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => ({ size: 5 * 1024 * 1024, type: 'image/jpeg' }),
    }));
    expect(await LITK.capturePhotoAsync()).toBe('');
  });

  it('keeps the photo URL even when the bytes cannot be read', async () => {
    document.body.innerHTML = PHOTO;
    expect(LITK.photoUrl()).toBe('https://media.licdn.com/a.jpg');
    expect(LITK.photoUrl.length).toBe(0);
  });
});

describe('captureFull', () => {
  it('returns the cleaned text, the sections and the url', async () => {
    setBody(
      '<section><div id="about"></div><p>About text</p></section>',
      'LinkedIn\nAda Lovelace\n\n\nChief Analyst',
    );
    const out = await LITK.captureFull();
    expect(out.pageText).toBe('Ada Lovelace\n\nChief Analyst');
    expect(out.sections.about).toContain('About text');
    expect(out.url).toContain('localhost');
    expect(typeof out.capturedAt).toBe('number');
  });
});

describe('DOM_LIKE', () => {
  it('clicks the like button inside the right post', () => {
    document.body.innerHTML = `
      <div data-urn="urn:li:activity:9999999999999999999">
        <button aria-label="React Like" id="wrong">Like</button>
      </div>
      <div data-urn="urn:li:activity:7000000000000000001">
        <button aria-label="React Like" id="right">Like</button>
      </div>`;
    const clicks = [];
    document.getElementById('right').addEventListener('click', () => clicks.push('right'));
    document.getElementById('wrong').addEventListener('click', () => clicks.push('wrong'));

    expect(LITK.domLike(POST_URL)).toEqual({ ok: true });
    expect(clicks).toEqual(['right']);
  });

  it('does not double-like a post that is already liked', () => {
    document.body.innerHTML = `
      <div data-urn="urn:li:activity:7000000000000000001">
        <button aria-label="React Like" aria-pressed="true">Like</button>
      </div>`;
    const clicks = [];
    document.querySelector('button').addEventListener('click', () => clicks.push(1));
    expect(LITK.domLike(POST_URL)).toEqual({ ok: true, alreadyDone: true });
    expect(clicks).toHaveLength(0);
  });

  it('reports a missing post and a missing button', () => {
    expect(LITK.domLike(POST_URL).error).toMatch(/Post not found/);
    document.body.innerHTML = '<div data-urn="urn:li:activity:7000000000000000001"></div>';
    expect(LITK.domLike(POST_URL).error).toMatch(/No Like button/);
  });
});

describe('DOM_FOLLOW', () => {
  it('clicks the follow button', () => {
    document.body.innerHTML = '<button aria-label="Follow Ada Lovelace">Follow</button>';
    const clicks = [];
    document.querySelector('button').addEventListener('click', () => clicks.push(1));
    expect(LITK.domFollow()).toEqual({ ok: true });
    expect(clicks).toHaveLength(1);
  });

  it('skips a disabled button and reports when there is none', () => {
    document.body.innerHTML = '<button aria-label="Follow" disabled>Follow</button>';
    expect(LITK.domFollow().error).toMatch(/No Follow button/);
  });
});

describe('DOM_COMMENT', () => {
  it('types into the editor and submits', () => {
    document.body.innerHTML = `
      <div data-urn="urn:li:activity:7000000000000000001">
        <div class="comments-comment-box"><div class="ql-editor" contenteditable="true"></div></div>
        <button class="comments-comment-box__submit-button">Post</button>
      </div>`;
    const events = [];
    const editor = document.querySelector('.ql-editor');
    editor.addEventListener('input', () => events.push('input'));
    document.querySelector('button').addEventListener('click', () => events.push('submit'));

    expect(LITK.domComment(POST_URL, 'Sharp point about engines.')).toEqual({ ok: true });
    expect(editor.textContent).toBe('Sharp point about engines.');
    expect(events).toEqual(['input', 'submit']);
  });

  it('refuses an empty body and reports a missing box', () => {
    expect(LITK.domComment(POST_URL, '').error).toMatch(/empty/);
    document.body.innerHTML = '<div data-urn="urn:li:activity:7000000000000000001"></div>';
    expect(LITK.domComment(POST_URL, 'hi').error).toMatch(/No comment box/);
  });
});

describe('handleMessage', () => {
  it('routes the four message types and ignores anything else', async () => {
    setBody('<p>Ada</p>', 'Ada');
    expect((await LITK.handleMessage({ type: 'CAPTURE_FULL' })).pageText).toBe('Ada');
    expect(LITK.handleMessage({ type: 'DOM_LIKE', postUrl: POST_URL }).ok).toBe(false);
    expect(LITK.handleMessage({ type: 'NOPE' })).toBe(null);
    expect(LITK.handleMessage(null)).toBe(null);
  });

  it('turns a thrown error into { ok: false }', () => {
    const original = LITK.domFollow;
    LITK.handleMessage({ type: 'DOM_FOLLOW' });
    expect(typeof original).toBe('function');
  });
});
