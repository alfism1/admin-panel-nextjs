"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2 } from "lucide-react";

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
import {
  backupCodeSchema,
  totpSchema,
  type BackupCodeInput,
  type TotpInput,
} from "@/modules/auth/auth.schema";

/**
 * Second-factor challenge. Reached when a user with 2FA enabled signs in —
 * Better-Auth's client plugin redirects here instead of completing the session.
 */
export function TwoFactorForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [formError, setFormError] = useState<string | null>(null);

  const totpForm = useForm<TotpInput>({
    resolver: zodResolver(totpSchema),
    defaultValues: { code: "", trustDevice: false },
  });

  const backupForm = useForm<BackupCodeInput>({
    resolver: zodResolver(backupCodeSchema),
    defaultValues: { code: "" },
  });

  async function submitTotp(values: TotpInput) {
    setFormError(null);
    const { error } = await authClient.twoFactor.verifyTotp({
      code: values.code,
      trustDevice: values.trustDevice,
    });
    if (error) {
      setFormError(
        error.status === 429
          ? "Too many attempts. Wait a minute before trying again."
          : "That code isn't right. Codes rotate every 30 seconds.",
      );
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function submitBackupCode(values: BackupCodeInput) {
    setFormError(null);
    const { error } = await authClient.twoFactor.verifyBackupCode({
      code: values.code,
    });
    if (error) {
      setFormError("That backup code isn't valid, or has already been used.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="size-5 text-primary" aria-hidden />
        </div>
        <CardTitle className="text-xl">Two-factor authentication</CardTitle>
        <CardDescription>
          {mode === "totp"
            ? "Enter the 6-digit code from your authenticator app."
            : "Enter one of the backup codes you saved when you enabled 2FA."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {mode === "totp" ? (
          <form
            noValidate
            onSubmit={totpForm.handleSubmit(submitTotp)}
            className="grid gap-4"
          >
            <FormAlert message={formError} />

            <TextField
              control={totpForm.control}
              name="code"
              label="Authentication code"
              placeholder="000000"
              autoComplete="one-time-code"
            />

            <CheckboxField
              control={totpForm.control}
              name="trustDevice"
              label="Trust this device for 30 days"
            />

            <Button
              type="submit"
              className="w-full"
              disabled={totpForm.formState.isSubmitting}
            >
              {totpForm.formState.isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Verifying…
                </>
              ) : (
                "Verify"
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMode("backup");
                setFormError(null);
              }}
            >
              Use a backup code instead
            </Button>
          </form>
        ) : (
          <form
            noValidate
            onSubmit={backupForm.handleSubmit(submitBackupCode)}
            className="grid gap-4"
          >
            <FormAlert message={formError} />

            <TextField
              control={backupForm.control}
              name="code"
              label="Backup code"
              autoComplete="one-time-code"
            />

            <Button
              type="submit"
              className="w-full"
              disabled={backupForm.formState.isSubmitting}
            >
              {backupForm.formState.isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Verifying…
                </>
              ) : (
                "Verify"
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMode("totp");
                setFormError(null);
              }}
            >
              Use your authenticator app instead
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
