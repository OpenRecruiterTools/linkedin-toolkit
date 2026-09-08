/**
 * LinkedIn Toolkit — page capture and DOM actions (content script).
 *
 * A classic script, not a module: MV3 content scripts cannot be ES modules.
 * Everything is hung off `globalThis.LITK` so `linkedin.js` (loaded after it)
 * and the tests can both reach it.
 *
 * Nothing here talks to LinkedIn's API. These are the things that only work in
 * the page: reading the rendered text, turning the profile photo into a data
 * URL, and clicking the buttons that have no usable endpoint.
 */

(function () {
  'use strict';

  /* ================================================================ */
  /*  Text cleaning                                                   */
  /* ================================================================ */

  /** Chrome and LinkedIn furniture that carries no information. */
  const BOILERPLATE = [
    'skip to main content',
    'linkedin',
    'home',
    'my network',
    'jobs',
    'messaging',
    'notifications',
    'me',
    'for business',
    'try premium for free',
    'try premium',
    'status is offline',
    'status is reachable',
    'see more',
    '…see more',
    '...see more',
    'see less',
    'show all',
    'new feed updates notifications',
    'open the options list in your navbar',
    'more',
    'ad',
    'feed post number',
  ];

  const MAX_TEXT = 60000;

  /**
   * `document.body.innerText` → something worth sending to a model.
   * Collapses whitespace, drops navigation furniture and repeated lines,
   * and caps the length.
   * @param {string} raw
   * @returns {string}
   */
  function cleanText(raw) {
    const lines = String(raw || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim());

    const out = [];
    let lastBlank = false;

    for (const line of lines) {
      if (!line) {
        if (!lastBlank && out.length) out.push('');
        lastBlank = true;
        continue;
      }
      const lower = line.toLowerCase();
      if (BOILERPLATE.includes(lower)) continue;
      if (out.length && out[out.length - 1] === line) continue;
      out.push(line);
      lastBlank = false;
    }

    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n').slice(0, MAX_TEXT);
  }

  /* ================================================================ */
  /*  Sections                                                        */
  /* ================================================================ */

  const SECTION_IDS = ['about', 'experience', 'education', 'skills', 'licenses_and_certifications'];

  function sectionText(id) {
    const anchor = document.getElementById(id);
    if (!anchor) return '';
    const section = anchor.closest('section') || anchor.parentElement;
    if (!section) return '';
    return cleanText(section.innerText || section.textContent || '');
  }

  /** The named profile sections that are present on the page. */
  function captureSections() {
    const sections = {};
    for (const id of SECTION_IDS) {
      const text = sectionText(id);
      if (text) sections[id === 'licenses_and_certifications' ? 'certifications' : id] = text;
    }
    return sections;
  }

  /* ================================================================ */
  /*  Photo                                                           */
  /* ================================================================ */

  const PHOTO_SELECTORS = [
    'img.pv-top-card-profile-picture__image',
    'img.pv-top-card-profile-picture__image--show',
    '.pv-top-card__photo img',
    'img[class*="profile-photo"]',
    'main img[alt*="profile photo"]',
  ];

  function findPhoto() {
    for (const selector of PHOTO_SELECTORS) {
      const img = document.querySelector(selector);
      if (img && (img.src || img.currentSrc)) return img;
    }
    return null;
  }

  /**
   * The profile photo as a data URL, so it survives without a network call.
   * Returns '' whenever the image is not there, is not loaded, or the canvas
   * is tainted — a missing photo must never fail a capture.
   */
  function capturePhoto() {
    const img = findPhoto();
    if (!img) return '';
    try {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, 0, 0, size, size);
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch {
      return '';
    }
  }

  /* ================================================================ */
  /*  Full capture                                                    */
  /* ================================================================ */

  /**
   * Everything the API cannot give us about the profile currently rendered.
   * @returns {{pageText: string, photoDataUrl: string, sections: object, url: string, capturedAt: number}}
   */
  function captureFull() {
    return {
      pageText: cleanText(document.body ? document.body.innerText : ''),
      photoDataUrl: capturePhoto(),
      sections: captureSections(),
      url: location.href,
      capturedAt: Date.now(),
    };
  }

  /* ================================================================ */
  /*  DOM actions                                                     */
  /* ================================================================ */

  /** A real-looking click: LinkedIn's buttons listen for more than 'click'. */
  function humanClick(element) {
    if (!element) return false;
    if (element.scrollIntoView) element.scrollIntoView({ block: 'center' });
    for (const type of ['mousedown', 'mouseup', 'click']) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
    return true;
  }

  /** First matching, visible, enabled button. */
  function findButton(selectors, root) {
    const scope = root || document;
    for (const selector of selectors) {
      for (const button of scope.querySelectorAll(selector)) {
        if (button.disabled) continue;
        if (button.getAttribute('aria-hidden') === 'true') continue;
        return button;
      }
    }
    return null;
  }

  /** The card for one post, found by its activity urn. */
  function findPost(postUrl) {
    const match = String(postUrl || '').match(/urn:li:(?:activity|ugcPost|share):(\d+)/);
    if (!match) return null;
    const urn = `urn:li:activity:${match[1]}`;
    return (
      document.querySelector(`[data-urn="${urn}"]`) ||
      document.querySelector(`[data-id="${urn}"]`) ||
      document.querySelector(`[data-activity-urn="${urn}"]`)
    );
  }

  const LIKE_SELECTORS = [
    'button[aria-label^="React Like"]',
    'button.react-button__trigger',
    'button[aria-label="Like"]',
  ];
  const FOLLOW_SELECTORS = [
    'button[aria-label^="Follow"]',
    'button.follow',
    'button[aria-label*="Follow "]',
  ];
  const COMMENT_BOX_SELECTORS = [
    '.comments-comment-box .ql-editor',
    '.comments-comment-texteditor div[role="textbox"]',
    'div[role="textbox"][contenteditable="true"]',
  ];
  const COMMENT_SUBMIT_SELECTORS = [
    'button.comments-comment-box__submit-button',
    'button.comments-comment-box__submit-button--cr',
    'form button[type="submit"]',
  ];

  function domLike(postUrl) {
    const post = findPost(postUrl);
    if (postUrl && !post) return { ok: false, error: 'Post not found on this page.' };
    const button = findButton(LIKE_SELECTORS, post || document);
    if (!button) return { ok: false, error: 'No Like button found.' };
    if (button.getAttribute('aria-pressed') === 'true') return { ok: true, alreadyDone: true };
    humanClick(button);
    return { ok: true };
  }

  function domFollow() {
    const button = findButton(FOLLOW_SELECTORS);
    if (!button) return { ok: false, error: 'No Follow button found.' };
    humanClick(button);
    return { ok: true };
  }

  function domComment(postUrl, body) {
    if (!body) return { ok: false, error: 'Comment body cannot be empty.' };
    const post = findPost(postUrl);
    if (postUrl && !post) return { ok: false, error: 'Post not found on this page.' };

    const scope = post || document;
    const box = findButton(COMMENT_BOX_SELECTORS, scope);
    if (!box) return { ok: false, error: 'No comment box found.' };

    box.focus();
    box.innerHTML = '';
    const paragraph = document.createElement('p');
    paragraph.textContent = body;
    box.appendChild(paragraph);
    box.dispatchEvent(new Event('input', { bubbles: true }));

    const submit = findButton(COMMENT_SUBMIT_SELECTORS, scope);
    if (!submit) return { ok: false, error: 'No comment submit button found.' };
    humanClick(submit);
    return { ok: true };
  }

  /* ================================================================ */
  /*  Message handling                                                */
  /* ================================================================ */

  const HANDLERS = {
    CAPTURE_FULL: () => captureFull(),
    DOM_LIKE: (msg) => domLike(msg.postUrl),
    DOM_FOLLOW: () => domFollow(),
    DOM_COMMENT: (msg) => domComment(msg.postUrl, msg.body),
  };

  /** Run one background→content message. Returns null for anything else. */
  function handleMessage(msg) {
    if (!msg || !HANDLERS[msg.type]) return null;
    try {
      return HANDLERS[msg.type](msg);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  globalThis.LITK = {
    cleanText,
    captureSections,
    capturePhoto,
    captureFull,
    humanClick,
    findButton,
    findPost,
    domLike,
    domFollow,
    domComment,
    handleMessage,
    BOILERPLATE,
    MAX_TEXT,
  };
})();
