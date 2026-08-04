import type { Metadata } from "next";

import { enabledSocialProviders } from "@/lib/auth";
import { SignUpForm } from "@/modules/auth/components/sign-up-form";

export const metadata: Metadata = { title: "Sign up" };

export default function SignUpPage() {
  return <SignUpForm socialProviders={enabledSocialProviders} />;
}
