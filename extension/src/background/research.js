/**
 * LinkedIn Toolkit — Research Pack.
 *
 * Rows of half-known people in, dossiers out. Resolution, gathering, signals
 * and (optional) enrichment all run locally through the user's own session, a
 * few rows per campaign tick, so a 500-row CSV is spread over days inside the
 * quotas rather than burning them in a minute.
 *
 * Step 5 of the pipeline — the open web — is deliberately not here: the
 * extension never crawls. The dossier leaves a "Public web" section for the
 * agent to fill with its own search tool.
 */

import { ACTIONS, ERROR, EVENTS, EngineError } from '../lib/actions.js';
import { handle, register } from './engine.js';
import { K, get, newId, set, stamp } from '../lib/storage.js';
import { addTickHook } from './campaigns.js';
import { emit } from './events.js';
import { lookupEmail } from './enrich.js';
import * as lists from './lists.js';
import * as quota from './quota.js';
import * as voyager from './voyager.js';

/** Rows processed per tick; the rest wait for the next one. */
export const ROWS_PER_TICK = 10;

/**
 * Name similarity a search hit must reach before it may be accepted at all.
 *
 * High on purpose. The cost of resolving the wrong person is not a bad row in
 * a spreadsheet — it is a connection request, addressed by name, sent to a
 * stranger.
 */
export const NAME_MATCH_THRESHOLD = 0.92;

/**
 * And the bar at which a second candidate counts as a rival.
 *
 * Anything above this is close enough that a human should be the one to pick,
 * so two of them means the row comes back unresolved with both attached
 * rather than a coin toss dressed up as a confidence score.
 */
export const NAME_RIVAL_THRESHOLD = 0.85;

/** Assumed cost of one row before we have measured any. */
const DEFAULT_ROW_MS = 20000;

/* ================================================================== */
/*  Name matching                                                     */
/* ================================================================== */

/** Honorifics and post-nominals that are not part of anybody's name. */
const NAME_NOISE = new Set([
  'jr', 'sr', 'ii', 'iii', 'iv',
  'phd', 'mba', 'msc', 'bsc', 'ma', 'md', 'cfa', 'cpa', 'pmp',
  'mr', 'mrs', 'ms', 'dr', 'prof',
]);

/**
 * A name reduced to what actually identifies a person.
 *
 * LinkedIn display names carry a lot that a comparison must ignore: emoji and
 * pronouns ("Ada Lovelace 🚀 (she/her)"), post-nominals ("Ada Lovelace, PhD")
 * and middle initials ("Ada B. Lovelace"). Accents are folded rather than
 * dropped, so "Zoë" still matches "Zoe".
 */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((part) => part && part.length > 1 && !NAME_NOISE.has(part))
    .join(' ')
    .trim();
}

/** Classic Levenshtein distance. */
export function levenshtein(a, b) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  let previous = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[t.length];
}

/** 1 for identical, 0 for nothing in common. */
export function nameSimilarity(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  const longest = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / longest;
}

/**
 * Does this candidate look like they work where the row says?
 *
 * The headline counts as well as the parsed employer, because LinkedIn often
 * has the company only in the free text — and it is a *bonus*, never a
 * requirement. Reid Hoffman's headline does not say "Greylock"; a rule that
 * demanded it would refuse to resolve him at all.
 */
function companyMatches(rowCompany, profile = {}) {
  const wanted = normalizeName(rowCompany);
  if (!wanted) return false;
  for (const field of [profile.company, profile.headline, profile.title]) {
    const candidate = normalizeName(field);
    if (!candidate) continue;
    if (candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate)) {
      return true;
    }
  }
  return false;
}

/** `ada@analytical-engines.com` → `analytical-engines.com`. */
export function domainOf(row = {}) {
  if (row.domain) return String(row.domain).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const email = String(row.email || '');
  const at = email.indexOf('@');
  return at > 0 ? email.slice(at + 1).toLowerCase() : '';
}

/** A domain → the LinkedIn universalName it most likely maps to. */
export function universalNameFromDomain(domain) {
  return String(domain || '')
    .split('.')
    .slice(0, -1)
    .join('-')
    .replace(/[^a-z0-9-]/gi, '')
    .toLowerCase();
}

/* ================================================================== */
/*  Resolution                                                        */
/* ================================================================== */

/** The company a row's domain, email domain or company name points at. */
async function resolveCompany(row) {
  const domain = domainOf(row);
  const universalName = domain
    ? universalNameFromDomain(domain)
    : universalNameFromDomain(`${row.company || ''}.com`);
  if (!universalName) return null;

  const res = await handle(ACTIONS.COMPANY_GET, { universalName }, 'system');
  if (!res.ok) return null;
  return { row, kind: 'company', universalName, confidence: domain ? 0.9 : 0.5 };
}

async function searchPeople(keywords) {
  const res = await handle(ACTIONS.SEARCH_PEOPLE, { keywords, count: 5 }, 'system');
  return res.ok ? res.data.profiles : [];
}

/**
 * Pick a person out of a page of search hits, or decline.
 *
 * The name has to be right; the company is what raises confidence, not what
 * grants permission. One near-exact name resolves at 0.85, the same name plus
 * a company or headline that agrees resolves at 1.0, and two names that are
 * both plausible resolve at nothing at all — that is a question for a human,
 * and the candidates are handed back so they can answer it in one click.
 *
 * @returns {{publicId: string, confidence: number} | null}
 */
export function pickCandidate(name, company, candidates = []) {
  const scored = candidates
    .filter((c) => c && c.publicId)
    .map((c) => ({
      candidate: c,
      name: nameSimilarity(name, c.fullName),
      company: companyMatches(company, c),
    }));

  const rivals = scored.filter((s) => s.name >= NAME_RIVAL_THRESHOLD);
  const strong = scored.filter((s) => s.name >= NAME_MATCH_THRESHOLD);
  const confirmed = strong.filter((s) => s.company);

  if (confirmed.length === 1) {
    return { publicId: confirmed[0].candidate.publicId, confidence: 1 };
  }
  if (strong.length === 1 && rivals.length === 1) {
    return { publicId: strong[0].candidate.publicId, confidence: 0.85 };
  }
  return null;
}

/**
 * Match one row to a LinkedIn profile or company.
 *
 * A row that names a person is resolved to a person or to nothing. It is
 * never resolved to their employer's page: "Satya Nadella, Microsoft" is a
 * request for Satya Nadella, and answering with the Microsoft company page is
 * not a partial success — it is a different answer to a different question,
 * and everything downstream (the invite, the message, the dossier) would be
 * addressed to a company. The company path is for rows that carry no name.
 *
 * @returns {Promise<{row, kind: 'person'|'company'|'unresolved', publicId?, universalName?, confidence: number, candidates?: Profile[]}>}
 */
export async function resolveRow(row = {}) {
  const url = row.linkedinUrl || row.linkedin_url || row.url || '';
  const publicId = voyager.publicIdFromUrl(url);
  if (publicId) return { row, kind: 'person', publicId, confidence: 1 };

  const name = row.name || row.fullName || '';
  if (name) {
    const seen = new Map();
    const collect = (profiles) => {
      for (const p of profiles) if (p.publicId && !seen.has(p.publicId)) seen.set(p.publicId, p);
      return profiles;
    };

    // Narrow first, because a name plus an employer is the strongest signal
    // we have; then the name on its own, because LinkedIn's own index often
    // does not carry the employer the row came with.
    for (const keywords of [row.company ? `${name} ${row.company}`.trim() : '', name]) {
      if (!keywords) continue;
      const picked = pickCandidate(name, row.company, collect(await searchPeople(keywords)));
      if (picked) return { row, kind: 'person', ...picked };
    }

    return {
      row,
      kind: 'unresolved',
      confidence: 0,
      candidates: [...seen.values()],
    };
  }

  const company = await resolveCompany(row);
  return company || { row, kind: 'unresolved', confidence: 0 };
}

export async function resolve(rows) {
  const resolved = [];
  for (const row of rows) resolved.push(await resolveRow(row));
  return { resolved };
}

/* ================================================================== */
/*  Signals                                                           */
/* ================================================================== */

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/** Spec §5c signals: what about this person is worth acting on today. */
export function packSignals({ profile, company, posts, mutualConnections, connectionStatus }) {
  const signals = [];
  const p = profile || {};

  const current = (p.experience || []).filter((e) => !e.end);
  const latest = current.sort((a, b) => (b.start || 0) - (a.start || 0))[0];
  if (latest && latest.start && Date.now() - latest.start < NINETY_DAYS) {
    signals.push('changedJobRecently');
  }

  const recent = (posts || []).filter((x) => x.postedAt && Date.now() - x.postedAt < NINETY_DAYS);
  if (recent.length) signals.push('postedRecently');

  // Somebody posting several times a month is worth approaching through their
  // own writing rather than cold.
  const thisMonth = recent.filter((x) => Date.now() - x.postedAt < THIRTY_DAYS);
  if (thisMonth.length >= 3) signals.push('high-activity');

  if (p.engagedWithPost) signals.push('engagedWithMe');

  if (company && company.followerCount) signals.push(`followers:${company.followerCount}`);
  if (company && company.size) signals.push(`headcount:${company.size}`);
  if (company && /hiring|we are hiring|join us/i.test(company.description || '')) {
    signals.push('companyHiring');
  }

  if (mutualConnections) signals.push(`mutuals:${mutualConnections}`);
  if (connectionStatus === 'connected') signals.push('alreadyConnected');

  return signals;
}

/* ================================================================== */
/*  Dossier                                                           */
/* ================================================================== */

function bullet(label, value) {
  return value ? `- **${label}:** ${value}\n` : '';
}

/** The pack as a markdown dossier. */
export function buildMarkdown(pack) {
  const p = pack.profile || {};
  const c = pack.company || {};
  const title = p.fullName || c.name || pack.row.name || 'Unresolved row';

  let md = `# ${title}\n\n`;

  md += '## Summary\n\n';
  md += bullet('LinkedIn', p.url || c.url);
  md += bullet('Headline', p.headline);
  md += bullet('Location', p.location);
  md += bullet('Match confidence', pack.resolved ? pack.resolved.confidence.toFixed(2) : '');
  md += bullet('Connection', pack.connectionStatus);
  if (!p.url && !c.url) md += '_Could not be matched to a LinkedIn profile or company._\n';
  md += '\n';

  md += '## Role & Company\n\n';
  md += bullet('Title', p.title);
  md += bullet('Company', p.company || c.name);
  md += bullet('Industry', c.industry || p.industry);
  md += bullet('Size', c.size);
  md += bullet('HQ', c.hq);
  md += bullet('Website', c.website);
  if (c.description) md += `\n${c.description}\n`;
  md += '\n';

  md += '## Career\n\n';
  const experience = p.experience || [];
  if (experience.length) {
    for (const role of experience.slice(0, 6)) {
      const years = [role.start, role.end]
        .map((t) => (t ? new Date(t).getFullYear() : ''))
        .filter(Boolean)
        .join('–');
      md += `- ${role.title || 'Role'}${role.company ? ` at ${role.company}` : ''}${
        years ? ` (${years})` : ''
      }\n`;
    }
  } else {
    md += '_No experience captured._\n';
  }
  const education = p.education || [];
  if (education.length) {
    md += '\n';
    for (const school of education.slice(0, 3)) {
      md += `- ${school.school}${school.degree ? `, ${school.degree}` : ''}\n`;
    }
  }
  md += '\n';

  md += '## Signals\n\n';
  md += (pack.signals || []).length
    ? `${pack.signals.map((s) => `- ${s}`).join('\n')}\n`
    : '_No signals._\n';
  md += '\n';

  md += '## Recent activity\n\n';
  const posts = pack.recentPosts || [];
  if (posts.length) {
    for (const post of posts.slice(0, 5)) {
      const when = post.postedAt ? new Date(post.postedAt).toISOString().slice(0, 10) : '';
      md += `- ${when ? `${when} — ` : ''}${String(post.text || '').slice(0, 200)}`;
      md += ` (${post.likes || 0} likes, ${post.comments || 0} comments)\n`;
      if (post.url) md += `  ${post.url}\n`;
    }
  } else {
    md += '_No recent posts found._\n';
  }
  md += '\n';

  md += '## Contact\n\n';
  const enrichment = pack.enrichment || {};
  md += bullet('Email', enrichment.email);
  md += bullet('Phone', enrichment.phone);
  md += bullet('Source', enrichment.provider && enrichment.provider !== 'none' ? enrichment.provider : '');
  if (!enrichment.email && !enrichment.phone) {
    md += '_No verified contact details. Enrichment is off or found nothing._\n';
  }
  md += '\n';

  md += '## Public web\n\n';
  md +=
    '_The extension never crawls the open web. Use your own search tool for news, talks, ' +
    'GitHub and podcasts, and write what you find here._\n\n';

  md += '## Suggested opener\n\n';
  md +=
    '_Draft one from the facts above — `ai.complete` with task `opener`, or write it yourself. ' +
    'Do not invent anything that is not in this dossier._\n';

  return md;
}

/** The pack as one row of the enriched output CSV. */
export function buildCsvRow(pack) {
  const p = pack.profile || {};
  const c = pack.company || {};
  const enrichment = pack.enrichment || {};
  return {
    ...pack.row,
    resolvedKind: pack.resolved ? pack.resolved.kind : 'unresolved',
    matchConfidence: pack.resolved ? String(pack.resolved.confidence) : '0',
    linkedinUrl: p.url || c.url || '',
    fullName: p.fullName || '',
    title: p.title || '',
    company: p.company || c.name || '',
    location: p.location || '',
    connectionStatus: pack.connectionStatus || '',
    mutualConnections: pack.mutualConnections === undefined ? '' : String(pack.mutualConnections),
    signals: (pack.signals || []).join('; '),
    email: enrichment.email || '',
    phone: enrichment.phone || '',
  };
}

/* ================================================================== */
/*  Jobs                                                              */
/* ================================================================== */

async function readJobs() {
  return get(K.RESEARCH_JOBS, []);
}

async function writeJobs(jobs) {
  await set(K.RESEARCH_JOBS, jobs);
  return jobs;
}

async function readPacks(jobId) {
  return get(K.researchPacks(jobId), []);
}

function etaFor(job) {
  const remaining = Math.max(0, job.total - job.done);
  const perRow = job.done > 0 ? job.elapsedMs / job.done : DEFAULT_ROW_MS;
  return Math.round(remaining * perRow);
}

/**
 * Queue a pack job. Rows are processed on the campaign tick.
 * @returns {Promise<{jobId: string, total: number, etaMs: number}>}
 */
export async function startPack(rows, { listName, enrich = false, full = false } = {}) {
  if (!rows || !rows.length) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'research.pack needs at least one row.');
  }

  const today = new Date().toISOString().slice(0, 10);
  const job = stamp({
    jobId: newId('job'),
    status: 'pending',
    rows,
    total: rows.length,
    done: 0,
    cursor: 0,
    elapsedMs: 0,
    listName: listName || `Research Pack ${today}`,
    enrich,
    full,
    createdAt: Date.now(),
  });

  const jobs = await readJobs();
  jobs.push(job);
  await writeJobs(jobs);
  await set(K.researchPacks(job.jobId), []);

  return { jobId: job.jobId, total: job.total, etaMs: etaFor(job) };
}

/* ================================================================== */
/*  Gathering one row                                                 */
/* ================================================================== */

/** Errors that mean the whole job should pause, not just this row. */
const PAUSE_CODES = new Set([
  ERROR.QUOTA_EXCEEDED,
  ERROR.OUTSIDE_BUSINESS_HOURS,
  ERROR.RATE_LIMITED,
  ERROR.CHALLENGE_DETECTED,
  ERROR.NOT_LOGGED_IN,
]);

/**
 * Run an action and hand back its data. A quota or challenge error is
 * rethrown so the job pauses; anything else is just a gap in this pack.
 */
async function run(action, params) {
  const res = await handle(action, params, 'system');
  if (res.ok) return res.data;
  if (PAUSE_CODES.has(res.error.code)) {
    throw new EngineError(res.error.code, res.error.message, res.error);
  }
  return null;
}

async function gather(resolved, { full }) {
  //  is always present, empty included: a caller has to be able
  // to tell 'nothing posted' from 'we never looked'.
  const pack = { row: resolved.row, resolved, signals: [], recentPosts: [] };

  if (resolved.kind === 'person') {
    // profile.get reserves a visit and paces itself, so this is where a job
    // that has run out of quota stops for the day.
    pack.profile = await run(ACTIONS.PROFILE_GET, { publicId: resolved.publicId, full });

    if (pack.profile && pack.profile.company) {
      pack.company = await run(ACTIONS.COMPANY_GET, {
        universalName: universalNameFromDomain(`${pack.profile.company}.com`),
      });
    }

    try {
      pack.recentPosts = await voyager.getMemberPosts({
        publicId: resolved.publicId,
        profileUrn: pack.profile && pack.profile.urn,
        count: 5,
      });
    } catch {
      pack.recentPosts = [];
    }

    try {
      pack.mutualConnections = await voyager.getMutualConnectionsCount({
        profileUrn: (pack.profile && pack.profile.urn) || '',
      });
    } catch {
      pack.mutualConnections = undefined;
    }

    const status = await run(ACTIONS.NETWORK_STATUS, { publicIds: [resolved.publicId] });
    if (status) pack.connectionStatus = status.statuses[resolved.publicId];
  } else if (resolved.kind === 'company') {
    pack.company = await run(ACTIONS.COMPANY_GET, { universalName: resolved.universalName });
  }

  pack.signals = packSignals(pack);
  return pack;
}

/* ================================================================== */
/*  The tick worker                                                   */
/* ================================================================== */

/**
 * Advance every running job by at most `ROWS_PER_TICK` rows. Stops early and
 * resumes next tick when the quotas say no.
 *
 * @returns {Promise<{processed: number, jobs: number}>}
 */
export async function progress() {
  const jobs = await readJobs();
  const running = jobs.filter((j) => j.status === 'pending' || j.status === 'running');
  if (!running.length) return { processed: 0, jobs: 0 };

  let processed = 0;

  for (const job of running) {
    job.status = 'running';
    const packs = await readPacks(job.jobId);

    for (let n = 0; n < ROWS_PER_TICK && job.cursor < job.total; n += 1) {
      const startedAt = Date.now();

      let pack;
      try {
        const resolved = await resolveRow(job.rows[job.cursor]);
        pack = await gather(resolved, { full: job.full });
      } catch (e) {
        if (PAUSE_CODES.has(e.code)) break;
        pack = {
          row: job.rows[job.cursor],
          resolved: { row: job.rows[job.cursor], kind: 'unresolved', confidence: 0 },
          signals: [],
          error: e.message,
        };
      }

      if (job.enrich && pack.profile) {
        pack.enrichment = await lookupEmail(pack.profile, pack.company);
      }

      pack.markdown = buildMarkdown(pack);
      pack.csvRow = buildCsvRow(pack);
      packs.push(stamp(pack));

      job.cursor += 1;
      job.done += 1;
      job.elapsedMs += Date.now() - startedAt;
      processed += 1;

      await emit(EVENTS.RESEARCH_PROGRESS, {
        jobId: job.jobId,
        done: job.done,
        total: job.total,
        row: pack.row,
        packSummary: {
          kind: pack.resolved.kind,
          fullName: pack.profile ? pack.profile.fullName : '',
          company: pack.profile ? pack.profile.company : (pack.company || {}).name || '',
          signals: pack.signals,
        },
        etaMs: etaFor(job),
      });

      if (!(await hasQuotaLeft())) break;

      // Pace the job the same way every other read is paced.
      if (job.cursor < job.total) await quota.humanDelay();
    }

    await set(K.researchPacks(job.jobId), packs);

    // The job is finished when every row is done, whether or not the quota ran
    // out on the very last one.
    if (job.cursor >= job.total) {
      job.status = 'done';
      job.completedAt = Date.now();
      const list = await lists.ensureList(job.listName);
      const profiles = packs.filter((p) => p.profile).map((p) => p.profile);
      if (profiles.length) await lists.add(list.listId, { profiles });
      job.listId = list.listId;
      await emit(EVENTS.RESEARCH_COMPLETED, {
        jobId: job.jobId,
        listId: list.listId,
        total: job.total,
      });
    }

    job.updatedAt = Date.now();
  }

  await writeJobs(jobs);
  return { processed, jobs: running.length };
}

/** A pack costs a search and a visit; stop before either bucket is empty. */
async function hasQuotaLeft() {
  const search = await quota.snapshot('search');
  const visit = await quota.snapshot('visit');
  return search.dailyUsed < search.dailyCap && visit.dailyUsed < visit.dailyCap;
}

/** Job status plus its packs. */
export async function getJob(jobId) {
  const job = (await readJobs()).find((j) => j.jobId === jobId);
  if (!job) throw new EngineError(ERROR.NOT_FOUND, `Research job ${jobId} not found.`);
  return {
    jobId: job.jobId,
    status: job.status,
    done: job.done,
    total: job.total,
    etaMs: etaFor(job),
    listId: job.listId,
    packs: await readPacks(jobId),
  };
}

/** Every job, for status and for sync. */
export async function allJobs() {
  return readJobs();
}

/* ================================================================== */
/*  Wiring                                                            */
/* ================================================================== */

addTickHook(() => progress());

register(ACTIONS.RESEARCH_RESOLVE, ({ rows }) => resolve(rows));
register(ACTIONS.RESEARCH_PACK, ({ rows, listName, enrich, full }) =>
  startPack(rows, { listName, enrich, full }),
);
register(ACTIONS.RESEARCH_GET, ({ jobId }) => getJob(jobId));
