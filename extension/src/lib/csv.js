/**
 * LinkedIn Toolkit — CSV reader and writer (RFC 4180).
 *
 * Used by `export.csv` and by `list.importCsv`. No dependencies: this runs
 * inside the MV3 service worker.
 */

/** One value → one CSV field. Arrays become `a; b`; null/undefined become ''. */
export function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = Array.isArray(value) ? value.join('; ') : String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function normalizeColumns(columns, rows) {
  if (columns && columns.length) {
    return columns.map((c) => (typeof c === 'string' ? { key: c, label: c } : c));
  }
  const first = rows[0] || {};
  return Object.keys(first).map((key) => ({ key, label: key }));
}

/**
 * Rows → CSV text.
 * @param {object[]} rows
 * @param {(string|{key: string, label?: string})[]} [columns] defaults to the first row's keys
 */
export function toCsv(rows, columns) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const cols = normalizeColumns(columns, list);
  const header = cols.map((c) => escapeCsvValue(c.label ?? c.key)).join(',');
  const body = list.map((row) => cols.map((c) => escapeCsvValue(row[c.key])).join(','));
  return [header, ...body].join('\n');
}

/** Split CSV text into a matrix, honouring quotes, escaped quotes and CRLF. */
function parseMatrix(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let started = false;

  const pushField = () => {
    row.push(field);
    field = '';
    started = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && !started) {
      quoted = true;
      started = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch === '\r') {
      // swallow; the \n that follows ends the row
    } else {
      field += ch;
      started = true;
    }
  }

  if (field !== '' || row.length) pushRow();
  return rows;
}

/**
 * CSV text → `{ headers, rows }` where each row is an object keyed by header.
 * Headers are trimmed; missing trailing fields become ''.
 */
export function fromCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  if (!raw.trim()) return { headers: [], rows: [] };

  const matrix = parseMatrix(raw).filter((r) => r.length > 1 || (r[0] || '').trim() !== '');
  if (!matrix.length) return { headers: [], rows: [] };

  const headers = matrix[0].map((h) => h.trim());
  const rows = matrix.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] === undefined ? '' : cells[i];
    });
    return obj;
  });
  return { headers, rows };
}
