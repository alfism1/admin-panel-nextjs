import { z } from "zod";

/**
 * Field descriptors — the atoms a resource is built from.
 *
 * A field answers three questions the rest of the framework asks it: how is the
 * value **stored**, how is it **edited**, and how is it **displayed**. Every
 * zod schema, form control and table cell in a generated module is derived from
 * those three answers, which is why a module no longer hand-writes any of them.
 *
 * Deliberately isomorphic — no `server-only`, no Drizzle. The same descriptor
 * builds the service's validation schema and the browser's form, so the two
 * cannot drift apart the way a hand-written pair always eventually does.
 */

export type FieldKind =
  "text" | "textarea" | "number" | "money" | "boolean" | "select";

export interface FieldDescriptor {
  kind: FieldKind;
  label: string;
  description?: string;
  placeholder?: string;
  /** Nullable in the database, skippable in the form. */
  optional: boolean;
  /** Set once at creation and never editable after (a SKU, a slug). */
  immutable: boolean;
  /** Never rendered in the form — system-managed or derived columns. */
  hiddenInForm: boolean;
  /** Rendered as a table column. */
  inTable: boolean;
  /** Included in the search predicate. Text-shaped fields only. */
  searchable: boolean;
  /** Offered as a sort key. */
  sortable: boolean;
  /**
   * Enforced unique before the write, so the user gets "that SKU is taken"
   * instead of a driver constraint violation. The database index is still the
   * guarantee — this is only the readable path.
   */
  unique: boolean;
  /** Validation for the **stored** representation — what the service parses. */
  stored: z.ZodType;
  /** Validation for the **edited** representation — what the form parses. */
  form: z.ZodType;
  /** stored → form */
  toForm: (value: unknown) => unknown;
  /** form → stored */
  fromForm: (value: unknown) => unknown;
  /** The form value for a brand-new record. */
  emptyForm: unknown;
  /** Default table-cell text. */
  format: (value: unknown) => string;
  /** Right-align the column and use tabular figures. */
  numeric: boolean;
  options?: readonly { value: string; label: string }[];
  rows?: number;
}

interface CommonOptions {
  label: string;
  description?: string;
  placeholder?: string;
  optional?: boolean;
  immutable?: boolean;
  hiddenInForm?: boolean;
  inTable?: boolean;
  sortable?: boolean;
  unique?: boolean;
}

function base(options: CommonOptions) {
  return {
    label: options.label,
    description: options.description,
    placeholder: options.placeholder,
    optional: options.optional ?? false,
    immutable: options.immutable ?? false,
    hiddenInForm: options.hiddenInForm ?? false,
    inTable: options.inTable ?? true,
    sortable: options.sortable ?? false,
    unique: options.unique ?? false,
  };
}

const asString = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

// ---------------------------------------------------------------------------
// text / textarea
// ---------------------------------------------------------------------------

interface TextOptions extends CommonOptions {
  min?: number;
  max?: number;
  searchable?: boolean;
  /**
   * Replaces the generated string schema outright — for a SKU regex, an e-mail,
   * anything the generic builder can't express. Applied to both the stored and
   * the edited representation, which for a text field are the same thing.
   */
  schema?: z.ZodType<string>;
}

function buildStringSchema(options: TextOptions): z.ZodType<string> {
  if (options.schema) return options.schema;

  let schema = z.string().trim();
  if (options.min !== undefined) schema = schema.min(options.min);
  else if (!options.optional) {
    schema = schema.min(1, `${options.label} is required.`);
  }
  return schema.max(options.max ?? 255);
}

export function text(options: TextOptions): FieldDescriptor {
  const schema = buildStringSchema(options);
  const optional = options.optional ?? false;

  return {
    ...base(options),
    kind: "text",
    searchable: options.searchable ?? false,
    sortable: options.sortable ?? true,
    numeric: false,
    stored: optional ? schema.optional() : schema,
    // An optional text input still edits a string — "" is how a user clears it,
    // and `fromForm` is what turns that back into `undefined`.
    form: optional
      ? z
          .string()
          .trim()
          .max(options.max ?? 255)
      : schema,
    toForm: asString,
    fromForm: (value) => {
      const next = asString(value);
      return optional && next === "" ? undefined : next;
    },
    emptyForm: "",
    format: asString,
  };
}

export function textarea(
  options: TextOptions & { rows?: number },
): FieldDescriptor {
  return {
    ...text({ max: 2000, ...options }),
    kind: "textarea",
    rows: options.rows ?? 3,
    sortable: options.sortable ?? false,
  };
}

// ---------------------------------------------------------------------------
// number / money
// ---------------------------------------------------------------------------

export function number(
  options: CommonOptions & { min?: number; max?: number },
): FieldDescriptor {
  const min = options.min ?? 0;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  const optional = options.optional ?? false;

  return {
    ...base(options),
    kind: "number",
    searchable: false,
    sortable: options.sortable ?? true,
    numeric: true,
    stored: z.number().int().min(min).max(max),
    // The form edits the string the user typed, not a number. `z.coerce` would
    // make the zod input and output types diverge, which react-hook-form's
    // single generic cannot express.
    form: z
      .string()
      .trim()
      .regex(/^-?\d+$/, "Enter a whole number.")
      .refine((value) => Number(value) >= min, `Must be at least ${min}.`)
      .refine((value) => Number(value) <= max, `Must be at most ${max}.`),
    toForm: (value) =>
      value === null || value === undefined ? "" : String(value),
    fromForm: (value) => {
      const next = asString(value);
      return optional && next === "" ? undefined : Number(next);
    },
    emptyForm: "0",
    format: (value) =>
      typeof value === "number" ? value.toLocaleString("en-US") : "",
  };
}

/**
 * An integer number of minor units (cents), edited as a decimal string.
 *
 * The representation gap is the whole reason fields carry `toForm`/`fromForm`:
 * the database stores `1999`, the human types `19.99`, and `19.99 * 100` is
 * `1998.9999999999998` in IEEE 754 — so the conversion rounds, in one place,
 * for every money field anyone ever declares.
 */
export function money(
  options: CommonOptions & {
    currency?: string;
    /** Upper bound in **major** units. */
    max?: number;
  },
): FieldDescriptor {
  const currency = options.currency ?? "USD";
  const maxMajor = options.max ?? 1_000_000;

  /**
   * Fixed locale, deliberately. A Client Component still renders on the server
   * first, where `undefined` resolves to the *server's* locale rather than the
   * viewer's — the two disagree and React reports a hydration mismatch.
   */
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  });

  return {
    ...base(options),
    kind: "money",
    searchable: false,
    sortable: options.sortable ?? true,
    numeric: true,
    stored: z
      .number()
      .int()
      .min(0)
      .max(maxMajor * 100),
    form: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 19.99.")
      .refine(
        (value) => Number(value) <= maxMajor,
        "That's above the maximum.",
      ),
    toForm: (value) =>
      typeof value === "number" ? (value / 100).toFixed(2) : "0.00",
    fromForm: (value) => Math.round(Number(asString(value)) * 100),
    emptyForm: "0.00",
    format: (value) =>
      typeof value === "number" ? formatter.format(value / 100) : "",
  };
}

// ---------------------------------------------------------------------------
// boolean / select
// ---------------------------------------------------------------------------

export function boolean(
  options: CommonOptions & { trueLabel?: string; falseLabel?: string },
): FieldDescriptor {
  const trueLabel = options.trueLabel ?? "Yes";
  const falseLabel = options.falseLabel ?? "No";

  return {
    ...base(options),
    kind: "boolean",
    searchable: false,
    sortable: options.sortable ?? false,
    numeric: false,
    stored: z.boolean(),
    form: z.boolean(),
    toForm: (value) => Boolean(value),
    fromForm: (value) => Boolean(value),
    emptyForm: false,
    format: (value) => (value ? trueLabel : falseLabel),
  };
}

export function select(
  options: CommonOptions & {
    options: readonly { value: string; label: string }[];
  },
): FieldDescriptor {
  const values = options.options.map((option) => option.value);
  if (values.length === 0) {
    throw new Error(
      `select field "${options.label}" needs at least one option.`,
    );
  }
  const schema = z.enum(values as [string, ...string[]]);
  const labels = new Map(options.options.map((o) => [o.value, o.label]));

  return {
    ...base(options),
    kind: "select",
    searchable: false,
    sortable: options.sortable ?? false,
    numeric: false,
    options: options.options,
    stored: schema,
    form: schema,
    toForm: (value) => asString(value) || values[0],
    fromForm: (value) => asString(value),
    emptyForm: values[0],
    format: (value) => labels.get(asString(value)) ?? asString(value),
  };
}

export const field = { text, textarea, number, money, boolean, select };
