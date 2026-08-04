import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auditLogRepository } from "./audit-log.repository";
import { auditLogService } from "./audit-log.service";

vi.mock("./audit-log.repository", () => ({
  auditLogRepository: {
    insert: vi.fn(),
    deleteOlderThan: vi.fn(),
    countOlderThan: vi.fn(),
  },
}));

vi.mock("@/modules/rbac/session", () => ({
  getSession: vi.fn(async () => null),
}));

const repo = vi.mocked(auditLogRepository);

/** 2026-06-15T12:00:00Z — fixed so cutoff arithmetic is assertable. */
const NOW = new Date("2026-06-15T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  repo.insert.mockResolvedValue({} as Awaited<ReturnType<typeof repo.insert>>);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("purgeExpired", () => {
  it("computes the cutoff from AUDIT_LOG_RETENTION_DAYS", () => {
    // The default is 90 days; setup does not override it.
    repo.deleteOlderThan.mockResolvedValue(0);

    return auditLogService.purgeExpired().then(({ cutoff }) => {
      const expected = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
      expect(cutoff.toISOString()).toBe(expected.toISOString());
    });
  });

  it("deletes entries past the cutoff and reports the count", async () => {
    repo.deleteOlderThan.mockResolvedValue(42);

    const result = await auditLogService.purgeExpired();

    expect(result).toMatchObject({ deleted: 42, dryRun: false });
    expect(repo.deleteOlderThan).toHaveBeenCalledWith(result.cutoff);
  });

  it("records the purge itself in the audit log", async () => {
    repo.deleteOlderThan.mockResolvedValue(42);

    await auditLogService.purgeExpired();

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auditLog.purged",
        resourceType: "auditLog",
        // A system job, not a signed-in user.
        actorId: null,
      }),
    );
  });

  it("writes no audit entry when nothing was expired", async () => {
    // Otherwise a nightly cron fills the table with "purged 0 rows".
    repo.deleteOlderThan.mockResolvedValue(0);

    await auditLogService.purgeExpired();

    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("counts without deleting in dry-run mode", async () => {
    repo.countOlderThan.mockResolvedValue(17);

    const result = await auditLogService.purgeExpired({ dryRun: true });

    expect(result).toMatchObject({ deleted: 17, dryRun: true });
    expect(repo.deleteOlderThan).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
  });
});
