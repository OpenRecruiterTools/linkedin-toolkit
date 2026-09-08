import { describe, it, expect, beforeEach } from 'vitest';
import * as v from '../../src/background/voyager.js';
import { seedSession, stubFetch } from '../helpers/net.js';

import profileView from '../fixtures/voyager/profileView.json';
import searchClusters from '../fixtures/voyager/searchClusters.json';
import companyEmployees from '../fixtures/voyager/companyEmployees.json';
import company from '../fixtures/voyager/company.json';
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

let net;

beforeEach(() => {
  seedSession();
  net = stubFetch();
});

const POST_URL = 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001/';

describe('endpoint catalogue', () => {
  it('keeps every uncertain path in one place', () => {
    expect(Object.keys(v.ENDPOINTS).length).toBeGreaterThan(10);
    for (const path of Object.values(v.ENDPOINTS)) expect(typeof path).toBe('string');
  });
});

describe('profile', () => {
  it('normalizes a profileView into a contract Profile', () => {
    const p = v.normalizeProfileView(profileView);
    expect(p.publicId).toBe('adalovelace');
    expect(p.fullName).toBe('Ada Lovelace');
    expect(p.url).toBe('https://www.linkedin.com/in/adalovelace/');
    expect(p.title).toBe('Chief Analyst');
    expect(p.company).toBe('Analytical Engines');
    expect(p.location).toBe('London, United Kingdom');
    expect(p.industry).toBe('Software Development');
    expect(p.connectionDegree).toBe(2);
    expect(p.skills).toEqual(['Mathematics', 'Algorithms']);
    expect(p.education[0]).toMatchObject({ school: 'University of London', degree: 'BSc' });
    expect(p.experience[0]).toMatchObject({ title: 'Chief Analyst', company: 'Analytical Engines' });
    expect(p.experience[0].start).toBeTypeOf('number');
    expect(p.photoUrl).toContain('media.licdn.com');
    expect(typeof p.capturedAt).toBe('number');
  });

  it('sets connectionDegree to null when the response carries no distance', () => {
    const raw = structuredClone(profileView);
    const profile = raw.included.find((e) => e.publicIdentifier === 'adalovelace');
    delete profile.distance;

    const p = v.normalizeProfileView(raw);
    expect(p.connectionDegree).toBe(null);
    expect('connectionDegree' in p).toBe(true);
  });

  it('viewProfile hits the profileView path and returns the Profile', async () => {
    net.push(profileView);
    const p = await v.viewProfile('adalovelace');
    expect(net.calls[0].url).toContain('/identity/profiles/adalovelace/profileView');
    expect(p.publicId).toBe('adalovelace');
  });
});

describe('search sources', () => {
  it('search maps clusters to Profiles', async () => {
    net.push(searchClusters);
    const out = await v.searchProfiles({ keywords: 'analyst', count: 10 });
    expect(net.calls[0].url).toContain('/search/dash/clusters');
    expect(net.query().get('count')).toBe('10');
    expect(out.profiles.map((p) => p.publicId)).toEqual(['adalovelace', 'bobbright']);
    expect(out.profiles[0].company).toBe('Analytical Engines');
    expect(out.profiles[0].source).toBe('search');
    expect(out.total).toBe(240);
  });

  it('salesNavSearch uses the Sales Navigator API', async () => {
    net.push(salesNavSearch);
    const out = await v.salesNavSearch({ keywords: 'analyst', start: 0, count: 25 });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.salesNavSearch);
    expect(net.query().get('keywords')).toBe('analyst');
    expect(out.profiles[0]).toMatchObject({
      publicId: 'adalovelace',
      title: 'Chief Analyst',
      company: 'Analytical Engines',
      source: 'salesnav',
    });
    expect(out.total).toBe(137);
  });

  it('recruiterSearch uses the Recruiter API', async () => {
    net.push(recruiterSearch);
    const out = await v.recruiterSearch({ keywords: 'analyst' });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.recruiterSearch);
    expect(out.profiles[0]).toMatchObject({ publicId: 'adalovelace', source: 'recruiter' });
    expect(out.total).toBe(58);
  });
});

describe('company', () => {
  it('getCompany queries by universalName and returns a Company', async () => {
    net.push(company);
    const c = await v.getCompany('analytical-engines');
    expect(net.calls[0].url).toContain(v.ENDPOINTS.companies);
    expect(net.query().get('q')).toBe('universalName');
    expect(net.query().get('universalName')).toBe('analytical-engines');
    expect(c).toMatchObject({
      universalName: 'analytical-engines',
      name: 'Analytical Engines',
      industry: 'Software Development',
      website: 'https://analytical-engines.example',
      followerCount: 18400,
    });
    expect(c.url).toBe('https://www.linkedin.com/company/analytical-engines/');
    expect(c.size).toBe('201-500');
    expect(c.hq).toContain('London');
  });

  it('getCompanyEmployees searches people at the company', async () => {
    net.push(companyEmployees);
    const out = await v.getCompanyEmployees({ universalName: 'analytical-engines', count: 10 });
    expect(net.calls[0].url).toContain('/search/dash/clusters');
    expect(decodeURIComponent(net.calls[0].url)).toContain('analytical-engines');
    expect(out.profiles[0].publicId).toBe('carlachen');
    expect(out.nextStart).toBe(10);
  });
});

describe('post engagers', () => {
  it('reads reactions with a threadUrn built from the post URL', async () => {
    net.push(reactions);
    const out = await v.getPostEngagers({ postUrl: POST_URL, kind: 'likes', count: 10 });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.reactions);
    expect(net.query().get('threadUrn')).toBe('urn:li:activity:7000000000000000001');
    expect(out.engagers[0]).toMatchObject({
      publicId: 'adalovelace',
      fullName: 'Ada Lovelace',
      reaction: 'LIKE',
    });
    expect(out.engagers[0].engagedAt).toBe(1757000000000);
  });

  it('reads comments and carries the comment text', async () => {
    net.push(comments);
    const out = await v.getPostEngagers({ postUrl: POST_URL, kind: 'comments' });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.comments);
    expect(out.engagers[0]).toMatchObject({
      publicId: 'bobbright',
      commentText: 'This is exactly the problem we hit last quarter.',
    });
  });

  it("kind 'both' merges the two calls and dedupes on publicId", async () => {
    net.push(reactions);
    net.push(comments);
    const out = await v.getPostEngagers({ postUrl: POST_URL, kind: 'both' });
    expect(net.calls).toHaveLength(2);
    expect(out.engagers.map((e) => e.publicId).sort()).toEqual(['adalovelace', 'bobbright']);
  });

  it('rejects a URL with no activity urn', async () => {
    await expect(v.getPostEngagers({ postUrl: 'https://example.com/x' })).rejects.toThrow(
      /activity/i,
    );
  });
});

describe('audiences', () => {
  it('getGroupMembers unwraps the membership profiles', async () => {
    net.push(groupMembers);
    const out = await v.getGroupMembers({ groupUrl: 'https://www.linkedin.com/groups/12345/' });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.groupMemberships);
    expect(net.query().get('groupUrn')).toBe('urn:li:group:12345');
    expect(out.profiles[0].publicId).toBe('erikericsson');
  });

  it('getEventAttendees unwraps mini profiles', async () => {
    net.push(eventAttendees);
    const out = await v.getEventAttendees({
      eventUrl: 'https://www.linkedin.com/events/7000000000000000009/',
    });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.eventAttendees);
    expect(net.query().get('eventUrn')).toBe('urn:li:event:7000000000000000009');
    expect(out.profiles[0].publicId).toBe('fatimafarouk');
  });

  it('getConnections reads the dash connections collection', async () => {
    net.push(connections);
    const out = await v.getConnections({ start: 0, count: 10 });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.connections);
    expect(out.profiles[0]).toMatchObject({
      publicId: 'adalovelace',
      connectionDegree: 1,
      location: 'London, United Kingdom',
    });
    expect(out.total).toBe(204);
  });

  it('getFollowers reads the followers collection', async () => {
    net.push(followers);
    const out = await v.getFollowers({ start: 0, count: 10 });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.followers);
    expect(out.profiles[0].publicId).toBe('danadupont');
  });
});

describe('messaging', () => {
  it('getConversations maps to contract Threads', async () => {
    net.push(conversations);
    const out = await v.getConversations({ count: 20 });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.conversations);
    expect(out.threads).toHaveLength(2);
    expect(out.threads[0]).toMatchObject({
      threadId: '2-abc123',
      unread: true,
      lastMessageAt: 1757200000000,
      snippet: 'Sounds interesting, can we book a call?',
    });
    expect(out.threads[0].participants[0]).toEqual({
      publicId: 'adalovelace',
      fullName: 'Ada Lovelace',
    });
    expect(out.threads[1].unread).toBe(false);
  });

  it('getConversationMessages maps events to contract Messages, oldest first', async () => {
    net.push(conversationEvents);
    const out = await v.getConversationMessages({ threadId: '2-abc123' });
    expect(net.calls[0].url).toContain('2-abc123');
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].sentAt).toBeLessThan(out.messages[1].sentAt);
    expect(out.messages[1]).toMatchObject({
      threadId: '2-abc123',
      fromPublicId: 'adalovelace',
      body: 'Sounds interesting, can we book a call?',
    });
  });
});

describe('activity and graph', () => {
  it('getMemberPosts returns recent posts', async () => {
    net.push(memberPosts);
    const posts = await v.getMemberPosts({ publicId: 'adalovelace', count: 5 });
    expect(net.calls[0].url).toContain(v.ENDPOINTS.memberPosts);
    expect(posts[0]).toMatchObject({
      text: 'We are hiring two analysts this quarter.',
      likes: 42,
      comments: 7,
      postedAt: 1757000000000,
    });
    expect(posts[0].url).toContain('urn:li:activity:7000000000000000001');
  });

  it('getMutualConnectionsCount reads the total off a zero-count search', async () => {
    net.push(mutualConnections);
    const n = await v.getMutualConnectionsCount({ profileUrn: 'urn:li:fsd_profile:ACoAAAada' });
    expect(net.calls[0].url).toContain('/search/dash/clusters');
    expect(n).toBe(37);
  });
});

describe('writes', () => {
  it('follow toggles the following state for the profile urn', async () => {
    net.push({});
    await v.follow({ profileUrn: 'urn:li:fsd_profile:ACoAAAada' });
    const call = net.calls[0];
    expect(call.method).toBe('POST');
    expect(decodeURIComponent(call.url)).toContain('urn:li:fsd_followingState:urn:li:fsd_profile:ACoAAAada');
    expect(call.url).toContain('action=toggleFollow');
    expect(call.json).toEqual({ patch: { $set: { following: true } } });
  });

  it('likePost posts a LIKE reaction on the activity thread', async () => {
    net.push({});
    await v.likePost({ postUrl: POST_URL });
    const call = net.calls[0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain(v.ENDPOINTS.reactions);
    expect(call.json).toMatchObject({
      reactionType: 'LIKE',
      threadUrn: 'urn:li:activity:7000000000000000001',
    });
  });

  it('commentPost posts the comment text on the activity thread', async () => {
    net.push({});
    await v.commentPost({ postUrl: POST_URL, body: 'Great write-up.' });
    const call = net.calls[0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain(v.ENDPOINTS.comments);
    expect(JSON.stringify(call.json)).toContain('Great write-up.');
  });

  it('sendInMail sends a message with the INMAIL subtype and a subject', async () => {
    net.push({});
    await v.sendInMail({ recipientUrn: 'urn:li:fsd_profile:ACoAAAada', subject: 'Role', body: 'Hi' });
    const call = net.calls[0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/messaging/conversations');
    const create = call.json.conversationCreate;
    expect(create.subtype).toBe('INMAIL');
    expect(
      create.eventCreate.value['com.linkedin.voyager.messaging.create.MessageCreate'].subject,
    ).toBe('Role');
  });
});

describe('transport', () => {
  it('sends the CSRF token, the restli version and the session cookies', async () => {
    net.push(profileView);
    await v.viewProfile('adalovelace');
    const headers = net.calls[0].headers;
    expect(headers['csrf-token']).toBe('ajax:1234567890');
    expect(headers['x-restli-protocol-version']).toBe('2.0.0');
    expect(net.calls[0].credentials).toBe('include');
  });

  it('throws when there is no LinkedIn session', async () => {
    chrome.__mock.cookies.clear();
    await expect(v.getProfile('adalovelace')).rejects.toThrow(/not logged in/i);
  });
});
