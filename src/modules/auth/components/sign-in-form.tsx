"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CheckboxField,
  FormAlert,
  TextField,
} from "@/components/shared/form-field";
import { authClient } from "@/lib/auth-client";
import { signInSchema, type SignInInput } from "@/modules/auth/auth.schema";

import { SocialSignIn } from "./social-sign-in";

export function SignInForm({
  socialProviders,
}: {
  socialProviders: readonly ("google" | "github")[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  /**
   * Only same-origin relative paths are honoured, so `?redirect=https://evil`
   * can't turn sign-in into an open redirect.
   */
  const rawRedirect = searchParams.get("redirect");
  const redirectTo =
    rawRedirect && rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/";

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "", rememberMe: true },
  });

  async function onSubmit(values: SignInInput) {
    setFormError(null);
    setUnverifiedEmail(null);

    const { error } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
      rememberMe: values.rememberMe,
      callbackURL: redirectTo,
    });

    if (error) {
      if (error.status === 403) {
        // Better-Auth returns 403 when the address hasn't been verified yet.
        setUnverifiedEmail(values.email);
        setFormError(
          "Your e-mail address hasn't been verified yet. Check your inbox, or resend the link below.",
        );
        return;
      }
      if (error.status === 429) {
        setFormError("Too many attempts. Wait a minute and try again.");
        return;
      }
      setFormError(error.message ?? "Invalid e-mail or password.");
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  async function resendVerification() {
    if (!unverifiedEmail) return;
    await authClient.sendVerificationEmail({
      email: unverifiedEmail,
      callbackURL: redirectTo,
    });
    toast.success("Verification e-mail sent. Check your inbox.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>
          Enter your credentials to access the admin panel.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-4"
        >
          <FormAlert message={formError} />

          {unverifiedEmail ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void resendVerification()}
            >
              Resend verification e-mail
            </Button>
          ) : null}

          <TextField
            control={form.control}
            name="email"
            label="E-mail"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
          />

          <div className="grid gap-2">
            <TextField
              control={form.control}
              name="password"
              label="Password"
              type="password"
              autoComplete="current-password"
            />
            <Link
              href="/forgot-password"
              className="justify-self-end rounded-sm text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Forgot your password?
            </Link>
          </div>

          <CheckboxField
            control={form.control}
            name="rememberMe"
            label="Keep me signed in"
          />

          <Button
            type="submit"
            className="w-full"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>

          <SocialSignIn providers={socialProviders} callbackURL={redirectTo} />

          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href="/sign-up"
              className="rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Sign up
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
