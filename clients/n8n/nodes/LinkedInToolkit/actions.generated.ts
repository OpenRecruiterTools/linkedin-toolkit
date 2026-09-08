/**
 * AUTO-GENERATED — do not edit by hand.
 *
 * Written by `npm run gen` in `clients/n8n` from `mcp-server/openapi.json`
 * and `mcp-server/tools.json`. Every resource, operation and field in the
 * node comes from here, so the node cannot fall behind the action contract
 * without `tests/gen.test.ts` failing.
 */

export type FieldSpec = {
  name: string;
  key: string;
  displayName: string;
  type: 'string' | 'number' | 'boolean' | 'options' | 'json' | 'stringList';
  required: boolean;
  default: string | number | boolean;
  description: string;
  options?: Array<{ name: string; value: string }>;
};

export type ActionSpec = {
  action: string;
  key: string;
  resource: string;
  operation: string;
  displayName: string;
  description: string;
  write: boolean;
  required: FieldSpec[];
  optional: FieldSpec[];
};

export const RESOURCES: Array<{ name: string; value: string; description: string }> = [
  {
    "name": "Status",
    "value": "status",
    "description": "1 operation(s)."
  },
  {
    "name": "Config",
    "value": "config",
    "description": "2 operation(s)."
  },
  {
    "name": "Search",
    "value": "search",
    "description": "1 operation(s)."
  },
  {
    "name": "Profile",
    "value": "profile",
    "description": "2 operation(s)."
  },
  {
    "name": "Company",
    "value": "company",
    "description": "2 operation(s)."
  },
  {
    "name": "Post",
    "value": "post",
    "description": "1 operation(s)."
  },
  {
    "name": "Group",
    "value": "group",
    "description": "1 operation(s)."
  },
  {
    "name": "Event",
    "value": "event",
    "description": "1 operation(s)."
  },
  {
    "name": "Network",
    "value": "network",
    "description": "5 operation(s)."
  },
  {
    "name": "Outreach",
    "value": "outreach",
    "description": "7 operation(s)."
  },
  {
    "name": "Inbox",
    "value": "inbox",
    "description": "3 operation(s)."
  },
  {
    "name": "List",
    "value": "list",
    "description": "8 operation(s)."
  },
  {
    "name": "Campaign",
    "value": "campaign",
    "description": "8 operation(s)."
  },
  {
    "name": "Queue",
    "value": "queue",
    "description": "3 operation(s)."
  },
  {
    "name": "AI",
    "value": "ai",
    "description": "1 operation(s)."
  },
  {
    "name": "Export",
    "value": "export",
    "description": "1 operation(s)."
  },
  {
    "name": "Research",
    "value": "research",
    "description": "3 operation(s)."
  },
  {
    "name": "Sync",
    "value": "sync",
    "description": "1 operation(s)."
  }
];

export const ACTIONS: ActionSpec[] = [
  {
    "action": "status.get",
    "key": "status_get",
    "resource": "status",
    "operation": "get",
    "displayName": "Get",
    "description": "Check that the Chrome extension is connected and the user is logged in to LinkedIn. Call this first in any session and again after a rate-limit error; returns extension version, autopilot on/off, business-hours flag, per-quota usage (invite, message, visit, search), pending approval-queue size and campaign counts.",
    "write": false,
    "required": [],
    "optional": []
  },
  {
    "action": "config.get",
    "key": "config_get",
    "resource": "config",
    "operation": "get",
    "displayName": "Get",
    "description": "Run the `config.get` action on the connected extension.",
    "write": false,
    "required": [],
    "optional": []
  },
  {
    "action": "config.set",
    "key": "config_set",
    "resource": "config",
    "operation": "set",
    "displayName": "Set",
    "description": "Run the `config.set` action on the connected extension. This is a write action: it is rate-capped and queues for approval in Copilot mode.",
    "write": false,
    "required": [],
    "optional": [
      {
        "name": "config_set_minDelayMs",
        "key": "minDelayMs",
        "displayName": "Min Delay Ms",
        "required": false,
        "description": "The Min Delay Ms parameter.",
        "type": "number",
        "default": 0
      },
      {
        "name": "config_set_maxDelayMs",
        "key": "maxDelayMs",
        "displayName": "Max Delay Ms",
        "required": false,
        "description": "The Max Delay Ms parameter.",
        "type": "number",
        "default": 0
      },
      {
        "name": "config_set_hourlyCap",
        "key": "hourlyCap",
        "displayName": "Hourly Cap",
        "required": false,
        "description": "The Hourly Cap parameter.",
        "type": "number",
        "default": 0
      },
      {
        "name": "config_set_dailyInviteCap",
        "key": "dailyInviteCap",
        "displayName": "Daily Invite Cap",
        "required": false,
        "description": "The Daily Invite Cap parameter.",
        "type": "number",
        "default": 0
      },
      {
        "name": "config_set_dailyMessageCap",
        "key": "dailyMessageCap",
        "displayName": "Daily Message Cap",
        "required": false,
        "description": "The Daily Message Cap parameter.",
        "type": "number",
        "default": 0
      },
      {
        "name": "config_set_dailyVisitCap",
        "key": "dailyVisitCap",
        "displayName": "Daily Visit Cap",
        "required": false,
        "description": "The Daily Visit Cap parameter.",
        "type": "number",
        "default": 0
      },
      {
        "name": "config_set_dailySearchCap",
        "key": "dailySearchCap",
        "displayName": "Daily Search Cap",
        "required": false,
        "description": "The Daily Search Cap parameter.",
        "type": "number",
        "default": 0
      },
      {
        "name": "config_set_businessHoursOnly",
        "key": "businessHoursOnly",
        "displayName": "Business Hours Only",
        "required": false,
        "description": "The Business Hours Only parameter.",
        "type": "boolean",
        "default": false
      },
      {
        "name": "config_set_businessStart",
        "key": "businessStart",
        "displayName": "Business Start",
        "required": false,
        "description": "The Business Start parameter.",
        "type": "number",
        "default": 0
      },
      {
        "name": "config_set_businessEnd",
        "key": "businessEnd",
        "displayName": "Business End",
        "required": false,
        "description": "The Business End parameter.",
        "type": "number",
        "default": 0
      },
      {
        "name": "config_set_weekdaysOnly",
        "key": "weekdaysOnly",
        "displayName": "Weekdays Only",
        "required": false,
        "description": "The Weekdays Only parameter.",
        "type": "boolean",
        "default": false
      },
      {
        "name": "config_set_autopilot",
        "key": "autopilot",
        "displayName": "Autopilot",
        "required": false,
        "description": "The Autopilot parameter.",
        "type": "boolean",
        "default": false
      },
      {
        "name": "config_set_accountPreset",
        "key": "accountPreset",
        "displayName": "Account Preset",
        "required": false,
        "description": "One of free, premium, salesnav, recruiter.",
        "type": "options",
        "default": "free",
        "options": [
          {
            "name": "Free",
            "value": "free"
          },
          {
            "name": "Premium",
            "value": "premium"
          },
          {
            "name": "Salesnav",
            "value": "salesnav"
          },
          {
            "name": "Recruiter",
            "value": "recruiter"
          }
        ]
      },
      {
        "name": "config_set_warmup",
        "key": "warmup",
        "displayName": "Warmup",
        "required": false,
        "description": "The Warmup parameter. JSON object.",
        "type": "json",
        "default": "{}"
      },
      {
        "name": "config_set_ai",
        "key": "ai",
        "displayName": "AI",
        "required": false,
        "description": "The AI parameter. JSON object.",
        "type": "json",
        "default": "{}"
      },
      {
        "name": "config_set_bridge",
        "key": "bridge",
        "displayName": "Bridge",
        "required": false,
        "description": "The Bridge parameter. JSON object.",
        "type": "json",
        "default": "{}"
      },
      {
        "name": "config_set_webhookUrl",
        "key": "webhookUrl",
        "displayName": "Webhook URL",
        "required": false,
        "description": "The Webhook URL parameter.",
        "type": "string",
        "default": ""
      }
    ]
  },
  {
    "action": "search.people",
    "key": "search_people",
    "resource": "search",
    "operation": "people",
    "displayName": "People",
    "description": "Search LinkedIn people and return structured profiles. Use it to build a candidate or prospect list from keywords plus optional title, company and location filters. Returns up to 100 profiles per call with nextStart for paging; the extension caps search results at 1,000 per day.",
    "write": false,
    "required": [
      {
        "name": "search_people_keywords",
        "key": "keywords",
        "displayName": "Keywords",
        "required": true,
        "description": "The Keywords parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "search_people_title",
        "key": "title",
        "displayName": "Title",
        "required": false,
        "description": "The Title parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "search_people_company",
        "key": "company",
        "displayName": "Company",
        "required": false,
        "description": "The Company parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "search_people_location",
        "key": "location",
        "displayName": "Location",
        "required": false,
        "description": "The Location parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "search_people_source",
        "key": "source",
        "displayName": "Source",
        "required": false,
        "description": "One of search, salesnav, recruiter.",
        "type": "options",
        "default": "search",
        "options": [
          {
            "name": "Search",
            "value": "search"
          },
          {
            "name": "Salesnav",
            "value": "salesnav"
          },
          {
            "name": "Recruiter",
            "value": "recruiter"
          }
        ]
      },
      {
        "name": "search_people_start",
        "key": "start",
        "displayName": "Start",
        "required": false,
        "description": "minimum 0.",
        "type": "number",
        "default": 0
      },
      {
        "name": "search_people_count",
        "key": "count",
        "displayName": "Count",
        "required": false,
        "description": "minimum 1; maximum 100.",
        "type": "number",
        "default": 0
      }
    ]
  },
  {
    "action": "profile.get",
    "key": "profile_get",
    "resource": "profile",
    "operation": "get",
    "displayName": "Get",
    "description": "Fetch one profile by URL or publicId. Use it before writing an invite or message so the copy can reference real detail. Returns the Profile; with full=true it also captures the rendered page text, photo and experience/education, which costs one profile visit against the 500/day cap.",
    "write": false,
    "required": [],
    "optional": [
      {
        "name": "profile_get_url",
        "key": "url",
        "displayName": "URL",
        "required": false,
        "description": "The URL parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "profile_get_publicId",
        "key": "publicId",
        "displayName": "Public ID",
        "required": false,
        "description": "The Public ID parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "profile_get_full",
        "key": "full",
        "displayName": "Full",
        "required": false,
        "description": "The Full parameter.",
        "type": "boolean",
        "default": false
      }
    ]
  },
  {
    "action": "profile.export",
    "key": "profile_export",
    "resource": "profile",
    "operation": "export",
    "displayName": "Export",
    "description": "Fetch many profiles in one call from a list of LinkedIn URLs. Use it to hydrate a list you already have URLs for. Returns profiles plus a failed array of {url, error}; each profile counts against the 500 visits/day cap, so keep batches modest.",
    "write": false,
    "required": [
      {
        "name": "profile_export_urls",
        "key": "urls",
        "displayName": "URLs",
        "required": true,
        "description": "The URLs parameter. Comma-separated.",
        "type": "stringList",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "profile_export_full",
        "key": "full",
        "displayName": "Full",
        "required": false,
        "description": "The Full parameter.",
        "type": "boolean",
        "default": false
      }
    ]
  },
  {
    "action": "company.get",
    "key": "company_get",
    "resource": "company",
    "operation": "get",
    "displayName": "Get",
    "description": "Fetch a company page by URL or universalName. Use it for account research before outreach. Returns name, industry, size, HQ, website, description and follower count.",
    "write": false,
    "required": [],
    "optional": [
      {
        "name": "company_get_url",
        "key": "url",
        "displayName": "URL",
        "required": false,
        "description": "The URL parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "company_get_universalName",
        "key": "universalName",
        "displayName": "Universal Name",
        "required": false,
        "description": "The Universal Name parameter.",
        "type": "string",
        "default": ""
      }
    ]
  },
  {
    "action": "company.employees",
    "key": "company_employees",
    "resource": "company",
    "operation": "employees",
    "displayName": "Employees",
    "description": "List people who work at a company, by universalName. Use it for account-based sourcing once you know the company. Returns a page of profiles plus nextStart; results count against the daily search cap.",
    "write": false,
    "required": [
      {
        "name": "company_employees_universalName",
        "key": "universalName",
        "displayName": "Universal Name",
        "required": true,
        "description": "The Universal Name parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "company_employees_start",
        "key": "start",
        "displayName": "Start",
        "required": false,
        "description": "minimum 0.",
        "type": "number",
        "default": 0
      },
      {
        "name": "company_employees_count",
        "key": "count",
        "displayName": "Count",
        "required": false,
        "description": "minimum 1.",
        "type": "number",
        "default": 0
      }
    ]
  },
  {
    "action": "post.engagers",
    "key": "post_engagers",
    "resource": "post",
    "operation": "engagers",
    "displayName": "Engagers",
    "description": "List the people who liked or commented on a LinkedIn post. Use it to source warm leads who have shown intent. Returns engagers (a profile plus reaction or comment text) and nextStart.",
    "write": false,
    "required": [
      {
        "name": "post_engagers_postUrl",
        "key": "postUrl",
        "displayName": "Post URL",
        "required": true,
        "description": "The Post URL parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "post_engagers_kind",
        "key": "kind",
        "displayName": "Kind",
        "required": true,
        "description": "One of likes, comments, both.",
        "type": "options",
        "default": "likes",
        "options": [
          {
            "name": "Likes",
            "value": "likes"
          },
          {
            "name": "Comments",
            "value": "comments"
          },
          {
            "name": "Both",
            "value": "both"
          }
        ]
      }
    ],
    "optional": [
      {
        "name": "post_engagers_start",
        "key": "start",
        "displayName": "Start",
        "required": false,
        "description": "minimum 0.",
        "type": "number",
        "default": 0
      },
      {
        "name": "post_engagers_count",
        "key": "count",
        "displayName": "Count",
        "required": false,
        "description": "minimum 1.",
        "type": "number",
        "default": 0
      }
    ]
  },
  {
    "action": "group.members",
    "key": "group_members",
    "resource": "group",
    "operation": "members",
    "displayName": "Members",
    "description": "List members of a LinkedIn group you belong to. Use it for niche sourcing. Returns a page of profiles plus nextStart.",
    "write": false,
    "required": [
      {
        "name": "group_members_groupUrl",
        "key": "groupUrl",
        "displayName": "Group URL",
        "required": true,
        "description": "The Group URL parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "group_members_start",
        "key": "start",
        "displayName": "Start",
        "required": false,
        "description": "minimum 0.",
        "type": "number",
        "default": 0
      },
      {
        "name": "group_members_count",
        "key": "count",
        "displayName": "Count",
        "required": false,
        "description": "minimum 1.",
        "type": "number",
        "default": 0
      }
    ]
  },
  {
    "action": "event.attendees",
    "key": "event_attendees",
    "resource": "event",
    "operation": "attendees",
    "displayName": "Attendees",
    "description": "List attendees of a LinkedIn event you can see. Use it to source people around a conference or webinar. Returns a page of profiles plus nextStart.",
    "write": false,
    "required": [
      {
        "name": "event_attendees_eventUrl",
        "key": "eventUrl",
        "displayName": "Event URL",
        "required": true,
        "description": "The Event URL parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "event_attendees_start",
        "key": "start",
        "displayName": "Start",
        "required": false,
        "description": "minimum 0.",
        "type": "number",
        "default": 0
      },
      {
        "name": "event_attendees_count",
        "key": "count",
        "displayName": "Count",
        "required": false,
        "description": "minimum 1.",
        "type": "number",
        "default": 0
      }
    ]
  },
  {
    "action": "network.connections",
    "key": "network_connections",
    "resource": "network",
    "operation": "connections",
    "displayName": "Connections",
    "description": "List the user's own first-degree connections. Use it to work an existing network rather than sending new invites. Returns a page of profiles plus nextStart.",
    "write": false,
    "required": [],
    "optional": [
      {
        "name": "network_connections_start",
        "key": "start",
        "displayName": "Start",
        "required": false,
        "description": "minimum 0.",
        "type": "number",
        "default": 0
      },
      {
        "name": "network_connections_count",
        "key": "count",
        "displayName": "Count",
        "required": false,
        "description": "minimum 1.",
        "type": "number",
        "default": 0
      }
    ]
  },
  {
    "action": "network.followers",
    "key": "network_followers",
    "resource": "network",
    "operation": "followers",
    "displayName": "Followers",
    "description": "Run the `network.followers` action on the connected extension.",
    "write": false,
    "required": [],
    "optional": [
      {
        "name": "network_followers_start",
        "key": "start",
        "displayName": "Start",
        "required": false,
        "description": "minimum 0.",
        "type": "number",
        "default": 0
      },
      {
        "name": "network_followers_count",
        "key": "count",
        "displayName": "Count",
        "required": false,
        "description": "minimum 1.",
        "type": "number",
        "default": 0
      }
    ]
  },
  {
    "action": "network.status",
    "key": "network_status",
    "resource": "network",
    "operation": "status",
    "displayName": "Status",
    "description": "Check whether the user is already connected to, or has a pending invite with, each of the given publicIds. Always call this before sending invites so you do not re-invite existing connections. Returns a map publicId to connected | pending | none.",
    "write": false,
    "required": [
      {
        "name": "network_status_publicIds",
        "key": "publicIds",
        "displayName": "Public IDs",
        "required": true,
        "description": "The Public IDs parameter. Comma-separated.",
        "type": "stringList",
        "default": ""
      }
    ],
    "optional": []
  },
  {
    "action": "network.unfollowCount",
    "key": "network_unfollowCount",
    "resource": "network",
    "operation": "unfollowCount",
    "displayName": "Unfollow Count",
    "description": "Run the `network.unfollowCount` action on the connected extension.",
    "write": false,
    "required": [],
    "optional": []
  },
  {
    "action": "network.unfollowAll",
    "key": "network_unfollowAll",
    "resource": "network",
    "operation": "unfollowAll",
    "displayName": "Unfollow All",
    "description": "Run the `network.unfollowAll` action on the connected extension.",
    "write": false,
    "required": [],
    "optional": []
  },
  {
    "action": "outreach.view",
    "key": "outreach_view",
    "resource": "outreach",
    "operation": "view",
    "displayName": "View",
    "description": "Visit a profile so the visit shows up in their \"who viewed your profile\". Use it as a light warm-up touch before an invite. Counts against the 500 visits/day cap. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "required": [
      {
        "name": "outreach_view_publicId",
        "key": "publicId",
        "displayName": "Public ID",
        "required": true,
        "description": "The Public ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "outreach_view_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "outreach.follow",
    "key": "outreach_follow",
    "resource": "outreach",
    "operation": "follow",
    "displayName": "Follow",
    "description": "Follow a person without sending a connection invite. Use it when an invite would be too strong a first touch. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "required": [
      {
        "name": "outreach_follow_publicId",
        "key": "publicId",
        "displayName": "Public ID",
        "required": true,
        "description": "The Public ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "outreach_follow_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "outreach.invite",
    "key": "outreach_invite",
    "resource": "outreach",
    "operation": "invite",
    "displayName": "Invite",
    "description": "Send a connection invite, optionally with a note. Check linkedin_get_connection_status first. Hard cap 100 invites/day; in Copilot mode (the default) the invite is queued for human approval and the result status is \"queued\" rather than \"sent\". Pass dry_run to preview the exact payload.",
    "write": true,
    "required": [
      {
        "name": "outreach_invite_publicId",
        "key": "publicId",
        "displayName": "Public ID",
        "required": true,
        "description": "The Public ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "outreach_invite_note",
        "key": "note",
        "displayName": "Note",
        "required": false,
        "description": "The Note parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "outreach_invite_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "outreach.message",
    "key": "outreach_message",
    "resource": "outreach",
    "operation": "message",
    "displayName": "Message",
    "description": "Send a direct message to a first-degree connection. Hard cap 150 messages/day; in Copilot mode it is queued for approval. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "required": [
      {
        "name": "outreach_message_publicId",
        "key": "publicId",
        "displayName": "Public ID",
        "required": true,
        "description": "The Public ID parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "outreach_message_body",
        "key": "body",
        "displayName": "Body",
        "required": true,
        "description": "The Body parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "outreach_message_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "outreach.inmail",
    "key": "outreach_inmail",
    "resource": "outreach",
    "operation": "inmail",
    "displayName": "Inmail",
    "description": "Send an InMail with a subject line (requires Premium, Sales Navigator or Recruiter). Counts against the message cap and queues for approval in Copilot mode. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "required": [
      {
        "name": "outreach_inmail_publicId",
        "key": "publicId",
        "displayName": "Public ID",
        "required": true,
        "description": "The Public ID parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "outreach_inmail_subject",
        "key": "subject",
        "displayName": "Subject",
        "required": true,
        "description": "The Subject parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "outreach_inmail_body",
        "key": "body",
        "displayName": "Body",
        "required": true,
        "description": "The Body parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "outreach_inmail_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "outreach.like",
    "key": "outreach_like",
    "resource": "outreach",
    "operation": "like",
    "displayName": "Like",
    "description": "Like a post by URL. Use it as a low-risk warm-up touch before inviting the author. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "required": [
      {
        "name": "outreach_like_postUrl",
        "key": "postUrl",
        "displayName": "Post URL",
        "required": true,
        "description": "The Post URL parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "outreach_like_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "outreach.comment",
    "key": "outreach_comment",
    "resource": "outreach",
    "operation": "comment",
    "displayName": "Comment",
    "description": "Comment on a post by URL. Use it for public engagement before outreach; comments are queued for approval in Copilot mode because they are visible to everyone. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "required": [
      {
        "name": "outreach_comment_postUrl",
        "key": "postUrl",
        "displayName": "Post URL",
        "required": true,
        "description": "The Post URL parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "outreach_comment_body",
        "key": "body",
        "displayName": "Body",
        "required": true,
        "description": "The Body parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "outreach_comment_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "inbox.threads",
    "key": "inbox_threads",
    "resource": "inbox",
    "operation": "threads",
    "displayName": "Threads",
    "description": "List LinkedIn inbox threads, optionally only those since a timestamp or only unread. Use it to triage replies. Returns threads with participants, snippet, unread flag and sentiment when the extension has an AI provider configured.",
    "write": false,
    "required": [],
    "optional": [
      {
        "name": "inbox_threads_since",
        "key": "since",
        "displayName": "Since",
        "required": false,
        "description": "The Since parameter.",
        "type": "number",
        "default": 0
      },
      {
        "name": "inbox_threads_unreadOnly",
        "key": "unreadOnly",
        "displayName": "Unread Only",
        "required": false,
        "description": "The Unread Only parameter.",
        "type": "boolean",
        "default": false
      },
      {
        "name": "inbox_threads_count",
        "key": "count",
        "displayName": "Count",
        "required": false,
        "description": "minimum 1.",
        "type": "number",
        "default": 0
      }
    ]
  },
  {
    "action": "inbox.messages",
    "key": "inbox_messages",
    "resource": "inbox",
    "operation": "messages",
    "displayName": "Messages",
    "description": "Fetch the messages in one thread by threadId. Use it after linkedin_get_conversations to read the full exchange before replying. Returns messages with sender publicId, body and sentAt.",
    "write": false,
    "required": [
      {
        "name": "inbox_messages_threadId",
        "key": "threadId",
        "displayName": "Thread ID",
        "required": true,
        "description": "The Thread ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "inbox_messages_since",
        "key": "since",
        "displayName": "Since",
        "required": false,
        "description": "The Since parameter.",
        "type": "number",
        "default": 0
      }
    ]
  },
  {
    "action": "inbox.export",
    "key": "inbox_export",
    "resource": "inbox",
    "operation": "export",
    "displayName": "Export",
    "description": "Run the `inbox.export` action on the connected extension.",
    "write": false,
    "required": [],
    "optional": [
      {
        "name": "inbox_export_since",
        "key": "since",
        "displayName": "Since",
        "required": false,
        "description": "The Since parameter.",
        "type": "number",
        "default": 0
      }
    ]
  },
  {
    "action": "list.create",
    "key": "list_create",
    "resource": "list",
    "operation": "create",
    "displayName": "Create",
    "description": "Create a named local list to hold prospects. Use it as the container for search results before enrolling them in a campaign. Returns the List with its listId. Lists live only in the local extension storage.",
    "write": true,
    "required": [
      {
        "name": "list_create_name",
        "key": "name",
        "displayName": "Name",
        "required": true,
        "description": "The Name parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "list_create_tags",
        "key": "tags",
        "displayName": "Tags",
        "required": false,
        "description": "The Tags parameter. Comma-separated.",
        "type": "stringList",
        "default": ""
      },
      {
        "name": "list_create_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "list.getAll",
    "key": "list_getAll",
    "resource": "list",
    "operation": "getAll",
    "displayName": "Get All",
    "description": "List every local list. Use it to discover listIds before adding members or creating a campaign. Returns all List records with their member counts.",
    "write": false,
    "required": [],
    "optional": []
  },
  {
    "action": "list.get",
    "key": "list_get",
    "resource": "list",
    "operation": "get",
    "displayName": "Get",
    "description": "Fetch one list by listId. Use it to confirm a list exists and how many members it holds. Returns the List record.",
    "write": false,
    "required": [
      {
        "name": "list_get_listId",
        "key": "listId",
        "displayName": "List ID",
        "required": true,
        "description": "The List ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": []
  },
  {
    "action": "list.add",
    "key": "list_add",
    "resource": "list",
    "operation": "add",
    "displayName": "Add",
    "description": "Add profiles (or bare publicIds) to a list. Use it to save search or engager results for later outreach. Duplicates are skipped; returns {added, duplicates}.",
    "write": true,
    "required": [
      {
        "name": "list_add_listId",
        "key": "listId",
        "displayName": "List ID",
        "required": true,
        "description": "The List ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "list_add_profiles",
        "key": "profiles",
        "displayName": "Profiles",
        "required": false,
        "description": "The Profiles parameter. JSON array.",
        "type": "json",
        "default": "[]"
      },
      {
        "name": "list_add_publicIds",
        "key": "publicIds",
        "displayName": "Public IDs",
        "required": false,
        "description": "The Public IDs parameter. Comma-separated.",
        "type": "stringList",
        "default": ""
      },
      {
        "name": "list_add_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "list.remove",
    "key": "list_remove",
    "resource": "list",
    "operation": "remove",
    "displayName": "Remove",
    "description": "Run the `list.remove` action on the connected extension. This is a write action: it is rate-capped and queues for approval in Copilot mode.",
    "write": false,
    "required": [
      {
        "name": "list_remove_listId",
        "key": "listId",
        "displayName": "List ID",
        "required": true,
        "description": "The List ID parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "list_remove_publicIds",
        "key": "publicIds",
        "displayName": "Public IDs",
        "required": true,
        "description": "The Public IDs parameter. Comma-separated.",
        "type": "stringList",
        "default": ""
      }
    ],
    "optional": []
  },
  {
    "action": "list.members",
    "key": "list_members",
    "resource": "list",
    "operation": "members",
    "displayName": "Members",
    "description": "Page through the members of a list. Use it to read back what is in a list, including tags, whether each person was contacted before and any signals. Returns members plus total.",
    "write": false,
    "required": [
      {
        "name": "list_members_listId",
        "key": "listId",
        "displayName": "List ID",
        "required": true,
        "description": "The List ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "list_members_start",
        "key": "start",
        "displayName": "Start",
        "required": false,
        "description": "minimum 0.",
        "type": "number",
        "default": 0
      },
      {
        "name": "list_members_count",
        "key": "count",
        "displayName": "Count",
        "required": false,
        "description": "minimum 1.",
        "type": "number",
        "default": 0
      }
    ]
  },
  {
    "action": "list.delete",
    "key": "list_delete",
    "resource": "list",
    "operation": "delete",
    "displayName": "Delete",
    "description": "Run the `list.delete` action on the connected extension. This is a write action: it is rate-capped and queues for approval in Copilot mode.",
    "write": false,
    "required": [
      {
        "name": "list_delete_listId",
        "key": "listId",
        "displayName": "List ID",
        "required": true,
        "description": "The List ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": []
  },
  {
    "action": "list.importCsv",
    "key": "list_importCsv",
    "resource": "list",
    "operation": "importCsv",
    "displayName": "Import CSV",
    "description": "Run the `list.importCsv` action on the connected extension. This is a write action: it is rate-capped and queues for approval in Copilot mode.",
    "write": false,
    "required": [
      {
        "name": "list_importCsv_listId",
        "key": "listId",
        "displayName": "List ID",
        "required": true,
        "description": "The List ID parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "list_importCsv_csv",
        "key": "csv",
        "displayName": "CSV",
        "required": true,
        "description": "The CSV parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": []
  },
  {
    "action": "campaign.create",
    "key": "campaign_create",
    "resource": "campaign",
    "operation": "create",
    "displayName": "Create",
    "description": "Create a multi-step outreach sequence (view, follow, invite, message, inmail, like, comment, wait, branch) over a list or explicit publicIds. Use it instead of firing individual writes when the touches should be spaced over days. Returns the Campaign; steps still obey every quota and the approval queue.",
    "write": true,
    "required": [
      {
        "name": "campaign_create_name",
        "key": "name",
        "displayName": "Name",
        "required": true,
        "description": "The Name parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "campaign_create_steps",
        "key": "steps",
        "displayName": "Steps",
        "required": true,
        "description": "The Steps parameter. JSON array.",
        "type": "json",
        "default": "[]"
      }
    ],
    "optional": [
      {
        "name": "campaign_create_listId",
        "key": "listId",
        "displayName": "List ID",
        "required": false,
        "description": "The List ID parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "campaign_create_publicIds",
        "key": "publicIds",
        "displayName": "Public IDs",
        "required": false,
        "description": "The Public IDs parameter. Comma-separated.",
        "type": "stringList",
        "default": ""
      },
      {
        "name": "campaign_create_settings",
        "key": "settings",
        "displayName": "Settings",
        "required": false,
        "description": "The Settings parameter. JSON object.",
        "type": "json",
        "default": "{}"
      },
      {
        "name": "campaign_create_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "campaign.getAll",
    "key": "campaign_getAll",
    "resource": "campaign",
    "operation": "getAll",
    "displayName": "Get All",
    "description": "List every campaign with its status. Use it to find campaignIds and see what is currently running or paused.",
    "write": false,
    "required": [],
    "optional": []
  },
  {
    "action": "campaign.get",
    "key": "campaign_get",
    "resource": "campaign",
    "operation": "get",
    "displayName": "Get",
    "description": "Fetch one campaign by campaignId including its stats. Use it to report on enrolled, sent, accepted, replied and positive counts per step.",
    "write": false,
    "required": [
      {
        "name": "campaign_get_campaignId",
        "key": "campaignId",
        "displayName": "Campaign ID",
        "required": true,
        "description": "The Campaign ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": []
  },
  {
    "action": "campaign.enroll",
    "key": "campaign_enroll",
    "resource": "campaign",
    "operation": "enroll",
    "displayName": "Enroll",
    "description": "Enroll publicIds into an existing campaign. Use it to top up a running sequence with newly sourced people. Already-enrolled people are skipped; returns {enrolled, skipped}.",
    "write": true,
    "required": [
      {
        "name": "campaign_enroll_campaignId",
        "key": "campaignId",
        "displayName": "Campaign ID",
        "required": true,
        "description": "The Campaign ID parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "campaign_enroll_publicIds",
        "key": "publicIds",
        "displayName": "Public IDs",
        "required": true,
        "description": "The Public IDs parameter. Comma-separated.",
        "type": "stringList",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "campaign_enroll_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "campaign.pause",
    "key": "campaign_pause",
    "resource": "campaign",
    "operation": "pause",
    "displayName": "Pause",
    "description": "Pause a campaign so no further steps execute. Use it immediately if replies look negative or a challenge was detected. Returns the updated Campaign.",
    "write": true,
    "required": [
      {
        "name": "campaign_pause_campaignId",
        "key": "campaignId",
        "displayName": "Campaign ID",
        "required": true,
        "description": "The Campaign ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "campaign_pause_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "campaign.resume",
    "key": "campaign_resume",
    "resource": "campaign",
    "operation": "resume",
    "displayName": "Resume",
    "description": "Resume a paused campaign from where it stopped. Returns the updated Campaign.",
    "write": true,
    "required": [
      {
        "name": "campaign_resume_campaignId",
        "key": "campaignId",
        "displayName": "Campaign ID",
        "required": true,
        "description": "The Campaign ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "campaign_resume_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "campaign.delete",
    "key": "campaign_delete",
    "resource": "campaign",
    "operation": "delete",
    "displayName": "Delete",
    "description": "Run the `campaign.delete` action on the connected extension. This is a write action: it is rate-capped and queues for approval in Copilot mode.",
    "write": false,
    "required": [
      {
        "name": "campaign_delete_campaignId",
        "key": "campaignId",
        "displayName": "Campaign ID",
        "required": true,
        "description": "The Campaign ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": []
  },
  {
    "action": "campaign.tick",
    "key": "campaign_tick",
    "resource": "campaign",
    "operation": "tick",
    "displayName": "Tick",
    "description": "Run the `campaign.tick` action on the connected extension.",
    "write": false,
    "required": [],
    "optional": []
  },
  {
    "action": "queue.list",
    "key": "queue_list",
    "resource": "queue",
    "operation": "list",
    "displayName": "List",
    "description": "List items in the human-approval queue, optionally filtered by status. In Copilot mode every agent-originated write lands here first, so call this to show the user what is waiting. Returns queue items with their action, params and target profile.",
    "write": false,
    "required": [],
    "optional": [
      {
        "name": "queue_list_status",
        "key": "status",
        "displayName": "Status",
        "required": false,
        "description": "One of pending, approved, rejected, sent.",
        "type": "options",
        "default": "pending",
        "options": [
          {
            "name": "Pending",
            "value": "pending"
          },
          {
            "name": "Approved",
            "value": "approved"
          },
          {
            "name": "Rejected",
            "value": "rejected"
          },
          {
            "name": "Sent",
            "value": "sent"
          }
        ]
      }
    ]
  },
  {
    "action": "queue.approve",
    "key": "queue_approve",
    "resource": "queue",
    "operation": "approve",
    "displayName": "Approve",
    "description": "Approve queued writes by id so the extension sends them, optionally editing the note or body first. This works only when the user has turned Autopilot on: in the default Copilot mode approval is a human action and the extension answers UNAUTHORIZED, so show the queue with linkedin_queue_list and ask the user to approve in the popup. Returns {approved}.",
    "write": true,
    "required": [
      {
        "name": "queue_approve_ids",
        "key": "ids",
        "displayName": "IDs",
        "required": true,
        "description": "The IDs parameter. Comma-separated.",
        "type": "stringList",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "queue_approve_edits",
        "key": "edits",
        "displayName": "Edits",
        "required": false,
        "description": "The Edits parameter. JSON object.",
        "type": "json",
        "default": "{}"
      },
      {
        "name": "queue_approve_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "queue.reject",
    "key": "queue_reject",
    "resource": "queue",
    "operation": "reject",
    "displayName": "Reject",
    "description": "Reject queued writes by id so they are never sent. Like approving, this works only when the user has turned Autopilot on; in the default Copilot mode the extension answers UNAUTHORIZED and the user rejects in the popup. Returns {rejected}.",
    "write": true,
    "required": [
      {
        "name": "queue_reject_ids",
        "key": "ids",
        "displayName": "IDs",
        "required": true,
        "description": "The IDs parameter. Comma-separated.",
        "type": "stringList",
        "default": ""
      }
    ],
    "optional": [
      {
        "name": "queue_reject_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "ai.complete",
    "key": "ai_complete",
    "resource": "ai",
    "operation": "complete",
    "displayName": "Complete",
    "description": "Run the `ai.complete` action on the connected extension.",
    "write": false,
    "required": [
      {
        "name": "ai_complete_task",
        "key": "task",
        "displayName": "Task",
        "required": true,
        "description": "One of opener, summary, sentiment, comment, score.",
        "type": "options",
        "default": "opener",
        "options": [
          {
            "name": "Opener",
            "value": "opener"
          },
          {
            "name": "Summary",
            "value": "summary"
          },
          {
            "name": "Sentiment",
            "value": "sentiment"
          },
          {
            "name": "Comment",
            "value": "comment"
          },
          {
            "name": "Score",
            "value": "score"
          }
        ]
      },
      {
        "name": "ai_complete_input",
        "key": "input",
        "displayName": "Input",
        "required": true,
        "description": "The Input parameter. JSON object.",
        "type": "json",
        "default": "{}"
      }
    ],
    "optional": []
  },
  {
    "action": "export.csv",
    "key": "export_csv",
    "resource": "export",
    "operation": "csv",
    "displayName": "CSV",
    "description": "Run the `export.csv` action on the connected extension.",
    "write": false,
    "required": [
      {
        "name": "export_csv_kind",
        "key": "kind",
        "displayName": "Kind",
        "required": true,
        "description": "One of profiles, list, campaign, inbox.",
        "type": "options",
        "default": "profiles",
        "options": [
          {
            "name": "Profiles",
            "value": "profiles"
          },
          {
            "name": "List",
            "value": "list"
          },
          {
            "name": "Campaign",
            "value": "campaign"
          },
          {
            "name": "Inbox",
            "value": "inbox"
          }
        ]
      }
    ],
    "optional": [
      {
        "name": "export_csv_id",
        "key": "id",
        "displayName": "ID",
        "required": false,
        "description": "The ID parameter.",
        "type": "string",
        "default": ""
      }
    ]
  },
  {
    "action": "research.resolve",
    "key": "research_resolve",
    "resource": "research",
    "operation": "resolve",
    "displayName": "Resolve",
    "description": "Resolve messy rows (a name, an email, a company domain) to LinkedIn people or companies without doing the full research gather. Use it as a cheap first pass to check match quality before spending visits on linkedin_research_pack. Returns each row with kind, publicId or universalName, a confidence score and candidate profiles.",
    "write": false,
    "required": [
      {
        "name": "research_resolve_rows",
        "key": "rows",
        "displayName": "Rows",
        "required": true,
        "description": "The Rows parameter. JSON array.",
        "type": "json",
        "default": "[]"
      }
    ],
    "optional": []
  },
  {
    "action": "research.pack",
    "key": "research_pack",
    "resource": "research",
    "operation": "pack",
    "displayName": "Pack",
    "description": "Turn a list of rows (name, LinkedIn URL, email, domain or company) into full research packs: resolved profile, company, recent posts, mutual connections, connection status, signals and a ready-to-read markdown brief per row. Use it as the one-shot \"research these people for me\" tool. The server waits for the job to finish and returns the packs; if it takes longer than the research timeout it returns {jobId, status:\"running\"} and you should poll linkedin_research_get.",
    "write": true,
    "required": [
      {
        "name": "research_pack_rows",
        "key": "rows",
        "displayName": "Rows",
        "required": true,
        "description": "The Rows parameter. JSON array.",
        "type": "json",
        "default": "[]"
      }
    ],
    "optional": [
      {
        "name": "research_pack_listName",
        "key": "listName",
        "displayName": "List Name",
        "required": false,
        "description": "The List Name parameter.",
        "type": "string",
        "default": ""
      },
      {
        "name": "research_pack_enrich",
        "key": "enrich",
        "displayName": "Enrich",
        "required": false,
        "description": "The Enrich parameter.",
        "type": "boolean",
        "default": false
      },
      {
        "name": "research_pack_full",
        "key": "full",
        "displayName": "Full",
        "required": false,
        "description": "The Full parameter.",
        "type": "boolean",
        "default": false
      },
      {
        "name": "research_pack_dry_run",
        "key": "dry_run",
        "displayName": "Dry Run",
        "type": "boolean",
        "required": false,
        "default": false,
        "description": "Preview the write without queueing or sending it."
      }
    ]
  },
  {
    "action": "research.get",
    "key": "research_get",
    "resource": "research",
    "operation": "get",
    "displayName": "Get",
    "description": "Poll a research job by jobId. Use it after linkedin_research_pack returned status \"running\". Returns {jobId, status, done, total, packs} with the packs finished so far.",
    "write": false,
    "required": [
      {
        "name": "research_get_jobId",
        "key": "jobId",
        "displayName": "Job ID",
        "required": true,
        "description": "The Job ID parameter.",
        "type": "string",
        "default": ""
      }
    ],
    "optional": []
  },
  {
    "action": "sync.pull",
    "key": "sync_pull",
    "resource": "sync",
    "operation": "pull",
    "displayName": "Pull",
    "description": "Pull everything changed in the extension since the last sync into the local SQLite mirror. Call it before linkedin_query_sql so the database is current. Returns per-table row counts and the new sync timestamp.",
    "write": false,
    "required": [],
    "optional": [
      {
        "name": "sync_pull_since",
        "key": "since",
        "displayName": "Since",
        "required": false,
        "description": "The Since parameter.",
        "type": "number",
        "default": 0
      }
    ]
  }
];
