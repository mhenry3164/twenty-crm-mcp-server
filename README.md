<div align="center">

# 🤖 Twenty CRM MCP Server

**Transform your CRM into an AI-powered assistant**

[![CI](https://github.com/mhenry3164/twenty-crm-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/mhenry3164/twenty-crm-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![Twenty CRM](https://img.shields.io/badge/Twenty_CRM-Compatible-blue)](https://twenty.com)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple)](https://modelcontextprotocol.io/)

*A Model Context Protocol server that connects [Twenty CRM](https://twenty.com) with Claude and other AI assistants, enabling natural language interactions with your customer data.*

[🚀 Quick Start](#-installation) • [🛠️ Tools](#%EF%B8%8F-tools) • [🔍 Search & Filtering](#-search-filtering--pagination) • [🐳 Docker](#-docker) • [🤝 Contributing](#-contributing)

</div>

---

## ✨ Features

- **Complete CRUD** for people, companies, **opportunities**, notes and tasks
- **Working search** — built on Twenty's real `filter` grammar (`ilike` matching), not the nonexistent `search` param
- **Correct composite-field mapping** — flat inputs like `firstName`/`email`/`amount` are converted to Twenty's `name`/`emails`/`amount` composite shapes on write
- **Cursor pagination** (`startingAfter`/`endingBefore`) plus raw `filter`, `orderBy` and `depth` passthrough on every list tool
- **Notes & tasks attach to records** — pass `personId`/`companyId`/`opportunityId` when creating and the target links are created for you
- **Batch creates** — up to 60 people or companies per call
- **Resilient client** — 30s timeouts, automatic retry with backoff on 429/5xx (honors `Retry-After`), structured error messages
- **Schema discovery** — metadata tools expose your workspace's objects, fields and enum options, including custom objects

## 🚀 Installation

### Prerequisites

- Node.js 18 or higher
- A Twenty CRM instance (cloud or self-hosted)
- Claude Desktop, Claude Code, or any MCP-compatible client

### Setup

1. **Get your Twenty CRM API key**: in Twenty, go to Settings → API & Webhooks (under Developers) and generate a key.

2. **Configure your MCP client.**

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "twenty-crm": {
      "command": "npx",
      "args": ["-y", "github:mhenry3164/twenty-crm-mcp-server"],
      "env": {
        "TWENTY_API_KEY": "your_api_key_here",
        "TWENTY_BASE_URL": "https://api.twenty.com"
      }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add twenty-crm -e TWENTY_API_KEY=your_api_key_here -e TWENTY_BASE_URL=https://api.twenty.com -- npx -y github:mhenry3164/twenty-crm-mcp-server
```

Or clone and run from source:

```bash
git clone https://github.com/mhenry3164/twenty-crm-mcp-server.git
cd twenty-crm-mcp-server
npm install
```

then point your client at `node /path/to/twenty-crm-mcp-server/index.js`.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TWENTY_API_KEY` | ✅ | — | API key from Settings → API & Webhooks |
| `TWENTY_BASE_URL` | | `https://api.twenty.com` | Your instance URL if self-hosted |
| `TWENTY_DEFAULT_CURRENCY` | | `USD` | Currency code used when none is given for money fields |

## 💬 Usage

Once configured, use natural language to interact with your Twenty CRM:

```
"List the first 10 people in my CRM"
"Create a new person named John Doe with email john@example.com at Acme (company id ...)"
"Create a $12,000 opportunity called 'Acme renewal' in PROPOSAL stage"
"Add a note about today's call and attach it to the Acme company record"
"Create a follow-up task due Friday assigned to Sam, linked to the deal"
"Search people, companies and opportunities for 'blockchain'"
```

## 🛠️ Tools

| Category | Tools |
|---|---|
| **People** | `create_person`, `get_person`, `update_person`, `list_people`, `delete_person` |
| **Companies** | `create_company`, `get_company`, `update_company`, `list_companies`, `delete_company` |
| **Opportunities** | `create_opportunity`, `get_opportunity`, `update_opportunity`, `list_opportunities`, `delete_opportunity` |
| **Notes** | `create_note` (with record targets), `get_note`, `update_note`, `list_notes`, `delete_note` |
| **Tasks** | `create_task` (with record targets + assignee), `get_task`, `update_task`, `list_tasks`, `delete_task` |
| **Batch** | `batch_create_people`, `batch_create_companies` (up to 60 records) |
| **Workspace** | `list_workspace_members` (for task assignment) |
| **Metadata** | `get_metadata_objects`, `get_object_metadata` |
| **Search** | `search_records` (across people, companies, opportunities, notes, tasks) |

### Composite fields, handled for you

Twenty stores identity/contact/money data in composite fields. This server accepts flat parameters and maps them to the shapes the API expects:

| You pass | Twenty receives |
|---|---|
| `firstName`, `lastName` | `name: { firstName, lastName }` |
| `email` | `emails: { primaryEmail, additionalEmails: [] }` |
| `phone` | `phones: { primaryPhoneNumber, ... }` |
| `linkedinUrl` / `xUrl` / `domainName` | `{ primaryLinkUrl, ... }` link composites |
| `amount: 12000` + `currencyCode` | `amount: { amountMicros: 12000000000, currencyCode }` |
| `body` (notes/tasks) | `bodyV2: { markdown }` |
| `address` (string) | `address: { addressStreet1, ... }` (or pass a full address object) |

Anything else — including your workspace's custom fields — passes through untouched.

> **Note on company revenue:** the field is `annualRecurringRevenue` on most deployed Twenty versions and `annualRevenue` on Twenty v2.x+. Both parameters are supported; use the one that matches your instance (check `get_object_metadata` for `companies` if unsure).

## 🔍 Search, filtering & pagination

Twenty's REST API has no `search` or `offset` query params — this server builds real filters instead:

- **`search`** on list tools becomes a case-insensitive `ilike` filter across sensible fields per object (people: first/last name + email; companies: name + domain; opportunities/notes/tasks: name/title).
- **`filter`** accepts Twenty's raw filter grammar for anything more specific:
  - `createdAt[gte]:2026-01-01`
  - `or(city[eq]:Austin,city[eq]:Dallas)`
  - `emails.primaryEmail[ilike]:%@acme.com`
  - Comparators: `eq, neq, in, containsAny, is, gt, gte, lt, lte, startsWith, endsWith, like, ilike`; combine with `and(...)`, `or(...)`, `not(...)`. Use `field[is]:NULL` / `NOT_NULL` for empty checks.
- **`orderBy`**: e.g. `createdAt[DescNullsLast]` (directions: `AscNullsFirst`, `AscNullsLast`, `DescNullsFirst`, `DescNullsLast`).
- **Pagination is cursor-based**: results include `pageInfo.endCursor` — pass it as `startingAfter` for the next page. `limit` max is 200.
- **`depth`**: `0` (default) or `1` to include first-level related records.

## 🐳 Docker

```bash
docker build -t twenty-crm-mcp-server .
```

```json
{
  "mcpServers": {
    "twenty-crm": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "TWENTY_API_KEY", "-e", "TWENTY_BASE_URL", "twenty-crm-mcp-server"],
      "env": {
        "TWENTY_API_KEY": "your_api_key_here",
        "TWENTY_BASE_URL": "https://api.twenty.com"
      }
    }
  }
}
```

## 🧪 Development

```bash
npm install
npm test        # unit tests (node --test, no network needed)
npm start       # run the stdio server
```

## ⬆️ Upgrading from v1.x

v2.0.0 fixes writes and search against the actual Twenty API. Breaking changes:

- `offset` was removed from list tools (Twenty's REST API never supported it) — use cursor pagination (`startingAfter`).
- Note/task `body` now maps to `bodyV2.markdown`; `position` params were dropped.
- Updates now use `PATCH` (Twenty's documented verb) instead of `PUT`.
- List results are returned as `{ records, pageInfo, totalCount? }` instead of the raw API envelope.

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

v2.0.0 builds on excellent community work: composite-field mapping ([#4](https://github.com/mhenry3164/twenty-crm-mcp-server/pull/4) by @zaks), filter-based search ([#6](https://github.com/mhenry3164/twenty-crm-mcp-server/pull/6) by @studio7A, [#8](https://github.com/mhenry3164/twenty-crm-mcp-server/pull/8) by @InDebted-Growth), opportunity tools ([#7](https://github.com/mhenry3164/twenty-crm-mcp-server/pull/7) by @tarikhennen), and patterns from the forks by @BCJonkhout, @archie1492, @ndrkltsk and @atilladeniz.

## 📄 License

MIT — see [LICENSE](LICENSE).
