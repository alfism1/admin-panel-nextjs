import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * Auth shell. Mobile-first: a single centred column that never exceeds the
 * viewport at 375px, with generous tap targets and no fixed chrome to fight
 * the on-screen keyboard.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-10 sm:px-6">
      <Link
        href="/"
        className="flex items-center gap-2 self-center rounded-md text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        Modern Admin
      </Link>

      <main className="w-full max-w-sm">{children}</main>

      <p className="max-w-sm text-center text-xs text-balance text-muted-foreground">
        Protected area. All sign-in attempts are recorded in the audit log.
      </p>
    </div>
  );
}
