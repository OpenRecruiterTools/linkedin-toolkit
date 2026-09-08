/**
 * LinkedIn Toolkit — client-side CSV, used by the Extract, Lists and Research
 * tabs. Files are parsed and built in the popup; nothing is uploaded anywhere.
 */

/**
 * Read a picked file as text. `Blob.text()` where it exists, `FileReader`
 * otherwise — the popup never uploads a file anywhere.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readTextFile(file) {
  if (!file) return Promise.reject(new Error('Choose a file first.'));
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

const BOM = 0xfeff;

/** Spreadsheets love a byte-order mark; it must not become part of a header. */
function stripBom(text) {
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

/**
 * Parse CSV text (RFC 4180-ish: quoted fields, doubled quotes, CRLF, BOM).
 * @param {string} text
 * @returns {{ headers: string[], rows: object[], matrix: string[][] }}
 */
export function parseCsv(text) {
  const source = stripBom(String(text || ''));
  const matrix = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        value += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(value);
      value = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(value);
      matrix.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }
  if (value !== '' || row.length) {
    row.push(value);
    matrix.push(row);
  }

  const cleaned = matrix.filter((r) => r.some((cell) => String(cell).trim() !== ''));
  if (!cleaned.length) return { headers: [], rows: [], matrix: [] };

  const headers = cleaned[0].map((h) => String(h).trim());
  const rows = cleaned.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = cells[index] === undefined ? '' : String(cells[index]).trim();
    });
    return obj;
  });

  return { headers, rows, matrix: cleaned };
}

function escapeCell(value) {
  let str;
  if (value === null || value === undefined) str = '';
  else if (Array.isArray(value)) str = value.map((v) => escapePlain(v)).join('; ');
  else if (typeof value === 'object') str = JSON.stringify(value);
  else str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function escapePlain(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const PROFILE_COLUMNS = [
  'fullName',
  'firstName',
  'lastName',
  'headline',
  'title',
  'company',
  'location',
  'industry',
  'url',
  'publicId',
  'connectionDegree',
  'reaction',
  'commentText',
];

/**
 * Build CSV text from an array of objects.
 * Columns default to a stable profile-ish order followed by any extra keys.
 * @param {object[]} rows
 * @param {string[]} [columns]
 */
export function toCsv(rows, columns) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';

  let cols = columns;
  if (!cols) {
    const seen = new Set();
    for (const item of list) {
      for (const key of Object.keys(item || {})) seen.add(key);
    }
    const preferred = PROFILE_COLUMNS.filter((c) => seen.has(c));
    const rest = [...seen].filter((c) => !preferred.includes(c) && !SKIP_COLUMNS.has(c)).sort();
    cols = [...preferred, ...rest];
  }

  const header = cols.map((c) => escapeCell(c)).join(',');
  const body = list.map((item) => cols.map((c) => escapeCell(item ? item[c] : '')).join(','));
  return [header, ...body].join('\n');
}

/** Heavy fields that would make a spreadsheet unusable. */
const SKIP_COLUMNS = new Set(['pageText', 'photoDataUrl', 'experience', 'education']);

/* ================================================================== */
/*  Research Pack column mapping                                       */
/* ================================================================== */

/** The `ResearchRow` fields the UI maps CSV columns onto. */
export const RESEARCH_FIELDS = Object.freeze([
  { key: 'name', label: 'Name' },
  { key: 'linkedinUrl', label: 'LinkedIn URL' },
  { key: 'email', label: 'Email' },
  { key: 'domain', label: 'Domain' },
  { key: 'company', label: 'Company' },
]);

const HEADER_HINTS = {
  name: ['name', 'fullname', 'full_name', 'contact', 'contactname', 'person', 'lead'],
  linkedinUrl: [
    'linkedinurl',
    'linkedin_url',
    'linkedin',
    'profileurl',
    'profile_url',
    'profile',
    'url',
    'link',
  ],
  email: ['email', 'emailaddress', 'email_address', 'e_mail', 'mail', 'workemail'],
  domain: ['domain', 'website', 'web', 'site', 'companydomain', 'company_domain', 'url_domain'],
  company: [
    'company',
    'companyname',
    'company_name',
    'organisation',
    'organization',
    'account',
    'employer',
  ],
};

function canonical(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Guess which CSV header feeds which `ResearchRow` field.
 * Recognises `name,linkedin_url,email,domain,company` plus common variants,
 * and leaves every other column alone (they ride along as extras).
 *
 * @param {string[]} headers
 * @returns {Record<string, string|null>} field → header (or null)
 */
export function guessMapping(headers) {
  const mapping = {};
  const used = new Set();
  const list = Array.isArray(headers) ? headers : [];

  for (const { key } of RESEARCH_FIELDS) {
    const hints = HEADER_HINTS[key] || [];
    let best = null;
    let bestRank = Infinity;

    for (const header of list) {
      if (used.has(header)) continue;
      const c = canonical(header);
      const compact = c.replace(/_/g, '');
      const rank = hints.findIndex((hint) => hint === c || hint === compact);
      if (rank !== -1 && rank < bestRank) {
        best = header;
        bestRank = rank;
      }
    }
    if (best) used.add(best);
    mapping[key] = best;
  }
  return mapping;
}

/**
 * Turn parsed CSV rows into contract `ResearchRow` objects.
 * Unmapped columns are preserved verbatim as extra keys.
 *
 * @param {object[]} rows      objects keyed by the original headers
 * @param {Record<string, string|null>} mapping  field → header
 * @returns {object[]} ResearchRow[]
 */
export function toResearchRows(rows, mapping) {
  const map = mapping || {};
  const claimed = new Set(Object.values(map).filter(Boolean));

  return (Array.isArray(rows) ? rows : []).map((source) => {
    const out = {};
    for (const { key } of RESEARCH_FIELDS) {
      const header = map[key];
      const value = header ? source[header] : '';
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        out[key] = String(value).trim();
      }
    }
    for (const [header, value] of Object.entries(source || {})) {
      if (claimed.has(header)) continue;
      if (value === undefined || value === null || String(value).trim() === '') continue;
      if (out[header] === undefined) out[header] = String(value).trim();
    }
    return out;
  });
}
