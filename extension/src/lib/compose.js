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
    const name = String(f.name || `post.${kind === 'document' ? 'pdf' : kind === 'video' ? 'mp4' : 'png'}`)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .slice(0, 120);
    const title = kind === 'document' ? String(f.title || name.replace(/\.[^.]+$/, '')).trim().slice(0, COMPOSE_TITLE_MAX) : '';
    file = { name, type: String(f.type).toLowerCase(), kind, data: f.data, title };
  }
  if (!text && !file) return { ok: false, error: 'There is nothing to post: no text and no file.' };
  return { ok: true, draft: { text, file } };
}

/** The site part of a page URL ("https://platform.example.com"), or null for anything not http(s). */
export function siteOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}
