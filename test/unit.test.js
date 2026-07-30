import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildQuery,
  eqFilter,
  formatListResult,
  mapBodyInput,
  mapCompanyInput,
  mapOpportunityInput,
  mapPersonInput,
  parseErrorBody,
  sanitizeSearchTerm,
  searchToFilter,
  SEARCH_FIELDS,
  toCurrency,
  toLinks,
} from "../index.js";

test("mapPersonInput maps flat params to Twenty composite fields", () => {
  const payload = mapPersonInput({
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "+15551234567",
    linkedinUrl: "https://linkedin.com/in/ada",
    jobTitle: "Engineer",
    companyId: "abc-123",
  });

  assert.deepEqual(payload.name, { firstName: "Ada", lastName: "Lovelace" });
  assert.deepEqual(payload.emails, { primaryEmail: "ada@example.com", additionalEmails: [] });
  assert.equal(payload.phones.primaryPhoneNumber, "+15551234567");
  assert.equal(payload.linkedinLink.primaryLinkUrl, "https://linkedin.com/in/ada");
  // non-composite fields pass through untouched
  assert.equal(payload.jobTitle, "Engineer");
  assert.equal(payload.companyId, "abc-123");
  // flat params must not leak into the payload
  assert.ok(!("firstName" in payload));
  assert.ok(!("email" in payload));
  assert.ok(!("phone" in payload));
});

test("mapPersonInput omits composites for absent params (partial update safe)", () => {
  const payload = mapPersonInput({ jobTitle: "CTO" });
  assert.deepEqual(payload, { jobTitle: "CTO" });
});

test("mapPersonInput partial name update does not clobber the other part", () => {
  assert.deepEqual(mapPersonInput({ firstName: "Ada" }).name, { firstName: "Ada" });
  assert.deepEqual(mapPersonInput({ lastName: "Lovelace" }).name, { lastName: "Lovelace" });
});

test("mapCompanyInput maps domain, address and revenue composites", () => {
  const payload = mapCompanyInput({
    name: "Acme",
    domainName: "acme.com",
    address: "1 Main St",
    annualRecurringRevenue: 5,
    currencyCode: "EUR",
    employees: 10,
  });

  assert.equal(payload.domainName.primaryLinkUrl, "acme.com");
  assert.equal(payload.address.addressStreet1, "1 Main St");
  assert.deepEqual(payload.annualRecurringRevenue, { amountMicros: 5_000_000, currencyCode: "EUR" });
  assert.equal(payload.employees, 10);
  assert.ok(!("currencyCode" in payload));
});

test("mapCompanyInput supports the v2.x annualRevenue field name", () => {
  const payload = mapCompanyInput({ annualRevenue: 2 });
  assert.deepEqual(payload.annualRevenue, { amountMicros: 2_000_000, currencyCode: "USD" });
  assert.ok(!("annualRecurringRevenue" in payload));
});

test("mapCompanyInput passes through a full address object", () => {
  const address = { addressStreet1: "1 Main St", addressCity: "Austin" };
  const payload = mapCompanyInput({ address });
  assert.deepEqual(payload.address, address);
});

test("mapOpportunityInput converts amount to micros", () => {
  const payload = mapOpportunityInput({ name: "Big deal", amount: 1234.56 });
  assert.deepEqual(payload.amount, { amountMicros: 1_234_560_000, currencyCode: "USD" });
  assert.equal(payload.name, "Big deal");
});

test("mapBodyInput maps body to bodyV2 markdown", () => {
  const payload = mapBodyInput({ title: "Call notes", body: "Discussed **pricing**" });
  assert.deepEqual(payload.bodyV2, { markdown: "Discussed **pricing**" });
  assert.ok(!("body" in payload));
});

test("toLinks passes through composite objects", () => {
  const links = { primaryLinkUrl: "x.com", primaryLinkLabel: "X", secondaryLinks: [] };
  assert.equal(toLinks(links), links);
});

test("toCurrency rounds to integer micros", () => {
  assert.equal(toCurrency(0.1, "USD").amountMicros, 100_000);
  assert.equal(toCurrency(19.99, "USD").amountMicros, 19_990_000);
});

test("searchToFilter builds an or() of ilike clauses", () => {
  const filter = searchToFilter("ada", SEARCH_FIELDS.people);
  assert.equal(
    filter,
    "or(name.firstName[ilike]:%ada%,name.lastName[ilike]:%ada%,emails.primaryEmail[ilike]:%ada%)"
  );
});

test("searchToFilter uses a bare clause for single-field searches", () => {
  assert.equal(searchToFilter("kick-off", SEARCH_FIELDS.notes), "title[ilike]:%kick-off%");
});

test("sanitizeSearchTerm strips filter-grammar characters", () => {
  assert.equal(sanitizeSearchTerm('a%b(c),d"e\\f[g]'), "a b c d e f g");
  assert.equal(searchToFilter("%(),", SEARCH_FIELDS.notes), null);
});

test("buildQuery assembles limit, filter, order_by and cursors", () => {
  const query = buildQuery(
    { limit: 50, orderBy: "createdAt[DescNullsLast]", startingAfter: "cur1", depth: 1 },
    eqFilter("companyId", "abc")
  );
  assert.ok(query.includes("limit=50"));
  assert.ok(query.includes(`filter=${encodeURIComponent("companyId[eq]:abc")}`));
  assert.ok(query.includes(`order_by=${encodeURIComponent("createdAt[DescNullsLast]")}`));
  assert.ok(query.includes("starting_after=cur1"));
  assert.ok(query.includes("depth=1"));
});

test("buildQuery AND-joins multiple filter clauses", () => {
  const query = buildQuery(
    { filter: "createdAt[gte]:2026-01-01" },
    eqFilter("status", "TODO")
  );
  assert.ok(
    query.includes(
      `filter=${encodeURIComponent("and(status[eq]:TODO,createdAt[gte]:2026-01-01)")}`
    )
  );
});

test("buildQuery defaults to limit=20 and no filter", () => {
  assert.equal(buildQuery(), "limit=20");
});

test("formatListResult unwraps Twenty's list envelope", () => {
  const result = formatListResult(
    {
      data: { people: [{ id: "1" }] },
      pageInfo: { hasNextPage: false, endCursor: "c1" },
      totalCount: 1,
    },
    "people"
  );
  assert.deepEqual(result.records, [{ id: "1" }]);
  assert.equal(result.pageInfo.endCursor, "c1");
  assert.equal(result.totalCount, 1);
});

test("parseErrorBody extracts messages from structured errors", () => {
  assert.equal(
    parseErrorBody('{"error":"BadRequestException","messages":["Invalid filter"]}'),
    "BadRequestException — Invalid filter"
  );
  assert.equal(parseErrorBody("plain text error"), "plain text error");
});
