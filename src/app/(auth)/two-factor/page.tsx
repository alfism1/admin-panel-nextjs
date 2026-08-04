import type { Metadata } from "next";

import { TwoFactorForm } from "@/modules/auth/components/two-factor-form";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default function TwoFactorPage() {
  return <TwoFactorForm />;
}
