"use client";

import { useMemo } from "react";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { FeatureFlagRules } from "@/db/schema";
import { evaluateFlag } from "@/modules/feature-flags/evaluate";

const REASON_LABELS: Record<string, string> = {
  "flag-disabled": "flag off",
  "user-excluded": "excluded",
  "user-included": "included",
  "role-included": "role match",
  "rollout-included": "in rollout",
  "rollout-excluded": "outside rollout",
  "flag-enabled": "flag on",
};

/**
 * "Who is this on for?" — runs the real evaluator against a sample of users.
 *
 * This calls the same `evaluateFlag` the server does, which is why that module
 * is kept free of Node built-ins. Answers here are exactly what production
 * would give, not an approximation.
 */
export function RolloutPreview({
  flagKey,
  enabled,
  rules,
  users,
}: {
  flagKey: string;
  enabled: boolean;
  rules: FeatureFlagRules;
  users: { id: string; email: string; roleKeys: string[] }[];
}) {
  const results = useMemo(() => {
    if (!flagKey) return [];
    return users.map((user) => ({
      ...user,
      ...evaluateFlag(
        flagKey,
        { enabled, rules },
        {
          userId: user.id,
          roleKeys: user.roleKeys,
        },
      ),
    }));
  }, [flagKey, enabled, rules, users]);

  if (!flagKey) {
    return (
      <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
        Enter a key to preview who this flag would be on for.
      </p>
    );
  }

  if (users.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
        No users to preview against yet.
      </p>
    );
  }

  const onCount = results.filter((result) => result.enabled).length;

  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-medium tabular-nums">
          {onCount}/{results.length}
        </span>{" "}
        <span className="text-muted-foreground">
          of the sampled users would see this.
        </span>
      </p>

      <ul className="max-h-56 divide-y overflow-y-auto rounded-md border text-sm">
        {results.map((result) => (
          <li
            key={result.id}
            className="flex items-center justify-between gap-2 px-3 py-2"
          >
            <span className="min-w-0 truncate">{result.email}</span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge variant="outline" className="text-xs font-normal">
                {REASON_LABELS[result.reason] ?? result.reason}
              </Badge>
              {result.enabled ? (
                <Check
                  className="size-4 text-emerald-600 dark:text-emerald-400"
                  aria-label="on"
                />
              ) : (
                <X className="size-4 text-muted-foreground" aria-label="off" />
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
