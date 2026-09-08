/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';

import * as dashboard from '../../src/popup/tabs/dashboard.js';
import { ACTIONS } from '../../src/lib/actions.js';
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

    [...banner.querySelectorAll('button')][0].click();
    await flush(8);

    expect(engine.paramsFor(ACTIONS.CONFIG_SET)).toEqual({ clearChallenge: true });
  });

  it('reports an offline engine instead of throwing', async () => {
    stubEngine({});
    const host = mountPoint();

    await dashboard.mount(host, ctx);

    expect(host.textContent).toContain('The engine did not answer');
    expect(host.querySelector('.err').hidden).toBe(false);
  });
});
