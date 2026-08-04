"use client";

import { useMemo } from "react";
import { Minus, Plus, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

type Json = unknown;

interface DiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: Json;
  after?: Json;
}

/**
 * Before/after diff for an audit entry.
 *
 * Diffs the two JSON snapshots into a flat list of changed paths rather than
 * showing both blobs side by side: what an auditor needs is "what changed", and
 * for a 20-field user record two pretty-printed objects hide that completely.
 *
 * Values are rendered as text, never as HTML — these snapshots contain
 * user-supplied strings.
 */
export function DiffView({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const entries = useMemo(() => diff(before, after), [before, after]);

  if (!before && !after) {
    return (
      <p className="text-sm text-muted-foreground">
        No snapshot was recorded for this entry.
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The snapshots are identical — the action didn&apos;t change any recorded
        field.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-lg border text-sm">
      {entries.map((entry) => (
        <li key={entry.path} className="flex gap-3 p-3">
          <span
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded",
              entry.kind === "added" &&
                "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
              entry.kind === "removed" && "bg-destructive/15 text-destructive",
              entry.kind === "changed" &&
                "bg-amber-500/15 text-amber-700 dark:text-amber-400",
            )}
          >
            {entry.kind === "added" ? (
              <Plus className="size-3" aria-hidden />
            ) : entry.kind === "removed" ? (
              <Minus className="size-3" aria-hidden />
            ) : (
              <RefreshCw className="size-3" aria-hidden />
            )}
            <span className="sr-only">{entry.kind}</span>
          </span>

          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-muted-foreground">
              {entry.path}
            </p>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {entry.kind !== "added" ? (
                <Value label="before" value={entry.before} tone="removed" />
              ) : null}
              {entry.kind !== "removed" ? (
                <Value label="after" value={entry.after} tone="added" />
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Value({
  label,
  value,
  tone,
}: {
  label: string;
  value: Json;
  tone: "added" | "removed";
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <pre
        className={cn(
          "overflow-x-auto rounded px-2 py-1 font-mono text-xs break-words whitespace-pre-wrap",
          tone === "added"
            ? "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
            : "bg-destructive/10 text-destructive",
        )}
      >
        {format(value)}
      </pre>
    </div>
  );
}

function format(value: Json): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value === "" ? '""' : value;
  return JSON.stringify(value, null, 2);
}

/**
 * Shallow-ish recursive diff. Arrays are compared as whole values: reordering a
 * list of role keys is one meaningful change, not N moves.
 */
export function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  prefix = "",
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);

  for (const key of [...keys].sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    const beforeValue = before?.[key];
    const afterValue = after?.[key];

    const bothPlainObjects =
      isPlainObject(beforeValue) && isPlainObject(afterValue);

    if (bothPlainObjects) {
      entries.push(...diff(beforeValue, afterValue, path));
      continue;
    }

    if (equal(beforeValue, afterValue)) continue;

    if (beforeValue === undefined) {
      entries.push({ path, kind: "added", after: afterValue });
    } else if (afterValue === undefined) {
      entries.push({ path, kind: "removed", before: beforeValue });
    } else {
      entries.push({
        path,
        kind: "changed",
        before: beforeValue,
        after: afterValue,
      });
    }
  }

  return entries;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
