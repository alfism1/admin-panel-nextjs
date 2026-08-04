"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * Persistent banner shown while an admin is acting as another user.
 *
 * Deliberately loud and always visible: the most dangerous thing about
 * impersonation is forgetting you're doing it and taking a destructive action
 * "as" someone else.
 */
export function ImpersonationBanner({ userName }: { userName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function stop() {
    setPending(true);
    const { error } = await authClient.admin.stopImpersonating();
    setPending(false);
    if (error) {
      toast.error(error.message ?? "Could not end the impersonation session.");
      return;
    }
    router.push("/users");
    router.refresh();
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-950"
    >
      <span className="inline-flex items-center gap-2">
        <UserCheck className="size-4 shrink-0" aria-hidden />
        You are impersonating <strong>{userName}</strong>
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void stop()}
        className="h-7 border-amber-950/30 bg-amber-100 text-amber-950 hover:bg-amber-50"
      >
        {pending ? "Ending…" : "Stop impersonating"}
      </Button>
    </div>
  );
}
