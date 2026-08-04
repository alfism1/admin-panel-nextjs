import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SIZE, parseTableParams } from "./table-params";

/**
 * These params come straight from a URL a user can edit, and feed a LIMIT/
 * OFFSET query. Clamping is a resource-exhaustion guard, not tidiness.
 */
describe("parseTableParams", () => {
  it("applies defaults for an empty query string", () => {
    expect(parseTableParams({})).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sort: null,
      order: "desc",
      search: "",
      filters: {},
    });
  });

  it("reads valid values", () => {
    const params = parseTableParams({
      page: "3",
      pageSize: "50",
      sort: "name",
      order: "asc",
      search: "ada",
    });

    expect(params).toMatchObject({
      page: 3,
      pageSize: 50,
      sort: "name",
      order: "asc",
      search: "ada",
    });
  });

  it("collects unreserved keys as filters", () => {
    const params = parseTableParams({
      page: "2",
      role: "admin",
      status: "banned",
    });
    expect(params.filters).toEqual({ role: "admin", status: "banned" });
  });

  it("ignores empty filter values", () => {
    expect(parseTableParams({ role: "" }).filters).toEqual({});
  });

  it.each([
    ["negative", "-1"],
    ["zero", "0"],
    ["not a number", "abc"],
    ["scientific", "1e9"],
  ])("falls back to page 1 for a %s page", (_label, page) => {
    expect(parseTableParams({ page }).page).toBe(1);
  });

  it("rejects a page size outside the allow-list", () => {
    // Otherwise `?pageSize=1000000` is an unbounded query.
    expect(parseTableParams({ pageSize: "1000000" }).pageSize).toBe(
      DEFAULT_PAGE_SIZE,
    );
    expect(parseTableParams({ pageSize: "37" }).pageSize).toBe(
      DEFAULT_PAGE_SIZE,
    );
    expect(parseTableParams({ pageSize: "-10" }).pageSize).toBe(
      DEFAULT_PAGE_SIZE,
    );
  });

  it("accepts every allow-listed page size", () => {
    for (const size of [10, 20, 50, 100]) {
      expect(parseTableParams({ pageSize: String(size) }).pageSize).toBe(size);
    }
  });

  it("defaults an unrecognised order to desc", () => {
    expect(parseTableParams({ order: "sideways" }).order).toBe("desc");
  });

  it("accepts URLSearchParams as well as a record", () => {
    const fromSearchParams = parseTableParams(
      new URLSearchParams("page=2&role=admin"),
    );
    const fromRecord = parseTableParams({ page: "2", role: "admin" });
    expect(fromSearchParams).toEqual(fromRecord);
  });

  it("takes the first value of a repeated key", () => {
    expect(parseTableParams({ role: ["admin", "viewer"] }).filters.role).toBe(
      "admin",
    );
  });
});
