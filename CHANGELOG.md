# Changelog

## 2.0.0 — 2026-07-30

A ground-up revision of the server against the real Twenty REST API, incorporating fixes and features contributed by the community in PRs #4, #6, #7 and #8 and several forks.

### Fixed

- **Writes work again.** Flat params (`firstName`, `email`, `phone`, `linkedinUrl`, `domainName`, `address`, revenue/amount fields) are now mapped to Twenty's composite field shapes (`name`, `emails`, `phones`, link/address/currency composites). Previously every `create_person`/`update_person` and most company writes returned HTTP 400. (Closes the regression tracked in #2; based on #4 by @zaks.)
- **Search works again.** Twenty's REST API has no `search` query param — it was silently ignored, so `search`/`search_records` returned unfiltered lists. Search now builds `or(...[ilike]:%term%...)` filters over per-object field sets, with grammar-safe sanitization. (Based on #6 by @studio7A and #8 by @InDebted-Growth.)
- **Pagination is now real.** `offset` (also silently ignored by the API) was replaced with Twenty's cursor pagination: `startingAfter` / `endingBefore`, and list results expose `pageInfo`.
- Updates use `PATCH` (Twenty's documented verb) instead of `PUT`.
- Note/task bodies write to `bodyV2: { markdown }` — plain `body` no longer exists on current Twenty versions.
- `DELETE` responses with empty bodies no longer throw (204/empty-body handling; based on @ndrkltsk's fork).
- Structured Twenty error bodies are parsed into readable messages instead of raw JSON dumps.

### Added

- **Opportunity tools**: `create_opportunity`, `get_opportunity`, `list_opportunities`, `update_opportunity`, `delete_opportunity`, with automatic `amountMicros` conversion. (Based on #7 by @tarikhennen.)
- **Record targets**: `create_note` and `create_task` accept `personId` / `companyId` / `opportunityId` and create the `noteTargets`/`taskTargets` links automatically.
- **Batch creates**: `batch_create_people` and `batch_create_companies` (up to 60 records per call).
- `list_workspace_members` for resolving task `assigneeId`.
- `filter`, `orderBy` and `depth` passthrough params on all list tools; `depth` on all get tools.
- Retry with exponential backoff on 429/5xx (honoring `Retry-After`) and 30s request timeouts.
- Unit test suite (`npm test`, `node --test`, no network required) and GitHub Actions CI.
- `Dockerfile`, `LICENSE` file, `bin` entry (`npx -y github:mhenry3164/twenty-crm-mcp-server`).
- Support for both `annualRecurringRevenue` (Twenty ≤ v1.x field name) and `annualRevenue` (v2.x+).
- `TWENTY_DEFAULT_CURRENCY` env var (default `USD`).

### Changed

- Upgraded `@modelcontextprotocol/sdk` from ^0.6.0 to ^1.30.0.
- List results are returned as `{ records, pageInfo, totalCount? }` instead of the raw API envelope.
- Errors from tool calls are flagged with `isError: true` in the MCP response.

### Breaking

- `offset` removed from list tools (it never worked — use `startingAfter`).
- `position` params removed from note/task tools.
- `assigneeId` on tasks is documented as a workspace member ID (it always was one — the old description said "person").

## 1.0.0 — 2025-08-21

Initial release.
