import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Rendered when `requirePermission()` throws inside a Server Component.
 *
 * Deliberately says nothing about what the resource is or whether it exists —
 * a 403 that leaks "this user id is real" is a 403 that helps an attacker
 * enumerate.
 */
export function Forbidden({
  title = "You don't have access to this",
  description = "Your role doesn't include permission for this page. If you think that's wrong, ask an administrator to review your role.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="size-6 text-destructive" aria-hidden />
      </div>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-md text-sm text-balance text-muted-foreground">
          {description}
        </p>
      </div>

      <Button asChild variant="outline">
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
