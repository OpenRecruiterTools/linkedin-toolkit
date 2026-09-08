import { describe, it, expect, beforeEach } from 'vitest';
import * as v from '../../src/background/voyager.js';
import { ERROR } from '../../src/lib/actions.js';
import { routeBackground, seedSession, status, stubFetch } from '../helpers/net.js';

import profileView from '../fixtures/voyager/profileView.json';
import profileFull from '../fixtures/voyager/profileFull.json';
import profileEducation from '../fixtures/voyager/profileEducation.json';
import profileSkills from '../fixtures/voyager/profileSkills.json';
import profilePositions from '../fixtures/voyager/profilePositions.json';
import searchClusters from '../fixtures/voyager/searchClusters.json';
import companyEmployees from '../fixtures/voyager/companyEmployees.json';
import companyRest from '../fixtures/voyager/companyRest.json';
import companyThin from '../fixtures/voyager/companyThin.json';
import reactions from '../fixtures/voyager/reactions.json';
import comments from '../fixtures/voyager/comments.json';
import connections from '../fixtures/voyager/connections.json';
import followers from '../fixtures/voyager/followers.json';
import groupMembers from '../fixtures/voyager/groupMembers.json';
import eventAttendees from '../fixtures/voyager/eventAttendees.json';
import conversations from '../fixtures/voyager/conversations.json';
import conversationEvents from '../fixtures/voyager/conversationEvents.json';
import salesNavSearch from '../fixtures/voyager/salesNavSearch.json';
import recruiterSearch from '../fixtures/voyager/recruiterSearch.json';
import memberPosts from '../fixtures/voyager/memberPosts.json';
import mutualConnections from '../fixtures/voyager/mutualConnections.json';
import sentInvitations from '../fixtures/voyager/sentInvitations.json';
import sentInvitationsGraphql from '../fixtures/voyager/sentInvitationsGraphql.json';

let net;

beforeEach(() => {
  seedSession();
  net = routeBackground(stubFetch());
  v.forgetSelf();
});

const POST_URL = 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001/';
const SELF_URN = 'urn:li:fsd_profile:ACoAAASELF0000000000000000000000000000';

/** The query string of the nth call, decoded far enough to read. */
const urlOf = (n = 0) => decodeURIComponent(net.calls[n].url);

/* ================================================================== */

describe('endpoint catalogue', () => {
  it('keeps every path, query id and decoration in one place', () => {
    expect(Object.keys(ENDPOINT_STRINGS(v.ENDPOINTS)).length).toBeGreaterThan(10);
    for (const value of ENDPOINT_STRINGS(v.ENDPOINTS)) expect(typeof value).toBe('string');
  });

  it('records which LinkedIn client the table was captured against', () => {
    expect(v.CAPTURED.clientVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(v.CAPTURED.at).toBe('2026-09-08');
  });

  it('every query id is a name and a 32-character hash', () => {
    for (const id of Object.values(v.ENDPOINTS.queryIds)) {
      expect(id).toMatch(/^(voyager|messenger)[A-Za-z]+\.[0-9a-f]{32}$/);
    }
  });

  it('names the unverified endpoints separately from the verified ones', () => {
    expect(Object.keys(v.ENDPOINTS.unverified)).toContain('comments');
    expect(Object.keys(v.ENDPOINTS.unverified)).toContain('followingStates');
    expect(v.ENDPOINTS.comments).toBeUndefined();
  });
});

/** Every leaf string in the catalogue, flattened. */
function ENDPOINT_STRINGS(node) {
  const out = [];
  for (const value of Object.values(node)) {
    if (typeof value === 'string') out.push(value);
    else if (value && typeof value === 'object') out.push(...ENDPOINT_STRINGS(value));
  }
  return out;
}

/* ================================================================== */

describe('graphql variable encoding', () => {
  it('writes a flat object as a Rest.li tuple', () => {
    expect(v.encodeVariables({ start: 0, count: 10 })).toBe('(start:0,count:10)');
  });

  it('percent-encodes the colons inside a urn', () => {
    // Leaving them literal is accepted by search and answered with a 400 by
    // the reactions query and the whole messaging surface.
    expect(v.encodeVariables({ profileUrn: 'urn:li:fsd_profile:ACoAAAada' })).toBe(
      '(profileUrn:urn%3Ali%3Afsd_profile%3AACoAAAada)',
    );
  });

  it('percent-encodes parentheses and commas inside a value', () => {
    expect(
      v.encodeVariables({ conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:A,2-abc)' }),
    ).toBe('(conversationUrn:urn%3Ali%3Amsg_conversation%3A%28urn%3Ali%3Afsd_profile%3AA%2C2-abc%29)');
  });

  it('encodes spaces as %20 rather than +', () => {
    expect(v.encodeVariables({ keywords: 'head of talent' })).toBe('(keywords:head%20of%20talent)');
  });

  it('nests objects and lists', () => {
    expect(
      v.encodeVariables({
        query: {
          keywords: 'cto',
          queryParameters: [{ key: 'resultType', value: ['PEOPLE'] }],
        },
      }),
    ).toBe('(query:(keywords:cto,queryParameters:List((key:resultType,value:List(PEOPLE)))))');
  });

  it('drops empty keys but keeps false and zero', () => {
    expect(v.encodeVariables({ a: undefined, b: null, c: '', d: false, e: 0 })).toBe(
      '(d:false,e:0)',
    );
  });

  it('percent-encodes anything that would end the query string', () => {
    expect(v.encodeVariables({ keywords: 'a&b=c' })).toBe('(keywords:a%26b%3Dc)');
  });

  it('builds a graphql URL with the variables first and the query id last', async () => {
    net.push(reactions);
    await v.getPostEngagers({ postUrl: POST_URL, kind: 'likes', count: 10 });
    expect(net.calls[0].url).toBe(
      'https://www.linkedin.com/voyager/api/graphql?variables=(threadUrn:urn%3Ali%3Aactivity%3A7000000000000000001,count:10,start:0)' +
        `&queryId=${v.ENDPOINTS.queryIds.reactions}`,
    );
  });

  it('omits includeWebMetadata, which some queries reject', async () => {
    net.push(searchClusters);
    await v.searchProfiles({ keywords: 'analyst' });
    expect(net.calls[0].url).not.toContain('includeWebMetadata');
  });
});

/* ================================================================== */

describe('selfTest', () => {
  it('reports the session and our own urn', async () => {
    const out = await v.selfTest();
    expect(net.calls[0].url).toContain('/voyager/api/me');
    expect(out).toMatchObject({ loggedIn: true, selfUrn: SELF_URN, publicId: 'samseller' });
  });

  it('reports a signed-out session rather than throwing', async () => {
    chrome.__mock.cookies.clear();
    expect(await v.selfTest()).toEqual({ loggedIn: false, selfUrn: '' });
  });
});

/* ================================================================== */

describe('profile', () => {
  it('normalizes the top-card decoration into a contract Profile', () => {
    const p = v.normalizeProfileView(profileView);
    expect(p.publicId).toBe('adalovelace');
    expect(p.fullName).toBe('Ada Lovelace');
    expect(p.url).toBe('https://www.linkedin.com/in/adalovelace/');
    expect(p.headline).toBe('Chief Analyst at Analytical Engines');
    expect(p.location).toBe('London, United Kingdom');
    expect(p.connectionDegree).toBe(2);
    expect(p.photoUrl).toContain('media.licdn.com');
    expect(typeof p.capturedAt).toBe('number');
  });

  it('takes the subject from *elements, not the first Profile in included', () => {
    // A top-card response also includes *us*, as the potential inviter.
    expect(profileView.included.filter((e) => e.$type.endsWith('profile.Profile'))).toHaveLength(2);
    expect(v.normalizeProfileView(profileView).publicId).toBe('adalovelace');
  });

  it('reads summary and industry off the full-profile decoration', () => {
    const p = v.normalizeProfileView(profileFull);
    expect(p.summary).toContain('Analyst');
    expect(p.industry).toBe('Software Development');
    // That decoration carries no member relationship, so it cannot state a degree.
    expect(p.connectionDegree).toBe(null);
  });

  it('leaves experience, education and skills empty on a bare decoration', () => {
    const p = v.normalizeProfileView(profileView);
    expect(p.experience).toEqual([]);
    expect(p.education).toEqual([]);
    expect(p.skills).toEqual([]);
  });

  it('sets connectionDegree to null when no relationship came back', () => {
    const raw = structuredClone(profileView);
    raw.included = raw.included.filter((e) => !e.$type.endsWith('MemberRelationship'));
    const p = v.normalizeProfileView(raw);
    expect(p.connectionDegree).toBe(null);
    expect('connectionDegree' in p).toBe(true);
  });

  it('reads a first-degree connection off the relationship union', () => {
    expect(v.normalizeProfileView(profileView).connectionDegree).toBe(2);
  });

  it('fetches the top card and the experience section, and fills title and company', async () => {
    net.push(profileView);
    const p = await v.getProfileNormalized('adalovelace');

    expect(urlOf(0)).toContain('/identity/dash/profiles?q=memberIdentity');
    expect(urlOf(0)).toContain('memberIdentity=adalovelace');
    expect(urlOf(0)).toContain(v.ENDPOINTS.decorations.topCard);

    expect(p.title).toBe('Chief Analyst');
    expect(p.company).toBe('Analytical Engines');
    expect(p.experience).toHaveLength(2);
    expect(p.experience[0]).toMatchObject({ title: 'Chief Analyst', company: 'Analytical Engines' });
    expect(p.experience[0].start).toBe(Date.UTC(2026, 7, 1));
    expect(p.experience[0].end).toBeUndefined();
    expect(p.experience[1].end).toBe(Date.UTC(2018, 11, 1));
  });

  it('full adds the full-profile decoration, education and skills', async () => {
    net.route('sectionType:education', profileEducation);
    net.route('sectionType:skills', profileSkills);
    net.push(profileView);
    net.push(profileFull);

    const p = await v.getProfileNormalized('adalovelace', 'profile', { full: true });

    expect(urlOf(1)).toContain(v.ENDPOINTS.decorations.fullProfile);
    expect(p.summary).toContain('Analyst');
    expect(p.industry).toBe('Software Development');
    // The top card is still the one entitled to state the degree.
    expect(p.connectionDegree).toBe(2);
    expect(p.education[0]).toMatchObject({ school: 'University of London', degree: 'BSc', field: 'Mathematics' });
    expect(p.skills).toEqual(['Mathematics', 'Algorithms']);
  });

  it('keeps the profile when a section read fails', async () => {
    net.route('voyagerIdentityDashProfileComponents', status(400));
    net.push(profileView);
    const p = await v.getProfileNormalized('adalovelace');
    expect(p.publicId).toBe('adalovelace');
    expect(p.experience).toEqual([]);
    expect(p.title).toBe('');
  });

  it('reads a school with no degree line without inventing one', () => {
    // Live shape: `title` = "Harvard University", no subtitle, caption
    // "1973 - 1975".
    const raw = structuredClone(profileEducation);
    const paged = raw.included.find((e) => e.$type.endsWith('PagedListComponent'));
    delete paged.components.elements[0].components.entityComponent.subtitle;

    const [school] = v.sectionToEducation(v.normalizeProfileSection(raw));
    expect(school).toMatchObject({ school: 'University of London', degree: '', field: '' });
    expect(school.start).toBe(Date.UTC(2011, 0, 1));
    expect(school.end).toBe(Date.UTC(2014, 0, 1));
  });

  it('does not invent an experience from the positions query, which carries none', () => {
    // Captured 2026-09-08: every Position is a urn and a company reference,
    // with no title and no dates. Read as a section it yields nothing.
    expect(v.normalizeProfileSection(profilePositions)).toEqual([]);
  });
});

/* ================================================================== */

describe('search', () => {
  it('maps entity results to Profiles', async () => {
    net.push(searchClusters);
    const out = await v.searchProfiles({ keywords: 'analyst', count: 10 });

    expect(net.calls[0].url).toContain(`queryId=${v.ENDPOINTS.queryIds.searchClusters}`);
    expect(urlOf(0)).toContain('(key:resultType,value:List(PEOPLE))');
    expect(urlOf(0)).toContain('count:10');

    expect(out.profiles.map((p) => p.publicId)).toEqual(['adalovelace', 'bobbright']);
    expect(out.profiles[0]).toMatchObject({
      fullName: 'Ada Lovelace',
      headline: 'Chief Analyst at Analytical Engines',
      company: 'Analytical Engines',
      location: 'London, United Kingdom',
      source: 'search',
    });
    expect(out.profiles[0].urn).toMatch(/^urn:li:fsd_profile:/);
    expect(out.total).toBe(240);
    expect(out.nextStart).toBe(10);
  });

  it('reads the degree off the plain memberDistance string', () => {
    const [second, first] = v.normalizeSearchClusters(searchClusters).profiles;
    expect(second.connectionDegree).toBe(2);
    expect(first.connectionDegree).toBe(1);
  });

  it('splits the rendered name into firstName and lastName', () => {
    // A search hit gives one rendered string and no name parts, but
    // `{{firstName}}` is in every campaign template.
    const [ada] = v.normalizeSearchClusters(searchClusters).profiles;
    expect(ada).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });
  });

  it.each([
    ['Ada Lovelace', 'Ada', 'Lovelace'],
    ['Mary Anne Smith', 'Mary', 'Anne Smith'],
    // LinkedIn abbreviates a surname it will not show us. `"J."` is not a
    // name, and putting it in a greeting would be worse than leaving it out.
    ['Govind J.', 'Govind', ''],
    ['Cher', 'Cher', ''],
    ['', '', ''],
  ])('splits %j into %j / %j', (fullName, firstName, lastName) => {
    expect(v.splitFullName(fullName)).toEqual({ firstName, lastName });
  });

  it('never overwrites name parts LinkedIn did give us', () => {
    const p = v.toProfile({ fullName: 'Ada Lovelace', firstName: 'Augusta', lastName: 'Byron' });
    expect(p).toMatchObject({ firstName: 'Augusta', lastName: 'Byron' });
  });

  it('appends the title to the keywords, because title is not a facet', async () => {
    net.push(searchClusters);
    await v.searchProfiles({ keywords: 'fintech', title: 'CTO' });
    expect(net.calls[0].url).toContain('keywords:fintech%20CTO');
    expect(urlOf(0)).not.toContain('key:title');
  });

  it('appends the location to the keywords too', async () => {
    net.push(searchClusters);
    await v.searchProfiles({ keywords: 'cto', location: 'London' });
    expect(net.calls[0].url).toContain('keywords:cto%20London');
  });

  it('resolves a company slug to the currentCompany facet', async () => {
    net.push(companyRest);
    net.push(searchClusters);
    await v.searchProfiles({ keywords: 'engineer', company: 'analytical-engines' });

    expect(net.calls[0].url).toContain('/organization/companies');
    expect(urlOf(1)).toContain('(key:currentCompany,value:List(9001))');
    expect(urlOf(1)).not.toContain('analytical-engines');
  });

  it('falls back to keywords for a company name that is not a slug', async () => {
    net.push(searchClusters);
    await v.searchProfiles({ keywords: 'engineer', company: 'Analytical Engines Ltd' });
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].url).toContain('keywords:engineer%20Analytical%20Engines%20Ltd');
  });

  it('falls back to keywords when the company lookup finds nothing', async () => {
    net.push({ data: {}, included: [] }); // the REST read
    net.push({ data: { data: {} }, included: [] }); // and the graphql fallback
    net.push(searchClusters);
    await v.searchProfiles({ keywords: 'engineer', company: 'nope-not-a-company' });
    expect(net.calls[2].url).toContain('keywords:engineer%20nope-not-a-company');
  });
});

describe('search sources that could not be verified', () => {
  it('salesNavSearch still maps a Sales Navigator page', async () => {
    net.push(salesNavSearch);
    const out = await v.salesNavSearch({ keywords: 'analyst', start: 0, count: 25 });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.unverified.salesNavSearch);
    expect(out.profiles[0]).toMatchObject({ publicId: 'adalovelace', source: 'salesnav' });
  });

  it('recruiterSearch still maps a Recruiter page', async () => {
    net.push(recruiterSearch);
    const out = await v.recruiterSearch({ keywords: 'analyst' });
    expect(out.profiles[0]).toMatchObject({ publicId: 'adalovelace', source: 'recruiter' });
  });

  it('turns an unrecognised body into one honest error, not raw JSON', async () => {
    net.push(status(400, { status: 400, message: 'BAD' }));
    const error = await v.salesNavSearch({ keywords: 'x' }).catch((e) => e);
    expect(error.code).toBe(ERROR.LINKEDIN_ERROR);
    expect(error.message).not.toContain('BAD');
    expect(error.extra.howToFix).toContain('docs/voyager-endpoints.md');
  });

  it('lets a signed-out session through unchanged', async () => {
    chrome.__mock.cookies.clear();
    const error = await v.salesNavSearch({ keywords: 'x' }).catch((e) => e);
    expect(error.code).toBe(ERROR.NOT_LOGGED_IN);
  });
});

/* ================================================================== */

describe('company', () => {
  it('reads a company by universal name off the REST decoration', async () => {
    net.push(companyRest);
    const c = await v.getCompany('analytical-engines');
    expect(net.calls[0].url).toContain('/organization/companies');
    expect(net.query().get('decorationId')).toBe(v.ENDPOINTS.decorations.company);
    expect(net.query().get('q')).toBe('universalName');
    expect(c).toMatchObject({
      universalName: 'analytical-engines',
      urn: 'urn:li:fs_normalized_company:9001',
      name: 'Analytical Engines',
      industry: 'Software Development',
      website: 'https://analytical-engines.example',
      followerCount: 18400,
    });
    expect(c.url).toBe('https://www.linkedin.com/company/analytical-engines/');
    expect(c.size).toBe('201-500');
    expect(c.hq).toContain('London');
  });

  it('falls back to graphql, and still returns the urn from a thin decoration', async () => {
    // The REST read is refused, and the graphql query answers with what it
    // answered for `microsoft` on 2026-09-08: an entityUrn and nothing else.
    net.push(status(404));
    net.push(companyThin);
    const c = await v.getCompany('microsoft');
    expect(c.urn).toBe('urn:li:fsd_company:1035');
    expect(c.universalName).toBe('microsoft');
    expect(c.name).toBe('');
  });

  it('reports a company that is genuinely not there', async () => {
    net.push({ data: {}, included: [] });
    net.push({ data: { data: {} }, included: [] });
    await expect(v.getCompany('nope')).rejects.toMatchObject({ code: ERROR.NOT_FOUND });
  });

  it('resolves the numeric id before searching employees', async () => {
    net.push(companyRest);
    net.push(companyEmployees);
    const out = await v.getCompanyEmployees({ universalName: 'analytical-engines', count: 10 });

    expect(urlOf(1)).toContain('(key:currentCompany,value:List(9001))');
    expect(urlOf(1)).toContain('origin:COMPANY_PAGE_CANNED_SEARCH');
    expect(out.profiles[0].publicId).toBe('carlachen');
    expect(out.nextStart).toBe(10);
  });

  it('skips the lookup when the caller already has the id', async () => {
    net.push(companyEmployees);
    await v.getCompanyEmployees({ companyId: '1035', count: 5 });
    expect(net.calls).toHaveLength(1);
    expect(urlOf(0)).toContain('(key:currentCompany,value:List(1035))');
  });
});

/* ================================================================== */

describe('post engagers', () => {
  it('reads reactions through the social graphql query', async () => {
    net.push(reactions);
    const out = await v.getPostEngagers({ postUrl: POST_URL, kind: 'likes', count: 10 });

    expect(net.calls[0].url).toContain(v.ENDPOINTS.queryIds.reactions);
    expect(urlOf(0)).toContain('threadUrn:urn:li:activity:7000000000000000001');

    expect(out.engagers[0]).toMatchObject({
      publicId: 'adalovelace',
      fullName: 'Ada Lovelace',
      reaction: 'LIKE',
      connectionDegree: 1,
    });
    expect(out.engagers[1]).toMatchObject({ publicId: 'bobbright', reaction: 'PRAISE' });
  });

  it('fails honestly when comments are asked for on their own', async () => {
    net.push(status(400));
    const error = await v.getPostEngagers({ postUrl: POST_URL, kind: 'comments' }).catch((e) => e);
    expect(error.code).toBe(ERROR.LINKEDIN_ERROR);
    expect(error.extra.howToFix).toContain('docs/voyager-endpoints.md');
  });

  it("'both' keeps the reactions it did read and names what it could not", async () => {
    net.push(reactions);
    net.push(status(400));
    const out = await v.getPostEngagers({ postUrl: POST_URL, kind: 'both' });
    expect(out.engagers.map((e) => e.publicId)).toContain('adalovelace');
    expect(out.unavailable).toEqual(['comments']);
  });

  it("'both' merges the two sources when comments do answer", async () => {
    net.push(reactions);
    net.push(comments);
    const out = await v.getPostEngagers({ postUrl: POST_URL, kind: 'both' });
    expect(out.unavailable).toBeUndefined();
    expect(out.engagers.map((e) => e.publicId).sort()).toEqual(['adalovelace', 'bobbright']);
    expect(out.engagers.find((e) => e.publicId === 'bobbright').commentText).toContain('quarter');
  });

  it('rejects a URL with no activity urn', async () => {
    await expect(v.getPostEngagers({ postUrl: 'https://example.com/x' })).rejects.toThrow(
      /activity/i,
    );
  });
});

/* ================================================================== */

describe('audiences', () => {
  it('getConnections reads the dash collection and states the degree', async () => {
    net.push(connections);
    const out = await v.getConnections({ start: 0, count: 10 });
    expect(urlOf(0)).toContain(v.ENDPOINTS.connections);
    expect(urlOf(0)).toContain(v.ENDPOINTS.decorations.connectionList);
    expect(out.profiles[0]).toMatchObject({ connectionDegree: 1 });
    expect(out.profiles.map((p) => p.publicId)).toContain('adalovelace');
    expect(out.profiles[0].photoUrl).toContain('media.licdn.com');
  });

  it('getFollowers reads the curation-hub search', async () => {
    net.push(followers);
    const out = await v.getFollowers({ start: 0, count: 10 });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.queryIds.searchClusters);
    expect(urlOf(0)).toContain('(key:resultType,value:List(FOLLOWERS))');
    expect(out.profiles[0].publicId).toBe('danadupont');
    // Followers carry no distance, so nothing may be claimed about it.
    expect('connectionDegree' in out.profiles[0]).toBe(false);
  });

  it('group members and event attendees report themselves as unverified', async () => {
    net.push(status(400));
    const error = await v
      .getGroupMembers({ groupUrl: 'https://www.linkedin.com/groups/12345/' })
      .catch((e) => e);
    expect(error.code).toBe(ERROR.LINKEDIN_ERROR);
    expect(error.extra.howToFix).toContain('docs/voyager-endpoints.md');
  });

  it('still maps a group membership page if one comes back', async () => {
    net.push(groupMembers);
    const out = await v.getGroupMembers({ groupUrl: 'https://www.linkedin.com/groups/12345/' });
    expect(out.profiles[0].publicId).toBe('erikericsson');
  });

  it('still maps an event attendee page if one comes back', async () => {
    net.push(eventAttendees);
    const out = await v.getEventAttendees({
      eventUrl: 'https://www.linkedin.com/events/7000000000000000009/',
    });
    expect(out.profiles[0].publicId).toBe('fatimafarouk');
  });
});

/* ================================================================== */

describe('messaging', () => {
  it('addresses the mailbox with our own urn and maps contract Threads', async () => {
    net.push(conversations);
    const out = await v.getConversations({ count: 20 });

    const call = net.calls.find((c) => c.url.includes('messengerConversations'));
    expect(call.url).toContain('/voyagerMessagingGraphQL/graphql');
    // The messaging surface rejects includeWebMetadata, and wants these
    // variables by exactly these names in exactly this order.
    expect(call.url).not.toContain('includeWebMetadata');
    expect(call.url).toContain(
      `variables=(categories:List(INBOX,SPAM,ARCHIVE),count:20,firstDegreeConnections:false,mailboxUrn:${encodeURIComponent(SELF_URN)},read:false)`,
    );
    expect(call.url).toContain(`queryId=${v.ENDPOINTS.queryIds.conversations}`);

    expect(out.threads).toHaveLength(2);
    expect(out.threads[0]).toMatchObject({
      threadId: '2-abc123',
      unread: true,
      lastMessageAt: 1757200000000,
      snippet: 'Sounds interesting, can we book a call?',
    });
    // We are a participant of our own conversation and must not be listed.
    expect(out.threads[0].participants).toEqual([
      { publicId: 'adalovelace', fullName: 'Ada Lovelace' },
    ]);
    expect(out.threads[1].unread).toBe(false);
  });

  it('rebuilds the conversation urn from a stored thread id', async () => {
    net.push(conversationEvents);
    const out = await v.getConversationMessages({ threadId: '2-abc123' });

    const call = net.calls.find((c) => c.url.includes('messengerMessages'));
    expect(decodeURIComponent(call.url)).toContain(
      `conversationUrn:urn:li:msg_conversation:(${SELF_URN},2-abc123)`,
    );

    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].sentAt).toBeLessThan(out.messages[1].sentAt);
    expect(out.messages[1]).toMatchObject({
      threadId: '2-abc123',
      fromPublicId: 'adalovelace',
      body: 'Sounds interesting, can we book a call?',
    });
    expect(out.messages[0].fromUrn).toBe(SELF_URN);
  });

  it('pages the inbox by category with a lastUpdatedBefore cursor', async () => {
    net.push(conversations);
    await v.getConversations({ count: 20, createdBefore: 1757000000000 });
    const call = net.calls.find((c) => c.url.includes('messengerConversations'));
    expect(call.url).toContain(`queryId=${v.ENDPOINTS.queryIds.conversationsByCategory}`);
    expect(decodeURIComponent(call.url)).toContain('conversationCategoryPredicate:(category:INBOX)');
    expect(decodeURIComponent(call.url)).toContain('lastUpdatedBefore:1757000000000');
  });

  it('anchors the message read on a timestamp', async () => {
    net.push(conversationEvents);
    await v.getConversationMessages({ threadId: '2-abc123', createdBefore: 1757000000000 });
    const call = net.calls.find((c) => c.url.includes('messengerMessages'));
    expect(call.url).toContain(`queryId=${v.ENDPOINTS.queryIds.messages}`);
    expect(call.url).toContain('variables=(deliveredAt:1757000000000,conversationUrn:');
    expect(call.url).toContain(',countBefore:20,countAfter:0)');
  });
});

/* ================================================================== */

describe('activity and graph', () => {
  it('getMemberPosts reads the profile-updates query', async () => {
    net.push(memberPosts);
    const posts = await v.getMemberPosts({ profileUrn: 'urn:li:fsd_profile:ACoAAAada', count: 5 });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.queryIds.memberPosts);
    expect(urlOf(0)).toContain('profileUrn:urn:li:fsd_profile:ACoAAAada');
    expect(posts[0]).toMatchObject({
      text: 'We are hiring two analysts this quarter.',
      likes: 42,
      comments: 7,
      postedAt: 1757000000000,
    });
    expect(posts[0].url).toContain('urn:li:activity:7000000000000000001');
  });

  it('getMutualConnectionsCount reads the total off a first-degree search', async () => {
    net.push(mutualConnections);
    const n = await v.getMutualConnectionsCount({ profileUrn: 'urn:li:fsd_profile:ACoAAAada' });
    expect(urlOf(0)).toContain('(key:connectionOf,value:List(ACoAAAada))');
    expect(urlOf(0)).toContain('(key:network,value:List(F))');
    expect(n).toBe(37);
  });
});

/* ================================================================== */

describe('sent invitations', () => {
  it('reads the REST view and returns who is still pending', async () => {
    net.push(sentInvitations);
    const out = await v.getSentInvitations({ count: 10 });
    expect(net.calls[0].url).toContain('/relationships/sentInvitationViewsV2');
    expect(net.query().get('invitationType')).toBe('CONNECTION');
    expect(out.map((i) => i.publicId)).toContain('adalovelace');
    expect(out[0].invitationUrn).toContain('urn:li:fs_relInvitation:');
    expect(typeof out[0].sentAt).toBe('number');
  });

  it('falls back to the graphql view when the REST one stops answering', async () => {
    net.push(status(400));
    net.push(sentInvitationsGraphql);
    const out = await v.getSentInvitations({ count: 10 });
    expect(net.calls[1].url).toContain(v.ENDPOINTS.queryIds.sentInvitations);
    expect(out.map((i) => i.publicId)).toEqual(['adalovelace', 'bobbright']);
  });

  it('does not fall back when the session is the problem', async () => {
    chrome.__mock.cookies.clear();
    await expect(v.getSentInvitations()).rejects.toMatchObject({ code: ERROR.NOT_LOGGED_IN });
  });
});

/* ================================================================== */

describe('writes', () => {
  it('sendInvite posts the member profile urn and the note', async () => {
    net.push({});
    await v.sendInvite({ profileUrn: 'urn:li:fsd_profile:ACoAAAada', note: 'Hello Ada' });
    const call = net.calls[0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('action=verifyQuotaAndCreateV2');
    expect(call.json.invitee.inviteeUnion.memberProfile).toBe('urn:li:fsd_profile:ACoAAAada');
    expect(call.json.customMessage).toBe('Hello Ada');
  });

  it('sendMessage posts to the messenger create action with our mailbox', async () => {
    net.push({});
    await v.sendMessage({ recipientUrn: 'urn:li:fsd_profile:ACoAAAada', body: 'Hi' });
    const call = net.calls[net.calls.length - 1];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('action=createMessage');
    expect(call.json.mailboxUrn).toBe(SELF_URN);
    expect(call.json.hostRecipientUrns).toEqual(['urn:li:fsd_profile:ACoAAAada']);
    expect(call.json.message.body.text).toBe('Hi');
  });

  it('sendInMail carries the subject', async () => {
    net.push({});
    await v.sendInMail({ recipientUrn: 'urn:li:fsd_profile:ACoAAAada', subject: 'Role', body: 'Hi' });
    const call = net.calls[net.calls.length - 1];
    expect(call.json.message.subject).toBe('Role');
    expect(call.json.messageSubtype).toBe('INMAIL');
  });

  it('follow toggles the following state for the profile urn', async () => {
    net.push({});
    await v.follow({ profileUrn: 'urn:li:fsd_profile:ACoAAAada' });
    const call = net.calls[0];
    expect(call.method).toBe('POST');
    expect(decodeURIComponent(call.url)).toContain(
      'urn:li:fsd_followingState:urn:li:fsd_profile:ACoAAAada',
    );
    expect(call.json).toEqual({ patch: { $set: { following: true } } });
  });

  it('likePost posts a LIKE reaction on the activity thread', async () => {
    net.push({});
    await v.likePost({ postUrl: POST_URL });
    const call = net.calls[0];
    expect(call.json).toMatchObject({
      reactionType: 'LIKE',
      threadUrn: 'urn:li:activity:7000000000000000001',
    });
  });

  it('commentPost posts the comment text on the activity thread', async () => {
    net.push({});
    await v.commentPost({ postUrl: POST_URL, body: 'Great write-up.' });
    expect(JSON.stringify(net.calls[0].json)).toContain('Great write-up.');
  });

  it('a refused write surfaces as the unverified error, not raw JSON', async () => {
    net.push(status(500, { message: 'internal', trace: 'secret' }));
    const error = await v.likePost({ postUrl: POST_URL }).catch((e) => e);
    expect(error.code).toBe(ERROR.LINKEDIN_ERROR);
    expect(error.message).not.toContain('secret');
  });
});

/* ================================================================== */

describe('transport', () => {
  it('sends the CSRF token, the restli version, the accept header and the cookies', async () => {
    net.push(profileView);
    await v.viewProfile('adalovelace');
    const headers = net.calls[0].headers;
    expect(headers['csrf-token']).toBe('ajax:1234567890');
    expect(headers['x-restli-protocol-version']).toBe('2.0.0');
    expect(headers.accept).toBe('application/vnd.linkedin.normalized+json+2.1');
    expect(headers['x-li-lang']).toBe('en_US');
    expect(net.calls[0].credentials).toBe('include');
  });

  it('throws when there is no LinkedIn session', async () => {
    chrome.__mock.cookies.clear();
    await expect(v.getProfile('adalovelace')).rejects.toThrow(/not logged in/i);
  });
});

/* ================================================================== */

describe('endpoint self-check', () => {
  it('reports one word per endpoint and names the captured client', async () => {
    net.route('identity/dash/profiles', profileView);
    net.route('voyagerSearchDashClusters', searchClusters);
    net.route('/organization/companies', companyRest);
    net.route('/relationships/dash/connections', connections);
    net.route('sentInvitationViewsV2', sentInvitations);
    net.route('messengerConversations', conversations);
    net.route('voyagerFeedDashProfileUpdates', memberPosts);

    const out = await v.verifyEndpoints();

    expect(out.clientVersionCaptured).toBe(v.CAPTURED.clientVersion);
    expect(out.endpoints.me).toBe('ok');
    expect(out.endpoints.profile).toBe('ok');
    expect(out.endpoints.profileExperience).toBe('ok');
    expect(out.endpoints.search).toBe('ok');
    expect(out.endpoints.company).toBe('ok');
    expect(out.endpoints.connections).toBe('ok');
    expect(out.endpoints.conversations).toBe('ok');
    expect(out.endpoints.memberPosts).toBe('ok');
    // No post to count likes on was configured.
    expect(out.endpoints.reactions).toBe('skipped');
    for (const name of v.UNVERIFIABLE) expect(out.endpoints[name]).toBe('unverified');
  });

  it('marks a stale query id failed and records why', async () => {
    net.route('identity/dash/profiles', profileView);
    net.route('voyagerSearchDashClusters', searchClusters);
    net.route('/organization/companies', status(400));
    net.route('voyagerOrganizationDashCompanies', status(400));
    net.route('/relationships/dash/connections', connections);
    net.route('sentInvitationViewsV2', sentInvitations);
    net.route('messengerConversations', conversations);
    net.route('voyagerFeedDashProfileUpdates', memberPosts);

    const out = await v.verifyEndpoints();
    expect(out.endpoints.company).toBe('failed');
    expect(out.errors.company).toBeTruthy();
  });

  it('skips everything and calls nothing when signed out', async () => {
    chrome.__mock.cookies.clear();
    const out = await v.verifyEndpoints();
    expect(out.endpoints.me).toBe('failed');
    expect(out.endpoints.search).toBe('skipped');
    expect(net.calls).toHaveLength(0);
  });

  it('meters the search and the profile read like the real actions', async () => {
    net.route('identity/dash/profiles', profileView);
    net.route('voyagerSearchDashClusters', searchClusters);
    net.route('/organization/companies', companyRest);
    net.route('/relationships/dash/connections', connections);
    net.route('sentInvitationViewsV2', sentInvitations);
    net.route('messengerConversations', conversations);
    net.route('voyagerFeedDashProfileUpdates', memberPosts);

    const charged = [];
    await v.verifyEndpoints({ meter: async (kind, n) => charged.push([kind, n]) });
    expect(charged).toEqual([
      ['visit', 1],
      ['search', 1],
    ]);
  });
});
