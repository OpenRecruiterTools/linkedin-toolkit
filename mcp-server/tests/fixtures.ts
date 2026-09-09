/** Small, offline fixtures shaped exactly like the contract types. */
import type { Handlers } from './fakeExtension.js';

export const ada = {
  publicId: 'ada-lovelace',
  url: 'https://www.linkedin.com/in/ada-lovelace/',
  firstName: 'Ada',
  lastName: 'Lovelace',
  fullName: 'Ada Lovelace',
  headline: 'Head of Analytical Engines',
  title: 'Head of Analytical Engines',
  company: 'Difference Engine Ltd',
  location: 'London, United Kingdom',
  connectionDegree: 2 as const,
  capturedAt: 1_700_000_000_000,
  source: 'search',
};

export const grace = {
  publicId: 'grace-hopper',
  url: 'https://www.linkedin.com/in/grace-hopper/',
  firstName: 'Grace',
  lastName: 'Hopper',
  fullName: 'Grace Hopper',
  headline: 'Compiler Architect',
  company: 'Naval Systems',
  location: 'Arlington, Virginia',
  connectionDegree: 1 as const,
  capturedAt: 1_700_000_100_000,
  source: 'search',
};

export const acme = {
  universalName: 'difference-engine',
  name: 'Difference Engine Ltd',
  url: 'https://www.linkedin.com/company/difference-engine/',
  industry: 'Software Development',
  size: '51-200',
  hq: 'London',
  capturedAt: 1_700_000_200_000,
};

export const status = {
  connected: true as const,
  extensionVersion: '2.0.0',
  loggedIn: true,
  autopilot: false,
  businessHours: true,
  quotas: {
    invite: { hourlyUsed: 2, hourlyCap: 20, dailyUsed: 12, dailyCap: 100, nextAllowedAt: 0 },
    message: { hourlyUsed: 0, hourlyCap: 20, dailyUsed: 4, dailyCap: 150, nextAllowedAt: 0 },
    visit: { hourlyUsed: 5, hourlyCap: 50, dailyUsed: 30, dailyCap: 500, nextAllowedAt: 0 },
    search: { hourlyUsed: 1, hourlyCap: 50, dailyUsed: 40, dailyCap: 1000, nextAllowedAt: 0 },
  },
  queue: { pending: 1 },
  campaigns: { active: 1, paused: 0 },
};

export const prospectList = {
  listId: 'list_1',
  name: 'Engineering leaders',
  tags: ['q3'],
  createdAt: 1_700_000_000_000,
  count: 2,
};

export const campaign = {
  campaignId: 'camp_1',
  name: 'Warm intro',
  steps: [
    { type: 'view' as const },
    { type: 'wait' as const, waitMs: 86_400_000 },
    { type: 'invite' as const, note: 'Hi {{firstName}}' },
  ],
  status: 'active' as const,
  createdAt: 1_700_000_000_000,
  settings: { stopOnReply: true, autopilot: false },
  stats: { enrolled: 2, sent: 1, accepted: 0, replied: 0, positive: 0, byStep: { '0': { sent: 1 } } },
};

export const queueItem = {
  id: 'q_1',
  action: 'outreach.invite' as const,
  params: { publicId: 'ada-lovelace', note: 'Hi Ada' },
  origin: 'mcp' as const,
  profile: ada,
  createdAt: 1_700_000_300_000,
  status: 'pending' as const,
};

/** The same item after the sender could not send it. */
export const failedQueueItem = {
  ...queueItem,
  id: 'q_9',
  status: 'failed' as const,
  result: {
    error: {
      code: 'LINKEDIN_ERROR',
      message: 'LinkedIn refused the invitation (CANT_RESEND_YET): already pending.',
    },
  },
};

export const pack = {
  row: { name: 'Ada Lovelace', company: 'Difference Engine Ltd' },
  resolved: {
    row: { name: 'Ada Lovelace' },
    kind: 'person' as const,
    publicId: 'ada-lovelace',
    confidence: 0.94,
  },
  profile: ada,
  company: acme,
  recentPosts: [
    { url: 'https://www.linkedin.com/feed/update/1/', text: 'Shipping v2', likes: 12, comments: 3 },
  ],
  mutualConnections: 4,
  connectionStatus: 'none' as const,
  signals: ['posted in the last 30 days', 'shared connection'],
  markdown: '# Ada Lovelace\n\nHead of Analytical Engines at Difference Engine Ltd.\n',
  csvRow: { name: 'Ada Lovelace', publicId: 'ada-lovelace', company: 'Difference Engine Ltd' },
};

export const thread = {
  threadId: 'thread_1',
  participants: [{ publicId: 'ada-lovelace', fullName: 'Ada Lovelace' }],
  lastMessageAt: 1_700_000_400_000,
  unread: true,
  snippet: 'Sounds interesting, tell me more',
  sentiment: 'positive' as const,
};

export const message = {
  messageId: 'msg_1',
  threadId: 'thread_1',
  fromPublicId: 'ada-lovelace',
  body: 'Sounds interesting, tell me more',
  sentAt: 1_700_000_400_000,
};

export const config = {
  minDelayMs: 5000,
  maxDelayMs: 15000,
  hourlyCap: 20,
  dailyInviteCap: 100,
  dailyMessageCap: 150,
  dailyVisitCap: 500,
  dailySearchCap: 1000,
  businessHoursOnly: true,
  businessStart: 9,
  businessEnd: 18,
  weekdaysOnly: true,
  autopilot: false,
  accountPreset: 'free' as const,
  warmup: { enabled: true, days: 14 },
  ai: { provider: 'none' as const },
  bridge: { enabled: true, port: 47829 },
};

/** A handler map covering everything the tests exercise. */
export function defaultHandlers(): Handlers {
  return {
    'status.get': () => status,
    'config.get': () => config,
    'config.set': (params: any) => ({ ...config, ...params }),
    'search.people': (params: any) => ({
      profiles: [ada, grace].slice(0, params?.count ?? 2),
      total: 2,
    }),
    'profile.get': (params: any) => (params?.publicId === 'grace-hopper' ? grace : ada),
    'profile.export': () => ({ profiles: [ada, grace], failed: [] }),
    'company.get': () => acme,
    'company.employees': () => ({ profiles: [ada] }),
    'post.engagers': () => ({ engagers: [{ ...ada, reaction: 'like' }] }),
    'group.members': () => ({ profiles: [grace] }),
    'event.attendees': () => ({ profiles: [grace] }),
    'network.connections': () => ({ profiles: [grace] }),
    'network.followers': () => ({ profiles: [grace] }),
    'network.status': (params: any) => ({
      statuses: Object.fromEntries((params?.publicIds ?? []).map((id: string) => [id, 'none'])),
    }),
    'network.unfollowCount': () => ({ count: 3, sample: ['Ada Lovelace'] }),
    'network.unfollowAll': () => ({
      unfollowed: 3,
      attempted: 3,
      names: ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'],
      stopped: 'end',
    }),
    'outreach.view': () => ({ status: 'sent', sentAt: 1_700_000_500_000 }),
    'outreach.follow': () => ({ status: 'sent', sentAt: 1_700_000_500_000 }),
    'outreach.invite': (params: any) =>
      params?.dry_run
        ? { status: 'dryRun', wouldSend: params }
        : { status: 'queued', queueId: 'q_2' },
    'outreach.message': () => ({ status: 'queued', queueId: 'q_3' }),
    'outreach.inmail': () => ({ status: 'queued', queueId: 'q_4' }),
    'outreach.like': () => ({ status: 'sent', sentAt: 1_700_000_500_000 }),
    'outreach.comment': () => ({ status: 'queued', queueId: 'q_5' }),
    'inbox.threads': () => ({ threads: [thread] }),
    'inbox.messages': () => ({ messages: [message] }),
    'inbox.export': () => ({ threads: [thread], messages: [message] }),
    'list.create': (params: any) => ({ ...prospectList, name: params?.name ?? prospectList.name }),
    'list.getAll': () => ({ lists: [prospectList] }),
    'list.get': () => prospectList,
    'list.add': () => ({ added: 2, duplicates: 0 }),
    'list.remove': () => ({ removed: 1 }),
    'list.members': () => ({
      members: [
        { publicId: ada.publicId, profile: ada, addedAt: 1, tags: [], contactedBefore: false },
      ],
      total: 1,
    }),
    'list.delete': () => ({ ok: true }),
    'list.importCsv': () => ({ added: 1, duplicates: 0, invalid: 0 }),
    'campaign.create': (params: any) => ({ ...campaign, name: params?.name ?? campaign.name }),
    'campaign.getAll': () => ({ campaigns: [campaign] }),
    'campaign.get': () => campaign,
    'campaign.enroll': () => ({ enrolled: 2, skipped: 0 }),
    'campaign.pause': () => ({ ...campaign, status: 'paused' }),
    'campaign.resume': () => campaign,
    'campaign.delete': () => ({ ...campaign, status: 'completed' }),
    'campaign.tick': () => ({ executed: 1, queued: 0 }),
    'queue.list': (params: any) =>
      params?.status === 'failed' ? { items: [failedQueueItem] } : { items: [queueItem] },
    'queue.approve': (params: any) => ({ approved: (params?.ids ?? []).length }),
    'queue.reject': (params: any) => ({ rejected: (params?.ids ?? []).length }),
    'ai.complete': () => ({ output: 'Hi Ada', provider: 'none', model: 'stub' }),
    'export.csv': () => ({ csv: 'publicId,fullName\nada-lovelace,Ada Lovelace\n', filename: 'p.csv' }),
    'research.resolve': (params: any) => ({
      resolved: (params?.rows ?? []).map((row: any) => ({
        row,
        kind: 'person',
        publicId: 'ada-lovelace',
        confidence: 0.9,
      })),
    }),
    'research.pack': (params: any) => ({
      jobId: 'job_1',
      total: (params?.rows ?? []).length,
      etaMs: 1000,
    }),
    'research.get': () => ({ jobId: 'job_1', status: 'completed', done: 1, total: 1, packs: [pack] }),
    'sync.pull': () => ({
      profiles: [ada, grace],
      lists: [prospectList],
      listMembers: [
        { listId: 'list_1', publicId: 'ada-lovelace', addedAt: 1, tags: [], contactedBefore: false },
      ],
      campaigns: [campaign],
      enrollments: [
        { campaignId: 'camp_1', publicId: 'ada-lovelace', stepIndex: 0, status: 'active' },
      ],
      actions: [
        { id: 'a_1', action: 'outreach.view', publicId: 'ada-lovelace', at: 1, status: 'sent' },
      ],
      threads: [thread],
      messages: [message],
      events: [{ id: 'e_1', event: 'reply_received', payload: { threadId: 'thread_1' }, at: 1 }],
    }),
  };
}
