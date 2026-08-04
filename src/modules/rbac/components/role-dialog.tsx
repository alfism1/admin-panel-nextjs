"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FormAlert,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/shared/form-field";
import {
  createRoleAction,
  updateRoleAction,
  updateRolePermissionsAction,
} from "@/modules/rbac/rbac.actions";
import { roleKeySchema } from "@/modules/rbac/rbac.schema";

import { PermissionMatrix, type PermissionOption } from "./permission-matrix";

export interface RoleDialogRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  requireTwoFactor: boolean;
  permissionKeys: string[];
}

const roleFormSchema = z.object({
  key: roleKeySchema,
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: z.string().trim().max(500),
  requireTwoFactor: z.boolean(),
});
type RoleFormInput = z.infer<typeof roleFormSchema>;

/**
 * Create/edit dialog for a role.
 *
 * The body is a separate component keyed by role id, so opening the dialog for
 * a different role remounts it with fresh `useState`/`useForm` defaults. That
 * replaces the usual "reset everything in an effect when `open` flips" — no
 * cascading render, and no window where the form shows the previous role.
 */
export function RoleDialog({
  open,
  onOpenChange,
  role,
  permissions,
  grantableKeys,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = create mode. */
  role: RoleDialogRole | null;
  permissions: PermissionOption[];
  grantableKeys: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <RoleDialogBody
          key={role?.id ?? "new"}
          role={role}
          permissions={permissions}
          grantableKeys={grantableKeys}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function RoleDialogBody({
  role,
  permissions,
  grantableKeys,
  onDone,
}: {
  role: RoleDialogRole | null;
  permissions: PermissionOption[];
  grantableKeys: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const isEdit = role !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(
    role?.permissionKeys ?? [],
  );

  const grantable = useMemo(() => new Set(grantableKeys), [grantableKeys]);

  const form = useForm<RoleFormInput>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: {
      // In edit mode the key is immutable and not rendered, but it still has to
      // satisfy the schema for the form to submit.
      key: role?.key ?? "",
      name: role?.name ?? "",
      description: role?.description ?? "",
      requireTwoFactor: role?.requireTwoFactor ?? false,
    },
  });

  async function onSubmit(values: RoleFormInput) {
    setFormError(null);

    if (!isEdit) {
      const result = await createRoleAction({
        key: values.key,
        name: values.name,
        description: values.description || undefined,
        requireTwoFactor: values.requireTwoFactor,
        permissionKeys: selectedKeys,
      });
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      toast.success(`Role "${values.name}" created.`);
      router.refresh();
      onDone();
      return;
    }

    // Two calls on purpose: profile fields and grants carry different
    // permissions and produce different audit entries (`role.updated` vs
    // `role.permissions_updated`). Merging them would make the log say
    // "someone changed something".
    const profile = await updateRoleAction({
      id: role.id,
      name: values.name,
      description: values.description || undefined,
      requireTwoFactor: values.requireTwoFactor,
    });
    if (!profile.ok) {
      setFormError(profile.message);
      return;
    }

    const grants = await updateRolePermissionsAction({
      id: role.id,
      permissionKeys: selectedKeys,
    });
    if (!grants.ok) {
      setFormError(grants.message);
      return;
    }

    toast.success(`Role "${values.name}" updated.`);
    router.refresh();
    onDone();
  }

  const submitting = form.formState.isSubmitting;

  return (
    <>
      <DialogHeader className="border-b p-6 pb-4">
        <DialogTitle>{isEdit ? `Edit ${role.name}` : "New role"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Change the role's details and the permissions it grants."
            : "Roles are created at runtime — no deploy needed."}
        </DialogDescription>
      </DialogHeader>

      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-col"
      >
        <ScrollArea className="max-h-[60svh] flex-1">
          <div className="grid gap-4 p-6">
            <FormAlert message={formError} />

            {isEdit ? (
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">Key: </span>
                <span className="font-mono">{role.key}</span>
                <p className="mt-1 text-xs text-muted-foreground">
                  The key is immutable — it&apos;s stored on every user holding
                  this role.
                </p>
              </div>
            ) : (
              <TextField
                control={form.control}
                name="key"
                label="Key"
                placeholder="support_agent"
                description="Used in code and stored on users. Cannot be changed later."
              />
            )}

            <TextField
              control={form.control}
              name="name"
              label="Display name"
              placeholder="Support agent"
            />

            <TextareaField
              control={form.control}
              name="description"
              label="Description"
              placeholder="What this role is for, and who should have it."
            />

            <SwitchField
              control={form.control}
              name="requireTwoFactor"
              label="Require two-factor authentication"
              description="Members must enrol in TOTP before using the panel."
            />

            <div className="space-y-2">
              <p className="text-sm font-medium">Permissions</p>
              <PermissionMatrix
                options={permissions}
                value={selectedKeys}
                onChange={setSelectedKeys}
                grantableKeys={grantable}
                disabled={submitting}
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="border-t p-6 pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={onDone}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Create role"
            )}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
