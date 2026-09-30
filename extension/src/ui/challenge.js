/**
 * What the popup shows when LinkedIn has asked for a security check.
 *
 * It is a set of instructions for a person, because a person is the only thing
 * that can deal with one. The toolkit's whole response to a check is to stop,
 * say so here, and wait: it does not solve one, it does not retry past one and
 * it does not look for another way in. Step three is a button a human presses,
 * and nothing else in the extension ever presses it for them.
 */

import { el, fmtDate } from './dom.js';
import { busyButton, button } from './components.js';

export const CHALLENGE_TITLE = "LinkedIn is asking you to confirm it's you";

/** Where "Open LinkedIn" goes: the ordinary home page, in an ordinary tab. */
export const LINKEDIN_HOME_URL = 'https://www.linkedin.com/feed/';

/** How long the banner suggests leaving automation alone after a check. */
export const CHALLENGE_WAIT_MS = 24 * 60 * 60 * 1000;

export const OPEN_LINKEDIN_LABEL = 'Open LinkedIn';
export const RESUME_LABEL = "I've done it — resume";

export const CHALLENGE_STEP_ONE = 'Open LinkedIn in this browser and complete the check yourself.';
export const CHALLENGE_STEP_TWO =
  'Leave it for a while. We suggest waiting at least 24 hours before automating again.';
export const CHALLENGE_STEP_THREE = `Press "${RESUME_LABEL}".`;

export const CHALLENGE_PROMISE =
  'This tool will never try to solve or get round a security check. That is on purpose.';

/**
 * When the suggested wait is over, as a sentence.
 *
 * @param {number} detectedAt epoch ms the check was first seen
 * @param {number} [now]
 */
export function waitUntilLine(detectedAt, now = Date.now()) {
  const from = Number(detectedAt);
  if (!Number.isFinite(from) || from <= 0) return '';
  const until = from + CHALLENGE_WAIT_MS;
  const when = fmtDate(until, { time: true });
  return until > now ? `That is ${when}.` : `That was ${when}, so it has passed.`;
}

/** Open LinkedIn's home page in a new tab. The human does the rest. */
export function openLinkedIn() {
  return chrome.tabs.create({ url: LINKEDIN_HOME_URL });
}

/**
 * The banner.
 *
 * @param {{detectedAt?: number}} challenge `status.challenge`
 * @param {{onResume: () => Promise<*>, error?: object, now?: number}} opts
 *   `onResume` is the existing clear action; the banner only offers it
 * @returns {HTMLElement}
 */
export function challengeBanner(challenge, opts = {}) {
  const detectedAt = challenge && challenge.detectedAt;

  const open = button(OPEN_LINKEDIN_LABEL, () => openLinkedIn(), { variant: 'ghost' });
  open.setAttribute('data-testid', 'challenge-open-linkedin');

  const resume = busyButton(RESUME_LABEL, () => opts.onResume(), {
    variant: 'primary',
    error: opts.error,
  });
  resume.setAttribute('data-testid', 'challenge-resume');

  return el(
    'div',
    { class: 'banner banner--bad banner--challenge', role: 'alert', 'data-testid': 'challenge-banner' },
    el('strong', { class: 'banner-title' }, CHALLENGE_TITLE),
    el(
      'p',
      null,
      `Detected ${fmtDate(detectedAt, { time: true })}. Everything is paused, and nothing will ` +
        'be sent until you have done these three things.',
    ),
    el(
      'ol',
      { class: 'steps' },
      el('li', null, el('span', null, CHALLENGE_STEP_ONE), open),
      el(
        'li',
        null,
        el(
          'span',
          null,
          CHALLENGE_STEP_TWO,
          ' ',
          el('span', { 'data-testid': 'challenge-wait-until' }, waitUntilLine(detectedAt, opts.now)),
        ),
      ),
      el('li', null, el('span', null, CHALLENGE_STEP_THREE), resume),
    ),
    el('p', { class: 'hint', 'data-testid': 'challenge-promise' }, CHALLENGE_PROMISE),
  );
}
