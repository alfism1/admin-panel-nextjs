"use client";

import { useId } from "react";
import {
  Controller,
  type Control,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * react-hook-form ↔ shadcn `Field` bridge.
 *
 * shadcn v4 replaced the old `<Form>` primitive with the lower-level `Field`
 * parts, which know nothing about form state. These wrappers own the wiring
 * every form otherwise repeats: id generation, `aria-invalid`, associating the
 * error message with the control via `aria-describedby`, and rendering the
 * message only once the field has been touched or submitted.
 */

interface BaseFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  control: Control<TFieldValues>;
  name: TName;
  label: string;
  description?: string;
  className?: string;
  disabled?: boolean;
}

/** Wraps any control in the label/description/error scaffolding. */
export function FormFieldShell<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  control,
  name,
  label,
  description,
  className,
  disabled,
  orientation = "vertical",
  children,
}: BaseFieldProps<TFieldValues, TName> & {
  orientation?: "vertical" | "horizontal";
  children: (args: {
    field: ControllerRenderProps<TFieldValues, TName>;
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => React.ReactNode;
}) {
  const generatedId = useId();
  const id = `${generatedId}-${name}`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  return (
    <Controller
      control={control}
      name={name}
      disabled={disabled}
      render={({ field, fieldState }) => {
        const invalid = Boolean(fieldState.error);
        const describedBy =
          [description ? descriptionId : null, invalid ? errorId : null]
            .filter(Boolean)
            .join(" ") || undefined;

        return (
          <Field
            orientation={orientation}
            data-invalid={invalid || undefined}
            className={className}
          >
            {orientation === "horizontal" ? (
              <>
                {children({ field, id, describedBy, invalid })}
                <FieldContent>
                  <FieldLabel htmlFor={id}>{label}</FieldLabel>
                  {description ? (
                    <FieldDescription id={descriptionId}>
                      {description}
                    </FieldDescription>
                  ) : null}
                  {invalid ? (
                    <FieldError id={errorId} errors={[fieldState.error]} />
                  ) : null}
                </FieldContent>
              </>
            ) : (
              <>
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
                {children({ field, id, describedBy, invalid })}
                {description ? (
                  <FieldDescription id={descriptionId}>
                    {description}
                  </FieldDescription>
                ) : null}
                {invalid ? (
                  <FieldError id={errorId} errors={[fieldState.error]} />
                ) : null}
              </>
            )}
          </Field>
        );
      }}
    />
  );
}

export function TextField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  type = "text",
  placeholder,
  autoComplete,
  ...props
}: BaseFieldProps<TFieldValues, TName> & {
  type?: React.ComponentProps<typeof Input>["type"];
  placeholder?: string;
  autoComplete?: string;
}) {
  /**
   * There is deliberately no `autoFocus` prop. Programmatic focus on mount
   * moves a screen reader's or magnifier's viewport without the user asking,
   * so `jsx-a11y/no-autofocus` treats it as an error and we agree. Inside a
   * dialog Radix already moves focus to the first focusable element, which is
   * the behaviour WAI-ARIA actually asks for.
   */
  return (
    <FormFieldShell {...props}>
      {({ field, id, describedBy, invalid }) => (
        <Input
          {...field}
          id={id}
          type={type}
          value={field.value ?? ""}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      )}
    </FormFieldShell>
  );
}

export function TextareaField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  placeholder,
  rows = 3,
  ...props
}: BaseFieldProps<TFieldValues, TName> & {
  placeholder?: string;
  rows?: number;
}) {
  return (
    <FormFieldShell {...props}>
      {({ field, id, describedBy, invalid }) => (
        <Textarea
          {...field}
          id={id}
          rows={rows}
          value={field.value ?? ""}
          placeholder={placeholder}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      )}
    </FormFieldShell>
  );
}

export function SelectField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  options,
  placeholder,
  ...props
}: BaseFieldProps<TFieldValues, TName> & {
  options: readonly { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <FormFieldShell {...props}>
      {({ field, id, describedBy, invalid }) => (
        <Select
          value={field.value === undefined ? "" : String(field.value)}
          onValueChange={field.onChange}
          disabled={field.disabled}
        >
          {/*
            Radix renders a button, not a native `<select>`, so the blur that
            marks the field touched has to be wired by hand.
          */}
          <SelectTrigger
            id={id}
            onBlur={field.onBlur}
            ref={field.ref}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="w-full"
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormFieldShell>
  );
}

export function SwitchField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>(props: BaseFieldProps<TFieldValues, TName>) {
  return (
    <FormFieldShell {...props} orientation="horizontal">
      {({ field, id, describedBy, invalid }) => (
        <Switch
          id={id}
          checked={Boolean(field.value)}
          onCheckedChange={field.onChange}
          onBlur={field.onBlur}
          disabled={field.disabled}
          ref={field.ref}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      )}
    </FormFieldShell>
  );
}

export function CheckboxField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>(props: BaseFieldProps<TFieldValues, TName>) {
  return (
    <FormFieldShell {...props} orientation="horizontal">
      {({ field, id, describedBy, invalid }) => (
        <Checkbox
          id={id}
          checked={Boolean(field.value)}
          onCheckedChange={field.onChange}
          onBlur={field.onBlur}
          disabled={field.disabled}
          ref={field.ref}
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      )}
    </FormFieldShell>
  );
}

/** Non-field error banner, e.g. "Invalid e-mail or password". */
export function FormAlert({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className,
      )}
    >
      {message}
    </p>
  );
}
