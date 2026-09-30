/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

import * as dashboard from '../../src/popup/tabs/dashboard.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { fmtDate } from '../../src/ui/dom.js';
import {
  CHALLENGE_PROMISE,
  CHALLENGE_TITLE,
  CHALLENGE_WAIT_MS,
  LINKEDIN_HOME_URL,
  waitUntilLine,
} from '../../src/ui/challenge.js';
import { stubEngine, flush, mountPoint, statusFixture, configFixture } from './helpers.js';

const ctx = { goTo: () => {}, refreshHeader: () => {} };

function engineWith(status = {}, config = {}, extra = {}) {
  return stubEngine({
    [ACTIONS.STATUS_GET]: statusFixture(status),
    [ACTIONS.CONFIG_GET]: configFixture(config),
    [ACTIONS.CONFIG_SET]: (params) => configFixture({ ...config, ...params }),
    ...extra,
  });
}

describe('Dashboard', () => {
  it('renders connection, quotas and campaign counts from status.get', async () => {
    engineWith();
    const host = mountPoint();

    await dashboard.mount(host, ctx);

    const text = host.textContent;
    expect(text).toContain('LinkedIn signed in');
    expect(text).toContain('inside work hours');
    expect(text).toContain('Engine v2.0.0');
    // one bar per contract quota bucket
    expect(host.querySelectorAll('.quota')).toHaveLength(4);
    expect(text).toContain('6 / 25');
    expect(text).toContain('Copilot');
    expect(text).toContain('2 items waiting for approval.');
  });

  it('shows the signed-out and bridge-off states', async () => {
    engineWith({ loggedIn: false, businessHours: false });
    const host = mountPoint();

    await dashboard.mount(host, ctx);

    expect(host.textContent).toContain('LinkedIn signed out');
    expect(host.textContent).toContain('bridge off');
    expect(host.textContent).toContain('outside hours');
  });

  it('shows the bridge as connected when the engine reports it', async () => {
    engineWith({ bridge: { enabled: true, connected: true, port: 47829 } });
    const host = mountPoint();

    await dashboard.mount(host, ctx);

    expect(host.textContent).toContain('bridge ✓ :47829');
  });

  it('asks for confirmation before turning Autopilot on, then calls config.set', async () => {
    const engine = engineWith();
    const host = mountPoint();
    await dashboard.mount(host, ctx);

    const toggle = [...host.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Switch to Autopilot'),
    );
    expect(toggle).toBeTruthy();
    toggle.click();
    await flush();

    // Nothing is written until the dialog is answered.
    expect(engine.countOf(ACTIONS.CONFIG_SET)).toBe(0);
    const dialog = document.querySelector('[data-testid="confirm-dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('without waiting for approval');

    dialog.querySelector('[data-testid="confirm-ok"]').click();
    await flush(8);

    expect(engine.paramsFor(ACTIONS.CONFIG_SET)).toEqual({ autopilot: true });
    expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
  });

  it('writes nothing when the confirmation is cancelled', async () => {
    const engine = engineWith();
    const host = mountPoint();
    await dashboard.mount(host, ctx);

    [...host.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Switch to Autopilot'))
      .click();
    await flush();
    document.querySelector('[data-testid="confirm-cancel"]').click();
    await flush(6);

    expect(engine.countOf(ACTIONS.CONFIG_SET)).toBe(0);
  });

  it('switches back to Copilot without a confirmation', async () => {
    const engine = engineWith({ autopilot: true }, { autopilot: true });
    const host = mountPoint();
    await dashboard.mount(host, ctx);

    [...host.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Switch to Copilot'))
      .click();
    await flush(8);

    expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
    expect(engine.paramsFor(ACTIONS.CONFIG_SET)).toEqual({ autopilot: false });
  });

  it('shows the challenge banner and clears it with config.set { clearChallenge }', async () => {
    const engine = engineWith({ challenge: { detectedAt: 1_757_000_000_000 } });
    const host = mountPoint();
    await dashboard.mount(host, ctx);

    const banner = host.querySelector('[data-testid="challenge-banner"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('security check');

    banner.querySelector('[data-testid="challenge-resume"]').click();
    await flush(8);

    expect(engine.paramsFor(ACTIONS.CONFIG_SET)).toEqual({ clearChallenge: true });
  });

  describe('the security-check banner', () => {
    const DETECTED_AT = 1_757_000_000_000;
    const banner = (host) => host.querySelector('[data-testid="challenge-banner"]');

    it('is not there when LinkedIn has asked for nothing', async () => {
      engineWith();
      const host = mountPoint();
      await dashboard.mount(host, ctx);

      expect(banner(host)).toBeNull();
    });

    it('says what is happening and gives three numbered steps', async () => {
      engineWith({ challenge: { detectedAt: DETECTED_AT } });
      const host = mountPoint();
      await dashboard.mount(host, ctx);

      const node = banner(host);
      expect(node.getAttribute('role')).toBe('alert');
      expect(node.querySelector('.banner-title').textContent).toBe(CHALLENGE_TITLE);
      expect(CHALLENGE_TITLE).toBe("LinkedIn is asking you to confirm it's you");

      const steps = [...node.querySelectorAll('ol.steps > li')];
      expect(steps).toHaveLength(3);
      expect(steps[0].textContent).toContain(
        'Open LinkedIn in this browser and complete the check yourself.',
      );
      expect(steps[1].textContent).toContain('at least 24 hours');
      expect(steps[2].textContent).toContain('Press "I\'ve done it — resume".');
      expect(node.textContent).toContain('Everything is paused');
    });

    it('promises, in so many words, never to solve or get round a check', async () => {
      engineWith({ challenge: { detectedAt: DETECTED_AT } });
      const host = mountPoint();
      await dashboard.mount(host, ctx);

      expect(banner(host).querySelector('[data-testid="challenge-promise"]').textContent).toBe(
        'This tool will never try to solve or get round a security check. That is on purpose.',
      );
      expect(CHALLENGE_PROMISE).toBe(
        'This tool will never try to solve or get round a security check. That is on purpose.',
      );
    });

    it('"Open LinkedIn" opens the home page in a new tab, and clears nothing', async () => {
      const engine = engineWith({ challenge: { detectedAt: DETECTED_AT } });
      const host = mountPoint();
      await dashboard.mount(host, ctx);

      const open = banner(host).querySelector('[data-testid="challenge-open-linkedin"]');
      expect(open.textContent).toBe('Open LinkedIn');
      open.click();
      await flush();

      expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://www.linkedin.com/feed/' });
      expect(LINKEDIN_HOME_URL).toBe('https://www.linkedin.com/feed/');
      // Opening LinkedIn is not dealing with the check. The pause stays.
      expect(engine.countOf(ACTIONS.CONFIG_SET)).toBe(0);
      expect(banner(host)).toBeTruthy();
    });

    it('shows when the suggested 24 hours is up', async () => {
      const detectedAt = Date.now() - 60 * 60 * 1000; // an hour ago
      engineWith({ challenge: { detectedAt } });
      const host = mountPoint();
      await dashboard.mount(host, ctx);

      const until = detectedAt + CHALLENGE_WAIT_MS;
      expect(CHALLENGE_WAIT_MS).toBe(24 * 60 * 60 * 1000);
      expect(banner(host).querySelector('[data-testid="challenge-wait-until"]').textContent).toBe(
        `That is ${fmtDate(until, { time: true })}.`,
      );
    });

    it('says so when the 24 hours has already passed — and still waits for the human', async () => {
      const engine = engineWith({ challenge: { detectedAt: DETECTED_AT } });
      const host = mountPoint();
      await dashboard.mount(host, ctx);

      const line = banner(host).querySelector('[data-testid="challenge-wait-until"]').textContent;
      expect(line).toBe(
        `That was ${fmtDate(DETECTED_AT + CHALLENGE_WAIT_MS, { time: true })}, so it has passed.`,
      );
      // Time passing clears nothing: the banner and its button are still there.
      expect(banner(host).querySelector('[data-testid="challenge-resume"]')).toBeTruthy();
      expect(engine.countOf(ACTIONS.CONFIG_SET)).toBe(0);
    });

    it('waitUntilLine has nothing to say without a detection time', () => {
      expect(waitUntilLine(undefined)).toBe('');
      expect(waitUntilLine(0)).toBe('');
    });

    it('"I\'ve done it — resume" is the only thing that lifts the pause, and the banner goes', async () => {
      let challenged = true;
      const engine = stubEngine({
        [ACTIONS.STATUS_GET]: () =>
          statusFixture(challenged ? { challenge: { detectedAt: DETECTED_AT } } : {}),
        [ACTIONS.CONFIG_GET]: configFixture(),
        [ACTIONS.CONFIG_SET]: (params) => {
          if (params.clearChallenge) challenged = false;
          return configFixture();
        },
      });
      const host = mountPoint();
      await dashboard.mount(host, ctx);

      const resume = banner(host).querySelector('[data-testid="challenge-resume"]');
      expect(resume.textContent).toBe("I've done it — resume");
      resume.click();
      await flush(8);

      expect(engine.allParamsFor(ACTIONS.CONFIG_SET)).toEqual([{ clearChallenge: true }]);
      expect(banner(host)).toBeNull();
    });
  });

  it('reports an offline engine instead of throwing', async () => {
    stubEngine({});
    const host = mountPoint();

    await dashboard.mount(host, ctx);

    expect(host.textContent).toContain('The engine did not answer');
    expect(host.querySelector('.err').hidden).toBe(false);
  });
});
