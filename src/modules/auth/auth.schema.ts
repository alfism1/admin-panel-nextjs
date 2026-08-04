import { z } from "zod";

/**
 * Auth form schemas. Shared by the client (react-hook-form resolver) and any
 * server code that re-validates the same shape — one definition, no drift
 * between what the form accepts and what the server accepts.
 *
 * No `.default()` anywhere: it makes a field optional on the input side and
 * required on the output side, which fights react-hook-form's single generic.
 * Defaults belong in `defaultValues`.
 */

/** Trim and lowercase first, then validate, so " Foo@Bar.com " is accepted. */
export const emailField = z
  .string()
  .trim()
  .min(1, "E-mail is required.")
  .toLowerCase()
  .pipe(z.email("Enter a valid e-mail address."));

/**
 * Length-only by design. Composition rules (a digit, a symbol, …) push people
 * towards `Password1!` and measurably weaken passwords; NIST SP 800-63B has
 * recommended against them since 2017.
 */
export const passwordField = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128, "Use at most 128 characters.");

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required."),
  rememberMe: z.boolean(),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(120),
    email: emailField,
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type SignUpInput = z.infer<typeof signUpSchema>;

export const forgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const totpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
  trustDevice: z.boolean(),
});
export type TotpInput = z.infer<typeof totpSchema>;

export const backupCodeSchema = z.object({
  code: z.string().trim().min(1, "Enter one of your backup codes."),
});
export type BackupCodeInput = z.infer<typeof backupCodeSchema>;
