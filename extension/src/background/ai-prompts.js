/**
 * LinkedIn Toolkit — AI prompts.
 *
 * One prompt per contract task. Every prompt is fed *only* facts that came out
 * of LinkedIn, and every prompt forbids inventing anything: an opener that
 * makes up a shared connection is worse than no opener.
 */

const NO_INVENTION =
  'Use only the facts given. Never invent employers, dates, mutual connections, ' +
  'achievements or shared history. If a fact is missing, leave it out.';

function profileFacts(profile = {}) {
  const lines = [
    ['Name', profile.fullName],
    ['Headline', profile.headline],
    ['Title', profile.title],
    ['Company', profile.company],
    ['Location', profile.location],
    ['Industry', profile.industry],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);

  const experience = (profile.experience || [])
    .slice(0, 3)
    .map((e) => `- ${e.title || ''}${e.company ? ` at ${e.company}` : ''}`)
    .filter((l) => l.trim() !== '-');
  if (experience.length) lines.push('Recent roles:', ...experience);

  const education = (profile.education || [])
    .slice(0, 2)
    .map((e) => `- ${e.school || ''}${e.degree ? `, ${e.degree}` : ''}`)
    .filter((l) => l.trim() !== '-');
  if (education.length) lines.push('Education:', ...education);

  if (profile.skills && profile.skills.length) {
    lines.push(`Skills: ${profile.skills.slice(0, 10).join(', ')}`);
  }
  if (profile.signals && profile.signals.length) {
    lines.push(`Signals: ${profile.signals.join(', ')}`);
  }
  return lines.join('\n');
}

const BUILDERS = {
  opener: (input) => ({
    system:
      `You write the first line of a LinkedIn connection request. ` +
      `Keep it under 180 characters — LinkedIn refuses an invitation note over 200, and a ` +
      `margin leaves room for a long name — in a ${input.tone || 'friendly, professional'} tone. ` +
      `One specific, verifiable reason for reaching out. No flattery, no buzzwords, ` +
      `no "I came across your profile". ${NO_INVENTION} Reply with the opener only.`,
    user: `Profile:\n${profileFacts(input.profile)}${
      input.context ? `\n\nWhat I do: ${input.context}` : ''
    }`,
    maxTokens: 300,
  }),

  summary: (input) => ({
    system:
      `You summarise a LinkedIn profile for a recruiter or founder in three short ` +
      `sentences: who they are, what they are responsible for, and why they might ` +
      `be worth talking to. ${NO_INVENTION}`,
    user: `Profile:\n${profileFacts(input.profile)}${
      input.pageText ? `\n\nProfile page text:\n${String(input.pageText).slice(0, 4000)}` : ''
    }`,
    maxTokens: 400,
  }),

  sentiment: (input) => ({
    system:
      `You classify a reply to a cold LinkedIn message. Respond with JSON only: ` +
      `{"sentiment":"positive"|"neutral"|"negative","intent":"<short snake_case label>"}. ` +
      `positive = interest or a willingness to talk; negative = a refusal or an ask to stop; ` +
      `neutral = anything else. Typical intents: book_call, wants_info, not_now, ` +
      `not_interested, unsubscribe, wrong_person, referral.`,
    user: `Reply:\n${input.message || input.body || ''}`,
    maxTokens: 120,
  }),

  comment: (input) => ({
    system:
      `You write one short LinkedIn comment (under 200 characters) that adds a ` +
      `specific thought or a genuine question. Never praise for its own sake, never ` +
      `pitch, never use emoji. ${NO_INVENTION} Reply with the comment only.`,
    user: `Post:\n${input.post || ''}${
      input.profile ? `\n\nAuthor:\n${profileFacts(input.profile)}` : ''
    }`,
    maxTokens: 200,
  }),

  score: (input) => ({
    system:
      `You score how well a person matches a brief. Respond with JSON only: ` +
      `{"score":<integer 0-100>,"reason":"<one sentence>"}. 0 means no match at all, ` +
      `100 means an exact match on the stated criteria. ${NO_INVENTION}`,
    user: `Brief:\n${input.brief || ''}\n\nProfile:\n${profileFacts(input.profile)}`,
    maxTokens: 200,
  }),
};

/**
 * Build the prompt for one task.
 * @returns {{system: string, user: string, maxTokens: number}}
 */
export function promptFor(task, input = {}) {
  const build = BUILDERS[task];
  if (!build) throw new Error(`No prompt for task: ${task}`);
  return build(input);
}

/* ================================================================== */
/*  Output parsing                                                    */
/* ================================================================== */

function firstJson(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

const SENTIMENTS = ['positive', 'negative', 'neutral'];

/**
 * Shape a model's reply for the task. `sentiment` and `score` become objects;
 * every other task is a trimmed string.
 */
export function parseOutput(task, text) {
  const raw = String(text || '').trim();

  if (task === 'sentiment') {
    const json = firstJson(raw);
    if (json && SENTIMENTS.includes(json.sentiment)) {
      return { sentiment: json.sentiment, intent: json.intent || '' };
    }
    const lower = raw.toLowerCase();
    const found = SENTIMENTS.find((s) => lower.includes(s)) || 'neutral';
    return { sentiment: found, intent: (json && json.intent) || '' };
  }

  if (task === 'score') {
    const json = firstJson(raw);
    if (json && Number.isFinite(Number(json.score))) {
      return { score: clampScore(json.score), reason: json.reason || '' };
    }
    const match = raw.match(/\d{1,3}/);
    return {
      score: match ? clampScore(match[0]) : 0,
      reason: match ? raw.slice(raw.indexOf(match[0]) + match[0].length).replace(/^\W+/, '') : '',
    };
  }

  return raw;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}
