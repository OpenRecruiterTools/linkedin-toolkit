/**
 * AUTO-GENERATED — do not edit by hand.
 *
 * Written by `npm run gen` in `clients/node` from `mcp-server/tools.json`,
 * which the server itself generates from the contract. These are the exact
 * definitions the MCP server advertises, so an agent using this package and
 * an agent using MCP see the same 39 tools with the same descriptions.
 */
import type { ToolDefinition } from './types.js';

export const TOOLS_VERSION = "2.0.0";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    "name": "linkedin_get_status",
    "action": "status.get",
    "description": "Check that the Chrome extension is connected and the user is logged in to LinkedIn. Call this first in any session and again after a rate-limit error; returns extension version, autopilot on/off, business-hours flag, per-quota usage (invite, message, visit, search), pending approval-queue size and campaign counts.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_search_people",
    "action": "search.people",
    "description": "Search LinkedIn people and return structured profiles. Use it to build a candidate or prospect list from keywords plus optional title, company and location filters. Returns up to 100 profiles per call with nextStart for paging; the extension caps search results at 1,000 per day.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "keywords": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "company": {
          "type": "string"
        },
        "location": {
          "type": "string"
        },
        "source": {
          "type": "string",
          "enum": [
            "search",
            "salesnav",
            "recruiter"
          ]
        },
        "start": {
          "type": "integer",
          "minimum": 0
        },
        "count": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        }
      },
      "required": [
        "keywords"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_get_profile",
    "action": "profile.get",
    "description": "Fetch one profile by URL or publicId. Use it before writing an invite or message so the copy can reference real detail. Returns the Profile; with full=true it also captures the rendered page text, photo and experience/education, which costs one profile visit against the 500/day cap.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string"
        },
        "publicId": {
          "type": "string"
        },
        "full": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_export_profiles",
    "action": "profile.export",
    "description": "Fetch many profiles in one call from a list of LinkedIn URLs. Use it to hydrate a list you already have URLs for. Returns profiles plus a failed array of {url, error}; each profile counts against the 500 visits/day cap, so keep batches modest.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "urls": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "full": {
          "type": "boolean"
        }
      },
      "required": [
        "urls"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_get_company",
    "action": "company.get",
    "description": "Fetch a company page by URL or universalName. Use it for account research before outreach. Returns name, industry, size, HQ, website, description and follower count.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string"
        },
        "universalName": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_get_company_employees",
    "action": "company.employees",
    "description": "List people who work at a company, by universalName. Use it for account-based sourcing once you know the company. Returns a page of profiles plus nextStart; results count against the daily search cap.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "universalName": {
          "type": "string"
        },
        "start": {
          "type": "integer",
          "minimum": 0
        },
        "count": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "universalName"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_get_post_engagers",
    "action": "post.engagers",
    "description": "List the people who liked or commented on a LinkedIn post. Use it to source warm leads who have shown intent. Returns engagers (a profile plus reaction or comment text) and nextStart.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "postUrl": {
          "type": "string"
        },
        "kind": {
          "type": "string",
          "enum": [
            "likes",
            "comments",
            "both"
          ]
        },
        "start": {
          "type": "integer",
          "minimum": 0
        },
        "count": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "postUrl",
        "kind"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_get_group_members",
    "action": "group.members",
    "description": "List members of a LinkedIn group you belong to. Use it for niche sourcing. Returns a page of profiles plus nextStart.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "groupUrl": {
          "type": "string"
        },
        "start": {
          "type": "integer",
          "minimum": 0
        },
        "count": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "groupUrl"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_get_event_attendees",
    "action": "event.attendees",
    "description": "List attendees of a LinkedIn event you can see. Use it to source people around a conference or webinar. Returns a page of profiles plus nextStart.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "eventUrl": {
          "type": "string"
        },
        "start": {
          "type": "integer",
          "minimum": 0
        },
        "count": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "eventUrl"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_get_connections",
    "action": "network.connections",
    "description": "List the user's own first-degree connections. Use it to work an existing network rather than sending new invites. Returns a page of profiles plus nextStart.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "start": {
          "type": "integer",
          "minimum": 0
        },
        "count": {
          "type": "integer",
          "minimum": 1
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_get_connection_status",
    "action": "network.status",
    "description": "Check whether the user is already connected to, or has a pending invite with, each of the given publicIds. Always call this before sending invites so you do not re-invite existing connections. Returns a map publicId to connected | pending | none.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "publicIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "publicIds"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_get_conversations",
    "action": "inbox.threads",
    "description": "List LinkedIn inbox threads, optionally only those since a timestamp or only unread. Use it to triage replies. Returns threads with participants, snippet, unread flag and sentiment when the extension has an AI provider configured.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "since": {
          "type": "number"
        },
        "unreadOnly": {
          "type": "boolean"
        },
        "count": {
          "type": "integer",
          "minimum": 1
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_get_messages",
    "action": "inbox.messages",
    "description": "Fetch the messages in one thread by threadId. Use it after linkedin_get_conversations to read the full exchange before replying. Returns messages with sender publicId, body and sentAt.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "threadId": {
          "type": "string"
        },
        "since": {
          "type": "number"
        }
      },
      "required": [
        "threadId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_list_create",
    "action": "list.create",
    "description": "Create a named local list to hold prospects. Use it as the container for search results before enrolling them in a campaign. Returns the List with its listId. Lists live only in the local extension storage.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "name"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_list_get",
    "action": "list.get",
    "description": "Fetch one list by listId. Use it to confirm a list exists and how many members it holds. Returns the List record.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "listId": {
          "type": "string"
        }
      },
      "required": [
        "listId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_list_all",
    "action": "list.getAll",
    "description": "List every local list. Use it to discover listIds before adding members or creating a campaign. Returns all List records with their member counts.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_list_add",
    "action": "list.add",
    "description": "Add profiles (or bare publicIds) to a list. Use it to save search or engager results for later outreach. Duplicates are skipped; returns {added, duplicates}.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "listId": {
          "type": "string"
        },
        "profiles": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "publicId": {
                "type": "string"
              },
              "urn": {
                "type": "string"
              },
              "url": {
                "type": "string"
              },
              "firstName": {
                "type": "string"
              },
              "lastName": {
                "type": "string"
              },
              "fullName": {
                "type": "string"
              },
              "headline": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "company": {
                "type": "string"
              },
              "companyUrn": {
                "type": "string"
              },
              "location": {
                "type": "string"
              },
              "industry": {
                "type": "string"
              },
              "photoUrl": {
                "type": "string"
              },
              "photoDataUrl": {
                "type": "string"
              },
              "pageText": {
                "type": "string"
              },
              "skills": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "connectionDegree": {
                "type": "number",
                "enum": [
                  1,
                  2,
                  3
                ]
              },
              "experience": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "title": {
                      "type": "string"
                    },
                    "company": {
                      "type": "string"
                    },
                    "start": {
                      "type": "string"
                    },
                    "end": {
                      "type": "string"
                    },
                    "description": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "title",
                    "company"
                  ],
                  "additionalProperties": false
                }
              },
              "education": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "school": {
                      "type": "string"
                    },
                    "degree": {
                      "type": "string"
                    },
                    "field": {
                      "type": "string"
                    },
                    "start": {
                      "type": "string"
                    },
                    "end": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "school"
                  ],
                  "additionalProperties": false
                }
              },
              "capturedAt": {
                "type": "number"
              },
              "source": {
                "type": "string"
              }
            },
            "required": [
              "publicId",
              "url",
              "firstName",
              "lastName",
              "fullName",
              "capturedAt"
            ],
            "additionalProperties": true
          }
        },
        "publicIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "listId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_list_members",
    "action": "list.members",
    "description": "Page through the members of a list. Use it to read back what is in a list, including tags, whether each person was contacted before and any signals. Returns members plus total.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "listId": {
          "type": "string"
        },
        "start": {
          "type": "integer",
          "minimum": 0
        },
        "count": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "listId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_view_profile",
    "action": "outreach.view",
    "description": "Visit a profile so the visit shows up in their \"who viewed your profile\". Use it as a light warm-up touch before an invite. Counts against the 500 visits/day cap. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "publicId": {
          "type": "string"
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "publicId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_follow",
    "action": "outreach.follow",
    "description": "Follow a person without sending a connection invite. Use it when an invite would be too strong a first touch. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "publicId": {
          "type": "string"
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "publicId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_send_invite",
    "action": "outreach.invite",
    "description": "Send a connection invite, optionally with a note. Check linkedin_get_connection_status first. Hard cap 100 invites/day; in Copilot mode (the default) the invite is queued for human approval and the result status is \"queued\" rather than \"sent\". Pass dry_run to preview the exact payload.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "publicId": {
          "type": "string"
        },
        "note": {
          "type": "string"
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "publicId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_send_message",
    "action": "outreach.message",
    "description": "Send a direct message to a first-degree connection. Hard cap 150 messages/day; in Copilot mode it is queued for approval. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "publicId": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "publicId",
        "body"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_send_inmail",
    "action": "outreach.inmail",
    "description": "Send an InMail with a subject line (requires Premium, Sales Navigator or Recruiter). Counts against the message cap and queues for approval in Copilot mode. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "publicId": {
          "type": "string"
        },
        "subject": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "publicId",
        "subject",
        "body"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_like_post",
    "action": "outreach.like",
    "description": "Like a post by URL. Use it as a low-risk warm-up touch before inviting the author. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "postUrl": {
          "type": "string"
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "postUrl"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_comment_post",
    "action": "outreach.comment",
    "description": "Comment on a post by URL. Use it for public engagement before outreach; comments are queued for approval in Copilot mode because they are visible to everyone. Returns a WriteResult; pass dry_run to preview.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "postUrl": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "postUrl",
        "body"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_campaign_create",
    "action": "campaign.create",
    "description": "Create a multi-step outreach sequence (view, follow, invite, message, inmail, like, comment, wait, branch) over a list or explicit publicIds. Use it instead of firing individual writes when the touches should be spaced over days. Returns the Campaign; steps still obey every quota and the approval queue.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "steps": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "view",
                  "follow",
                  "invite",
                  "message",
                  "inmail",
                  "like",
                  "comment",
                  "wait",
                  "branch"
                ]
              },
              "note": {
                "type": "string"
              },
              "body": {
                "type": "string"
              },
              "subject": {
                "type": "string"
              },
              "variants": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "waitMs": {
                "type": "number"
              },
              "branch": {
                "type": "object",
                "properties": {
                  "on": {
                    "type": "string",
                    "enum": [
                      "accepted",
                      "replied",
                      "notAcceptedAfterMs"
                    ]
                  },
                  "ms": {
                    "type": "number"
                  },
                  "then": {
                    "type": "array",
                    "items": {}
                  },
                  "else": {
                    "type": "array",
                    "items": {}
                  }
                },
                "required": [
                  "on",
                  "then",
                  "else"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": true
          }
        },
        "listId": {
          "type": "string"
        },
        "publicIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "settings": {
          "type": "object",
          "properties": {
            "stopOnReply": {
              "type": "boolean"
            },
            "autopilot": {
              "type": "boolean"
            }
          },
          "additionalProperties": true
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "name",
        "steps"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_campaign_get",
    "action": "campaign.get",
    "description": "Fetch one campaign by campaignId including its stats. Use it to report on enrolled, sent, accepted, replied and positive counts per step.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "campaignId": {
          "type": "string"
        }
      },
      "required": [
        "campaignId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_campaign_list",
    "action": "campaign.getAll",
    "description": "List every campaign with its status. Use it to find campaignIds and see what is currently running or paused.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_campaign_enroll",
    "action": "campaign.enroll",
    "description": "Enroll publicIds into an existing campaign. Use it to top up a running sequence with newly sourced people. Already-enrolled people are skipped; returns {enrolled, skipped}.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "campaignId": {
          "type": "string"
        },
        "publicIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "campaignId",
        "publicIds"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_campaign_pause",
    "action": "campaign.pause",
    "description": "Pause a campaign so no further steps execute. Use it immediately if replies look negative or a challenge was detected. Returns the updated Campaign.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "campaignId": {
          "type": "string"
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "campaignId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_campaign_resume",
    "action": "campaign.resume",
    "description": "Resume a paused campaign from where it stopped. Returns the updated Campaign.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "campaignId": {
          "type": "string"
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "campaignId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_queue_list",
    "action": "queue.list",
    "description": "List items in the human-approval queue, optionally filtered by status. In Copilot mode every agent-originated write lands here first, so call this to show the user what is waiting. Returns queue items with their action, params and target profile.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "approved",
            "rejected",
            "sent"
          ]
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_queue_approve",
    "action": "queue.approve",
    "description": "Approve queued writes by id so the extension sends them, optionally editing the note or body first. This works only when the user has turned Autopilot on: in the default Copilot mode approval is a human action and the extension answers UNAUTHORIZED, so show the queue with linkedin_queue_list and ask the user to approve in the popup. Returns {approved}.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "ids": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "edits": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "properties": {
              "note": {
                "type": "string"
              },
              "body": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "ids"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_queue_reject",
    "action": "queue.reject",
    "description": "Reject queued writes by id so they are never sent. Like approving, this works only when the user has turned Autopilot on; in the default Copilot mode the extension answers UNAUTHORIZED and the user rejects in the popup. Returns {rejected}.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "ids": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "ids"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_research_pack",
    "action": "research.pack",
    "description": "Turn a list of rows (name, LinkedIn URL, email, domain or company) into full research packs: resolved profile, company, recent posts, mutual connections, connection status, signals and a ready-to-read markdown brief per row. Use it as the one-shot \"research these people for me\" tool. The server waits for the job to finish and returns the packs; if it takes longer than the research timeout it returns {jobId, status:\"running\"} and you should poll linkedin_research_get.",
    "write": true,
    "parameters": {
      "type": "object",
      "properties": {
        "rows": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "linkedinUrl": {
                "type": "string"
              },
              "email": {
                "type": "string"
              },
              "domain": {
                "type": "string"
              },
              "company": {
                "type": "string"
              }
            },
            "additionalProperties": true
          }
        },
        "listName": {
          "type": "string"
        },
        "enrich": {
          "type": "boolean"
        },
        "full": {
          "type": "boolean"
        },
        "dry_run": {
          "type": "boolean"
        }
      },
      "required": [
        "rows"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_research_get",
    "action": "research.get",
    "description": "Poll a research job by jobId. Use it after linkedin_research_pack returned status \"running\". Returns {jobId, status, done, total, packs} with the packs finished so far.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "jobId": {
          "type": "string"
        }
      },
      "required": [
        "jobId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_research_resolve",
    "action": "research.resolve",
    "description": "Resolve messy rows (a name, an email, a company domain) to LinkedIn people or companies without doing the full research gather. Use it as a cheap first pass to check match quality before spending visits on linkedin_research_pack. Returns each row with kind, publicId or universalName, a confidence score and candidate profiles.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "rows": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "linkedinUrl": {
                "type": "string"
              },
              "email": {
                "type": "string"
              },
              "domain": {
                "type": "string"
              },
              "company": {
                "type": "string"
              }
            },
            "additionalProperties": true
          }
        }
      },
      "required": [
        "rows"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_query_sql",
    "action": null,
    "description": "Run a read-only SQL query against the local SQLite mirror of everything the toolkit has captured (tables: profiles, companies, searches, search_results, lists, list_members, campaigns, enrollments, actions, conversations, messages, events, packs). Use it for counting, filtering and joining across past work instead of re-scraping LinkedIn. Only a single SELECT or WITH statement is allowed and at most 1,000 rows are returned.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "sql": {
          "type": "string"
        },
        "params": {
          "type": "array",
          "items": {
            "type": [
              "string",
              "number",
              "null"
            ]
          }
        }
      },
      "required": [
        "sql"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "linkedin_sync",
    "action": "sync.pull",
    "description": "Pull everything changed in the extension since the last sync into the local SQLite mirror. Call it before linkedin_query_sql so the database is current. Returns per-table row counts and the new sync timestamp.",
    "write": false,
    "parameters": {
      "type": "object",
      "properties": {
        "since": {
          "type": "number"
        }
      },
      "additionalProperties": false
    }
  }
];
