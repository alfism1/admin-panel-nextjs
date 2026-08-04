"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * OAuth buttons. `providers` comes from the server, which only lists a provider
 * when both of its env vars are present — so this renders nothing at all in a
 * fresh clone rather than showing buttons that 500.
 */
export function SocialSignIn({
  providers,
  callbackURL = "/",
}: {
  providers: readonly ("google" | "github")[];
  callbackURL?: string;
}) {
  const [pending, setPending] = useState<string | null>(null);

  if (providers.length === 0) return null;

  async function signInWith(provider: "google" | "github") {
    setPending(provider);
    const { error } = await authClient.signIn.social({ provider, callbackURL });
    if (error) {
      setPending(null);
      toast.error(error.message ?? `Could not sign in with ${provider}.`);
    }
    // On success the browser navigates away; leave the button disabled.
  }

  return (
    <>
      <div className="relative py-1 text-center text-sm">
        <span className="relative z-10 bg-card px-2 text-muted-foreground">
          or continue with
        </span>
        <span
          aria-hidden
          className="absolute inset-0 top-1/2 border-t border-border"
        />
      </div>

      <div className="grid gap-2">
        {providers.includes("google") ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={pending !== null}
            onClick={() => void signInWith("google")}
          >
            <GoogleIcon />
            {pending === "google" ? "Redirecting…" : "Continue with Google"}
          </Button>
        ) : null}

        {providers.includes("github") ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={pending !== null}
            onClick={() => void signInWith("github")}
          >
            <GitHubIcon />
            {pending === "github" ? "Redirecting…" : "Continue with GitHub"}
          </Button>
        ) : null}
      </div>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M12.48 10.92v3.28h7.84c-.24 1.84-.85 3.18-1.73 4.1-1.1 1.1-2.82 2.32-5.83 2.32-4.66 0-8.3-3.76-8.3-8.42s3.64-8.42 8.3-8.42c2.5 0 4.34 1 5.7 2.28l2.3-2.3C18.98 1.9 16.48.6 12.48.6 5.86.6.48 5.98.48 12.6s5.38 12 12 12c3.58 0 6.28-1.18 8.4-3.38 2.16-2.16 2.84-5.2 2.84-7.66 0-.76-.06-1.46-.18-2.04h-11.06Z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.9 18.3 5.2 18.3 5.2c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z"
      />
    </svg>
  );
}
