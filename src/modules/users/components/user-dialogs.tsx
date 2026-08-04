"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  FormAlert,
  SwitchField,
  TextField,
} from "@/components/shared/form-field";
import type { ActionResult } from "@/lib/action";
import {
  assignRolesAction,
  banUserAction,
  createUserAction,
  updateUserAction,
} from "@/modules/users/users.actions";
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/modules/users/users.schema";

import type { UserRow } from "./users-view";

export interface RoleOption {
  key: string;
  name: string;
  description: string | null;
}

/**
 * Every dialog here follows the same shape: a thin `<Dialog>` shell, and a body
 * component keyed by the entity id.
 *
 * Radix unmounts `DialogContent` when closed, so the keyed body remounts with
 * fresh `useState`/`useForm` defaults on every open. That removes the
 * "reset the form in an effect when `open` becomes true" pattern, which causes
 * a cascading render and briefly shows the previous entity's values.
 */

function useActionHandler() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  function handle(
    result: ActionResult<unknown>,
    successMessage: string,
  ): boolean {
    if (!result.ok) {
      setFormError(result.message);
      return false;
    }
    toast.success(successMessage);
    router.refresh();
    return true;
  }

  return { formError, setFormError, handle };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function CreateUserDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: RoleOption[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <CreateUserBody roles={roles} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateUserBody({
  roles,
  onDone,
}: {
  roles: RoleOption[];
  onDone: () => void;
}) {
  const { formError, setFormError, handle } = useActionHandler();
  const [roleKey, setRoleKey] = useState("");

  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "",
      markVerified: true,
    },
  });

  async function onSubmit(values: CreateUserInput) {
    setFormError(null);
    const result = await createUserAction({
      ...values,
      role: roleKey || undefined,
    });
    if (handle(result, `${values.name} created.`)) onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New user</DialogTitle>
        <DialogDescription>
          Creates the account through the normal sign-up path, so the password
          hash matches what sign-in verifies.
        </DialogDescription>
      </DialogHeader>

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
          autoComplete="off"
        />
        <TextField
          control={form.control}
          name="email"
          label="E-mail"
          type="email"
          autoComplete="off"
        />
        <TextField
          control={form.control}
          name="password"
          label="Temporary password"
          type="password"
          autoComplete="new-password"
          description="At least 8 characters. Share it out-of-band and ask them to change it."
        />

        <RolePicker
          roles={roles}
          value={roleKey ? [roleKey] : []}
          onChange={(keys) => setRoleKey(keys[0] ?? "")}
          single
        />

        <SwitchField
          control={form.control}
          name="markVerified"
          label="Mark e-mail as verified"
          description="Skips the verification e-mail. Only do this for addresses you control."
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Creating…
              </>
            ) : (
              "Create user"
            )}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export function EditUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {user ? (
          <EditUserBody
            key={user.id}
            user={user}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditUserBody({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const { formError, setFormError, handle } = useActionHandler();

  const form = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { id: user.id, name: user.name, email: user.email },
  });

  async function onSubmit(values: UpdateUserInput) {
    setFormError(null);
    if (handle(await updateUserAction(values), "User updated.")) onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {user.name}</DialogTitle>
        <DialogDescription>
          Changing the e-mail marks it unverified — they&apos;ll need to confirm
          the new address.
        </DialogDescription>
      </DialogHeader>

      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-4"
      >
        <FormAlert message={formError} />

        <TextField control={form.control} name="name" label="Name" />
        <TextField
          control={form.control}
          name="email"
          label="E-mail"
          type="email"
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Assign roles
// ---------------------------------------------------------------------------

export function AssignRolesDialog({
  user,
  open,
  onOpenChange,
  roles,
}: {
  user: UserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: RoleOption[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {user ? (
          <AssignRolesBody
            key={user.id}
            user={user}
            roles={roles}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AssignRolesBody({
  user,
  roles,
  onDone,
}: {
  user: UserRow;
  roles: RoleOption[];
  onDone: () => void;
}) {
  const { formError, setFormError, handle } = useActionHandler();
  const [selected, setSelected] = useState<string[]>(user.roleKeys);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setFormError(null);
    const result = await assignRolesAction({
      id: user.id,
      roleKeys: selected,
    });
    setPending(false);
    if (handle(result, "Roles updated.")) onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Roles for {user.name}</DialogTitle>
        <DialogDescription>
          You can only assign roles whose permissions you already hold.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <FormAlert message={formError} />
        <RolePicker roles={roles} value={selected} onChange={setSelected} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" disabled={pending} onClick={() => void submit()}>
          {pending ? "Saving…" : "Save roles"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ban
// ---------------------------------------------------------------------------

/**
 * The server schema coerces `expiresInDays` from a string (it also serves the
 * REST route), which makes its zod *input* type `unknown` and breaks
 * react-hook-form's single generic. The form therefore validates the string an
 * `<input type="number">` actually produces, and converts on submit.
 */
const banFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Give a reason — it goes in the audit log.")
    .max(500),
  expiresInDays: z
    .string()
    .trim()
    .regex(/^\d*$/, "Enter a whole number of days.")
    .refine((value) => value === "" || Number(value) >= 1, {
      message: "Must be at least 1 day.",
    }),
});
type BanFormInput = z.infer<typeof banFormSchema>;

export function BanUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {user ? (
          <BanUserBody
            key={user.id}
            user={user}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BanUserBody({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const { formError, setFormError, handle } = useActionHandler();

  const form = useForm<BanFormInput>({
    resolver: zodResolver(banFormSchema),
    defaultValues: { reason: "", expiresInDays: "" },
  });

  async function onSubmit(values: BanFormInput) {
    setFormError(null);
    const result = await banUserAction({
      id: user.id,
      reason: values.reason,
      ...(values.expiresInDays
        ? { expiresInDays: Number(values.expiresInDays) }
        : {}),
    });
    if (handle(result, `${user.name} banned.`)) onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ban {user.name}</DialogTitle>
        <DialogDescription>
          Their sessions are revoked immediately and they can&apos;t sign in
          again until the ban is lifted.
        </DialogDescription>
      </DialogHeader>

      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-4"
      >
        <FormAlert message={formError} />

        <TextField
          control={form.control}
          name="reason"
          label="Reason"
          placeholder="Repeated policy violations"
          description="Recorded in the audit log."
        />
        <TextField
          control={form.control}
          name="expiresInDays"
          label="Expires in (days)"
          type="number"
          placeholder="Leave empty for an indefinite ban"
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "Banning…" : "Ban user"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------

function RolePicker({
  roles,
  value,
  onChange,
  single = false,
}: {
  roles: RoleOption[];
  value: string[];
  onChange: (keys: string[]) => void;
  single?: boolean;
}) {
  function toggle(key: string, checked: boolean) {
    if (single) {
      onChange(checked ? [key] : []);
      return;
    }
    const next = new Set(value);
    if (checked) next.add(key);
    else next.delete(key);
    onChange([...next]);
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">
        {single ? "Role" : "Roles"}
      </legend>

      {roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No roles available to assign.
        </p>
      ) : (
        roles.map((role) => {
          const id = `role-${role.key}`;
          return (
            <div key={role.key} className="flex items-start gap-2">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={value.includes(role.key)}
                onCheckedChange={(checked) =>
                  toggle(role.key, Boolean(checked))
                }
              />
              <div className="min-w-0">
                <Label htmlFor={id} className="font-normal">
                  {role.name}
                </Label>
                {role.description ? (
                  <p className="text-xs text-muted-foreground">
                    {role.description}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </fieldset>
  );
}
