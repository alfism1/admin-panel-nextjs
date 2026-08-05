"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  FormAlert,
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
import {
  createProductAction,
  updateProductAction,
} from "@/modules/products/products.actions";
import { skuField } from "@/modules/products/products.schema";

import type { ProductRow } from "./products-view";

/**
 * The form's own schema, which is not `createProductSchema`.
 *
 * The service stores an integer number of cents; a human types `19.99`. So the
 * form validates the string it actually edits and converts on submit. Reaching
 * for `z.coerce.number()` instead would make the zod input and output types
 * diverge, which react-hook-form's single generic can't express.
 */
const productFormSchema = z.object({
  sku: skuField,
  name: z.string().trim().min(1, "Name is required.").max(160),
  description: z.string().trim().max(2000),
  price: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 19.99.")
    .refine((value) => Number(value) <= 1_000_000, "That's above the maximum."),
});
type ProductFormInput = z.infer<typeof productFormSchema>;

/**
 * Server field name → form field name.
 *
 * They differ wherever the form edits a different representation of a column,
 * so a `priceCents` error from the server still lands under the price input
 * rather than in the generic banner.
 */
const FIELD_MAP: Record<string, keyof ProductFormInput> = {
  sku: "sku",
  name: "name",
  description: "description",
  priceCents: "price",
};

/**
 * One dialog, two modes: `product === null` creates, otherwise it edits.
 *
 * The body is keyed by product id so Radix's unmount-on-close plus the key give
 * every open a fresh `useForm` with the right defaults — no "reset the form in
 * an effect" cascade, and no flash of the previously edited row.
 */
export function ProductDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductRow | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <ProductDialogBody
          key={product?.id ?? "new"}
          product={product}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProductDialogBody({
  product,
  onDone,
}: {
  product: ProductRow | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const isEdit = product !== null;
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ProductFormInput>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      sku: product?.sku ?? "",
      name: product?.name ?? "",
      description: product?.description ?? "",
      // Integer cents → the decimal string the input edits.
      price: product ? (product.priceCents / 100).toFixed(2) : "0.00",
    },
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

    for (const [serverField, messages] of Object.entries(
      result.fieldErrors ?? {},
    )) {
      const field = FIELD_MAP[serverField];
      const message = messages[0];
      if (!field || !message) continue;
      form.setError(field, { type: "server", message });
      applied = true;
    }

    return applied;
  }

  async function onSubmit(values: ProductFormInput) {
    setFormError(null);

    const payload = {
      name: values.name,
      description: values.description || undefined,
      // `Math.round` is not decoration: 19.99 * 100 is 1998.9999999999998 in
      // IEEE 754, and `priceCents` is an integer column.
      priceCents: Math.round(Number(values.price) * 100),
    };

    const result = isEdit
      ? await updateProductAction({ id: product.id, ...payload })
      : await createProductAction({ sku: values.sku, ...payload });

    if (!result.ok) {
      if (!applyServerErrors(result)) setFormError(result.message);
      return;
    }

    toast.success(isEdit ? "Product updated." : `Product ${values.sku} added.`);
    router.refresh();
    onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? `Edit ${product.name}` : "New product"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? "The SKU is fixed once a product exists — other systems reference it."
            : "Pick a SKU carefully: it identifies this product everywhere and can't be changed later."}
        </DialogDescription>
      </DialogHeader>

      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-4"
      >
        <FormAlert message={formError} />

        {isEdit ? (
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">SKU: </span>
            <span className="font-mono">{product.sku}</span>
          </div>
        ) : (
          <TextField
            control={form.control}
            name="sku"
            label="SKU"
            placeholder="TSHIRT-BLK-M"
            autoComplete="off"
            description="Uppercase letters, digits and hyphens."
          />
        )}

        <TextField control={form.control} name="name" label="Name" />

        <TextField
          control={form.control}
          name="price"
          label="Price (USD)"
          placeholder="19.99"
          description="Stored as an integer number of cents."
        />

        <TextareaField
          control={form.control}
          name="description"
          label="Description"
          placeholder="What it is, in a sentence or two."
        />

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
              "Create product"
            )}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
