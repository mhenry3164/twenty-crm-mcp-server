#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { realpathSync } from "fs";
import { pathToFileURL } from "url";

export const VERSION = "2.0.0";

const DEFAULT_CURRENCY = process.env.TWENTY_DEFAULT_CURRENCY || "USD";

// ---------------------------------------------------------------------------
// Filter helpers
//
// Twenty's REST API has no `search` or `offset` query params — reads are
// filtered with `filter=field[comparator]:value` (comparators: eq, neq, in,
// containsAny, is, gt, gte, lt, lte, startsWith, endsWith, like, ilike;
// conjunctions: and(...), or(...), not(...)) and paginated with cursors
// (`starting_after` / `ending_before` + `limit`, max 200).
// ---------------------------------------------------------------------------

// Fields searched per object by the `search` params and search_records.
export const SEARCH_FIELDS = {
  people: ["name.firstName", "name.lastName", "emails.primaryEmail"],
  companies: ["name", "domainName.primaryLinkUrl"],
  opportunities: ["name"],
  notes: ["title"],
  tasks: ["title"],
};

// Strip characters that are part of the filter grammar so a search term can
// never break out of its clause.
export function sanitizeSearchTerm(term) {
  return String(term).replace(/[%(),[\]\\"]/g, " ").replace(/\s+/g, " ").trim();
}

export function searchToFilter(term, fields) {
  const safe = sanitizeSearchTerm(term);
  if (!safe) return null;
  const clauses = fields.map((f) => `${f}[ilike]:%${safe}%`);
  return clauses.length > 1 ? `or(${clauses.join(",")})` : clauses[0];
}

// `is` comparator takes bare NULL / NOT_NULL; everything else is passed as-is
// (UUIDs, enum values and numbers are grammar-safe).
export function eqFilter(field, value) {
  return `${field}[eq]:${value}`;
}

// Assemble the query string for list endpoints. `andParts` are extra filter
// clauses AND-joined with any raw `filter` the caller passed.
export function buildQuery(params = {}, ...andParts) {
  const { limit = 20, startingAfter, endingBefore, orderBy, filter, depth } = params;
  const parts = [`limit=${limit}`];
  const filters = [...andParts, filter].filter(Boolean);
  if (filters.length === 1) {
    parts.push(`filter=${encodeURIComponent(filters[0])}`);
  } else if (filters.length > 1) {
    parts.push(`filter=${encodeURIComponent(`and(${filters.join(",")})`)}`);
  }
  if (orderBy) parts.push(`order_by=${encodeURIComponent(orderBy)}`);
  if (startingAfter) parts.push(`starting_after=${encodeURIComponent(startingAfter)}`);
  if (endingBefore) parts.push(`ending_before=${encodeURIComponent(endingBefore)}`);
  if (depth !== undefined) parts.push(`depth=${depth}`);
  return parts.join("&");
}

// ---------------------------------------------------------------------------
// Payload mappers
//
// Twenty stores identity/contact/link/money data in composite fields. These
// mappers accept flat convenience params (firstName, email, amount, ...) and
// produce the composite shapes the REST API expects, passing every other key
// through untouched so custom fields keep working.
// ---------------------------------------------------------------------------

export function toLinks(value) {
  if (value && typeof value === "object") return value;
  return { primaryLinkUrl: value, primaryLinkLabel: "", secondaryLinks: [] };
}

export function toCurrency(amount, currencyCode) {
  return {
    amountMicros: Math.round(Number(amount) * 1_000_000),
    currencyCode: currencyCode || DEFAULT_CURRENCY,
  };
}

export function mapPersonInput(data) {
  const { firstName, lastName, email, phone, linkedinUrl, xUrl, ...rest } = data;
  const payload = { ...rest };
  // Only send the name parts that were provided so a partial update can't
  // wipe the other part.
  if (firstName !== undefined || lastName !== undefined) {
    payload.name = {};
    if (firstName !== undefined) payload.name.firstName = firstName;
    if (lastName !== undefined) payload.name.lastName = lastName;
  }
  if (email !== undefined) {
    payload.emails = { primaryEmail: email, additionalEmails: [] };
  }
  if (phone !== undefined) {
    payload.phones = {
      primaryPhoneNumber: phone,
      primaryPhoneCountryCode: "",
      primaryPhoneCallingCode: "",
      additionalPhones: [],
    };
  }
  if (linkedinUrl !== undefined) payload.linkedinLink = toLinks(linkedinUrl);
  if (xUrl !== undefined) payload.xLink = toLinks(xUrl);
  return payload;
}

export function mapCompanyInput(data) {
  const {
    domainName,
    address,
    linkedinUrl,
    xUrl,
    annualRecurringRevenue,
    annualRevenue,
    currencyCode,
    ...rest
  } = data;
  const payload = { ...rest };
  if (domainName !== undefined) payload.domainName = toLinks(domainName);
  if (address !== undefined) {
    payload.address =
      typeof address === "string"
        ? {
            addressStreet1: address,
            addressStreet2: "",
            addressCity: "",
            addressState: "",
            addressPostcode: "",
            addressCountry: "",
          }
        : address;
  }
  if (linkedinUrl !== undefined) payload.linkedinLink = toLinks(linkedinUrl);
  if (xUrl !== undefined) payload.xLink = toLinks(xUrl);
  // Field is named annualRecurringRevenue on most deployed versions and
  // annualRevenue on Twenty >= v2.x — map whichever the caller used.
  if (annualRecurringRevenue !== undefined) {
    payload.annualRecurringRevenue = toCurrency(annualRecurringRevenue, currencyCode);
  }
  if (annualRevenue !== undefined) {
    payload.annualRevenue = toCurrency(annualRevenue, currencyCode);
  }
  return payload;
}

export function mapOpportunityInput(data) {
  const { amount, currencyCode, ...rest } = data;
  const payload = { ...rest };
  if (amount !== undefined && amount !== null) {
    payload.amount = toCurrency(amount, currencyCode);
  }
  return payload;
}

// Notes and tasks use the RICH_TEXT_V2 `bodyV2` composite; plain `body` was
// removed from current Twenty versions.
export function mapBodyInput(data) {
  const { body, ...rest } = data;
  const payload = { ...rest };
  if (body !== undefined) {
    payload.bodyV2 = { markdown: body };
  }
  return payload;
}

// Reshape Twenty's list envelope ({ data: { people: [...] }, pageInfo, totalCount })
// into a consistent, compact result.
export function formatListResult(result, objectName) {
  const records = result?.data?.[objectName] ?? result?.data ?? result;
  const out = { records };
  if (result?.pageInfo) out.pageInfo = result.pageInfo;
  if (result?.totalCount !== undefined) out.totalCount = result.totalCount;
  return out;
}

// Parse Twenty's structured error bodies into something readable.
export function parseErrorBody(text) {
  try {
    const parsed = JSON.parse(text);
    const messages = parsed.messages || parsed.errors || [];
    const parts = [];
    if (parsed.error) parts.push(parsed.error);
    if (parsed.message) parts.push(parsed.message);
    for (const m of messages) {
      parts.push(typeof m === "string" ? m : m.message || JSON.stringify(m));
    }
    if (parts.length) return parts.join(" — ");
  } catch {
    // not JSON, fall through
  }
  return text;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

export class TwentyCRMServer {
  constructor() {
    this.server = new Server(
      { name: "twenty-crm", version: VERSION },
      { capabilities: { tools: {} } }
    );

    this.apiKey = process.env.TWENTY_API_KEY;
    this.baseUrl = (process.env.TWENTY_BASE_URL || "https://api.twenty.com").replace(/\/+$/, "");

    if (!this.apiKey) {
      throw new Error("TWENTY_API_KEY environment variable is required");
    }

    this.setupToolHandlers();
  }

  async makeRequest(endpoint, method = "GET", data = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    };
    if (data && ["POST", "PUT", "PATCH"].includes(method)) {
      options.body = JSON.stringify(data);
    }

    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(30_000),
        });

        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${parseErrorBody(errorText)}`);
        }

        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      } catch (error) {
        lastError = error;
        const retryableNetwork =
          error.name === "TimeoutError" || error.cause?.code === "ECONNRESET";
        if (retryableNetwork && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
          continue;
        }
        throw new Error(`Twenty API request failed (${method} ${endpoint}): ${error.message}`);
      }
    }
    throw new Error(`Twenty API request failed (${method} ${endpoint}): ${lastError?.message}`);
  }

  text(value) {
    return {
      content: [
        {
          type: "text",
          text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
        },
      ],
    };
  }

  // Shared list-tool pagination/filtering params.
  static listParams(searchDescription) {
    const props = {
      limit: { type: "number", description: "Max results to return (default 20, max 200)" },
      startingAfter: { type: "string", description: "Cursor: return records after this cursor (from pageInfo.endCursor)" },
      endingBefore: { type: "string", description: "Cursor: return records before this cursor (from pageInfo.startCursor)" },
      orderBy: { type: "string", description: "Sort, e.g. 'createdAt[DescNullsLast]' or 'name.lastName'. Directions: AscNullsFirst, AscNullsLast, DescNullsFirst, DescNullsLast" },
      filter: { type: "string", description: "Raw Twenty filter, e.g. 'createdAt[gte]:2026-01-01' or 'or(city[eq]:Austin,city[eq]:Dallas)'. Comparators: eq, neq, in, containsAny, is, gt, gte, lt, lte, startsWith, endsWith, like, ilike" },
      depth: { type: "number", description: "Relation depth 0 or 1 (default 0). 1 includes related records" },
    };
    if (searchDescription) {
      props.search = { type: "string", description: searchDescription };
    }
    return props;
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const idOnly = (label) => ({
        type: "object",
        properties: {
          id: { type: "string", description: `${label} ID` },
          depth: { type: "number", description: "Relation depth 0 or 1" },
        },
        required: ["id"],
      });

      return {
        tools: [
          // ------------------------------------------------- People
          {
            name: "create_person",
            description: "Create a new person in Twenty CRM",
            inputSchema: {
              type: "object",
              properties: {
                firstName: { type: "string", description: "First name" },
                lastName: { type: "string", description: "Last name" },
                email: { type: "string", description: "Primary email address" },
                phone: { type: "string", description: "Primary phone number" },
                jobTitle: { type: "string", description: "Job title" },
                companyId: { type: "string", description: "Company ID to associate with" },
                linkedinUrl: { type: "string", description: "LinkedIn profile URL" },
                xUrl: { type: "string", description: "X (Twitter) profile URL" },
                city: { type: "string", description: "City" },
                avatarUrl: { type: "string", description: "Avatar image URL" },
              },
              required: ["firstName", "lastName"],
            },
          },
          {
            name: "get_person",
            description: "Get details of a specific person by ID",
            inputSchema: idOnly("Person"),
          },
          {
            name: "update_person",
            description: "Update an existing person. Only provided fields are changed",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "Person ID" },
                firstName: { type: "string", description: "First name" },
                lastName: { type: "string", description: "Last name" },
                email: { type: "string", description: "Primary email address" },
                phone: { type: "string", description: "Primary phone number" },
                jobTitle: { type: "string", description: "Job title" },
                companyId: { type: "string", description: "Company ID" },
                linkedinUrl: { type: "string", description: "LinkedIn profile URL" },
                xUrl: { type: "string", description: "X (Twitter) profile URL" },
                city: { type: "string", description: "City" },
              },
              required: ["id"],
            },
          },
          {
            name: "list_people",
            description: "List people with search, filtering and cursor pagination",
            inputSchema: {
              type: "object",
              properties: {
                ...TwentyCRMServer.listParams("Search across first name, last name and email"),
                companyId: { type: "string", description: "Filter by company ID" },
              },
            },
          },
          {
            name: "delete_person",
            description: "Delete a person from Twenty CRM",
            inputSchema: {
              type: "object",
              properties: { id: { type: "string", description: "Person ID to delete" } },
              required: ["id"],
            },
          },

          // ------------------------------------------------- Companies
          {
            name: "create_company",
            description: "Create a new company in Twenty CRM",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string", description: "Company name" },
                domainName: { type: "string", description: "Company domain, e.g. acme.com" },
                address: { type: "string", description: "Street address (or pass a full address object)" },
                employees: { type: "number", description: "Number of employees" },
                linkedinUrl: { type: "string", description: "LinkedIn company URL" },
                xUrl: { type: "string", description: "X (Twitter) URL" },
                annualRecurringRevenue: { type: "number", description: "ARR in currency units (field name on most Twenty versions)" },
                annualRevenue: { type: "number", description: "Annual revenue in currency units (field name on Twenty v2.x+)" },
                currencyCode: { type: "string", description: `Currency code for revenue (default ${DEFAULT_CURRENCY})` },
                idealCustomerProfile: { type: "boolean", description: "Is this an ideal customer profile" },
              },
              required: ["name"],
            },
          },
          {
            name: "get_company",
            description: "Get details of a specific company by ID",
            inputSchema: idOnly("Company"),
          },
          {
            name: "update_company",
            description: "Update an existing company. Only provided fields are changed",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "Company ID" },
                name: { type: "string", description: "Company name" },
                domainName: { type: "string", description: "Company domain" },
                address: { type: "string", description: "Street address (or pass a full address object)" },
                employees: { type: "number", description: "Number of employees" },
                linkedinUrl: { type: "string", description: "LinkedIn company URL" },
                xUrl: { type: "string", description: "X (Twitter) URL" },
                annualRecurringRevenue: { type: "number", description: "ARR in currency units (field name on most Twenty versions)" },
                annualRevenue: { type: "number", description: "Annual revenue in currency units (field name on Twenty v2.x+)" },
                currencyCode: { type: "string", description: `Currency code for revenue (default ${DEFAULT_CURRENCY})` },
                idealCustomerProfile: { type: "boolean", description: "Is this an ideal customer profile" },
              },
              required: ["id"],
            },
          },
          {
            name: "list_companies",
            description: "List companies with search, filtering and cursor pagination",
            inputSchema: {
              type: "object",
              properties: TwentyCRMServer.listParams("Search across company name and domain"),
            },
          },
          {
            name: "delete_company",
            description: "Delete a company from Twenty CRM",
            inputSchema: {
              type: "object",
              properties: { id: { type: "string", description: "Company ID to delete" } },
              required: ["id"],
            },
          },

          // ------------------------------------------------- Opportunities
          {
            name: "create_opportunity",
            description: "Create a new opportunity (deal) in Twenty CRM",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string", description: "Opportunity name" },
                stage: { type: "string", description: "Pipeline stage. Workspace-specific; defaults are NEW, SCREENING, MEETING, PROPOSAL, CUSTOMER (check get_object_metadata for custom stages)" },
                amount: { type: "number", description: "Deal amount in currency units (converted to micros automatically)" },
                currencyCode: { type: "string", description: `ISO currency code (default ${DEFAULT_CURRENCY})` },
                closeDate: { type: "string", description: "Expected close date (ISO 8601)" },
                companyId: { type: "string", description: "Related company ID" },
                pointOfContactId: { type: "string", description: "Related person ID (point of contact)" },
              },
              required: ["name"],
            },
          },
          {
            name: "get_opportunity",
            description: "Get details of a specific opportunity by ID",
            inputSchema: idOnly("Opportunity"),
          },
          {
            name: "list_opportunities",
            description: "List opportunities with search, filtering and cursor pagination",
            inputSchema: {
              type: "object",
              properties: {
                ...TwentyCRMServer.listParams("Search by opportunity name"),
                stage: { type: "string", description: "Filter by pipeline stage" },
                companyId: { type: "string", description: "Filter by company ID" },
              },
            },
          },
          {
            name: "update_opportunity",
            description: "Update an existing opportunity. Only provided fields are changed",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "Opportunity ID" },
                name: { type: "string", description: "Opportunity name" },
                stage: { type: "string", description: "Pipeline stage" },
                amount: { type: "number", description: "Deal amount in currency units" },
                currencyCode: { type: "string", description: `ISO currency code (default ${DEFAULT_CURRENCY})` },
                closeDate: { type: "string", description: "Expected close date (ISO 8601)" },
                companyId: { type: "string", description: "Related company ID" },
                pointOfContactId: { type: "string", description: "Related person ID" },
              },
              required: ["id"],
            },
          },
          {
            name: "delete_opportunity",
            description: "Delete an opportunity from Twenty CRM",
            inputSchema: {
              type: "object",
              properties: { id: { type: "string", description: "Opportunity ID to delete" } },
              required: ["id"],
            },
          },

          // ------------------------------------------------- Notes
          {
            name: "create_note",
            description: "Create a note, optionally attached to a person, company and/or opportunity",
            inputSchema: {
              type: "object",
              properties: {
                title: { type: "string", description: "Note title" },
                body: { type: "string", description: "Note content (markdown supported)" },
                personId: { type: "string", description: "Attach note to this person" },
                companyId: { type: "string", description: "Attach note to this company" },
                opportunityId: { type: "string", description: "Attach note to this opportunity" },
              },
              required: ["title", "body"],
            },
          },
          {
            name: "get_note",
            description: "Get details of a specific note by ID",
            inputSchema: idOnly("Note"),
          },
          {
            name: "list_notes",
            description: "List notes with search, filtering and cursor pagination",
            inputSchema: {
              type: "object",
              properties: TwentyCRMServer.listParams("Search by note title"),
            },
          },
          {
            name: "update_note",
            description: "Update an existing note. Only provided fields are changed",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "Note ID" },
                title: { type: "string", description: "Note title" },
                body: { type: "string", description: "Note content (markdown supported)" },
              },
              required: ["id"],
            },
          },
          {
            name: "delete_note",
            description: "Delete a note from Twenty CRM",
            inputSchema: {
              type: "object",
              properties: { id: { type: "string", description: "Note ID to delete" } },
              required: ["id"],
            },
          },

          // ------------------------------------------------- Tasks
          {
            name: "create_task",
            description: "Create a task, optionally attached to a person, company and/or opportunity",
            inputSchema: {
              type: "object",
              properties: {
                title: { type: "string", description: "Task title" },
                body: { type: "string", description: "Task description (markdown supported)" },
                dueAt: { type: "string", description: "Due date (ISO 8601)" },
                status: { type: "string", description: "Task status: TODO, IN_PROGRESS or DONE" },
                assigneeId: { type: "string", description: "Workspace member ID to assign (see list_workspace_members)" },
                personId: { type: "string", description: "Attach task to this person" },
                companyId: { type: "string", description: "Attach task to this company" },
                opportunityId: { type: "string", description: "Attach task to this opportunity" },
              },
              required: ["title"],
            },
          },
          {
            name: "get_task",
            description: "Get details of a specific task by ID",
            inputSchema: idOnly("Task"),
          },
          {
            name: "list_tasks",
            description: "List tasks with search, filtering and cursor pagination",
            inputSchema: {
              type: "object",
              properties: {
                ...TwentyCRMServer.listParams("Search by task title"),
                status: { type: "string", description: "Filter by status: TODO, IN_PROGRESS or DONE" },
                assigneeId: { type: "string", description: "Filter by assignee (workspace member ID)" },
              },
            },
          },
          {
            name: "update_task",
            description: "Update an existing task. Only provided fields are changed",
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: "Task ID" },
                title: { type: "string", description: "Task title" },
                body: { type: "string", description: "Task description (markdown supported)" },
                dueAt: { type: "string", description: "Due date (ISO 8601)" },
                status: { type: "string", description: "Task status: TODO, IN_PROGRESS or DONE" },
                assigneeId: { type: "string", description: "Workspace member ID to assign" },
              },
              required: ["id"],
            },
          },
          {
            name: "delete_task",
            description: "Delete a task from Twenty CRM",
            inputSchema: {
              type: "object",
              properties: { id: { type: "string", description: "Task ID to delete" } },
              required: ["id"],
            },
          },

          // ------------------------------------------------- Batch
          {
            name: "batch_create_people",
            description: "Create up to 60 people in one call",
            inputSchema: {
              type: "object",
              properties: {
                people: {
                  type: "array",
                  description: "People to create; same fields as create_person",
                  items: { type: "object" },
                },
              },
              required: ["people"],
            },
          },
          {
            name: "batch_create_companies",
            description: "Create up to 60 companies in one call",
            inputSchema: {
              type: "object",
              properties: {
                companies: {
                  type: "array",
                  description: "Companies to create; same fields as create_company",
                  items: { type: "object" },
                },
              },
              required: ["companies"],
            },
          },

          // ------------------------------------------------- Workspace
          {
            name: "list_workspace_members",
            description: "List workspace members (users) — needed for task assigneeId",
            inputSchema: {
              type: "object",
              properties: {
                limit: { type: "number", description: "Max results (default 60)" },
              },
            },
          },

          // ------------------------------------------------- Metadata
          {
            name: "get_metadata_objects",
            description: "Get all object types and their metadata (includes custom objects)",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "get_object_metadata",
            description: "Get metadata for a specific object type, including its fields and enum options",
            inputSchema: {
              type: "object",
              properties: {
                objectName: { type: "string", description: "Object name (e.g. 'people', 'companies', 'opportunities')" },
              },
              required: ["objectName"],
            },
          },

          // ------------------------------------------------- Search
          {
            name: "search_records",
            description: "Search across multiple object types at once (people, companies, opportunities, notes, tasks)",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query" },
                objectTypes: {
                  type: "array",
                  items: { type: "string", enum: Object.keys(SEARCH_FIELDS) },
                  description: "Object types to search (default: people, companies)",
                },
                limit: { type: "number", description: "Results per object type (default 10)" },
              },
              required: ["query"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;

      try {
        switch (name) {
          // People
          case "create_person":
            return this.text(await this.createRecord("people", mapPersonInput(args)));
          case "get_person":
            return this.text(await this.getRecord("people", args));
          case "update_person":
            return this.text(await this.updateRecord("people", args, mapPersonInput));
          case "list_people":
            return this.text(
              await this.listRecords("people", args, [
                args.companyId && eqFilter("companyId", args.companyId),
              ])
            );
          case "delete_person":
            return this.text(await this.deleteRecord("people", args.id, "person"));

          // Companies
          case "create_company":
            return this.text(await this.createRecord("companies", mapCompanyInput(args)));
          case "get_company":
            return this.text(await this.getRecord("companies", args));
          case "update_company":
            return this.text(await this.updateRecord("companies", args, mapCompanyInput));
          case "list_companies":
            return this.text(await this.listRecords("companies", args));
          case "delete_company":
            return this.text(await this.deleteRecord("companies", args.id, "company"));

          // Opportunities
          case "create_opportunity":
            return this.text(await this.createRecord("opportunities", mapOpportunityInput(args)));
          case "get_opportunity":
            return this.text(await this.getRecord("opportunities", args));
          case "update_opportunity":
            return this.text(await this.updateRecord("opportunities", args, mapOpportunityInput));
          case "list_opportunities":
            return this.text(
              await this.listRecords("opportunities", args, [
                args.stage && eqFilter("stage", args.stage),
                args.companyId && eqFilter("companyId", args.companyId),
              ])
            );
          case "delete_opportunity":
            return this.text(await this.deleteRecord("opportunities", args.id, "opportunity"));

          // Notes
          case "create_note":
            return this.text(await this.createNoteWithTargets(args));
          case "get_note":
            return this.text(await this.getRecord("notes", args));
          case "list_notes":
            return this.text(await this.listRecords("notes", args));
          case "update_note":
            return this.text(await this.updateRecord("notes", args, mapBodyInput));
          case "delete_note":
            return this.text(await this.deleteRecord("notes", args.id, "note"));

          // Tasks
          case "create_task":
            return this.text(await this.createTaskWithTargets(args));
          case "get_task":
            return this.text(await this.getRecord("tasks", args));
          case "list_tasks":
            return this.text(
              await this.listRecords("tasks", args, [
                args.status && eqFilter("status", args.status),
                args.assigneeId && eqFilter("assigneeId", args.assigneeId),
              ])
            );
          case "update_task":
            return this.text(await this.updateRecord("tasks", args, mapBodyInput));
          case "delete_task":
            return this.text(await this.deleteRecord("tasks", args.id, "task"));

          // Batch
          case "batch_create_people":
            return this.text(
              await this.makeRequest("/rest/batch/people", "POST", args.people.map(mapPersonInput))
            );
          case "batch_create_companies":
            return this.text(
              await this.makeRequest("/rest/batch/companies", "POST", args.companies.map(mapCompanyInput))
            );

          // Workspace
          case "list_workspace_members":
            return this.text(
              formatListResult(
                await this.makeRequest(`/rest/workspaceMembers?limit=${args.limit || 60}`),
                "workspaceMembers"
              )
            );

          // Metadata
          case "get_metadata_objects":
            return this.text(await this.makeRequest("/rest/metadata/objects"));
          case "get_object_metadata":
            return this.text(await this.makeRequest(`/rest/metadata/objects/${args.objectName}`));

          // Search
          case "search_records":
            return this.text(await this.searchRecords(args));

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  // ------------------------------------------------- Generic record helpers

  async createRecord(objectName, payload) {
    return this.makeRequest(`/rest/${objectName}`, "POST", payload);
  }

  async getRecord(objectName, { id, depth }) {
    const suffix = depth !== undefined ? `?depth=${depth}` : "";
    return this.makeRequest(`/rest/${objectName}/${id}${suffix}`);
  }

  async updateRecord(objectName, args, mapper) {
    const { id, ...data } = args;
    return this.makeRequest(`/rest/${objectName}/${id}`, "PATCH", mapper(data));
  }

  async deleteRecord(objectName, id, label) {
    await this.makeRequest(`/rest/${objectName}/${id}`, "DELETE");
    return `Successfully deleted ${label} with ID: ${id}`;
  }

  async listRecords(objectName, params, extraFilters = []) {
    const searchFilter =
      params.search && SEARCH_FIELDS[objectName]
        ? searchToFilter(params.search, SEARCH_FIELDS[objectName])
        : null;
    const query = buildQuery(params, ...extraFilters.filter(Boolean), searchFilter);
    const result = await this.makeRequest(`/rest/${objectName}?${query}`);
    return formatListResult(result, objectName);
  }

  // ------------------------------------------------- Notes / tasks with targets

  async attachTargets(targetType, idField, args, record) {
    const targets = [];
    for (const key of ["personId", "companyId", "opportunityId"]) {
      if (args[key]) {
        targets.push(
          this.makeRequest(`/rest/${targetType}`, "POST", {
            [idField]: record.id,
            [key]: args[key],
          })
        );
      }
    }
    if (targets.length) await Promise.all(targets);
    return targets.length;
  }

  async createNoteWithTargets(args) {
    const { personId, companyId, opportunityId, ...noteInput } = args;
    const result = await this.createRecord("notes", mapBodyInput(noteInput));
    const note = result?.data?.createNote ?? result?.data ?? result;
    const attached = await this.attachTargets(
      "noteTargets",
      "noteId",
      { personId, companyId, opportunityId },
      note
    );
    return { note, attachedTargets: attached };
  }

  async createTaskWithTargets(args) {
    const { personId, companyId, opportunityId, ...taskInput } = args;
    const result = await this.createRecord("tasks", mapBodyInput(taskInput));
    const task = result?.data?.createTask ?? result?.data ?? result;
    const attached = await this.attachTargets(
      "taskTargets",
      "taskId",
      { personId, companyId, opportunityId },
      task
    );
    return { task, attachedTargets: attached };
  }

  // ------------------------------------------------- Cross-object search

  async searchRecords(params) {
    const { query, objectTypes = ["people", "companies"], limit = 10 } = params;
    const entries = await Promise.all(
      objectTypes.map(async (objectType) => {
        if (!SEARCH_FIELDS[objectType]) {
          return [objectType, { error: `Unsupported object type. Use one of: ${Object.keys(SEARCH_FIELDS).join(", ")}` }];
        }
        try {
          const result = await this.listRecords(objectType, { search: query, limit });
          return [objectType, result];
        } catch (error) {
          return [objectType, { error: error.message }];
        }
      })
    );
    return Object.fromEntries(entries);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Twenty CRM MCP server v${VERSION} running on stdio`);
  }
}

// Only start the server when executed directly (node index.js or via the bin
// entry), not when imported by tests.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const server = new TwentyCRMServer();
  server.run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
