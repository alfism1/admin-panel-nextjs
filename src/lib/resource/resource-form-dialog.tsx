"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  FormAlert,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/action";

import { resourceMutate } from "./actions";
import type { ResourceDescriptor, ResourceRecord } from "./define";
import type { FieldDescriptor } from "./fields";

type FormValues = Record<string, unknown>;

/**
 * The create/edit form, built from the descriptor's fields.
 *
 * Two representations meet here. The service validates the **stored** shape
 * (`priceCents: 1999`); the user edits the **form** shape (`"19.99"`). Each
 * field owns both schemas and the conversion between them, so this component
 * never knows what a price is — it asks the field.
 *
 * That also retires the hand-written `FIELD_MAP` every dialog used to carry:
 * form field names now *are* stored field names, so a server-side field error
 * lands on the right input without a translation table.
 */

/** Fields the user can actually edit in this mode. */
function editableFields(
  descriptor: ResourceDescriptor,
  isEdit: boolean,
): [string, FieldDescriptor][] {
  return descriptor.fieldEntries.filter(
    ([, field]) => !field.hiddenInForm && !(isEdit && field.immutable),
  );
}

export function ResourceFormDialog({
  descriptor,
  open,
  onOpenChange,
  record,
}: {
  descriptor: ResourceDescriptor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: ResourceRecord | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/*
          Keyed by record id so Radix's unmount-on-close plus the key give every
          open a fresh `useForm` with the right defaults — no "reset the form in
          an effect" cascade, and no flash of the previously edited row.
        */}
        <ResourceFormBody
          key={record?.id ?? "new"}
          descriptor={descriptor}
          record={record}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ResourceFormBody({
  descriptor,
  record,
  onDone,
}: {
  descriptor: ResourceDescriptor;
  record: ResourceRecord | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const isEdit = record !== null;
  const [formError, setFormError] = useState<string | null>(null);

  const fields = editableFields(descriptor, isEdit);

  const schema = z.object(
    Object.fromEntries(fields.map(([name, field]) => [name, field.form])),
  );

  const defaultValues: FormValues = Object.fromEntries(
    fields.map(([name, field]) => [
      name,
      record ? field.toForm(record[name]) : field.emptyForm,
    ]),
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues,
  });

  /**
   * Puts server-side validation errors on the fields they belong to.
   *
   * Returns whether anything was placed: if not, the message goes in the banner
   * instead, so a `CONFLICT` or `FORBIDDEN` can never fail silently.
   */
  function applyServerErrors(
    result: Extract<ActionResult<unknown>, { ok: false }>,
  ): boolean {
    let applied = false;
    for (const [name, messages] of Object.entries(result.fieldErrors ?? {})) {
      const message = messages[0];
      if (!message || !descriptor.fields[name]) continue;
      form.setError(name, { type: "server", message });
      applied = true;
    }
    return applied;
  }

  async function onSubmit(values: FormValues) {
    setFormError(null);

    const payload: Record<string, unknown> = {};
    for (const [name, field] of fields) {
      payload[name] = field.fromForm(values[name]);
    }
    if (isEdit) payload.id = record.id;

    const result = await resourceMutate(
      descriptor.name,
      isEdit ? "update" : "create",
      payload,
    );

    if (!result.ok) {
      if (!applyServerErrors(result)) setFormError(result.message);
      return;
    }

    toast.success(
      isEdit
        ? `${descriptor.label} updated.`
        : `${descriptor.label} ${recordTitle(descriptor, payload)} added.`,
    );
    // The server re-renders the page with fresh rows; nothing is mutated
    // locally, so the table can't drift from the database.
    router.refresh();
    onDone();
  }

  const immutableShown = isEdit
    ? descriptor.fieldEntries.filter(
        ([, field]) => field.immutable && !field.hiddenInForm,
      )
    : [];

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit
            ? `Edit ${recordTitle(descriptor, record)}`
            : `New ${descriptor.label.toLowerCase()}`}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? `Update this ${descriptor.label.toLowerCase()}. Changes are audited.`
            : `Add a new ${descriptor.label.toLowerCase()} to ${descriptor.pluralLabel.toLowerCase()}.`}
        </DialogDescription>
      </DialogHeader>

      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-4"
      >
        <FormAlert message={formError} />

        {/* Immutable fields are shown, not edited — they identify the row. */}
        {record
          ? immutableShown.map(([name, field]) => (
              <div key={name} className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">{field.label}: </span>
                <span className="font-mono">{field.format(record[name])}</span>
              </div>
            ))
          : null}

        {fields.map(([name, field]) => (
          <ResourceFormField
            key={name}
            name={name}
            field={field}
            control={form.control}
          />
        ))}

        <DialogFooter>
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
              `Create ${descriptor.label.toLowerCase()}`
            )}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function ResourceFormField({
  name,
  field,
  control,
}: {
  name: string;
  field: FieldDescriptor;
  control: ReturnType<typeof useForm<FormValues>>["control"];
}) {
  const shared = {
    control,
    name,
    label: field.label,
    description: field.description,
  };

  switch (field.kind) {
    case "textarea":
      return (
        <TextareaField
          {...shared}
          placeholder={field.placeholder}
          rows={field.rows}
        />
      );
    case "boolean":
      return <SwitchField {...shared} />;
    case "select":
      return <SelectField {...shared} options={field.options ?? []} />;
    case "number":
    case "money":
    case "text":
    default:
      return (
        <TextField
          {...shared}
          placeholder={field.placeholder}
          // A SKU or a slug is not something a password manager should fill.
          autoComplete="off"
        />
      );
  }
}

/** The row's headline, used in dialog titles and toasts. */
function recordTitle(
  descriptor: ResourceDescriptor,
  values: Record<string, unknown>,
): string {
  const field = descriptor.fields[descriptor.primaryField];
  const value = values[descriptor.primaryField];
  return field ? field.format(value) : String(value ?? "");
}
