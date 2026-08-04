import { Suspense } from "react";
import type { Metadata } from "next";

import { Skeleton } from "@/components/ui/skeleton";
import { VerifyEmailPending } from "@/modules/auth/components/verify-email-pending";

export const metadata: Metadata = { title: "Verify your e-mail" };

export default function VerifyEmailPage() {
  return (
    // Reads `?email=` to offer a targeted "resend" button.
    <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
      <VerifyEmailPending />
    </Suspense>
  );
}
