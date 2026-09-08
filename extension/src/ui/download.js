/**
 * LinkedIn Toolkit — client-side file downloads.
 *
 * Files are built in the popup and handed to `chrome.downloads` as a data URL.
 * A service worker has no `URL.createObjectURL`, and using the same path from
 * every surface keeps behaviour identical wherever a download is triggered.
 */

import { toCsv } from './csv.js';

/** Filesystem-safe slug for generated filenames. */
export function slug(text, fallback = 'export') {
  const out = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return out || fallback;
}

/** `2026-09-08` — used to stamp every generated filename. */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Download a text file.
 * @param {string} filename
 * @param {string} text
 * @param {string} [mime]
 */
export async function downloadText(filename, text, mime = 'text/plain') {
  if (!text) throw new Error('Nothing to download.');
  await chrome.downloads.download({
    url: `data:${mime};charset=utf-8,${encodeURIComponent(text)}`,
    filename,
    saveAs: true,
  });
  return { filename };
}

/** Download rows as CSV. */
export async function downloadCsv(filename, rows, columns) {
  const csv = typeof rows === 'string' ? rows : toCsv(rows, columns);
  if (!csv) throw new Error('Nothing to download.');
  return downloadText(filename, csv, 'text/csv');
}

/** Download any value as pretty-printed JSON. */
export async function downloadJson(filename, value) {
  return downloadText(filename, JSON.stringify(value, null, 2), 'application/json');
}

/** Download Markdown. */
export async function downloadMarkdown(filename, text) {
  return downloadText(filename, text, 'text/markdown');
}
