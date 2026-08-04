"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { FormAlert, TextField } from "@/components/shared/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { passwordField } from "@/modules/auth/auth.schema";

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
});
type ProfileInput = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
type PasswordInput = z.infer<typeof passwordSchema>;

const enable2faSchema = z.object({
  password: z.string().min(1, "Confirm your password to continue."),
});
type Enable2faInput = z.infer<typeof enable2faSchema>;

export interface SessionSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  impersonatedBy: string | null;
}

/**
 * Account settings: profile, password, two-factor enrolment, active sessions.
 *
 * Everything here acts on the *signed-in* user through the Better-Auth client,
 * so it needs no admin permission — a viewer can secure their own account.
 */
export function SettingsView({
  user,
  roleLabels,
  sessions,
  twoFactorRequired,
}: {
  user: { id: string; name: string; email: string; twoFactorEnabled: boolean };
  roleLabels: string[];
  sessions: SessionSummary[];
  twoFactorRequired: boolean;
}) {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your profile, credentials and active sessions."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileCard user={user} roleLabels={roleLabels} />
        <PasswordCard />
        <TwoFactorCard
          enabled={user.twoFactorEnabled}
          required={twoFactorRequired}
        />
        <SessionsCard sessions={sessions} />
      </div>
    </>
  );
}

function ProfileCard({
  user,
  roleLabels,
}: {
  user: { name: string; email: string };
  roleLabels: string[];
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user.name },
  });

  async function onSubmit(values: ProfileInput) {
    setFormError(null);
    const { error } = await authClient.updateUser({ name: values.name });
    if (error) {
      setFormError(error.message ?? "Could not update your profile.");
      return;
    }
    toast.success("Profile updated.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profile</CardTitle>
        <CardDescription>
          Your e-mail is managed by an administrator.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-4"
        >
          <FormAlert message={formError} />

          <TextField control={form.control} name="name" label="Name" />

          <div className="space-y-1">
            <p className="text-sm font-medium">E-mail</p>
            <p className="text-sm break-all text-muted-foreground">
              {user.email}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium">Roles</p>
            <div className="flex flex-wrap gap-1">
              {roleLabels.length === 0 ? (
                <Badge variant="outline">none</Badge>
              ) : (
                roleLabels.map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <Button
            type="submit"
            className="justify-self-start"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<PasswordInput>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: PasswordInput) {
    setFormError(null);
    const { error } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      // Anyone holding a stolen session should lose it when the password
      // changes — that's usually why the password is being changed.
      revokeOtherSessions: true,
    });

    if (error) {
      setFormError(error.message ?? "Could not change your password.");
      return;
    }

    form.reset();
    toast.success("Password changed. Other sessions have been signed out.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Password</CardTitle>
        <CardDescription>
          Changing it signs you out everywhere else.
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
            name="currentPassword"
            label="Current password"
            type="password"
            autoComplete="current-password"
          />
          <TextField
            control={form.control}
            name="newPassword"
            label="New password"
            type="password"
            autoComplete="new-password"
          />
          <TextField
            control={form.control}
            name="confirmPassword"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
          />

          <Button
            type="submit"
            className="justify-self-start"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "Updating…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TwoFactorCard({
  enabled,
  required,
}: {
  enabled: boolean;
  required: boolean;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const form = useForm<Enable2faInput>({
    resolver: zodResolver(enable2faSchema),
    defaultValues: { password: "" },
  });

  async function enable(values: Enable2faInput) {
    setFormError(null);
    const { data, error } = await authClient.twoFactor.enable({
      password: values.password,
    });

    if (error || !data) {
      setFormError(error?.message ?? "Could not start two-factor enrolment.");
      return;
    }

    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes);
  }

  async function verify() {
    setVerifying(true);
    const { error } = await authClient.twoFactor.verifyTotp({
      code: verifyCode,
    });
    setVerifying(false);

    if (error) {
      setFormError("That code isn't right. Codes rotate every 30 seconds.");
      return;
    }

    setTotpUri(null);
    setVerifyCode("");
    toast.success("Two-factor authentication is on.");
    router.refresh();
  }

  async function disable(password: string) {
    const { error } = await authClient.twoFactor.disable({ password });
    if (error) {
      toast.error(error.message ?? "Could not disable two-factor.");
      return;
    }
    toast.success("Two-factor authentication is off.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" aria-hidden />
              Two-factor authentication
            </CardTitle>
            <CardDescription>
              A time-based code from your authenticator app, on top of your
              password.
            </CardDescription>
          </div>
          <Badge variant={enabled ? "default" : "outline"}>
            {enabled ? "on" : "off"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {required && !enabled ? (
          <p
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
          >
            Your role requires two-factor authentication. Enrol now to keep
            access.
          </p>
        ) : null}

        <FormAlert message={formError} />

        {enabled ? (
          <DisableTwoFactor onDisable={disable} />
        ) : totpUri ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">1. Add it to your app</p>
              <p className="text-sm text-muted-foreground">
                Paste this URI into your authenticator, or scan the QR code it
                generates.
              </p>
              <CopyableCode value={totpUri} />
            </div>

            {backupCodes.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">2. Save your backup codes</p>
                <p className="text-sm text-muted-foreground">
                  Each one works once. This is the only time they&apos;re shown.
                </p>
                <CopyableCode value={backupCodes.join("\n")} multiline />
              </div>
            ) : null}

            <Separator />

            <div className="space-y-2">
              <label htmlFor="totp-verify" className="text-sm font-medium">
                3. Confirm a code to finish
              </label>
              <div className="flex gap-2">
                <input
                  id="totp-verify"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(event) => setVerifyCode(event.target.value)}
                  className="h-9 w-32 rounded-md border bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                />
                <Button
                  type="button"
                  disabled={verifying || verifyCode.length !== 6}
                  onClick={() => void verify()}
                >
                  {verifying ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Verifying…
                    </>
                  ) : (
                    "Confirm"
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <form
            noValidate
            onSubmit={form.handleSubmit(enable)}
            className="grid gap-4"
          >
            <TextField
              control={form.control}
              name="password"
              label="Confirm your password"
              type="password"
              autoComplete="current-password"
            />
            <Button
              type="submit"
              className="justify-self-start"
              disabled={form.formState.isSubmitting}
            >
              <KeyRound className="size-4" aria-hidden />
              {form.formState.isSubmitting ? "Starting…" : "Enable two-factor"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function DisableTwoFactor({
  onDisable,
}: {
  onDisable: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");

  return (
    <div className="space-y-3">
      <label htmlFor="disable-2fa-password" className="text-sm font-medium">
        Confirm your password to turn it off
      </label>
      <input
        id="disable-2fa-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="h-9 w-full rounded-md border bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <ConfirmDialog
        trigger={
          <Button type="button" variant="destructive" disabled={!password}>
            Disable two-factor
          </Button>
        }
        title="Turn off two-factor authentication?"
        description={
          <p>
            Your account will be protected by its password alone, and your
            backup codes stop working.
          </p>
        }
        confirmLabel="Turn it off"
        destructive
        onConfirm={() => onDisable(password)}
      />
    </div>
  );
}

function CopyableCode({
  value,
  multiline = false,
}: {
  value: string;
  multiline?: boolean;
}) {
  async function copy() {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard.");
  }

  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
        {value}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => void copy()}
        aria-label={multiline ? "Copy backup codes" : "Copy"}
      >
        <Copy className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function SessionsCard({ sessions }: { sessions: SessionSummary[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function revokeOthers() {
    setPending(true);
    const { error } = await authClient.revokeOtherSessions();
    setPending(false);

    if (error) {
      toast.error(error.message ?? "Could not revoke your other sessions.");
      return;
    }
    toast.success("Other sessions signed out.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Active sessions</CardTitle>
        <CardDescription>
          Every device currently signed in as you.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {sessions.map((session) => (
              <li key={session.id} className="space-y-1 p-3">
                <p className="truncate font-medium">
                  {describeUserAgent(session.userAgent)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {session.ipAddress ?? "unknown IP"} · started{" "}
                  <time dateTime={session.createdAt}>
                    {new Date(session.createdAt).toLocaleString()}
                  </time>
                </p>
                {session.impersonatedBy ? (
                  <Badge variant="destructive">impersonated</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          variant="outline"
          disabled={pending || sessions.length <= 1}
          onClick={() => void revokeOthers()}
        >
          {pending ? "Signing out…" : "Sign out other sessions"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Enough to recognise your own device without shipping a UA-parsing library. */
function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Safari\//.test(userAgent)
        ? "Safari"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : "Browser";

  const platform = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Unknown OS";

  return `${browser} on ${platform}`;
}
