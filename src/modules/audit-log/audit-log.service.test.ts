import { beforeEach, describe, expect, it, vi } from "vitest";

import { auditLogRepository } from "./audit-log.repository";
import { logAudit } from "./audit-log.service";

vi.mock("./audit-log.repository", () => ({
  auditLogRepository: { insert: vi.fn() },
}));

vi.mock("@/modules/rbac/session", () => ({
  getSession: vi.fn(async () => ({
    user: { id: "actor-1", email: "actor@example.com" },
  })),
}));

const insert = vi.mocked(auditLogRepository.insert);

describe("logAudit", () => {
  beforeEach(() => {
    insert.mockReset();
    insert.mockResolvedValue({} as Awaited<ReturnType<typeof insert>>);
  });

  it("records the action, resource and snapshots", async () => {
    await logAudit({
      action: "user.banned",
      resourceType: "user",
      resourceId: "user-9",
      before: { banned: false },
      after: { banned: true, banReason: "spam" },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.banned",
        resourceType: "user",
        resourceId: "user-9",
        before: { banned: false },
        after: { banned: true, banReason: "spam" },
      }),
    );
  });

  it("stamps the entry with the signed-in actor", async () => {
    await logAudit({ action: "user.created", resourceType: "user" });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "actor-1",
        actorEmail: "actor@example.com",
      }),
    );
  });

  it("lets a caller override the actor, for hooks and system jobs", async () => {
    await logAudit({
      action: "auditLog.purged",
      resourceType: "auditLog",
      actor: { id: null, email: null },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null, actorEmail: null }),
    );
  });

  it("normalises absent snapshots to null rather than undefined", async () => {
    await logAudit({ action: "user.created", resourceType: "user" });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ before: null, after: null, resourceId: null }),
    );
  });

  it("never throws when the write fails", async () => {
    // Losing the record is bad; reverting a completed ban because we couldn't
    // write about it is worse.
    insert.mockRejectedValue(new Error("audit_logs is unreachable"));

    await expect(
      logAudit({
        action: "user.deleted",
        resourceType: "user",
        resourceId: "u1",
      }),
    ).resolves.toBeUndefined();
  });
});
