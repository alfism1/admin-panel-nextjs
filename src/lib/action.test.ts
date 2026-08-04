import { describe, expect, it } from "vitest";
import { z } from "zod";

import { actionOk, withAction } from "./action";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";

describe("withAction", () => {
  it("wraps a successful result", async () => {
    const result = await withAction("test", async () => ({ id: "1" }));
    expect(result).toEqual({ ok: true, data: { id: "1" } });
  });

  it("turns a ZodError into per-field messages", async () => {
    const schema = z.object({
      email: z.string().min(1, "E-mail is required."),
      name: z.string().min(1, "Name is required."),
    });

    const result = await withAction("test", async () =>
      schema.parse({ email: "", name: "" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("VALIDATION");
    expect(result.fieldErrors).toEqual({
      email: ["E-mail is required."],
      name: ["Name is required."],
    });
  });

  it("preserves a ValidationError's own field errors", async () => {
    const result = await withAction("test", async () => {
      throw new ValidationError("Check the form.", {
        email: ["Already taken."],
      });
    });

    expect(result).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { email: ["Already taken."] },
    });
  });

  it("passes an AppError's code and message through", async () => {
    // These were written to be read by a user.
    const result = await withAction("test", async () => {
      throw new ForbiddenError("You cannot ban yourself.");
    });

    expect(result).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "You cannot ban yourself.",
    });
  });

  it("keeps a ConflictError's message", async () => {
    const result = await withAction("test", async () => {
      throw new ConflictError('A role with the key "admin" already exists.');
    });

    expect(result).toMatchObject({
      ok: false,
      code: "CONFLICT",
      message: 'A role with the key "admin" already exists.',
    });
  });

  it("never leaks an unexpected error's message", async () => {
    // It may carry a query, a path, or a hostname.
    const result = await withAction("test", async () => {
      throw new Error(
        'relation "users" does not exist at postgres://admin:hunter2@db:5432',
      );
    });

    expect(result).toEqual({
      ok: false,
      code: "INTERNAL",
      message: "Something went wrong. Please try again.",
    });
  });

  it("handles a thrown non-Error", async () => {
    const result = await withAction("test", async () => {
      throw "just a string";
    });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL" });
  });
});

describe("actionOk", () => {
  it("wraps data", () => {
    expect(actionOk({ id: "1" })).toEqual({ ok: true, data: { id: "1" } });
  });

  it("works for void actions", () => {
    expect(actionOk()).toEqual({ ok: true, data: undefined });
  });
});
