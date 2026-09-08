/**
 * Dashboard tab — the at-a-glance state of the account and the engine.
 *
 * Reads `status.get` and `config.get`; writes only through `config.set`.
 */

import { el, render, fmtDate, fmtNumber, fmtDuration } from '../../ui/dom.js';
import { call, ApiError } from '../../ui/api.js';
import { ACTIONS } from '../../lib/actions.js';
import {
  card,
  pill,
  stat,
  quotaBar,
  errorLine,
  busyButton,
  button,
  confirmDialog,
  empty,
} from '../../ui/components.js';

export const id = 'dashboard';
export const label = 'Dashboard';

/**
 * Bridge state is reported by the engine as `status.bridge`
 * (`{ enabled, connected, port }`) when the bridge module is present; until
 * then we fall back to what the user configured.
 */
function bridgePill(status, config) {
  const bridge = status.bridge || {};
  const enabled = bridge.enabled !== undefined ? bridge.enabled : Boolean(config.bridge?.enabled);
  if (!enabled) return pill('bridge off', 'neutral');
  if (bridge.connected) return pill(`bridge ✓ :${bridge.port || config.bridge?.port}`, 'good');
  return pill('bridge not connected', 'warn');
}

export async function mount(container, ctx) {
  const err = errorLine();

  async function draw() {
    let status;
    let config;
    try {
      [status, config] = await Promise.all([
        call(ACTIONS.STATUS_GET, {}),
        call(ACTIONS.CONFIG_GET, {}),
      ]);
    } catch (e) {
      render(container, [
        err,
        empty('The engine did not answer. Reload the extension and try again.'),
      ]);
      err.show(e instanceof ApiError ? e : new Error(e.message));
      return;
    }

    const quotas = status.quotas || {};
    const campaigns = status.campaigns || { active: 0, paused: 0 };
    const pending = status.queue ? status.queue.pending || 0 : 0;
    const nodes = [err];

    /* ---- challenge banner ---------------------------------------- */
    if (status.challenge) {
      nodes.push(
        el(
          'div',
          { class: 'banner banner--bad', 'data-testid': 'challenge-banner' },
          el(
            'div',
            null,
            el('strong', null, 'LinkedIn asked for a security check. '),
            `Detected ${fmtDate(status.challenge.detectedAt, { time: true })}. ` +
              'Everything is paused until you clear it in a LinkedIn tab.',
          ),
          busyButton(
            "I've cleared it",
            async () => {
              await call(ACTIONS.CONFIG_SET, { clearChallenge: true });
              await draw();
            },
            { variant: 'primary', error: err },
          ),
        ),
      );
    }

    /* ---- backoff / business hours -------------------------------- */
    if (status.backoffUntil && status.backoffUntil > Date.now()) {
      nodes.push(
        el(
          'div',
          { class: 'banner banner--warn' },
          `Backing off for ${fmtDuration(status.backoffUntil - Date.now())} after a LinkedIn ` +
            'rate-limit response.',
        ),
      );
    }

    /* ---- connection ---------------------------------------------- */
    nodes.push(
      card(
        'Connection',
        {
          actions: button('Refresh', () => draw(), { variant: 'ghost', title: 'Reload status' }),
        },
        el(
          'div',
          { class: 'badges' },
          status.loggedIn ? pill('LinkedIn signed in', 'good') : pill('LinkedIn signed out', 'bad'),
          bridgePill(status, config),
          status.businessHours ? pill('inside work hours', 'good') : pill('outside hours', 'warn'),
          config.warmup && config.warmup.enabled ? pill('warm-up on', 'info') : null,
        ),
        status.loggedIn
          ? null
          : el(
              'p',
              { class: 'hint' },
              'Open linkedin.com and sign in — the toolkit only ever acts inside your own session.',
            ),
        el('p', { class: 'hint' }, `Engine v${status.extensionVersion || '—'}`),
      ),
    );

    /* ---- mode ----------------------------------------------------- */
    const autopilot = Boolean(status.autopilot);
    nodes.push(
      card(
        'Mode',
        { hint: 'Copilot queues every agent-originated write for your approval.' },
        el(
          'div',
          { class: 'row' },
          el(
            'div',
            null,
            el('div', { class: 'item-title' }, autopilot ? 'Autopilot' : 'Copilot'),
            el(
              'div',
              { class: 'item-sub' },
              autopilot
                ? 'Agents send invites and messages without asking.'
                : 'Nothing is sent until you approve it in the Queue tab.',
            ),
          ),
          busyButton(
            autopilot ? 'Switch to Copilot' : 'Switch to Autopilot',
            async () => {
              if (!autopilot) {
                const okToGo = await confirmDialog({
                  title: 'Turn on Autopilot?',
                  message:
                    'Agents will then send invites, messages and comments from your account ' +
                    'without waiting for approval. Hard daily caps still apply.',
                  confirmLabel: 'Turn on Autopilot',
                  danger: true,
                });
                if (!okToGo) return;
              }
              await call(ACTIONS.CONFIG_SET, { autopilot: !autopilot });
              await draw();
              if (ctx && ctx.refreshHeader) await ctx.refreshHeader();
            },
            { variant: autopilot ? 'ghost' : 'primary', error: err },
          ),
        ),
      ),
    );

    /* ---- quotas ---------------------------------------------------- */
    nodes.push(
      card(
        'Today',
        { hint: 'Hard caps live in the extension and cannot be raised by any client.' },
        ['invite', 'message', 'visit', 'search'].map((kind) => quotaBar(kind, quotas[kind] || {})),
      ),
    );

    /* ---- work ------------------------------------------------------ */
    nodes.push(
      card(
        'Work in flight',
        el(
          'div',
          { class: 'stats' },
          stat('Active', fmtNumber(campaigns.active || 0), 'good'),
          stat('Paused', fmtNumber(campaigns.paused || 0)),
          stat('Queued', fmtNumber(pending), pending > 0 ? 'warn' : undefined),
        ),
        pending > 0
          ? el(
              'div',
              { class: 'row' },
              el(
                'span',
                { class: 'hint' },
                `${fmtNumber(pending)} item${pending === 1 ? '' : 's'} waiting for approval.`,
              ),
              button('Open queue', () => ctx.goTo('queue'), { variant: 'primary' }),
            )
          : el('p', { class: 'hint' }, 'Nothing is waiting for approval.'),
      ),
    );

    render(container, nodes);
  }

  await draw();
}
