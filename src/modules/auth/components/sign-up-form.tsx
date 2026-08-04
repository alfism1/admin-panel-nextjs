"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormAlert, TextField } from "@/components/shared/form-field";
import { authClient } from "@/lib/auth-client";
import { signUpSchema, type SignUpInput } from "@/modules/auth/auth.schema";

import { SocialSignIn } from "./social-sign-in";

export function SignUpForm({
  socialProviders,
}: {
  socialProviders: readonly ("google" | "github")[];
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: SignUpInput) {
    setFormError(null);

    const { error } = await authClient.signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
    });

    if (error) {
      if (error.status === 422 || error.code === "USER_ALREADY_EXISTS") {
        setFormError("An account with that e-mail already exists.");
        return;
      }
      setFormError(error.message ?? "Could not create your account.");
      return;
    }

    // Verification is required before the first sign-in, so there is no session
    // yet — send them to the "check your inbox" screen.
    router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl">Create an account</h1>
        </CardTitle>
        <CardDescription>
          New accounts start with read-only access until an administrator
          assigns a role.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-4"
        >
          <FormAlert message={formError} />

          <TextField
            control={form.control}
            name="name"
            label="Name"
            placeholder="Ada Lovelace"
            autoComplete="name"
          />
          <TextField
            control={form.control}
            name="email"
            label="E-mail"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
          />
          <TextField
            control={form.control}
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            description="At least 8 characters. Longer beats more symbols."
          />
          <TextField
            control={form.control}
            name="confirmPassword"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
          />

          <Button
            type="submit"
            className="w-full"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>

          <SocialSignIn providers={socialProviders} />

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
