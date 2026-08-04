import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  CheckboxField,
  FormAlert,
  SwitchField,
  TextField,
  TextareaField,
} from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";

const schema = z.object({
  email: z
    .string()
    .min(1, "E-mail is required.")
    .pipe(z.email("Enter a valid e-mail address.")),
  bio: z.string().max(200),
  notify: z.boolean(),
  terms: z.boolean(),
});
type Values = z.infer<typeof schema>;

function DemoForm({
  showError = false,
  submitInvalid = false,
}: {
  showError?: boolean;
  submitInvalid?: boolean;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: submitInvalid ? "not-an-email" : "",
      bio: "",
      notify: true,
      terms: false,
    },
    mode: submitInvalid ? "onChange" : "onSubmit",
  });

  return (
    <form
      noValidate
      className="grid max-w-sm gap-4"
      onSubmit={form.handleSubmit(() => undefined)}
    >
      {showError ? <FormAlert message="Invalid e-mail or password." /> : null}
      <TextField
        control={form.control}
        name="email"
        label="E-mail"
        type="email"
      />
      <TextareaField
        control={form.control}
        name="bio"
        label="Bio"
        description="Shown on your profile."
      />
      <SwitchField
        control={form.control}
        name="notify"
        label="E-mail notifications"
      />
      <CheckboxField
        control={form.control}
        name="terms"
        label="I accept the terms"
      />
      <Button type="submit">Save</Button>
    </form>
  );
}

const meta = {
  title: "Shared/FormField",
  component: DemoForm,
  parameters: {
    docs: {
      description: {
        component:
          "react-hook-form ↔ shadcn `Field` bridge. Owns id generation, `aria-invalid`, and associating the error with the control via `aria-describedby`.",
      },
    },
  },
} satisfies Meta<typeof DemoForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: {} };

/** Field-level errors are wired to the input through `aria-describedby`. */
export const WithFieldErrors: Story = {
  args: { submitInvalid: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
  },
};

/** Non-field failures ("wrong password") use the `role="alert"` banner. */
export const WithFormError: Story = { args: { showError: true } };

export const Mobile: Story = {
  args: {},
  globals: { viewport: { value: "mobile" } },
};
