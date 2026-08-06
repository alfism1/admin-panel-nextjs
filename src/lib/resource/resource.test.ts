import { describe, expect, it } from "vitest";
import { Package } from "lucide-react";
import { z } from "zod";

import { productResource } from "@/modules/products/product.resource";
import { ALL_PERMISSION_KEYS, statement } from "@/lib/permissions";
import { navigation } from "@/components/layout/nav-config";
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
} from "@/modules/audit-log/audit-log.schema";

import { defineResource } from "./define";
import { field } from "./fields";
import { resourceStatement } from "./registry";

/**
 * What a resource declaration is supposed to produce.
 *
 * These are the assertions that used to be spread across eight files and five
 * shared registries — the point of the registry is that they now all follow
 * from one declaration, so this is where that claim gets checked.
 */

const minimal = defineResource({
  name: "widget",
  route: "/widgets",
  icon: Package,
  fields: {
    name: field.text({ label: "Name" }),
  },
});

const archivable = defineResource({
  name: "gadget",
  route: "/gadgets",
  icon: Package,
  archivable: true,
  extraActions: ["publish"],
  fields: {
    code: field.text({ label: "Code", unique: true, searchable: true }),
    tier: field.select({
      label: "Tier",
      options: [
        { value: "free", label: "Free" },
        { value: "pro", label: "Pro" },
      ],
    }),
    notes: field.textarea({ label: "Notes", optional: true }),
  },
});

describe("defineResource", () => {
  it("derives the four base actions, and nothing else by default", () => {
    expect(minimal.actions).toEqual(["create", "read", "update", "delete"]);
    expect(minimal.permissionKeys).toEqual([
      "widget:create",
      "widget:read",
      "widget:update",
      "widget:delete",
    ]);
  });

  it("adds archive and any extra actions when asked", () => {
    expect(archivable.actions).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "archive",
      "publish",
    ]);
  });

  it("derives audit actions, and the archive pair only when archivable", () => {
    expect(minimal.auditActions).toEqual([
      "widget.created",
      "widget.updated",
      "widget.deleted",
    ]);
    expect(archivable.auditActions).toContain("gadget.archived");
    expect(archivable.auditActions).toContain("gadget.unarchived");
  });

  it("derives labels, route segment and cache tags", () => {
    expect(minimal.label).toBe("Widget");
    expect(minimal.pluralLabel).toBe("Widgets");
    expect(minimal.segment).toBe("widgets");
    expect(minimal.cacheTag).toBe("widgets");
    expect(minimal.recordCacheTag("abc")).toBe("widget:abc");
  });

  it("offers a status filter for archivable resources and one per select field", () => {
    expect(archivable.filters.map((filter) => filter.name)).toEqual([
      "status",
      "tier",
    ]);
    expect(minimal.filters).toEqual([]);
  });

  it("collects searchable and unique fields", () => {
    expect(archivable.searchFields).toEqual(["code"]);
    expect(archivable.uniqueFields).toEqual(["code"]);
  });

  it("always makes createdAt sortable, and never a textarea", () => {
    expect(archivable.sortKeys).toContain("createdAt");
    expect(archivable.sortKeys).not.toContain("notes");
  });

  it("refuses a defaultSort that isn't sortable", () => {
    expect(() =>
      defineResource({
        name: "broken",
        route: "/broken",
        icon: Package,
        defaultSort: "nope",
        fields: { name: field.text({ label: "Name" }) },
      }),
    ).toThrow(/defaultSort/);
  });

  it("refuses a resource with no fields", () => {
    expect(() =>
      defineResource({
        name: "empty",
        route: "/empty",
        icon: Package,
        fields: {},
      }),
    ).toThrow(/no fields/);
  });
});

describe("derived payload schemas", () => {
  it("accepts an immutable field on create", () => {
    const parsed = archivable.createSchema.parse({
      code: "ABC",
      tier: "pro",
      notes: "hello",
    });
    expect(parsed).toMatchObject({ code: "ABC", tier: "pro" });
  });

  it("drops an immutable field on update, so it cannot be rewritten", () => {
    const sku = productResource.updateSchema.parse({
      id: "1",
      sku: "TAMPERED",
      name: "Shirt",
      priceCents: 1999,
      description: "x",
    }) as Record<string, unknown>;
    // Not merely ignored downstream — the schema strips it, so no layer below
    // ever sees the attempted change.
    expect(sku.sku).toBeUndefined();
    expect(sku.name).toBe("Shirt");
  });

  it("applies a field's custom schema", () => {
    expect(() =>
      productResource.createSchema.parse({
        sku: "lower-case",
        name: "Shirt",
        priceCents: 1999,
      }),
    ).toThrow(z.ZodError);
  });

  it("defaults list params and rejects an unknown sort key", () => {
    const parsed = productResource.listSchema.parse({}) as Record<
      string,
      unknown
    >;
    expect(parsed).toMatchObject({
      page: 1,
      pageSize: 20,
      sort: "createdAt",
      order: "desc",
      search: "",
    });

    expect(() =>
      productResource.listSchema.parse({ sort: "priceCents; DROP TABLE" }),
    ).toThrow(z.ZodError);
  });

  it("strips unknown query parameters", () => {
    const parsed = productResource.listSchema.parse({
      page: 2,
      junk: "value",
    }) as Record<string, unknown>;
    expect(parsed.junk).toBeUndefined();
  });
});

describe("field transforms", () => {
  it("round-trips money through the form representation", () => {
    const price = field.money({ label: "Price" });
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754, and the column is an
    // integer — truncating here would silently undercharge by a cent.
    expect(price.fromForm("19.99")).toBe(1999);
    expect(price.toForm(1999)).toBe("19.99");
    expect(price.format(1999)).toBe("$19.99");
  });

  it("rejects money with more than two decimal places", () => {
    const price = field.money({ label: "Price" });
    expect(price.form.safeParse("19.999").success).toBe(false);
    expect(price.form.safeParse("19.99").success).toBe(true);
  });

  it("turns a cleared optional text field into undefined, not an empty string", () => {
    const notes = field.text({ label: "Notes", optional: true });
    expect(notes.fromForm("")).toBeUndefined();
    expect(notes.fromForm("hi")).toBe("hi");
    expect(notes.toForm(null)).toBe("");
  });

  it("labels a select value by its option", () => {
    const tier = field.select({
      label: "Tier",
      options: [
        { value: "free", label: "Free" },
        { value: "pro", label: "Pro" },
      ],
    });
    expect(tier.format("pro")).toBe("Pro");
    expect(tier.emptyForm).toBe("free");
  });
});

describe("registry-derived registration", () => {
  it("contributes products to the permission statement", () => {
    expect(statement.product).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "archive",
    ]);
    expect(resourceStatement.product).toBe(productResource.actions);
    expect(ALL_PERMISSION_KEYS).toContain("product:archive");
  });

  it("contributes products to the audit vocabulary", () => {
    expect(AUDIT_ACTIONS).toContain("product.archived");
    expect(AUDIT_ACTIONS).toContain("product.unarchived");
    expect(AUDIT_RESOURCE_TYPES).toContain("product");
  });

  it("contributes products to the navigation", () => {
    const item = navigation
      .flatMap((group) => group.items)
      .find((candidate) => candidate.href === "/products");
    expect(item).toMatchObject({
      title: "Products",
      permission: "product:read",
      matchNested: true,
    });
  });
});

describe("products still declares what the hand-written module did", () => {
  it("keeps the same searchable and sortable columns", () => {
    expect(productResource.searchFields).toEqual(["sku", "name"]);
    expect([...productResource.sortKeys].sort()).toEqual([
      "createdAt",
      "name",
      "priceCents",
      "sku",
    ]);
  });

  it("keeps SKU immutable and unique", () => {
    expect(productResource.fields.sku?.immutable).toBe(true);
    expect(productResource.uniqueFields).toEqual(["sku"]);
  });

  it("keeps the active/archived status filter", () => {
    const status = productResource.filters.find((f) => f.name === "status");
    expect(status?.options.map((o) => o.value)).toEqual(["active", "archived"]);
  });
});
