/**
 * A small stateful fake engine for the end-to-end test.
 *
 * `tests/fixtures.ts` answers one action at a time with a canned reply, which
 * is right for unit tests. An end-to-end run needs the answers to depend on
 * what happened before it: a list has to contain what was added to it, a
 * campaign tick has to queue something the approve step can then send, and
 * `sync.pull` has to hand the mirror the same records the earlier calls
 * created. This module is that state.
 *
 * It is still entirely offline — it never touches LinkedIn and never opens a
 * socket of its own. It is handed to `FakeExtension` as its handler map.
 */
import { defaultHandlers, ada, grace, acme, status } from '../fixtures.js';
import type { Handlers } from '../fakeExtension.js';
import { FakeError } from '../fakeExtension.js';

export type Emit = (event: string, payload: unknown) => void;

type Profile = typeof ada;

type QueueRow = {
  id: string;
  action: string;
  params: Record<string, unknown>;
  origin: 'popup' | 'campaign' | 'mcp' | 'cli';
  profile?: Profile;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'sent' | 'failed';
  result?: Record<string, unknown>;
};

export class E2eEngine {
  /** Set once the fake extension exists, so handlers can push events. */
  emit: Emit = () => {};

  /** When set, the next call to this action throws it instead of answering. */
  failures = new Map<string, () => never>();

  readonly profiles = new Map<string, Profile>([
    [ada.publicId, ada],
    [grace.publicId, grace],
  ]);
  readonly lists = new Map<
    string,
    { listId: string; name: string; tags: string[]; createdAt: number; members: string[] }
  >();
  readonly campaigns = new Map<string, any>();
  readonly enrollments: { campaignId: string; publicId: string; stepIndex: number; status: string }[] =
    [];
  readonly queue: QueueRow[] = [];
  readonly actions: { id: string; action: string; publicId: string; at: number; status: string }[] =
    [];
  readonly events: { id: string; event: string; payload: unknown; at: number }[] = [];
  private jobs = new Map<string, { rows: any[]; packs: any[] }>();
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  private record(event: string, payload: unknown): void {
    this.events.push({ id: this.id('e'), event, payload, at: Date.now() });
    this.emit(event, payload);
  }

  /** Make the next call to `action` fail with this contract error. */
  failNext(action: string, code: string, message: string, extra: Record<string, unknown> = {}): void {
    this.failures.set(action, () => {
      this.failures.delete(action);
      throw new FakeError(code, message, extra);
    });
  }

  handlers(): Handlers {
    const base = defaultHandlers();
    const guard =
      (action: string, handler: (params: any) => unknown) =>
      (params: any): unknown => {
        this.failures.get(action)?.();
        return handler(params);
      };

    const stateful: Handlers = {
      'status.get': () => ({
        ...status,
        queue: { pending: this.queue.filter((q) => q.status === 'pending').length },
        campaigns: {
          active: [...this.campaigns.values()].filter((c) => c.status === 'active').length,
          paused: [...this.campaigns.values()].filter((c) => c.status === 'paused').length,
        },
      }),

      'search.people': (params: any) => {
        const all = [...this.profiles.values()];
        const count = Math.min(params?.count ?? all.length, all.length);
        return { profiles: all.slice(0, count), total: all.length };
      },

      'list.create': (params: any) => {
        const listId = this.id('list');
        const row = {
          listId,
          name: String(params?.name ?? 'Untitled'),
          tags: params?.tags ?? [],
          createdAt: Date.now(),
          members: [] as string[],
        };
        this.lists.set(listId, row);
        return { listId, name: row.name, tags: row.tags, createdAt: row.createdAt, count: 0 };
      },

      'list.add': (params: any) => {
        const list = this.lists.get(String(params?.listId));
        if (!list) throw new FakeError('NOT_FOUND', `no list ${params?.listId}`);
        const incoming: string[] = [
          ...(params?.publicIds ?? []),
          ...(params?.profiles ?? []).map((p: Profile) => p.publicId),
        ];
        for (const p of params?.profiles ?? []) this.profiles.set(p.publicId, p);
        let added = 0;
        let duplicates = 0;
        for (const publicId of incoming) {
          if (list.members.includes(publicId)) duplicates += 1;
          else {
            list.members.push(publicId);
            added += 1;
          }
        }
        return { added, duplicates };
      },

      'list.get': (params: any) => {
        const list = this.lists.get(String(params?.listId));
        if (!list) throw new FakeError('NOT_FOUND', `no list ${params?.listId}`);
        return {
          listId: list.listId,
          name: list.name,
          tags: list.tags,
          createdAt: list.createdAt,
          count: list.members.length,
        };
      },

      'list.getAll': () => ({ lists: [...this.lists.values()].map((l) => this.listRow(l)) }),

      'list.members': (params: any) => {
        const list = this.lists.get(String(params?.listId));
        if (!list) throw new FakeError('NOT_FOUND', `no list ${params?.listId}`);
        const members = list.members.map((publicId) => ({
          publicId,
          profile: this.profiles.get(publicId) ?? ada,
          addedAt: list.createdAt,
          tags: [],
          contactedBefore: false,
        }));
        return { members, total: members.length };
      },

      'campaign.create': (params: any) => {
        const campaignId = this.id('camp');
        const campaign = {
          campaignId,
          name: String(params?.name ?? 'Untitled'),
          steps: params?.steps ?? [],
          status: 'active' as const,
          createdAt: Date.now(),
          settings: params?.settings ?? { stopOnReply: true, autopilot: false },
          stats: { enrolled: 0, sent: 0, accepted: 0, replied: 0, positive: 0, byStep: {} },
        };
        this.campaigns.set(campaignId, campaign);
        if (params?.listId) {
          const list = this.lists.get(String(params.listId));
          for (const publicId of list?.members ?? []) this.enrol(campaignId, publicId);
        }
        return this.campaignRow(campaignId);
      },

      'campaign.get': (params: any) => this.campaignRow(String(params?.campaignId)),
      'campaign.getAll': () => ({
        campaigns: [...this.campaigns.keys()].map((id) => this.campaignRow(id)),
      }),

      'campaign.enroll': (params: any) => {
        const campaignId = String(params?.campaignId);
        if (!this.campaigns.has(campaignId)) throw new FakeError('NOT_FOUND', 'no such campaign');
        let enrolled = 0;
        let skipped = 0;
        for (const publicId of params?.publicIds ?? []) {
          if (this.enrol(campaignId, publicId)) enrolled += 1;
          else skipped += 1;
        }
        return { enrolled, skipped };
      },

      /**
       * One tick of the scheduler: everyone enrolled and still on step 0 gets
       * the first actionable step. In Copilot mode that means a queued item,
       * not a sent invite.
       */
      'campaign.tick': () => {
        let queued = 0;
        for (const enrollment of this.enrollments) {
          if (enrollment.status !== 'active' || enrollment.stepIndex > 0) continue;
          const campaign = this.campaigns.get(enrollment.campaignId);
          if (!campaign || campaign.status !== 'active') continue;
          const item: QueueRow = {
            id: this.id('q'),
            action: 'outreach.invite',
            params: { publicId: enrollment.publicId, note: 'Hi there' },
            origin: 'campaign',
            profile: this.profiles.get(enrollment.publicId),
            createdAt: Date.now(),
            status: 'pending',
          };
          this.queue.push(item);
          enrollment.stepIndex = 1;
          queued += 1;
          this.record('queue_item_added', { id: item.id, action: item.action });
        }
        return { executed: queued, queued };
      },

      'queue.list': (params: any) => {
        const wanted = params?.status;
        const items = wanted ? this.queue.filter((q) => q.status === wanted) : [...this.queue];
        return { items };
      },

      'queue.approve': (params: any) => {
        const ids: string[] = params?.ids ?? [];
        const edits = params?.edits ?? {};
        let approved = 0;
        for (const id of ids) {
          const item = this.queue.find((q) => q.id === id && q.status === 'pending');
          if (!item) continue;
          Object.assign(item.params, edits[id] ?? {});
          item.status = 'sent';
          item.result = { sentAt: Date.now() };
          approved += 1;
          this.actions.push({
            id: this.id('a'),
            action: item.action,
            publicId: String(item.params.publicId ?? ''),
            at: Date.now(),
            status: 'sent',
          });
          this.record('queue_item_sent', {
            id: item.id,
            action: item.action,
            publicId: item.params.publicId,
          });
        }
        return { approved };
      },

      'queue.reject': (params: any) => {
        let rejected = 0;
        for (const id of params?.ids ?? []) {
          const item = this.queue.find((q) => q.id === id && q.status === 'pending');
          if (!item) continue;
          item.status = 'rejected';
          rejected += 1;
        }
        return { rejected };
      },

      'outreach.invite': (params: any) => {
        if (params?.dry_run) return { status: 'dryRun', wouldSend: params };
        const item: QueueRow = {
          id: this.id('q'),
          action: 'outreach.invite',
          params: { ...params },
          origin: 'mcp',
          profile: this.profiles.get(String(params?.publicId ?? '')),
          createdAt: Date.now(),
          status: 'pending',
        };
        this.queue.push(item);
        this.record('queue_item_added', { id: item.id, action: item.action });
        return { status: 'queued', queueId: item.id };
      },

      'research.pack': (params: any) => {
        const jobId = this.id('job');
        const rows = params?.rows ?? [];
        const packs = rows.map((row: any, index: number) => {
          const profile = index === 0 ? ada : grace;
          return {
            row,
            resolved: { row, kind: 'person', publicId: profile.publicId, confidence: 0.92 },
            profile,
            company: acme,
            recentPosts: [],
            mutualConnections: 3,
            connectionStatus: 'none',
            signals: ['posted in the last 30 days'],
            markdown: `# ${profile.fullName}\n\n${profile.headline}\n`,
            csvRow: { name: profile.fullName, publicId: profile.publicId },
          };
        });
        this.jobs.set(jobId, { rows, packs });
        // The real engine finishes asynchronously and announces it on the
        // event channel; the tool layer is waiting for exactly this.
        setTimeout(() => {
          this.record('research_completed', { jobId, done: packs.length, total: packs.length });
        }, 10).unref?.();
        return { jobId, total: rows.length, etaMs: 50 };
      },

      'research.get': (params: any) => {
        const job = this.jobs.get(String(params?.jobId));
        if (!job) throw new FakeError('NOT_FOUND', `no job ${params?.jobId}`);
        return {
          jobId: String(params?.jobId),
          status: 'completed',
          done: job.packs.length,
          total: job.rows.length,
          packs: job.packs,
        };
      },

      'sync.pull': () => ({
        profiles: [...this.profiles.values()],
        lists: [...this.lists.values()].map((l) => this.listRow(l)),
        listMembers: [...this.lists.values()].flatMap((list) =>
          list.members.map((publicId) => ({
            listId: list.listId,
            publicId,
            addedAt: list.createdAt,
            tags: [],
            contactedBefore: false,
          })),
        ),
        campaigns: [...this.campaigns.keys()].map((id) => this.campaignRow(id)),
        enrollments: this.enrollments.map((e) => ({ ...e })),
        actions: this.actions.map((a) => ({ ...a })),
        threads: [],
        messages: [],
        events: this.events.map((e) => ({ ...e })),
      }),
    };

    const handlers: Handlers = { ...base };
    for (const [action, handler] of Object.entries(stateful)) {
      handlers[action] = guard(action, handler);
    }
    // Everything the engine does not model still goes through the guard, so a
    // test can make any action fail.
    for (const action of Object.keys(base)) {
      if (!(action in stateful)) handlers[action] = guard(action, base[action]);
    }
    return handlers;
  }

  private enrol(campaignId: string, publicId: string): boolean {
    if (this.enrollments.some((e) => e.campaignId === campaignId && e.publicId === publicId)) {
      return false;
    }
    this.enrollments.push({ campaignId, publicId, stepIndex: 0, status: 'active' });
    const campaign = this.campaigns.get(campaignId);
    if (campaign) campaign.stats.enrolled += 1;
    return true;
  }

  private listRow(list: { listId: string; name: string; tags: string[]; createdAt: number; members: string[] }) {
    return {
      listId: list.listId,
      name: list.name,
      tags: list.tags,
      createdAt: list.createdAt,
      count: list.members.length,
    };
  }

  private campaignRow(campaignId: string) {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw new FakeError('NOT_FOUND', `no campaign ${campaignId}`);
    return {
      ...campaign,
      stats: {
        ...campaign.stats,
        enrolled: this.enrollments.filter((e) => e.campaignId === campaignId).length,
      },
    };
  }
}
