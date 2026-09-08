/**
 * The demo dataset behind `lit serve --fake`.
 *
 * Everyone and every company here is invented. No real person, company, URL or
 * LinkedIn record appears, and nothing in this file ever reaches the network —
 * it exists so the README recording, the examples and anyone evaluating the
 * toolkit can drive every command without a LinkedIn account.
 */
import type { FakeHandlers } from './fake-extension.js';

export const FAKE_BANNER = 'FAKE MODE — no LinkedIn calls are made; demo data only';

const CAPTURED_AT = Date.UTC(2026, 8, 1, 9, 0, 0);
const DAY = 86_400_000;

type Seed = [
  first: string,
  last: string,
  title: string,
  company: string,
  location: string,
  degree: 1 | 2 | 3,
];

/** 25 invented people at invented companies. */
const SEEDS: Seed[] = [
  ['Marisol', 'Adeyemi', 'VP Platform Engineering', 'Northwind Robotics', 'London, United Kingdom', 2],
  ['Tobias', 'Reinhardt', 'Head of Infrastructure', 'Bellhaven Analytics', 'Berlin, Germany', 2],
  ['Priya', 'Ranganathan', 'Director of Engineering', 'Quillstone Systems', 'Manchester, United Kingdom', 1],
  ['Émile', 'Ducharme', 'Staff Site Reliability Engineer', 'Fernwood Labs', 'Montréal, Canada', 3],
  ['Nadia', 'Karimov', 'CTO', 'Marrowgate Health', 'Amsterdam, Netherlands', 2],
  ['Callum', 'Whitfield', 'Engineering Manager, Payments', 'Tidewater Logistics', 'Bristol, United Kingdom', 2],
  ['Ingrid', 'Halvorsen', 'Principal Engineer', 'Ashgrove Bioscience', 'Oslo, Norway', 3],
  ['Rafael', 'Sotomayor', 'Head of Data Platform', 'Calderon Freight', 'Madrid, Spain', 2],
  ['Wenjun', 'Xiao', 'Director, Developer Experience', 'Pinemark Software', 'Dublin, Ireland', 1],
  ['Anneke', 'Vos', 'VP Engineering', 'Verity Loop', 'Rotterdam, Netherlands', 2],
  ['Dmitri', 'Barinov', 'Lead Backend Engineer', 'Northwind Robotics', 'Warsaw, Poland', 3],
  ['Sofia', 'Marchetti', 'Head of Security Engineering', 'Bellhaven Analytics', 'Milan, Italy', 2],
  ['Oluwaseun', 'Bakare', 'Engineering Director', 'Quillstone Systems', 'Lagos, Nigeria', 2],
  ['Hana', 'Kobayashi', 'Staff Engineer, Platform', 'Fernwood Labs', 'Copenhagen, Denmark', 3],
  ['Lucas', 'Fenwick', 'Chief Architect', 'Marrowgate Health', 'Edinburgh, United Kingdom', 1],
  ['Amara', 'Nwosu', 'Head of SRE', 'Tidewater Logistics', 'Lisbon, Portugal', 2],
  ['Bjorn', 'Lindqvist', 'VP Technology', 'Ashgrove Bioscience', 'Stockholm, Sweden', 2],
  ['Yasmin', 'Haddad', 'Director of Cloud Platform', 'Calderon Freight', 'Paris, France', 3],
  ['Gareth', 'Pemberton', 'Engineering Lead, Core Services', 'Pinemark Software', 'Cardiff, United Kingdom', 2],
  ['Elena', 'Vasquez', 'Head of Infrastructure', 'Verity Loop', 'Barcelona, Spain', 2],
  ['Kofi', 'Mensah', 'Principal Platform Engineer', 'Northwind Robotics', 'Accra, Ghana', 3],
  ['Astrid', 'Bergström', 'CTO', 'Bellhaven Analytics', 'Helsinki, Finland', 2],
  ['Ravi', 'Chandrasekaran', 'Director of Engineering', 'Quillstone Systems', 'Bengaluru, India', 2],
  ['Freya', 'Ashworth', 'Head of Developer Platform', 'Fernwood Labs', 'Leeds, United Kingdom', 1],
  ['Mateo', 'Iglesias', 'VP Infrastructure', 'Marrowgate Health', 'Valencia, Spain', 2],
];

const slug = (first: string, last: string): string =>
  `${first}-${last}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-');

const companySlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export type FakeProfile = ReturnType<typeof makeProfile>;

function makeProfile(seed: Seed, index: number) {
  const [firstName, lastName, title, company, location, connectionDegree] = seed;
  const publicId = slug(firstName, lastName);
  return {
    publicId,
    url: `https://www.linkedin.com/in/${publicId}/`,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    headline: `${title} at ${company}`,
    title,
    company,
    companyUrn: `urn:li:company:${companySlug(company)}`,
    location,
    industry: 'Software Development',
    connectionDegree,
    capturedAt: CAPTURED_AT + index * 1000,
    source: 'search',
  };
}

export const FAKE_PROFILES = SEEDS.map(makeProfile);

const COMPANY_NAMES = [...new Set(SEEDS.map((seed) => seed[3]))];

export const FAKE_COMPANIES = COMPANY_NAMES.map((name, index) => ({
  universalName: companySlug(name),
  name,
  url: `https://www.linkedin.com/company/${companySlug(name)}/`,
  industry: 'Software Development',
  size: ['51-200', '201-500', '501-1,000', '1,001-5,000'][index % 4],
  hq: FAKE_PROFILES.find((profile) => profile.company === name)?.location ?? 'London, United Kingdom',
  website: `https://${companySlug(name)}.example`,
  description: `${name} is a fictional company used for the LinkedIn Toolkit demo dataset.`,
  followerCount: 1200 + index * 830,
  capturedAt: CAPTURED_AT,
}));

const profileFor = (publicId: string) =>
  FAKE_PROFILES.find((profile) => profile.publicId === publicId);

type DemoStep = {
  type: 'view' | 'follow' | 'invite' | 'message' | 'inmail' | 'like' | 'comment' | 'wait' | 'branch';
  note?: string;
  body?: string;
  waitMs?: number;
};

type DemoCampaign = {
  campaignId: string;
  name: string;
  steps: DemoStep[];
  status: 'active' | 'paused' | 'completed';
  createdAt: number;
  settings: { stopOnReply: boolean; autopilot: boolean };
  stats: {
    enrolled: number;
    sent: number;
    accepted: number;
    replied: number;
    positive: number;
    byStep: Record<string, Record<string, number>>;
  };
};

/** The mutable half of the demo: lists, campaigns, the queue and the inbox. */
export type DemoState = ReturnType<typeof createDemoState>;

export function createDemoState() {
  const lists = [
    {
      listId: 'list_platform_leads',
      name: 'Platform engineering leads',
      tags: ['platform', 'q3'],
      createdAt: CAPTURED_AT - 14 * DAY,
      members: FAKE_PROFILES.slice(0, 10).map((profile, index) => ({
        publicId: profile.publicId,
        profile,
        addedAt: CAPTURED_AT - (14 - index) * DAY,
        tags: ['platform'],
        contactedBefore: index < 3,
        signals: index % 3 === 0 ? ['posted in the last 30 days'] : [],
      })),
    },
    {
      listId: 'list_dach_outbound',
      name: 'Q3 outbound — DACH',
      tags: ['dach'],
      createdAt: CAPTURED_AT - 9 * DAY,
      members: FAKE_PROFILES.filter((profile) =>
        ['Germany', 'Netherlands', 'Poland', 'Sweden'].some((country) =>
          profile.location.endsWith(country),
        ),
      ).map((profile, index) => ({
        publicId: profile.publicId,
        profile,
        addedAt: CAPTURED_AT - (9 - index) * DAY,
        tags: ['dach'],
        contactedBefore: false,
        signals: [],
      })),
    },
    {
      listId: 'list_event_warm',
      name: 'Warm intros from PlatformConf',
      tags: ['event', 'warm'],
      createdAt: CAPTURED_AT - 4 * DAY,
      members: FAKE_PROFILES.slice(18, 25).map((profile, index) => ({
        publicId: profile.publicId,
        profile,
        addedAt: CAPTURED_AT - (4 - index * 0.2) * DAY,
        tags: ['event'],
        contactedBefore: false,
        signals: ['attended PlatformConf'],
      })),
    },
  ];

  const campaigns: DemoCampaign[] = [
    {
      campaignId: 'camp_platform_intro',
      name: 'Platform leads — warm intro',
      steps: [
        { type: 'view' as const },
        { type: 'wait' as const, waitMs: 2 * DAY },
        { type: 'invite' as const, note: 'Hi {{firstName}}, enjoyed your take on platform tooling.' },
        { type: 'wait' as const, waitMs: 3 * DAY },
        { type: 'message' as const, body: 'Thanks for connecting, {{firstName}} — worth a chat?' },
      ],
      status: 'active' as 'active' | 'paused' | 'completed',
      createdAt: CAPTURED_AT - 12 * DAY,
      settings: { stopOnReply: true, autopilot: false },
      stats: {
        enrolled: 10,
        sent: 24,
        accepted: 6,
        replied: 3,
        positive: 2,
        byStep: { '0': { sent: 10 }, '2': { sent: 10, accepted: 6 }, '4': { sent: 4, replied: 3 } },
      },
    },
    {
      campaignId: 'camp_dach_q3',
      name: 'Q3 outbound — DACH',
      steps: [
        { type: 'follow' as const },
        { type: 'wait' as const, waitMs: DAY },
        { type: 'invite' as const, note: 'Hallo {{firstName}}, kurze Frage zu eurem Platform-Team.' },
      ],
      status: 'paused' as 'active' | 'paused' | 'completed',
      createdAt: CAPTURED_AT - 6 * DAY,
      settings: { stopOnReply: true, autopilot: false },
      stats: {
        enrolled: 6,
        sent: 9,
        accepted: 2,
        replied: 1,
        positive: 0,
        byStep: { '0': { sent: 6 }, '2': { sent: 3, accepted: 2 } },
      },
    },
  ];

  const queue = [
    {
      id: 'q_pending_1',
      action: 'outreach.invite' as const,
      params: {
        publicId: 'ingrid-halvorsen',
        note: 'Hi Ingrid, your write-up on build caching was excellent — worth connecting.',
      },
      origin: 'campaign' as const,
      profile: profileFor('ingrid-halvorsen'),
      createdAt: CAPTURED_AT - 2 * 3_600_000,
      status: 'pending' as const,
    },
    {
      id: 'q_pending_2',
      action: 'outreach.message' as const,
      params: {
        publicId: 'priya-ranganathan',
        body: 'Thanks for connecting, Priya — are you still hiring on the platform side?',
      },
      origin: 'mcp' as const,
      profile: profileFor('priya-ranganathan'),
      createdAt: CAPTURED_AT - 3_600_000,
      status: 'pending' as const,
    },
    {
      id: 'q_pending_3',
      action: 'outreach.comment' as const,
      params: {
        postUrl: 'https://www.linkedin.com/feed/update/demo-3/',
        body: 'The point about golden paths over golden cages lands well.',
      },
      origin: 'mcp' as const,
      profile: profileFor('anneke-vos'),
      createdAt: CAPTURED_AT - 1_800_000,
      status: 'pending' as const,
    },
  ];

  const threads = [
    {
      threadId: 'thread_marisol',
      participants: [{ publicId: 'marisol-adeyemi', fullName: 'Marisol Adeyemi' }],
      lastMessageAt: CAPTURED_AT - 3 * 3_600_000,
      unread: true,
      snippet: 'That sounds useful — can you send over a short summary?',
      sentiment: 'positive' as const,
    },
    {
      threadId: 'thread_tobias',
      participants: [{ publicId: 'tobias-reinhardt', fullName: 'Tobias Reinhardt' }],
      lastMessageAt: CAPTURED_AT - 8 * 3_600_000,
      unread: true,
      snippet: 'We are mid-migration right now, ask me again in Q4.',
      sentiment: 'neutral' as const,
    },
    {
      threadId: 'thread_callum',
      participants: [{ publicId: 'callum-whitfield', fullName: 'Callum Whitfield' }],
      lastMessageAt: CAPTURED_AT - 26 * 3_600_000,
      unread: false,
      snippet: 'Not for us, thanks — please take me off the list.',
      sentiment: 'negative' as const,
    },
    {
      threadId: 'thread_freya',
      participants: [{ publicId: 'freya-ashworth', fullName: 'Freya Ashworth' }],
      lastMessageAt: CAPTURED_AT - 50 * 3_600_000,
      unread: false,
      snippet: 'Happy to chat. Tuesday afternoon any good?',
      sentiment: 'positive' as const,
    },
  ];

  const messages = [
    {
      messageId: 'msg_marisol_1',
      threadId: 'thread_marisol',
      fromPublicId: 'me',
      body: 'Hi Marisol — we build a local-first LinkedIn automation layer for agents.',
      sentAt: CAPTURED_AT - 5 * 3_600_000,
    },
    {
      messageId: 'msg_marisol_2',
      threadId: 'thread_marisol',
      fromPublicId: 'marisol-adeyemi',
      body: 'That sounds useful — can you send over a short summary?',
      sentAt: CAPTURED_AT - 3 * 3_600_000,
    },
    {
      messageId: 'msg_tobias_1',
      threadId: 'thread_tobias',
      fromPublicId: 'tobias-reinhardt',
      body: 'We are mid-migration right now, ask me again in Q4.',
      sentAt: CAPTURED_AT - 8 * 3_600_000,
    },
    {
      messageId: 'msg_callum_1',
      threadId: 'thread_callum',
      fromPublicId: 'callum-whitfield',
      body: 'Not for us, thanks — please take me off the list.',
      sentAt: CAPTURED_AT - 26 * 3_600_000,
    },
    {
      messageId: 'msg_freya_1',
      threadId: 'thread_freya',
      fromPublicId: 'freya-ashworth',
      body: 'Happy to chat. Tuesday afternoon any good?',
      sentAt: CAPTURED_AT - 50 * 3_600_000,
    },
  ];

  return { lists, campaigns, queue, threads, messages, nextId: { queue: 4, list: 1, campaign: 1 } };
}

/** The three rows `lit research` demonstrates against. */
export const FAKE_RESEARCH_ROWS = [
  { name: 'Marisol Adeyemi', company: 'Northwind Robotics' },
  { name: 'Nadia Karimov', domain: 'marrowgate-health.example' },
  { name: 'Anneke Vos', linkedinUrl: 'https://www.linkedin.com/in/anneke-vos/' },
];

function packFor(row: Record<string, unknown>, index: number) {
  const profile = FAKE_PROFILES[[0, 4, 9][index] ?? 0];
  const company = FAKE_COMPANIES.find((c) => c.name === profile.company)!;
  const signals = [
    'posted in the last 30 days',
    `${2 + index} shared connections`,
    'company hiring on the platform team',
  ];
  const markdown = [
    `# ${profile.fullName}`,
    '',
    `**${profile.title}** at **${profile.company}** — ${profile.location}`,
    '',
    '## Why now',
    ...signals.map((signal) => `- ${signal}`),
    '',
    '## Company',
    `${company.name} (${company.size} employees, ${company.industry}). ${company.description}`,
    '',
    '## Suggested opener',
    `Hi ${profile.firstName}, your recent post on platform tooling matched something we are working on — worth a short chat?`,
    '',
  ].join('\n');

  return {
    row,
    resolved: { row, kind: 'person' as const, publicId: profile.publicId, confidence: 0.93 - index * 0.04 },
    profile,
    company,
    recentPosts: [
      {
        url: `https://www.linkedin.com/feed/update/demo-${index + 1}/`,
        text: 'Golden paths beat golden cages. Notes from our platform rebuild.',
        likes: 84 + index * 31,
        comments: 12 + index * 4,
        postedAt: CAPTURED_AT - (3 + index) * DAY,
      },
    ],
    mutualConnections: 2 + index,
    connectionStatus: 'none' as const,
    signals,
    markdown,
    csvRow: {
      name: profile.fullName,
      publicId: profile.publicId,
      title: profile.title,
      company: profile.company,
      location: profile.location,
      linkedinUrl: profile.url,
      signals: signals.join('; '),
    },
  };
}

/**
 * Handlers for every action, over the demo dataset. Writes never send
 * anything: they land in the approval queue exactly as Copilot mode does.
 */
export function createDemoHandlers(emit: (event: string, payload: unknown) => void): FakeHandlers {
  const state = createDemoState();
  const jobs = new Map<string, { total: number; packs: ReturnType<typeof packFor>[] }>();

  const listSummary = (list: DemoState['lists'][number]) => ({
    listId: list.listId,
    name: list.name,
    tags: list.tags,
    createdAt: list.createdAt,
    count: list.members.length,
  });

  const findList = (listId: string) => state.lists.find((list) => list.listId === listId);
  const findCampaign = (campaignId: string) =>
    state.campaigns.find((campaign) => campaign.campaignId === campaignId);

  const page = <T>(items: T[], params: any) => {
    const start = Number(params?.start ?? 0);
    const count = Number(params?.count ?? 25);
    const slice = items.slice(start, start + count);
    const nextStart = start + count < items.length ? start + count : undefined;
    return { slice, nextStart };
  };

  /** Every write queues rather than sending, and shows up in `queue.list`. */
  const enqueue = (action: string, params: any) => {
    if (params?.dry_run) return { status: 'dryRun', wouldSend: params };
    const id = `q_demo_${state.nextId.queue++}`;
    state.queue.push({
      id,
      action: action as any,
      params,
      origin: 'mcp',
      profile: typeof params?.publicId === 'string' ? profileFor(params.publicId) : undefined,
      createdAt: Date.now(),
      status: 'pending',
    });
    return { status: 'queued', queueId: id };
  };

  const search = (params: any) => {
    const keywords = String(params?.keywords ?? '').toLowerCase();
    const matches = FAKE_PROFILES.filter((profile) => {
      if (!keywords) return true;
      const haystack =
        `${profile.fullName} ${profile.headline} ${profile.company} ${profile.location}`.toLowerCase();
      return keywords.split(/\s+/).some((word) => haystack.includes(word));
    });
    // A demo search should never come back empty just because of the keywords.
    const results = matches.length > 0 ? matches : FAKE_PROFILES;
    const filtered = results.filter((profile) => {
      const title = String(params?.title ?? '').toLowerCase();
      const company = String(params?.company ?? '').toLowerCase();
      const location = String(params?.location ?? '').toLowerCase();
      return (
        (!title || profile.title.toLowerCase().includes(title)) &&
        (!company || profile.company.toLowerCase().includes(company)) &&
        (!location || profile.location.toLowerCase().includes(location))
      );
    });
    const { slice, nextStart } = page(filtered, params);
    return { profiles: slice, total: filtered.length, nextStart };
  };

  return {
    'status.get': () => ({
      connected: true,
      extensionVersion: '2.0.0 (fake)',
      loggedIn: true,
      autopilot: false,
      businessHours: true,
      quotas: {
        invite: { hourlyUsed: 3, hourlyCap: 20, dailyUsed: 18, dailyCap: 100, nextAllowedAt: 0 },
        message: { hourlyUsed: 1, hourlyCap: 20, dailyUsed: 7, dailyCap: 150, nextAllowedAt: 0 },
        visit: { hourlyUsed: 9, hourlyCap: 50, dailyUsed: 64, dailyCap: 500, nextAllowedAt: 0 },
        search: { hourlyUsed: 2, hourlyCap: 50, dailyUsed: 120, dailyCap: 1000, nextAllowedAt: 0 },
      },
      queue: { pending: state.queue.filter((item) => item.status === 'pending').length },
      campaigns: {
        active: state.campaigns.filter((c) => c.status === 'active').length,
        paused: state.campaigns.filter((c) => c.status === 'paused').length,
      },
    }),

    'config.get': () => FAKE_CONFIG,
    'config.set': (params: any) => ({ ...FAKE_CONFIG, ...params }),

    'search.people': search,
    'profile.get': (params: any) => {
      const publicId = String(params?.publicId ?? '') || String(params?.url ?? '');
      const profile = profileFor(publicId.replace(/.*\/in\//, '').replace(/\/$/, ''));
      if (!profile) return FAKE_PROFILES[0];
      return params?.full
        ? {
            ...profile,
            pageText: `${profile.fullName}\n${profile.headline}\n${profile.location}\n\nDemo profile text.`,
            skills: ['Kubernetes', 'Platform engineering', 'Go'],
            experience: [
              { title: profile.title, company: profile.company, start: '2023' },
              { title: 'Senior Engineer', company: 'Hollowmere Systems', start: '2019', end: '2023' },
            ],
            education: [{ school: 'Ashcombe University', degree: 'BSc', field: 'Computer Science' }],
          }
        : profile;
    },
    'profile.export': (params: any) => {
      const urls: string[] = params?.urls ?? [];
      const profiles = urls
        .map((url) => profileFor(String(url).replace(/.*\/in\//, '').replace(/\/$/, '')))
        .filter(Boolean);
      return {
        profiles,
        failed: urls
          .filter((url) => !profileFor(String(url).replace(/.*\/in\//, '').replace(/\/$/, '')))
          .map((url) => ({ url, error: 'not in the demo dataset' })),
      };
    },

    'company.get': (params: any) => {
      const name = String(params?.universalName ?? params?.url ?? '')
        .replace(/.*\/company\//, '')
        .replace(/\/$/, '');
      return FAKE_COMPANIES.find((company) => company.universalName === name) ?? FAKE_COMPANIES[0];
    },
    'company.employees': (params: any) => {
      const company = FAKE_COMPANIES.find((c) => c.universalName === params?.universalName);
      const staff = FAKE_PROFILES.filter((profile) => profile.company === company?.name);
      const { slice, nextStart } = page(staff, params);
      return { profiles: slice, nextStart };
    },

    'post.engagers': (params: any) => {
      const engagers = FAKE_PROFILES.slice(0, 8).map((profile, index) => ({
        ...profile,
        ...(index % 2 === 0
          ? { reaction: 'like' }
          : { commentText: 'Strongly agree with the golden paths point.' }),
        engagedAt: CAPTURED_AT - index * 3_600_000,
      }));
      const kind = params?.kind ?? 'both';
      const filtered =
        kind === 'likes'
          ? engagers.filter((e) => 'reaction' in e)
          : kind === 'comments'
            ? engagers.filter((e) => 'commentText' in e)
            : engagers;
      const { slice, nextStart } = page(filtered, params);
      return { engagers: slice, nextStart };
    },
    'group.members': (params: any) => {
      const { slice, nextStart } = page(FAKE_PROFILES.slice(5, 20), params);
      return { profiles: slice, nextStart };
    },
    'event.attendees': (params: any) => {
      const { slice, nextStart } = page(FAKE_PROFILES.slice(18), params);
      return { profiles: slice, nextStart };
    },

    'network.connections': (params: any) => {
      const first = FAKE_PROFILES.filter((profile) => profile.connectionDegree === 1);
      const { slice, nextStart } = page(first, params);
      return { profiles: slice, nextStart };
    },
    'network.followers': (params: any) => {
      const { slice, nextStart } = page(FAKE_PROFILES.slice(10), params);
      return { profiles: slice, nextStart };
    },
    'network.status': (params: any) => ({
      statuses: Object.fromEntries(
        (params?.publicIds ?? []).map((publicId: string) => {
          const profile = profileFor(publicId);
          return [
            publicId,
            profile?.connectionDegree === 1 ? 'connected' : profile ? 'none' : 'none',
          ];
        }),
      ),
    }),
    'network.unfollowCount': () => ({ count: 7 }),
    'network.unfollowAll': () => ({ unfollowed: 7 }),

    'outreach.view': (params: any) =>
      params?.dry_run ? { status: 'dryRun', wouldSend: params } : enqueue('outreach.view', params),
    'outreach.follow': (params: any) => enqueue('outreach.follow', params),
    'outreach.invite': (params: any) => enqueue('outreach.invite', params),
    'outreach.message': (params: any) => enqueue('outreach.message', params),
    'outreach.inmail': (params: any) => enqueue('outreach.inmail', params),
    'outreach.like': (params: any) => enqueue('outreach.like', params),
    'outreach.comment': (params: any) => enqueue('outreach.comment', params),

    'inbox.threads': (params: any) => {
      const since = Number(params?.since ?? 0);
      let threads = state.threads.filter((thread) => thread.lastMessageAt >= since);
      if (params?.unreadOnly) threads = threads.filter((thread) => thread.unread);
      return { threads: threads.slice(0, Number(params?.count ?? threads.length)) };
    },
    'inbox.messages': (params: any) => ({
      messages: state.messages.filter((message) => message.threadId === params?.threadId),
    }),
    'inbox.export': () => ({ threads: state.threads, messages: state.messages }),

    'list.create': (params: any) => {
      const list = {
        listId: `list_demo_${state.nextId.list++}`,
        name: String(params?.name ?? 'Untitled list'),
        tags: params?.tags ?? [],
        createdAt: Date.now(),
        members: [] as DemoState['lists'][number]['members'],
      };
      state.lists.push(list);
      return listSummary(list);
    },
    'list.getAll': () => ({ lists: state.lists.map(listSummary) }),
    'list.get': (params: any) => {
      const list = findList(params?.listId);
      if (!list) throw new Error(`no such list ${params?.listId}`);
      return listSummary(list);
    },
    'list.add': (params: any) => {
      const list = findList(params?.listId);
      if (!list) throw new Error(`no such list ${params?.listId}`);
      const incoming: any[] =
        params?.profiles ?? (params?.publicIds ?? []).map((id: string) => profileFor(id)).filter(Boolean);
      let added = 0;
      let duplicates = 0;
      for (const profile of incoming) {
        if (list.members.some((member) => member.publicId === profile.publicId)) {
          duplicates++;
          continue;
        }
        list.members.push({
          publicId: profile.publicId,
          profile,
          addedAt: Date.now(),
          tags: [],
          contactedBefore: false,
          signals: [],
        });
        added++;
      }
      return { added, duplicates };
    },
    'list.remove': (params: any) => {
      const list = findList(params?.listId);
      if (!list) throw new Error(`no such list ${params?.listId}`);
      const before = list.members.length;
      list.members = list.members.filter(
        (member) => !(params?.publicIds ?? []).includes(member.publicId),
      );
      return { removed: before - list.members.length };
    },
    'list.members': (params: any) => {
      const list = findList(params?.listId);
      if (!list) throw new Error(`no such list ${params?.listId}`);
      const { slice } = page(list.members, params);
      return { members: slice, total: list.members.length };
    },
    'list.delete': (params: any) => {
      state.lists = state.lists.filter((list) => list.listId !== params?.listId);
      return { ok: true };
    },
    'list.importCsv': (params: any) => {
      const rows = String(params?.csv ?? '').trim().split('\n').slice(1);
      return { added: rows.length, duplicates: 0, invalid: 0 };
    },

    'campaign.create': (params: any) => {
      const campaign = {
        campaignId: `camp_demo_${state.nextId.campaign++}`,
        name: String(params?.name ?? 'Untitled campaign'),
        steps: params?.steps ?? [],
        status: 'active' as 'active' | 'paused' | 'completed',
        createdAt: Date.now(),
        settings: { stopOnReply: true, autopilot: false, ...(params?.settings ?? {}) },
        stats: {
          enrolled: findList(params?.listId)?.members.length ?? (params?.publicIds ?? []).length,
          sent: 0,
          accepted: 0,
          replied: 0,
          positive: 0,
          byStep: {},
        },
      };
      state.campaigns.push(campaign);
      return campaign;
    },
    'campaign.getAll': () => ({ campaigns: state.campaigns }),
    'campaign.get': (params: any) => {
      const campaign = findCampaign(params?.campaignId);
      if (!campaign) throw new Error(`no such campaign ${params?.campaignId}`);
      return campaign;
    },
    'campaign.enroll': (params: any) => {
      const campaign = findCampaign(params?.campaignId);
      if (!campaign) throw new Error(`no such campaign ${params?.campaignId}`);
      const enrolled = (params?.publicIds ?? []).length;
      campaign.stats.enrolled += enrolled;
      return { enrolled, skipped: 0 };
    },
    'campaign.pause': (params: any) => {
      const campaign = findCampaign(params?.campaignId);
      if (!campaign) throw new Error(`no such campaign ${params?.campaignId}`);
      campaign.status = 'paused';
      return campaign;
    },
    'campaign.resume': (params: any) => {
      const campaign = findCampaign(params?.campaignId);
      if (!campaign) throw new Error(`no such campaign ${params?.campaignId}`);
      campaign.status = 'active';
      return campaign;
    },
    'campaign.delete': (params: any) => {
      const campaign = findCampaign(params?.campaignId);
      state.campaigns = state.campaigns.filter((c) => c.campaignId !== params?.campaignId);
      return { ...(campaign ?? {}), status: 'completed' };
    },
    'campaign.tick': () => ({ executed: 0, queued: 0 }),

    'queue.list': (params: any) => ({
      items: params?.status
        ? state.queue.filter((item) => item.status === params.status)
        : state.queue,
    }),
    'queue.approve': (params: any) => {
      const ids: string[] = params?.ids ?? [];
      let approved = 0;
      for (const item of state.queue) {
        if (ids.includes(item.id) && item.status === 'pending') {
          (item as any).status = 'sent';
          approved++;
        }
      }
      return { approved };
    },
    'queue.reject': (params: any) => {
      const ids: string[] = params?.ids ?? [];
      let rejected = 0;
      for (const item of state.queue) {
        if (ids.includes(item.id) && item.status === 'pending') {
          (item as any).status = 'rejected';
          rejected++;
        }
      }
      return { rejected };
    },

    'ai.complete': (params: any) => ({
      output:
        params?.task === 'sentiment'
          ? 'positive'
          : 'Hi there — your recent post on platform tooling lined up with something we are building. Worth a short chat?',
      provider: 'fake',
      model: 'demo',
    }),

    'export.csv': () => ({
      csv: ['publicId,fullName,title,company,location']
        .concat(
          FAKE_PROFILES.map((p) => [p.publicId, p.fullName, p.title, p.company, p.location].join(',')),
        )
        .join('\n'),
      filename: 'demo-profiles.csv',
    }),

    'research.resolve': (params: any) => ({
      resolved: (params?.rows ?? []).map((row: any, index: number) => ({
        row,
        kind: 'person',
        publicId: FAKE_PROFILES[index % FAKE_PROFILES.length].publicId,
        confidence: 0.9 - index * 0.05,
        candidates: [FAKE_PROFILES[index % FAKE_PROFILES.length]],
      })),
    }),
    'research.pack': (params: any) => {
      const rows: any[] = params?.rows ?? [];
      const jobId = `job_demo_${jobs.size + 1}`;
      const packs = rows.map((row, index) => packFor(row, index));
      jobs.set(jobId, { total: rows.length, packs });
      // Completion arrives on the event channel, exactly as the real engine does.
      setTimeout(() => emit('research_completed', { jobId, listId: params?.listName }), 150);
      return { jobId, total: rows.length, etaMs: 150 };
    },
    'research.get': (params: any) => {
      const job = jobs.get(params?.jobId);
      if (!job) throw new Error(`no such job ${params?.jobId}`);
      return {
        jobId: params.jobId,
        status: 'completed',
        done: job.packs.length,
        total: job.total,
        packs: job.packs,
      };
    },

    'sync.pull': () => ({
      profiles: FAKE_PROFILES,
      companies: FAKE_COMPANIES,
      lists: state.lists.map(listSummary),
      listMembers: state.lists.flatMap((list) =>
        list.members.map((member) => ({ ...member, listId: list.listId })),
      ),
      campaigns: state.campaigns,
      enrollments: state.lists[0].members.map((member) => ({
        campaignId: 'camp_platform_intro',
        publicId: member.publicId,
        stepIndex: 2,
        status: 'active',
        enrolledAt: CAPTURED_AT - 10 * DAY,
      })),
      actions: state.queue.map((item) => ({
        id: `action_${item.id}`,
        action: item.action,
        publicId: (item.params as any)?.publicId,
        status: item.status,
        at: item.createdAt,
      })),
      threads: state.threads,
      messages: state.messages,
      events: [],
    }),
  };
}

const FAKE_CONFIG = {
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
