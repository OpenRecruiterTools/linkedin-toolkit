/**
 * Compose a post from a website — shared rules.
 *
 * A website the user has connected (popup → "Let this site send you posts") can
 * hand the toolkit a draft: text and at most one file. The toolkit opens
 * LinkedIn's own post box and fills it in. It never presses Post: the person
 * reads the draft and publishes it themselves. See docs/compose-from-websites.md.
 */

export const COMPOSE_TEXT_MAX = 3000; // LinkedIn's post limit
export const COMPOSE_TITLE_MAX = 58; // LinkedIn's document title limit
export const COMPOSE_FILE_MAX = 40 * 1024 * 1024; // a runtime message holds ~64 MB; base64 adds a third

/** File kind by MIME type: what LinkedIn calls it in the post box. */
export const COMPOSE_KINDS = Object.freeze({
  'application/pdf': 'document',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
});

/** The extension a file gets from its checked type: a site's own file name never decides it. */
export const COMPOSE_EXTENSIONS = Object.freeze({
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function fileKind(type) {
  return COMPOSE_KINDS[String(type || '').toLowerCase()] || null;
}

/**
 * Check a draft from a website. Returns { ok: true, draft } with the cleaned
 * draft, or { ok: false, error } in plain words the website can show.
 * `file.size` is the decoded size in bytes; `file.data` is base64.
 */
export function checkDraft(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const text = typeof d.text === 'string' ? d.text.replace(/\r\n/g, '\n').trim() : '';
  if (text.length > COMPOSE_TEXT_MAX) {
    return { ok: false, error: `The post is longer than LinkedIn allows (${COMPOSE_TEXT_MAX} characters).` };
  }
  let file = null;
  if (d.file) {
    const f = d.file;
    const kind = fileKind(f.type);
    if (!kind) return { ok: false, error: 'That file type cannot be added to a LinkedIn post.' };
    if (typeof f.data !== 'string' || !f.data) return { ok: false, error: 'The file arrived empty.' };
    const size = Math.floor((f.data.length * 3) / 4);
    if (size > COMPOSE_FILE_MAX) return { ok: false, error: 'The file is too large to hand over (40 MB at most).' };
    const type = String(f.type).toLowerCase();
    // the name keeps only its first part; the extension comes from the checked type, never from the site
    const base =
      String(f.name || 'post')
        .split(/[\\/]/)
        .pop()
        .split('.')[0]
        .replace(/[^\w\- ]+/g, '_')
        .trim()
        .slice(0, 100) || 'post';
    const name = `${base}.${COMPOSE_EXTENSIONS[type]}`;
    const title = kind === 'document' ? String(f.title || base).trim().slice(0, COMPOSE_TITLE_MAX) : '';
    file = { name, type, kind, data: f.data, title };
  }
  if (!text && !file) return { ok: false, error: 'There is nothing to post: no text and no file.' };
  return { ok: true, draft: { text, file } };
}

/**
 * The site part of a page URL ("https://platform.example.com"), or null. Only https sites: a draft from a
 * plain-http page could have been changed on the way. This computer (localhost) is allowed for development.
 */
export function siteOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return u.origin;
    if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return u.origin;
    return null;
  } catch {
    return null;
  }
}
