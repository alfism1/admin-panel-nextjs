"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FormAlert,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/shared/form-field";
import {
  createFeatureFlagAction,
  updateFeatureFlagAction,
} from "@/modules/feature-flags/feature-flag.actions";
import {
  flagKeySchema,
  parseIdList,
} from "@/modules/feature-flags/feature-flag.schema";

import { RolloutPreview } from "./rollout-preview";

export interface FlagRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rules: {
    rolloutPercentage?: number;
    includeUserIds?: string[];
    excludeUserIds?: string[];
    includeRoles?: string[];
  };
  updatedAt: string;
}

/**
 * The rollout inputs are free text (`<input type="number">`, comma-separated id
 * lists), so the form validates strings and converts on submit. Coercion lives
 * in the server schema, where it also serves the REST route.
 */
const flagFormSchema = z.object({
  key: flagKeySchema,
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: z.string().trim().max(500),
  enabled: z.boolean(),
  rolloutPercentage: z
    .string()
    .trim()
    .regex(/^\d*$/, "Enter a whole number.")
    .refine((value) => value === "" || Number(value) <= 100, {
      message: "Must be between 0 and 100.",
    }),
  includeUserIds: z.string().trim().max(5000),
  excludeUserIds: z.string().trim().max(5000),
});
type FlagFormInput = z.infer<typeof flagFormSchema>;

/**
 * Keyed by flag id so the body remounts with fresh defaults on every open —
 * see the note in `users/components/user-dialogs.tsx` for why this beats
 * resetting the form in an effect.
 */
export function FlagDialog({
  open,
  onOpenChange,
  flag,
  roleOptions,
  previewUsers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = create mode. */
  flag: FlagRow | null;
  roleOptions: { key: string; name: string }[];
  previewUsers: { id: string; email: string; roleKeys: string[] }[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <FlagDialogBody
          key={flag?.id ?? "new"}
          flag={flag}
          roleOptions={roleOptions}
          previewUsers={previewUsers}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function FlagDialogBody({
  flag,
  roleOptions,
  previewUsers,
  onDone,
}: {
  flag: FlagRow | null;
  roleOptions: { key: string; name: string }[];
  previewUsers: { id: string; email: string; roleKeys: string[] }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const isEdit = flag !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const [includeRoles, setIncludeRoles] = useState<string[]>(
    flag?.rules.includeRoles ?? [],
  );

  const form = useForm<FlagFormInput>({
    resolver: zodResolver(flagFormSchema),
    defaultValues: {
      key: flag?.key ?? "",
      name: flag?.name ?? "",
      description: flag?.description ?? "",
      enabled: flag?.enabled ?? false,
      rolloutPercentage:
        flag?.rules.rolloutPercentage === undefined
          ? ""
          : String(flag.rules.rolloutPercentage),
      includeUserIds: (flag?.rules.includeUserIds ?? []).join("\n"),
      excludeUserIds: (flag?.rules.excludeUserIds ?? []).join("\n"),
    },
  });

  // `useWatch` rather than `form.watch()`: it subscribes through a hook the
  // React Compiler can reason about, so this component still gets memoized.
  const watched = useWatch({ control: form.control });

  /** Live rules object, so the preview reflects unsaved edits. */
  const draftRules = useMemo(
    () => ({
      ...(watched.rolloutPercentage
        ? { rolloutPercentage: Number(watched.rolloutPercentage) }
        : {}),
      ...(parseIdList(watched.includeUserIds)
        ? { includeUserIds: parseIdList(watched.includeUserIds) }
        : {}),
      ...(parseIdList(watched.excludeUserIds)
        ? { excludeUserIds: parseIdList(watched.excludeUserIds) }
        : {}),
      ...(includeRoles.length > 0 ? { includeRoles } : {}),
    }),
    [
      watched.rolloutPercentage,
      watched.includeUserIds,
      watched.excludeUserIds,
      includeRoles,
    ],
  );

  async function onSubmit(values: FlagFormInput) {
    setFormError(null);

    const payload = {
      name: values.name,
      description: values.description || undefined,
      enabled: values.enabled,
      rules: draftRules,
    };

    const result = isEdit
      ? await updateFeatureFlagAction({ id: flag.id, ...payload })
      : await createFeatureFlagAction({ key: values.key, ...payload });

    if (!result.ok) {
      setFormError(result.message);
      return;
    }

    toast.success(isEdit ? "Flag updated." : `Flag "${values.key}" created.`);
    router.refresh();
    onDone();
  }

  function toggleRole(key: string, checked: boolean) {
    setIncludeRoles((previous) =>
      checked
        ? [...new Set([...previous, key])]
        : previous.filter((role) => role !== key),
    );
  }

  return (
    <>
      <DialogHeader className="border-b p-6 pb-4">
        <DialogTitle>{isEdit ? `Edit ${flag.name}` : "New flag"}</DialogTitle>
        <DialogDescription>
          Rules are evaluated in a fixed order: a disabled flag is off for
          everyone, then excludes, then includes, then percentage rollout.
        </DialogDescription>
      </DialogHeader>

      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-col"
      >
        <ScrollArea className="max-h-[62svh] flex-1">
          <div className="grid gap-4 p-6">
            <FormAlert message={formError} />

            {isEdit ? (
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">Key: </span>
                <span className="font-mono">{flag.key}</span>
                <p className="mt-1 text-xs text-muted-foreground">
                  Immutable — it&apos;s referenced by name in code.
                </p>
              </div>
            ) : (
              <TextField
                control={form.control}
                name="key"
                label="Key"
                placeholder="new-billing"
                description='How you&apos;ll reference it: isFeatureEnabled("new-billing")'
              />
            )}

            <TextField control={form.control} name="name" label="Name" />
            <TextareaField
              control={form.control}
              name="description"
              label="Description"
              placeholder="What this flag gates, and when it can be removed."
            />

            <SwitchField
              control={form.control}
              name="enabled"
              label="Enabled"
              description="The kill switch. Off means off for everyone, whatever the rules say."
            />

            <fieldset className="grid gap-4 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">
                Targeting rules
              </legend>

              <TextField
                control={form.control}
                name="rolloutPercentage"
                label="Rollout percentage"
                type="number"
                placeholder="Leave empty for no percentage rollout"
                description="0–100. Deterministic per user, so nobody flickers between on and off."
              />

              <div className="grid gap-2">
                <p className="text-sm font-medium">Force on for roles</p>
                <div className="flex flex-wrap gap-3">
                  {roleOptions.map((role) => (
                    <div key={role.key} className="flex items-center gap-2">
                      <Checkbox
                        id={`flag-role-${role.key}`}
                        checked={includeRoles.includes(role.key)}
                        onCheckedChange={(checked) =>
                          toggleRole(role.key, Boolean(checked))
                        }
                      />
                      <Label
                        htmlFor={`flag-role-${role.key}`}
                        className="font-normal"
                      >
                        {role.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <TextareaField
                control={form.control}
                name="includeUserIds"
                label="Force on for user ids"
                placeholder="One id per line"
                description="Beats the percentage rollout."
              />

              <TextareaField
                control={form.control}
                name="excludeUserIds"
                label="Force off for user ids"
                placeholder="One id per line"
                description="Beats every other rule."
              />
            </fieldset>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Who is this on for?</h3>
                <Badge variant="secondary">preview</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Evaluated live against your most recent users, using the rules
                above — including unsaved changes.
              </p>
              <RolloutPreview
                flagKey={isEdit ? flag.key : (watched.key ?? "")}
                enabled={Boolean(watched.enabled)}
                rules={draftRules}
                users={previewUsers}
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="border-t p-6 pt-4">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Create flag"
            )}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
