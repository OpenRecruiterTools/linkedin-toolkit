# Directory submissions

Tick these off in order. The MCP registries are worth the most per unit of effort — they are how
agent developers find tools now, and several of them feed each other.

Copy for every listing:

- **Name:** LinkedIn Toolkit
- **Package:** `linkedin-toolkit-mcp` (npm) · `linkedin-toolkit` (npm, PyPI)
- **Repo:** `https://github.com/OpenRecruiterTools/linkedin-toolkit`
- **License:** MIT
- **One line:** The open-source, local-first LinkedIn automation layer for humans and AI agents.
- **Longer:** LinkedIn blocks AI browser agents. This gives any agent a structured API to the
  user's own logged-in Chrome session — typed JSON, hard caps enforced in the extension, and a
  human approval queue. No headless browser, no proxies, no cloud session, no telemetry.
- **Install:** `npx linkedin-toolkit-mcp`
- **Config:** `{ "mcpServers": { "linkedin-toolkit": { "command": "npx", "args": ["-y", "linkedin-toolkit-mcp"] } } }`

---

## MCP registries — Phase 2, immediately after the npm publish

- [ ] **Smithery** — https://smithery.ai/new · needs a `smithery.yaml`; auto-scans the repo
- [ ] **Glama** — https://glama.ai/mcp/servers · auto-indexes public repos with an MCP server;
      claim the listing after it appears
- [ ] **PulseMCP** — https://www.pulsemcp.com/submit
- [ ] **mcp.so** — https://mcp.so/submit
- [ ] **MCP Market** — https://mcpmarket.com/submit
- [ ] **Official MCP registry** — https://github.com/modelcontextprotocol/registry (PR)
- [ ] **Cursor directory** — https://cursor.directory/mcp (PR to the repo behind it)
- [ ] **Awesome MCP Servers** — https://github.com/punkpeye/awesome-mcp-servers (PR, text below)
- [ ] **Awesome MCP Servers (appcypher)** — https://github.com/appcypher/awesome-mcp-servers (PR)

### awesome-mcp-servers PR

Branch `add-linkedin-toolkit`, one line added under the most fitting category (Browser Automation
or Social Media), alphabetical:

```markdown
- [OpenRecruiterTools/linkedin-toolkit](https://github.com/OpenRecruiterTools/linkedin-toolkit) 🏠 - LinkedIn from the user's own logged-in Chrome session: search, profiles, post engagers, lists, sequences, inbox and a Research Pack, with hard caps and a human approval queue. No headless browser.
```

Check that repo's legend for the correct emoji — 🏠 usually means "local service". PR title:
`Add LinkedIn Toolkit`. Body: two sentences and the install line, nothing more.

## Package registries — Phase 3

- [ ] **npm** — `linkedin-toolkit-mcp` and `linkedin-toolkit`. Keywords: `mcp`, `linkedin`,
      `automation`, `ai-agents`, `model-context-protocol`, `sourcing`, `outreach`. README renders
      on the package page, so make sure the images use absolute URLs.
- [ ] **PyPI** — `linkedin-toolkit`. Same keywords, long description from the client README.
- [ ] **JSR** — optional, only if the Node client is published there too.

## Framework integration listings — Phase 3

- [ ] **LangChain integrations** — https://python.langchain.com/docs/integrations/tools/ · PR to
      `langchain-ai/langchain` docs with a notebook showing the tools
- [ ] **LlamaHub** — https://llamahub.ai/ · PR to `run-llama/llama_index` under
      `llama-index-integrations/tools/`
- [ ] **CrewAI tools** — https://github.com/crewAIInc/crewAI-tools · PR
- [ ] **n8n community nodes** — publish `n8n-nodes-linkedin-toolkit` to npm with the
      `n8n-community-node-package` keyword; it is then installable from the n8n UI. Submit for
      verification at https://docs.n8n.io/integrations/community-nodes/
- [ ] **Dify tools** — https://github.com/langgenius/dify-official-plugins · or ship it as an
      OpenAPI-based custom tool people import themselves
- [ ] **Vercel AI SDK providers/tools** — community list PR

## Open-source and alternative directories — Phase 4

- [ ] **AlternativeTo** — https://alternativeto.net/manage-app/ · list as an alternative to
      Waalaxy, PhantomBuster, Dux-Soup, Expandi, Sales-Mind. Tags: open-source, self-hosted, free.
- [ ] **OpenSourceAlternative.to** — https://www.opensourcealternative.to/submit · proprietary
      alternative: Waalaxy
- [ ] **Awesome Selfhosted** — https://github.com/awesome-selfhosted/awesome-selfhosted (PR, text
      below)
- [ ] **Awesome Chrome Extensions** — a few competing lists; pick the maintained one
- [ ] **libhunt / OpenAlternative / SaaSHub** — low effort, submit and forget
- [ ] **Hacker News Show HN** — see [show-hn.md](show-hn.md)
- [ ] **Lobsters** — only if you have an invite; tags `ai`, `programming`, `show`

### awesome-selfhosted PR

Read `CONTRIBUTING.md` there first — the format is strict and PRs are rejected for whitespace.
Under *Automation* or *Communication - Social Networks*, alphabetical:

```markdown
- [LinkedIn Toolkit](https://github.com/OpenRecruiterTools/linkedin-toolkit) - LinkedIn automation and data extraction that runs entirely in your own browser session, with hard rate caps and a human approval queue. Includes an MCP server for AI agents. `MIT` `Nodejs/Javascript`
```

Requirements to check before opening it: the project must be self-hostable (yes), have a clear
licence (MIT), and have had a release in the last 12 months (yes, at launch).

## AI and agent directories — Phase 3–4

- [ ] **There's An AI For That** — https://theresanaiforthat.com/submit/
- [ ] **Futurepedia** — https://www.futurepedia.io/submit-tool
- [ ] **AI Agents Directory** — https://aiagentsdirectory.com/submit
- [ ] **Product Hunt** — Phase 4, see [product-hunt.md](product-hunt.md)
- [ ] **Awesome AI Agents** — https://github.com/e2b-dev/awesome-ai-agents (PR)

## Communities — post, do not spam

One post per community, spaced across days, each written for that audience. Read the rules first;
several require prior participation.

- [ ] r/ClaudeAI, r/LocalLLaMA, r/selfhosted, r/sales, r/recruiting —
      [reddit-posts.md](reddit-posts.md)
- [ ] MCP Discord (`#showcase`)
- [ ] LangChain, CrewAI and n8n Discords — the integrations channel, once the wrapper is published
- [ ] Dev.to and Hashnode — [blog-post.md](blog-post.md)
- [ ] LinkedIn and X — [linkedin-post.md](linkedin-post.md)

## Before you submit anything

- [ ] `npx linkedin-toolkit-mcp` works from a clean machine with no repo checked out
- [ ] The release zip loads unpacked in a fresh Chrome profile
- [ ] The README's first screen makes sense to someone who has never heard of MCP
- [ ] The demo GIF exists and is under 10 MB
- [ ] README images use absolute `raw.githubusercontent.com` URLs, so npm and PyPI render them
- [ ] `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` are all present
- [ ] 15 good-first-issues are open and labelled
- [ ] Discussions are enabled
- [ ] The repo description and topics are set: `mcp`, `linkedin`, `ai-agents`, `automation`,
      `chrome-extension`, `local-first`, `open-source`
- [ ] A tagged release exists with the extension zip attached

## Keeping listings alive

Most directories rot. Every release, spend twenty minutes:

- Update the version and feature list on Smithery, Glama and PulseMCP
- Re-check the awesome-list entries still exist (lists get reorganised and entries get dropped)
- Answer any comment left on AlternativeTo or Product Hunt — an unanswered question sits at the top
  of the page forever
