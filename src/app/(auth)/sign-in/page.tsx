import { Suspense } from "react";
import type { Metadata } from "next";

import { Skeleton } from "@/components/ui/skeleton";
import { enabledSocialProviders } from "@/lib/auth";
import { SignInForm } from "@/modules/auth/components/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    // The form reads `?redirect=` via useSearchParams, which needs a Suspense
    // boundary so the rest of the page can still prerender.
    <Suspense fallback={<Skeleton className="h-[26rem] w-full rounded-xl" />}>
      <SignInForm socialProviders={enabledSocialProviders} />
    </Suspense>
  );
}
