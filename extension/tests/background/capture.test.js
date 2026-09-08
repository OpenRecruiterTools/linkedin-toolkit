import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ACTIONS } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import * as capture from '../../src/background/capture.js';
import * as storage from '../../src/lib/storage.js';
import { seedSession, stubFetch } from '../helpers/net.js';

import profileView from '../fixtures/voyager/profileView.json';

const CAPTURED = {
  pageText: 'Ada Lovelace\nChief Analyst at Analytical Engines',
  photoDataUrl: 'data:image/jpeg;base64,AAA',
  sections: { about: 'Wrote the first algorithm.' },
};

let net;

beforeEach(() => {
  seedSession();
  net = stubFetch();
  capture.setSleepFn(() => Promise.resolve());
});

function answerCapture(response = CAPTURED) {
  chrome.tabs.sendMessage = vi.fn(async (tabId, message) => {
    chrome.__mock.tabMessages.push({ tabId, message });
    return response;
  });
}

describe('captureFull', () => {
  it('opens a background tab, captures, and closes it again', async () => {
    answerCapture();
    const out = await capture.captureFull({
      publicId: 'adalovelace',
      url: 'https://www.linkedin.com/in/adalovelace/',
    });

    expect(out).toEqual(CAPTURED);
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://www.linkedin.com/in/adalovelace/',
      active: false,
    });
    expect(chrome.__mock.tabMessages[0].message).toEqual({ type: 'CAPTURE_FULL' });
    expect(chrome.tabs.remove).toHaveBeenCalled();
  });

  it('reuses a tab that is already on that profile and leaves it open', async () => {
    const existing = await chrome.tabs.create({
      url: 'https://www.linkedin.com/in/adalovelace/details/experience/',
      active: true,
    });
    chrome.tabs.create.mockClear();
    answerCapture();

    const out = await capture.captureFull({ publicId: 'adalovelace' });
    expect(out.pageText).toBe(CAPTURED.pageText);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.__mock.tabMessages[0].tabId).toBe(existing.id);
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  it('does not confuse a different profile for the one asked for', async () => {
    await chrome.tabs.create({ url: 'https://www.linkedin.com/in/bobbright/', active: true });
    chrome.tabs.create.mockClear();
    answerCapture();

    await capture.captureFull({ publicId: 'adalovelace' });
    expect(chrome.tabs.create).toHaveBeenCalled();
  });

  it('returns null when the content script never answers', async () => {
    chrome.tabs.sendMessage = vi.fn(async () => {
      throw new Error('Receiving end does not exist');
    });
    expect(await capture.captureFull({ publicId: 'adalovelace' })).toBe(null);
    expect(chrome.tabs.remove).toHaveBeenCalled();
  });

  it('returns null without a publicId', async () => {
    expect(await capture.captureFull({})).toBe(null);
    expect(await capture.captureFull(null)).toBe(null);
  });
});

describe('profile.get { full: true }', () => {
  it('merges the capture into the Profile and stores it', async () => {
    answerCapture();
    net.push(profileView);

    const res = await handle(ACTIONS.PROFILE_GET, { publicId: 'adalovelace', full: true });
    expect(res.ok).toBe(true);
    expect(res.data.fullName).toBe('Ada Lovelace');
    expect(res.data.pageText).toBe(CAPTURED.pageText);
    expect(res.data.photoDataUrl).toBe(CAPTURED.photoDataUrl);
    expect(res.data.sections.about).toBe('Wrote the first algorithm.');

    const stored = await storage.getStoredProfile('adalovelace');
    expect(stored.pageText).toBe(CAPTURED.pageText);
  });

  it('does not capture unless full is asked for', async () => {
    answerCapture();
    net.push(profileView);
    const res = await handle(ACTIONS.PROFILE_GET, { publicId: 'adalovelace' });
    expect(res.data.pageText).toBeUndefined();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('still returns the API profile when the capture fails', async () => {
    chrome.tabs.sendMessage = vi.fn(async () => null);
    net.push(profileView);
    const res = await handle(ACTIONS.PROFILE_GET, { publicId: 'adalovelace', full: true });
    expect(res.ok).toBe(true);
    expect(res.data.fullName).toBe('Ada Lovelace');
    expect(res.data.pageText).toBeUndefined();
  });
});
