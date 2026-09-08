/**
 * AUTO-GENERATED — do not edit by hand.
 *
 * Written by `npm run gen` in `clients/node`, one method per action in
 * `mcp-server/src/contract.ts`. `LinkedInToolkit` extends this class, so
 * every action reaches the same `call()` and the same error handling.
 */
import type { ActionName, ParamsOf, ResultOf } from './types.js';

/**
 * The generated action surface. Split out from the client so that the
 * hand-written parts of `LinkedInToolkit` are never touched by `npm run gen`.
 */
export abstract class GeneratedActions {
  /** Implemented by `LinkedInToolkit`. */
  abstract call<A extends ActionName>(action: A, params?: ParamsOf<A>): Promise<ResultOf<A>>;

  /** `status.get` — Check that the Chrome extension is connected and the user is logged in to LinkedIn. Call this first in any session and again after a rate-limit error; returns extension version, autopilot on/off, business-hours flag, per-quota usage (invite, message, visit, search), pending approval-queue size and campaign counts. */
  statusGet(params: ParamsOf<'status.get'> = {} as ParamsOf<'status.get'>): Promise<ResultOf<'status.get'>> {
    return this.call('status.get', params);
  }

  /** `config.get` — Call the `config.get` action. */
  configGet(params: ParamsOf<'config.get'> = {} as ParamsOf<'config.get'>): Promise<ResultOf<'config.get'>> {
    return this.call('config.get', params);
  }

  /** `config.set` — Call the `config.set` action. */
  configSet(params: ParamsOf<'config.set'> = {} as ParamsOf<'config.set'>): Promise<ResultOf<'config.set'>> {
    return this.call('config.set', params);
  }

  /** `search.people` — Search LinkedIn people and return structured profiles. Use it to build a candidate or prospect list from keywords plus optional title, company and location filters. Returns up to 100 profiles per call with nextStart for paging; the extension caps search results at 1,000 per day. */
  searchPeople(params: ParamsOf<'search.people'>): Promise<ResultOf<'search.people'>> {
    return this.call('search.people', params);
  }

  /** `profile.get` — Fetch one profile by URL or publicId. Use it before writing an invite or message so the copy can reference real detail. Returns the Profile; with full=true it also captures the rendered page text, photo and experience/education, which costs one profile visit against the 500/day cap. */
  profileGet(params: ParamsOf<'profile.get'> = {} as ParamsOf<'profile.get'>): Promise<ResultOf<'profile.get'>> {
    return this.call('profile.get', params);
  }

  /** `profile.export` — Fetch many profiles in one call from a list of LinkedIn URLs. Use it to hydrate a list you already have URLs for. Returns profiles plus a failed array of {url, error}; each profile counts against the 500 visits/day cap, so keep batches modest. */
  profileExport(params: ParamsOf<'profile.export'>): Promise<ResultOf<'profile.export'>> {
    return this.call('profile.export', params);
  }

  /** `company.get` — Fetch a company page by URL or universalName. Use it for account research before outreach. Returns name, industry, size, HQ, website, description and follower count. */
  companyGet(params: ParamsOf<'company.get'> = {} as ParamsOf<'company.get'>): Promise<ResultOf<'company.get'>> {
    return this.call('company.get', params);
  }

  /** `company.employees` — List people who work at a company, by universalName. Use it for account-based sourcing once you know the company. Returns a page of profiles plus nextStart; results count against the daily search cap. */
  companyEmployees(params: ParamsOf<'company.employees'>): Promise<ResultOf<'company.employees'>> {
    return this.call('company.employees', params);
  }

  /** `post.engagers` — List the people who liked or commented on a LinkedIn post. Use it to source warm leads who have shown intent. Returns engagers (a profile plus reaction or comment text) and nextStart. */
  postEngagers(params: ParamsOf<'post.engagers'>): Promise<ResultOf<'post.engagers'>> {
    return this.call('post.engagers', params);
  }

  /** `group.members` — List members of a LinkedIn group you belong to. Use it for niche sourcing. Returns a page of profiles plus nextStart. */
  groupMembers(params: ParamsOf<'group.members'>): Promise<ResultOf<'group.members'>> {
    return this.call('group.members', params);
  }

  /** `event.attendees` — List attendees of a LinkedIn event you can see. Use it to source people around a conference or webinar. Returns a page of profiles plus nextStart. */
  eventAttendees(params: ParamsOf<'event.attendees'>): Promise<ResultOf<'event.attendees'>> {
    return this.call('event.attendees', params);
  }

  /** `network.connections` — List the user's own first-degree connections. Use it to work an existing network rather than sending new invites. Returns a page of profiles plus nextStart. */
  networkConnections(params: ParamsOf<'network.connections'> = {} as ParamsOf<'network.connections'>): Promise<ResultOf<'network.connections'>> {
    return this.call('network.connections', params);
  }

  /** `network.followers` — Call the `network.followers` action. */
  networkFollowers(params: ParamsOf<'network.followers'> = {} as ParamsOf<'network.followers'>): Promise<ResultOf<'network.followers'>> {
    return this.call('network.followers', params);
  }

  /** `network.status` — Check whether the user is already connected to, or has a pending invite with, each of the given publicIds. Always call this before sending invites so you do not re-invite existing connections. Returns a map publicId to connected | pending | none. */
  networkStatus(params: ParamsOf<'network.status'>): Promise<ResultOf<'network.status'>> {
    return this.call('network.status', params);
  }

  /** `network.unfollowCount` — Call the `network.unfollowCount` action. */
  networkUnfollowCount(params: ParamsOf<'network.unfollowCount'> = {} as ParamsOf<'network.unfollowCount'>): Promise<ResultOf<'network.unfollowCount'>> {
    return this.call('network.unfollowCount', params);
  }

  /** `network.unfollowAll` — Call the `network.unfollowAll` action. */
  networkUnfollowAll(params: ParamsOf<'network.unfollowAll'> = {} as ParamsOf<'network.unfollowAll'>): Promise<ResultOf<'network.unfollowAll'>> {
    return this.call('network.unfollowAll', params);
  }

  /** `outreach.view` — Visit a profile so the visit shows up in their "who viewed your profile". Use it as a light warm-up touch before an invite. Counts against the 500 visits/day cap. Returns a WriteResult; pass dry_run to preview. */
  outreachView(params: ParamsOf<'outreach.view'> & { dry_run?: boolean }): Promise<ResultOf<'outreach.view'>> {
    return this.call('outreach.view', params);
  }

  /** `outreach.follow` — Follow a person without sending a connection invite. Use it when an invite would be too strong a first touch. Returns a WriteResult; pass dry_run to preview. */
  outreachFollow(params: ParamsOf<'outreach.follow'> & { dry_run?: boolean }): Promise<ResultOf<'outreach.follow'>> {
    return this.call('outreach.follow', params);
  }

  /** `outreach.invite` — Send a connection invite, optionally with a note. Check linkedin_get_connection_status first. Hard cap 100 invites/day; in Copilot mode (the default) the invite is queued for human approval and the result status is "queued" rather than "sent". Pass dry_run to preview the exact payload. */
  outreachInvite(params: ParamsOf<'outreach.invite'> & { dry_run?: boolean }): Promise<ResultOf<'outreach.invite'>> {
    return this.call('outreach.invite', params);
  }

  /** `outreach.message` — Send a direct message to a first-degree connection. Hard cap 150 messages/day; in Copilot mode it is queued for approval. Returns a WriteResult; pass dry_run to preview. */
  outreachMessage(params: ParamsOf<'outreach.message'> & { dry_run?: boolean }): Promise<ResultOf<'outreach.message'>> {
    return this.call('outreach.message', params);
  }

  /** `outreach.inmail` — Send an InMail with a subject line (requires Premium, Sales Navigator or Recruiter). Counts against the message cap and queues for approval in Copilot mode. Returns a WriteResult; pass dry_run to preview. */
  outreachInmail(params: ParamsOf<'outreach.inmail'> & { dry_run?: boolean }): Promise<ResultOf<'outreach.inmail'>> {
    return this.call('outreach.inmail', params);
  }

  /** `outreach.like` — Like a post by URL. Use it as a low-risk warm-up touch before inviting the author. Returns a WriteResult; pass dry_run to preview. */
  outreachLike(params: ParamsOf<'outreach.like'> & { dry_run?: boolean }): Promise<ResultOf<'outreach.like'>> {
    return this.call('outreach.like', params);
  }

  /** `outreach.comment` — Comment on a post by URL. Use it for public engagement before outreach; comments are queued for approval in Copilot mode because they are visible to everyone. Returns a WriteResult; pass dry_run to preview. */
  outreachComment(params: ParamsOf<'outreach.comment'> & { dry_run?: boolean }): Promise<ResultOf<'outreach.comment'>> {
    return this.call('outreach.comment', params);
  }

  /** `inbox.threads` — List LinkedIn inbox threads, optionally only those since a timestamp or only unread. Use it to triage replies. Returns threads with participants, snippet, unread flag and sentiment when the extension has an AI provider configured. */
  inboxThreads(params: ParamsOf<'inbox.threads'> = {} as ParamsOf<'inbox.threads'>): Promise<ResultOf<'inbox.threads'>> {
    return this.call('inbox.threads', params);
  }

  /** `inbox.messages` — Fetch the messages in one thread by threadId. Use it after linkedin_get_conversations to read the full exchange before replying. Returns messages with sender publicId, body and sentAt. */
  inboxMessages(params: ParamsOf<'inbox.messages'>): Promise<ResultOf<'inbox.messages'>> {
    return this.call('inbox.messages', params);
  }

  /** `inbox.export` — Call the `inbox.export` action. */
  inboxExport(params: ParamsOf<'inbox.export'> = {} as ParamsOf<'inbox.export'>): Promise<ResultOf<'inbox.export'>> {
    return this.call('inbox.export', params);
  }

  /** `list.create` — Create a named local list to hold prospects. Use it as the container for search results before enrolling them in a campaign. Returns the List with its listId. Lists live only in the local extension storage. */
  listCreate(params: ParamsOf<'list.create'> & { dry_run?: boolean }): Promise<ResultOf<'list.create'>> {
    return this.call('list.create', params);
  }

  /** `list.getAll` — List every local list. Use it to discover listIds before adding members or creating a campaign. Returns all List records with their member counts. */
  listGetAll(params: ParamsOf<'list.getAll'> = {} as ParamsOf<'list.getAll'>): Promise<ResultOf<'list.getAll'>> {
    return this.call('list.getAll', params);
  }

  /** `list.get` — Fetch one list by listId. Use it to confirm a list exists and how many members it holds. Returns the List record. */
  listGet(params: ParamsOf<'list.get'>): Promise<ResultOf<'list.get'>> {
    return this.call('list.get', params);
  }

  /** `list.add` — Add profiles (or bare publicIds) to a list. Use it to save search or engager results for later outreach. Duplicates are skipped; returns {added, duplicates}. */
  listAdd(params: ParamsOf<'list.add'> & { dry_run?: boolean }): Promise<ResultOf<'list.add'>> {
    return this.call('list.add', params);
  }

  /** `list.remove` — Call the `list.remove` action. */
  listRemove(params: ParamsOf<'list.remove'>): Promise<ResultOf<'list.remove'>> {
    return this.call('list.remove', params);
  }

  /** `list.members` — Page through the members of a list. Use it to read back what is in a list, including tags, whether each person was contacted before and any signals. Returns members plus total. */
  listMembers(params: ParamsOf<'list.members'>): Promise<ResultOf<'list.members'>> {
    return this.call('list.members', params);
  }

  /** `list.delete` — Call the `list.delete` action. */
  listDelete(params: ParamsOf<'list.delete'>): Promise<ResultOf<'list.delete'>> {
    return this.call('list.delete', params);
  }

  /** `list.importCsv` — Call the `list.importCsv` action. */
  listImportCsv(params: ParamsOf<'list.importCsv'>): Promise<ResultOf<'list.importCsv'>> {
    return this.call('list.importCsv', params);
  }

  /** `campaign.create` — Create a multi-step outreach sequence (view, follow, invite, message, inmail, like, comment, wait, branch) over a list or explicit publicIds. Use it instead of firing individual writes when the touches should be spaced over days. Returns the Campaign; steps still obey every quota and the approval queue. */
  campaignCreate(params: ParamsOf<'campaign.create'> & { dry_run?: boolean }): Promise<ResultOf<'campaign.create'>> {
    return this.call('campaign.create', params);
  }

  /** `campaign.getAll` — List every campaign with its status. Use it to find campaignIds and see what is currently running or paused. */
  campaignGetAll(params: ParamsOf<'campaign.getAll'> = {} as ParamsOf<'campaign.getAll'>): Promise<ResultOf<'campaign.getAll'>> {
    return this.call('campaign.getAll', params);
  }

  /** `campaign.get` — Fetch one campaign by campaignId including its stats. Use it to report on enrolled, sent, accepted, replied and positive counts per step. */
  campaignGet(params: ParamsOf<'campaign.get'>): Promise<ResultOf<'campaign.get'>> {
    return this.call('campaign.get', params);
  }

  /** `campaign.enroll` — Enroll publicIds into an existing campaign. Use it to top up a running sequence with newly sourced people. Already-enrolled people are skipped; returns {enrolled, skipped}. */
  campaignEnroll(params: ParamsOf<'campaign.enroll'> & { dry_run?: boolean }): Promise<ResultOf<'campaign.enroll'>> {
    return this.call('campaign.enroll', params);
  }

  /** `campaign.pause` — Pause a campaign so no further steps execute. Use it immediately if replies look negative or a challenge was detected. Returns the updated Campaign. */
  campaignPause(params: ParamsOf<'campaign.pause'> & { dry_run?: boolean }): Promise<ResultOf<'campaign.pause'>> {
    return this.call('campaign.pause', params);
  }

  /** `campaign.resume` — Resume a paused campaign from where it stopped. Returns the updated Campaign. */
  campaignResume(params: ParamsOf<'campaign.resume'> & { dry_run?: boolean }): Promise<ResultOf<'campaign.resume'>> {
    return this.call('campaign.resume', params);
  }

  /** `campaign.delete` — Call the `campaign.delete` action. */
  campaignDelete(params: ParamsOf<'campaign.delete'>): Promise<ResultOf<'campaign.delete'>> {
    return this.call('campaign.delete', params);
  }

  /** `campaign.tick` — Call the `campaign.tick` action. */
  campaignTick(params: ParamsOf<'campaign.tick'> = {} as ParamsOf<'campaign.tick'>): Promise<ResultOf<'campaign.tick'>> {
    return this.call('campaign.tick', params);
  }

  /** `queue.list` — List items in the human-approval queue, optionally filtered by status. In Copilot mode every agent-originated write lands here first, so call this to show the user what is waiting. Returns queue items with their action, params and target profile. */
  queueList(params: ParamsOf<'queue.list'> = {} as ParamsOf<'queue.list'>): Promise<ResultOf<'queue.list'>> {
    return this.call('queue.list', params);
  }

  /** `queue.approve` — Approve queued writes by id so the extension sends them, optionally editing the note or body first. This works only when the user has turned Autopilot on: in the default Copilot mode approval is a human action and the extension answers UNAUTHORIZED, so show the queue with linkedin_queue_list and ask the user to approve in the popup. Returns {approved}. */
  queueApprove(params: ParamsOf<'queue.approve'> & { dry_run?: boolean }): Promise<ResultOf<'queue.approve'>> {
    return this.call('queue.approve', params);
  }

  /** `queue.reject` — Reject queued writes by id so they are never sent. Like approving, this works only when the user has turned Autopilot on; in the default Copilot mode the extension answers UNAUTHORIZED and the user rejects in the popup. Returns {rejected}. */
  queueReject(params: ParamsOf<'queue.reject'> & { dry_run?: boolean }): Promise<ResultOf<'queue.reject'>> {
    return this.call('queue.reject', params);
  }

  /** `ai.complete` — Call the `ai.complete` action. */
  aiComplete(params: ParamsOf<'ai.complete'>): Promise<ResultOf<'ai.complete'>> {
    return this.call('ai.complete', params);
  }

  /** `export.csv` — Call the `export.csv` action. */
  exportCsv(params: ParamsOf<'export.csv'>): Promise<ResultOf<'export.csv'>> {
    return this.call('export.csv', params);
  }

  /** `research.resolve` — Resolve messy rows (a name, an email, a company domain) to LinkedIn people or companies without doing the full research gather. Use it as a cheap first pass to check match quality before spending visits on linkedin_research_pack. Returns each row with kind, publicId or universalName, a confidence score and candidate profiles. */
  researchResolve(params: ParamsOf<'research.resolve'>): Promise<ResultOf<'research.resolve'>> {
    return this.call('research.resolve', params);
  }

  /** `research.pack` — Turn a list of rows (name, LinkedIn URL, email, domain or company) into full research packs: resolved profile, company, recent posts, mutual connections, connection status, signals and a ready-to-read markdown brief per row. Use it as the one-shot "research these people for me" tool. The server waits for the job to finish and returns the packs; if it takes longer than the research timeout it returns {jobId, status:"running"} and you should poll linkedin_research_get. */
  researchPack(params: ParamsOf<'research.pack'> & { dry_run?: boolean }): Promise<ResultOf<'research.pack'>> {
    return this.call('research.pack', params);
  }

  /** `research.get` — Poll a research job by jobId. Use it after linkedin_research_pack returned status "running". Returns {jobId, status, done, total, packs} with the packs finished so far. */
  researchGet(params: ParamsOf<'research.get'>): Promise<ResultOf<'research.get'>> {
    return this.call('research.get', params);
  }

  /** `sync.pull` — Pull everything changed in the extension since the last sync into the local SQLite mirror. Call it before linkedin_query_sql so the database is current. Returns per-table row counts and the new sync timestamp. */
  syncPull(params: ParamsOf<'sync.pull'> = {} as ParamsOf<'sync.pull'>): Promise<ResultOf<'sync.pull'>> {
    return this.call('sync.pull', params);
  }
}

/** Every action, and the method name this package exposes it under. */
export const ACTION_METHODS: Record<ActionName, string> = {
  'status.get': 'statusGet',
  'config.get': 'configGet',
  'config.set': 'configSet',
  'search.people': 'searchPeople',
  'profile.get': 'profileGet',
  'profile.export': 'profileExport',
  'company.get': 'companyGet',
  'company.employees': 'companyEmployees',
  'post.engagers': 'postEngagers',
  'group.members': 'groupMembers',
  'event.attendees': 'eventAttendees',
  'network.connections': 'networkConnections',
  'network.followers': 'networkFollowers',
  'network.status': 'networkStatus',
  'network.unfollowCount': 'networkUnfollowCount',
  'network.unfollowAll': 'networkUnfollowAll',
  'outreach.view': 'outreachView',
  'outreach.follow': 'outreachFollow',
  'outreach.invite': 'outreachInvite',
  'outreach.message': 'outreachMessage',
  'outreach.inmail': 'outreachInmail',
  'outreach.like': 'outreachLike',
  'outreach.comment': 'outreachComment',
  'inbox.threads': 'inboxThreads',
  'inbox.messages': 'inboxMessages',
  'inbox.export': 'inboxExport',
  'list.create': 'listCreate',
  'list.getAll': 'listGetAll',
  'list.get': 'listGet',
  'list.add': 'listAdd',
  'list.remove': 'listRemove',
  'list.members': 'listMembers',
  'list.delete': 'listDelete',
  'list.importCsv': 'listImportCsv',
  'campaign.create': 'campaignCreate',
  'campaign.getAll': 'campaignGetAll',
  'campaign.get': 'campaignGet',
  'campaign.enroll': 'campaignEnroll',
  'campaign.pause': 'campaignPause',
  'campaign.resume': 'campaignResume',
  'campaign.delete': 'campaignDelete',
  'campaign.tick': 'campaignTick',
  'queue.list': 'queueList',
  'queue.approve': 'queueApprove',
  'queue.reject': 'queueReject',
  'ai.complete': 'aiComplete',
  'export.csv': 'exportCsv',
  'research.resolve': 'researchResolve',
  'research.pack': 'researchPack',
  'research.get': 'researchGet',
  'sync.pull': 'syncPull',
};
