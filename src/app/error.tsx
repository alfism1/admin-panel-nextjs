"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Root error boundary.
 *
 * `error.message` is only shown outside production: in production Next replaces
 * it with a generic string anyway, and showing raw messages is how stack
 * details and query fragments end up on a user's screen. `digest` is the
 * server-side correlation id — that is the thing worth surfacing.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="size-6 text-destructive" aria-hidden />
      </div>

      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-balance text-muted-foreground">
          The page couldn&apos;t be rendered. Trying again often works — if it
          doesn&apos;t, the reference below will help whoever looks into it.
        </p>
        {error.digest ? (
          <p className="pt-1 font-mono text-xs text-muted-foreground">
            {error.digest}
          </p>
        ) : null}
        {process.env.NODE_ENV !== "production" ? (
          <pre className="mx-auto mt-3 max-w-lg overflow-x-auto rounded-md bg-muted p-3 text-left text-xs">
            {error.message}
          </pre>
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
