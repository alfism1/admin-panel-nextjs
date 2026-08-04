"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

/**
 * "Check your inbox" screen shown after sign-up, and whenever sign-in is
 * refused because the address is unverified.
 */
export function VerifyEmailPending() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const [resending, setResending] = useState(false);
  const [resentAt, setResentAt] = useState<number | null>(null);

  async function resend() {
    if (!email) return;
    setResending(true);
    const { error } = await authClient.sendVerificationEmail({
      email,
      callbackURL: "/",
    });
    setResending(false);

    if (error) {
      toast.error(
        error.status === 429
          ? "You've requested a few of these already. Try again in a minute."
          : (error.message ?? "Could not resend the verification e-mail."),
      );
      return;
    }

    setResentAt(Date.now());
    toast.success("Verification e-mail sent.");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
          <MailCheck className="size-5 text-primary" aria-hidden />
        </div>
        <CardTitle className="text-xl">Verify your e-mail</CardTitle>
        <CardDescription>
          {email ? (
            <>
              We sent a verification link to{" "}
              <span className="font-medium break-all text-foreground">
                {email}
              </span>
              . Click it to activate your account — you can&apos;t sign in until
              you do.
            </>
          ) : (
            <>
              We sent you a verification link. Click it to activate your account
              — you can&apos;t sign in until you do.
            </>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-3">
        {email ? (
          <Button
            type="button"
            variant="outline"
            disabled={resending}
            onClick={() => void resend()}
          >
            {resending ? "Sending…" : "Resend verification e-mail"}
          </Button>
        ) : null}

        {resentAt ? (
          <p
            className="text-center text-sm text-muted-foreground"
            role="status"
          >
            Sent. Give it a minute, and check your spam folder.
          </p>
        ) : null}

        <p className="text-center text-sm text-muted-foreground">
          Running locally with{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            MAIL_TRANSPORT=console
          </code>
          ? The link is printed in your dev server terminal.
        </p>

        <Button asChild variant="ghost">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
