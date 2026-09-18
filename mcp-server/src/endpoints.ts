/**
 * Endpoint drift: which LinkedIn call broke, and what to edit.
 *
 * LinkedIn's persisted GraphQL queries are addressed by a `queryId` — a name
 * and a 32-hex hash that changes with every web client release. A stale hash
 * answers 400, and the feature that used it stops working for everybody at
 * once. `lit endpoints check` says *which* checks failed; this table says what
 * a failed check means you have to re-capture, because "memberPosts failed" is
 * only useful to somebody who already knows the codebase.
 *
 * Nothing here calls LinkedIn. The check itself runs inside the user's own
 * extension, in their own session — which is why it can only ever be run by a
 * person, and why no CI job in this repository can do it for them.
 */

export type EndpointSource = {
  /** What the check exercises, in one line. */
  does: string;
  /** The `ENDPOINTS` keys in extension/src/background/voyager.js to re-capture. */
  keys: string[];
  /** The GraphQL query whose hash goes stale, when it is one. */
  queryName?: string;
};

export const VOYAGER_FILE = 'extension/src/background/voyager.js';
export const RECAPTURE_DOC = 'docs/voyager-endpoints.md#re-capturing';

/**
 * Check name (as `status.get { verify: true }` reports it) → what to fix.
 * Kept in the same order the check runs them.
 */
export const ENDPOINT_SOURCES: Record<string, EndpointSource> = {
  me: {
    does: 'reads /voyager/api/me — the session test everything else depends on',
    keys: ['ENDPOINTS.me'],
  },
  profile: {
    does: 'reads one profile through the REST profiles decoration',
    keys: ['ENDPOINTS.profiles', 'ENDPOINTS.decorations.fullProfile', 'ENDPOINTS.decorations.topCard'],
  },
  profileExperience: {
    does: 'reads the experience section of a profile',
    keys: ['ENDPOINTS.queryIds.profileComponents'],
    queryName: 'voyagerIdentityDashProfileComponents',
  },
  search: {
    does: 'runs a one-result people search',
    keys: ['ENDPOINTS.queryIds.searchClusters'],
    queryName: 'voyagerSearchDashClusters',
  },
  company: {
    does: 'reads a company page',
    keys: ['ENDPOINTS.companies', 'ENDPOINTS.decorations.company', 'ENDPOINTS.queryIds.company'],
    queryName: 'voyagerOrganizationDashCompanies',
  },
  companyEmployees: {
    does: 'lists employees of a company (a search behind a company id lookup)',
    keys: ['ENDPOINTS.queryIds.searchClusters', 'ENDPOINTS.queryIds.company'],
    queryName: 'voyagerSearchDashClusters',
  },
  connections: {
    does: 'reads your connections list',
    keys: ['ENDPOINTS.connections', 'ENDPOINTS.decorations.connectionList'],
  },
  sentInvitations: {
    does: 'reads invitations you have sent — the accepted/pending signal',
    keys: ['ENDPOINTS.sentInvitations', 'ENDPOINTS.queryIds.sentInvitations'],
    queryName: 'voyagerRelationshipsDashSentInvitationViews',
  },
  conversations: {
    does: 'reads the messaging inbox',
    keys: ['ENDPOINTS.queryIds.conversations', 'ENDPOINTS.queryIds.conversationsByCategory'],
    queryName: 'messengerConversations',
  },
  followers: {
    does: 'reads your followers through the curation hub — also what mass unfollow walks',
    keys: ['ENDPOINTS.queryIds.searchClusters', 'ENDPOINTS.curationHub'],
    queryName: 'voyagerSearchDashClusters',
  },
  memberPosts: {
    does: 'reads a member\'s recent posts (research packs)',
    keys: ['ENDPOINTS.queryIds.memberPosts'],
    queryName: 'voyagerFeedDashProfileUpdates',
  },
  reactions: {
    does: 'reads who reacted to a post',
    keys: ['ENDPOINTS.queryIds.reactions'],
    queryName: 'voyagerSocialDashReactions',
  },
  invite: {
    does: 'the invitation write — never probed, because probing it sends one',
    keys: ['ENDPOINTS.createInvitation', 'ENDPOINTS.decorations.invitationCreation'],
  },
};

/** What to do about one failed check, in the words of somebody who will fix it. */
export function diagnose(name: string, error?: string): string[] {
  const source = ENDPOINT_SOURCES[name];
  const lines = [`${name} — failed${error ? `: ${error}` : ''}`];
  if (!source) {
    lines.push(
      `  This check is not in the drift table. Report it with the output of \`lit endpoints check --json\`.`,
    );
    return lines;
  }
  lines.push(`  It ${source.does}.`);
  if (source.queryName) {
    lines.push(
      `  Stale hash: the 32 hex characters after "${source.queryName}." in ${source.keys[0]}`,
      `  (${VOYAGER_FILE}). Re-capture it: ${RECAPTURE_DOC}`,
    );
    if (source.keys.length > 1) {
      lines.push(`  Check these too: ${source.keys.slice(1).join(', ')}`);
    }
  } else {
    lines.push(
      `  No query id here — check ${source.keys.join(', ')} in ${VOYAGER_FILE}.`,
      `  A decoration id (the number after the decoration name) moves the same way a hash does.`,
    );
  }
  return lines;
}

export type DoctorInput = {
  endpoints: Record<string, string>;
  errors?: Record<string, string>;
  clientVersionCaptured?: string;
  endpointsCapturedAt?: string;
  loggedIn?: boolean;
  extensionVersion?: string;
};

/**
 * The whole report: a verdict, then one block per failure.
 *
 * Deliberately verbose on failure and short on success — it is read once,
 * usually by somebody whose script stopped working this morning.
 */
export function doctorReport(input: DoctorInput): { text: string; failed: string[] } {
  const entries = Object.entries(input.endpoints ?? {});
  const failed = entries.filter(([, result]) => result === 'failed').map(([name]) => name);
  const unverified = entries.filter(([, result]) => result === 'unverified').map(([name]) => name);
  const captured = input.clientVersionCaptured ?? 'unknown';
  const capturedAt = input.endpointsCapturedAt ?? 'unknown';

  const head = [
    'LinkedIn Toolkit endpoint doctor',
    '',
    `  captured against   LinkedIn web client ${captured} on ${capturedAt}`,
    `  checks run         ${entries.length}`,
    `  failed             ${failed.length}`,
    `  never verified     ${unverified.length}${unverified.length ? ` (${unverified.join(', ')})` : ''}`,
    '',
  ];

  if (failed.length === 0) {
    return {
      failed,
      text: [
        ...head,
        'Every verified endpoint still answers. Nothing to re-capture.',
        '',
        unverified.length
          ? `The ${unverified.length} unverified ones were never confirmed against a live client and are never called silently — see ${RECAPTURE_DOC}.`
          : '',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    };
  }

  const blocks = failed.flatMap((name) => [...diagnose(name, input.errors?.[name]), '']);

  return {
    failed,
    text: [
      ...head,
      `${failed.length} endpoint${failed.length === 1 ? '' : 's'} failed. LinkedIn ships a new web client`,
      'every week or two and every persisted query id changes with it, so a failure here is',
      'almost always a stale hash rather than a ban or a bug.',
      '',
      ...blocks,
      'If you are not going to re-capture it yourself, open an issue with the output of:',
      '',
      '  lit endpoints check --json',
      '',
      `That is what the "Endpoint drift" issue template asks for. No CI job can run this check:`,
      'it needs a signed-in LinkedIn session in your own browser, and this project never puts',
      'one in a workflow.',
    ].join('\n'),
  };
}
