import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiffView, diff } from "./diff-view";

describe("diff", () => {
  it("reports a changed field", () => {
    expect(diff({ name: "Ada" }, { name: "Grace" })).toEqual([
      { path: "name", kind: "changed", before: "Ada", after: "Grace" },
    ]);
  });

  it("reports added and removed fields", () => {
    expect(diff({ a: 1 }, { b: 2 })).toEqual([
      { path: "a", kind: "removed", before: 1 },
      { path: "b", kind: "added", after: 2 },
    ]);
  });

  it("ignores fields that did not change", () => {
    expect(
      diff({ name: "Ada", email: "a@b.c" }, { name: "Ada", email: "a@b.c" }),
    ).toEqual([]);
  });

  it("recurses into nested objects and dots the path", () => {
    expect(
      diff(
        { rules: { rolloutPercentage: 25, other: true } },
        { rules: { rolloutPercentage: 50, other: true } },
      ),
    ).toEqual([
      {
        path: "rules.rolloutPercentage",
        kind: "changed",
        before: 25,
        after: 50,
      },
    ]);
  });

  it("treats an array as one value", () => {
    // Reordering role keys is one meaningful change, not N moves.
    expect(diff({ roles: ["a", "b"] }, { roles: ["b", "a"] })).toEqual([
      { path: "roles", kind: "changed", before: ["a", "b"], after: ["b", "a"] },
    ]);
  });

  it("distinguishes null from absent", () => {
    expect(diff({ banReason: null }, { banReason: "spam" })).toEqual([
      { path: "banReason", kind: "changed", before: null, after: "spam" },
    ]);
  });

  it("handles a creation (no before snapshot)", () => {
    expect(diff(null, { name: "Ada" })).toEqual([
      { path: "name", kind: "added", after: "Ada" },
    ]);
  });

  it("handles a deletion (no after snapshot)", () => {
    expect(diff({ name: "Ada" }, null)).toEqual([
      { path: "name", kind: "removed", before: "Ada" },
    ]);
  });

  it("sorts paths so the same change always renders in the same order", () => {
    const entries = diff({ z: 1, a: 1 }, { z: 2, a: 2 });
    expect(entries.map((entry) => entry.path)).toEqual(["a", "z"]);
  });
});

describe("DiffView", () => {
  it("renders before and after values for a change", () => {
    render(<DiffView before={{ banned: false }} after={{ banned: true }} />);
    expect(screen.getByText("banned")).toBeInTheDocument();
    expect(screen.getByText("false")).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("explains an empty diff instead of rendering nothing", () => {
    render(<DiffView before={{ a: 1 }} after={{ a: 1 }} />);
    expect(screen.getByText(/snapshots are identical/i)).toBeInTheDocument();
  });

  it("explains a missing snapshot", () => {
    render(<DiffView before={null} after={null} />);
    expect(screen.getByText(/No snapshot was recorded/i)).toBeInTheDocument();
  });

  it("announces the kind of change to assistive tech", () => {
    render(<DiffView before={null} after={{ name: "Ada" }} />);
    expect(screen.getByText("added")).toBeInTheDocument();
  });

  it("renders a value that looks like markup as text", () => {
    // Snapshots contain user-supplied strings.
    const payload = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <DiffView before={{ name: "Ada" }} after={{ name: payload }} />,
    );
    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
