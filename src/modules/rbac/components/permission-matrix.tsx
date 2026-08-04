"use client";

import { useMemo } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface PermissionOption {
  key: string;
  resource: string;
  action: string;
}

/**
 * The resources × actions grid an operator ticks to define a role.
 *
 * Grouped by resource rather than shown as a flat list of 27 checkboxes: the
 * question being answered is "what can this role do to users?", not "is
 * `user:set-email` ticked?".
 *
 * `grantableKeys` is the actor's own permission set. Anything outside it renders
 * disabled with an explanation, because the server will refuse to save it
 * (`assertNoPrivilegeEscalation`) — showing it as tickable would be a lie.
 */
export function PermissionMatrix({
  options,
  value,
  onChange,
  grantableKeys,
  disabled = false,
}: {
  options: PermissionOption[];
  value: string[];
  onChange: (next: string[]) => void;
  grantableKeys?: ReadonlySet<string>;
  disabled?: boolean;
}) {
  const selected = useMemo(() => new Set(value), [value]);

  const groups = useMemo(() => {
    const byResource = new Map<string, PermissionOption[]>();
    for (const option of options) {
      byResource.set(option.resource, [
        ...(byResource.get(option.resource) ?? []),
        option,
      ]);
    }
    return [...byResource.entries()];
  }, [options]);

  function toggle(key: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    onChange([...next]);
  }

  function toggleResource(resource: string, checked: boolean) {
    const next = new Set(selected);
    for (const option of options) {
      if (option.resource !== resource) continue;
      if (grantableKeys && !grantableKeys.has(option.key)) continue;
      if (checked) next.add(option.key);
      else next.delete(option.key);
    }
    onChange([...next]);
  }

  return (
    <div className="space-y-4">
      {groups.map(([resource, resourceOptions]) => {
        const grantable = resourceOptions.filter(
          (option) => !grantableKeys || grantableKeys.has(option.key),
        );
        const allChecked =
          grantable.length > 0 &&
          grantable.every((option) => selected.has(option.key));
        const someChecked = grantable.some((option) =>
          selected.has(option.key),
        );

        return (
          <fieldset
            key={resource}
            className="rounded-lg border p-3 sm:p-4"
            disabled={disabled}
          >
            <legend className="sr-only">{resource} permissions</legend>

            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="font-medium">{resource}</p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="tabular-nums">
                  {resourceOptions.filter((o) => selected.has(o.key)).length}/
                  {resourceOptions.length}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || grantable.length === 0}
                  onClick={() => toggleResource(resource, !allChecked)}
                >
                  {allChecked
                    ? "Clear"
                    : someChecked
                      ? "Select all"
                      : "Select all"}
                </Button>
              </div>
            </div>

            {/* Two columns at 375px would give ~150px per label; one column
                keeps every action readable without truncation. */}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {resourceOptions.map((option) => {
                const locked = Boolean(
                  grantableKeys && !grantableKeys.has(option.key),
                );
                const id = `perm-${option.key.replace(/[^a-z0-9]/gi, "-")}`;

                return (
                  <div
                    key={option.key}
                    className={cn(
                      "flex items-start gap-2 rounded-md px-2 py-1.5",
                      locked && "opacity-60",
                    )}
                  >
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      checked={selected.has(option.key)}
                      disabled={disabled || locked}
                      onCheckedChange={(checked) =>
                        toggle(option.key, Boolean(checked))
                      }
                      aria-describedby={locked ? `${id}-locked` : undefined}
                    />
                    <div className="min-w-0">
                      <Label
                        htmlFor={id}
                        className={cn(
                          "font-normal",
                          locked && "cursor-not-allowed",
                        )}
                      >
                        {option.action}
                      </Label>
                      {locked ? (
                        <p
                          id={`${id}-locked`}
                          className="text-xs text-muted-foreground"
                        >
                          You don&apos;t hold this
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
