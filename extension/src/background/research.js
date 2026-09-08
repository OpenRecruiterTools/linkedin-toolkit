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

/** Name similarity a search hit must reach to be accepted without a human. */
export const NAME_MATCH_THRESHOLD = 0.85;

/** Assumed cost of one row before we have measured any. */
const DEFAULT_ROW_MS = 20000;

/* ================================================================== */
/*  Name matching                                                     */
/* ================================================================== */

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
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

function companyMatches(rowCompany, profileCompany) {
  const a = normalizeName(rowCompany);
  const b = normalizeName(profileCompany);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
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

/**
 * Match one row to a LinkedIn profile or company.
 * @returns {Promise<{row, kind: 'person'|'company'|'unresolved', publicId?, universalName?, confidence: number, candidates?: Profile[]}>}
 */
export async function resolveRow(row = {}) {
  const url = row.linkedinUrl || row.linkedin_url || row.url || '';
  const publicId = voyager.publicIdFromUrl(url);
  if (publicId) return { row, kind: 'person', publicId, confidence: 1 };

  const name = row.name || row.fullName || '';
  if (name && row.company) {
    const res = await handle(
      ACTIONS.SEARCH_PEOPLE,
      { keywords: `${name} ${row.company}`.trim(), count: 5 },
      'system',
    );
    const candidates = res.ok ? res.data.profiles : [];

    let best = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = nameSimilarity(name, candidate.fullName);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (best && bestScore >= NAME_MATCH_THRESHOLD && companyMatches(row.company, best.company)) {
      return { row, kind: 'person', publicId: best.publicId, confidence: bestScore };
    }
    if (candidates.length) {
      return { row, kind: 'unresolved', confidence: bestScore, candidates };
    }
  }

  const domain = domainOf(row);
  if (domain) {
    const universalName = universalNameFromDomain(domain);
    const res = await handle(ACTIONS.COMPANY_GET, { universalName }, 'system');
    if (res.ok) return { row, kind: 'company', universalName, confidence: 0.9 };
  }

  return { row, kind: 'unresolved', confidence: 0 };
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

async function gather(resolved, { full }) {
  const pack = { row: resolved.row, resolved, signals: [] };

  if (resolved.kind === 'person') {
    const res = await handle(ACTIONS.PROFILE_GET, { publicId: resolved.publicId, full }, 'system');
    if (res.ok) pack.profile = res.data;

    if (pack.profile && pack.profile.company) {
      const company = await handle(
        ACTIONS.COMPANY_GET,
        { universalName: universalNameFromDomain(`${pack.profile.company}.com`) },
        'system',
      );
      if (company.ok) pack.company = company.data;
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

    const status = await handle(
      ACTIONS.NETWORK_STATUS,
      { publicIds: [resolved.publicId] },
      'system',
    );
    if (status.ok) pack.connectionStatus = status.data.statuses[resolved.publicId];
  } else if (resolved.kind === 'company') {
    const res = await handle(ACTIONS.COMPANY_GET, { universalName: resolved.universalName }, 'system');
    if (res.ok) pack.company = res.data;
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
    let paused = false;

    for (let n = 0; n < ROWS_PER_TICK && job.cursor < job.total; n += 1) {
      const startedAt = Date.now();

      let pack;
      try {
        const resolved = await resolveRow(job.rows[job.cursor]);
        pack = await gather(resolved, { full: job.full });
      } catch (e) {
        if (
          e.code === ERROR.QUOTA_EXCEEDED ||
          e.code === ERROR.RATE_LIMITED ||
          e.code === ERROR.CHALLENGE_DETECTED
        ) {
          paused = true;
          break;
        }
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

      if (!(await hasQuotaLeft())) {
        paused = true;
        break;
      }
    }

    await set(K.researchPacks(job.jobId), packs);

    if (!paused && job.cursor >= job.total) {
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
