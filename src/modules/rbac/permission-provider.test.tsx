import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Can, PermissionProvider, usePermission } from "./permission-provider";

function Probe({
  resource,
  action,
}: {
  resource: "user";
  action: "read" | "delete";
}) {
  const allowed = usePermission(resource, action);
  return <span>{allowed ? "allowed" : "denied"}</span>;
}

describe("usePermission", () => {
  it("is true for a granted permission", () => {
    render(
      <PermissionProvider permissionKeys={["user:read"]}>
        <Probe resource="user" action="read" />
      </PermissionProvider>,
    );
    expect(screen.getByText("allowed")).toBeInTheDocument();
  });

  it("is false for a permission that was not granted", () => {
    render(
      <PermissionProvider permissionKeys={["user:read"]}>
        <Probe resource="user" action="delete" />
      </PermissionProvider>,
    );
    expect(screen.getByText("denied")).toBeInTheDocument();
  });

  it("throws outside a provider rather than defaulting to allowed", () => {
    // Failing loudly beats a component silently rendering admin controls
    // because someone forgot to mount the provider.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(() => render(<Probe resource="user" action="read" />)).toThrow(
      /usePermission must be used inside <PermissionProvider>/,
    );

    consoleError.mockRestore();
  });
});

describe("Can", () => {
  it("renders children when the permission is held", () => {
    render(
      <PermissionProvider permissionKeys={["user:ban"]}>
        <Can resource="user" action="ban">
          <button type="button">Ban user</button>
        </Can>
      </PermissionProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Ban user" }),
    ).toBeInTheDocument();
  });

  it("hides rather than disables when the permission is missing", () => {
    // A disabled button still advertises a capability the user doesn't have.
    render(
      <PermissionProvider permissionKeys={[]}>
        <Can resource="user" action="ban">
          <button type="button">Ban user</button>
        </Can>
      </PermissionProvider>,
    );
    expect(screen.queryByRole("button", { name: "Ban user" })).toBeNull();
  });

  it("renders the fallback when provided", () => {
    render(
      <PermissionProvider permissionKeys={[]}>
        <Can
          resource="user"
          action="ban"
          fallback={<span>Ask an administrator</span>}
        >
          <button type="button">Ban user</button>
        </Can>
      </PermissionProvider>,
    );
    expect(screen.getByText("Ask an administrator")).toBeInTheDocument();
  });
});
