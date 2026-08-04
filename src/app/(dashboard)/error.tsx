"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Forbidden } from "@/components/shared/forbidden";

/**
 * Dashboard error boundary.
 *
 * Distinguishes `ForbiddenError` from everything else so an authorization
 * failure renders as "you don't have access" rather than "something broke".
 *
 * Next strips error messages in production, so the class can't be recovered
 * from `error.message` there — hence the `digest`-friendly generic fallback,
 * and `ForbiddenError` being thrown with a stable name we can match in dev.
 * Pages that expect a 403 should call `hasPermission()` and render `<Forbidden />`
 * directly rather than relying on this boundary.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  if (error.name === "ForbiddenError") {
    return <Forbidden />;
  }

  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="size-6 text-destructive" aria-hidden />
      </div>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold">This page failed to load</h2>
        <p className="max-w-md text-sm text-balance text-muted-foreground">
          Retrying usually fixes it. If it keeps happening, quote the reference
          below.
        </p>
        {error.digest ? (
          <p className="pt-1 font-mono text-xs text-muted-foreground">
            {error.digest}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
