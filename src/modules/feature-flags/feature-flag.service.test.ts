import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { MemoryCacheStore } from "@/modules/cache/cache-store";
import { __setCacheStoreForTests } from "@/modules/cache/cache.service";

import { featureFlagRepository } from "./feature-flag.repository";
import { featureFlagService } from "./feature-flag.service";

vi.mock("./feature-flag.repository", () => ({
  featureFlagRepository: {
    list: vi.fn(),
    findByKey: vi.fn(),
    findById: vi.fn(),
    isKeyTaken: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    stats: vi.fn(),
  },
}));

vi.mock("@/modules/audit-log/audit-log.service", () => ({
  logAudit: vi.fn(),
}));

const requirePermission = vi.hoisted(() => vi.fn());
const getAuthorization = vi.hoisted(() => vi.fn());

vi.mock("@/modules/rbac/permissions.service", () => ({
  requirePermission,
  getAuthorization,
}));

const repo = vi.mocked(featureFlagRepository);
const { logAudit } = await import("@/modules/audit-log/audit-log.service");

const flag = {
  id: "flag-1",
  key: "new-billing",
  name: "New billing",
  description: null,
  enabled: true,
  rules: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  __setCacheStoreForTests(new MemoryCacheStore());
  requirePermission.mockResolvedValue({ permissionKeys: new Set() });
  getAuthorization.mockResolvedValue({
    user: { id: "user-1" },
    roleKeys: ["viewer"],
  });
});

afterEach(() => {
  __setCacheStoreForTests(undefined);
});

describe("isFeatureEnabled", () => {
  it("reads through to the database on a miss, then serves from cache", async () => {
    repo.findByKey.mockResolvedValue(flag);

    expect(await featureFlagService.isFeatureEnabled("new-billing")).toBe(true);
    expect(await featureFlagService.isFeatureEnabled("new-billing")).toBe(true);
    expect(await featureFlagService.isFeatureEnabled("new-billing")).toBe(true);

    // The hot path must not become a query per component.
    expect(repo.findByKey).toHaveBeenCalledTimes(1);
  });

  it("fails closed for an unknown key", async () => {
    // A deleted flag must not resurrect a code path.
    repo.findByKey.mockResolvedValue(null);
    expect(await featureFlagService.isFeatureEnabled("ghost")).toBe(false);
  });

  it("caches the absence of a flag too", async () => {
    repo.findByKey.mockResolvedValue(null);
    await featureFlagService.isFeatureEnabled("ghost");
    await featureFlagService.isFeatureEnabled("ghost");
    expect(repo.findByKey).toHaveBeenCalledTimes(1);
  });

  it("uses the ambient session when no context is passed", async () => {
    repo.findByKey.mockResolvedValue({
      ...flag,
      rules: { includeRoles: ["viewer"] },
    });

    expect(await featureFlagService.isFeatureEnabled("new-billing")).toBe(true);
    expect(getAuthorization).toHaveBeenCalled();
  });

  it("prefers an explicit context over the session", async () => {
    repo.findByKey.mockResolvedValue({
      ...flag,
      rules: { includeRoles: ["admin"] },
    });

    expect(
      await featureFlagService.isFeatureEnabled("new-billing", {
        userId: "other",
        roleKeys: ["admin"],
      }),
    ).toBe(true);
  });
});

describe("evaluateMany", () => {
  it("resolves each key independently", async () => {
    repo.findByKey.mockImplementation(async (key: string) =>
      key === "on" ? { ...flag, key, enabled: true } : null,
    );

    expect(await featureFlagService.evaluateMany(["on", "missing"])).toEqual({
      on: true,
      missing: false,
    });
  });
});

describe("featureFlagService.create", () => {
  it("refuses a duplicate key", async () => {
    repo.isKeyTaken.mockResolvedValue(true);

    await expect(
      featureFlagService.create({
        key: "new-billing",
        name: "New billing",
        enabled: false,
        rules: {},
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("audits the creation", async () => {
    repo.isKeyTaken.mockResolvedValue(false);
    repo.insert.mockResolvedValue(flag);

    await featureFlagService.create({
      key: "new-billing",
      name: "New billing",
      enabled: false,
      rules: {},
    });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "featureFlag.created",
        resourceType: "featureFlag",
        resourceId: "new-billing",
      }),
    );
  });
});

describe("featureFlagService.toggle", () => {
  it("records only the enabled transition, not the whole entity", async () => {
    repo.findById.mockResolvedValue({ ...flag, enabled: true });
    repo.update.mockResolvedValue({ ...flag, enabled: false });

    await featureFlagService.toggle({ id: "flag-1", enabled: false });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "featureFlag.toggled",
        before: { enabled: true },
        after: { enabled: false },
      }),
    );
  });

  it("invalidates the cache so the change takes effect without a redeploy", async () => {
    repo.findByKey.mockResolvedValue({ ...flag, enabled: true });
    expect(await featureFlagService.isFeatureEnabled("new-billing")).toBe(true);

    repo.findById.mockResolvedValue({ ...flag, enabled: true });
    repo.update.mockResolvedValue({ ...flag, enabled: false });
    await featureFlagService.toggle({ id: "flag-1", enabled: false });

    repo.findByKey.mockResolvedValue({ ...flag, enabled: false });
    expect(await featureFlagService.isFeatureEnabled("new-billing")).toBe(
      false,
    );
  });

  it("404s for an unknown flag", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      featureFlagService.toggle({ id: "nope", enabled: true }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("featureFlagService.remove", () => {
  it("audits the deletion with the prior state", async () => {
    repo.findById.mockResolvedValue(flag);

    await featureFlagService.remove({ id: "flag-1" });

    expect(repo.remove).toHaveBeenCalledWith("flag-1");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "featureFlag.deleted",
        before: expect.objectContaining({ key: "new-billing" }),
      }),
    );
  });

  it("404s for an unknown flag", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(featureFlagService.remove({ id: "nope" })).rejects.toThrow(
      NotFoundError,
    );
  });
});
