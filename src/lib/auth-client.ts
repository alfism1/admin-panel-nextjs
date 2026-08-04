"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";

import { ac, betterAuthRoles } from "@/lib/permissions";

/**
 * Browser-side Better-Auth client.
 *
 * The plugin list must mirror `lib/auth.ts` or the typed method surface drifts
 * from what the server actually exposes.
 *
 * Note this imports `lib/permissions.ts`, which therefore ships to the client.
 * That is intentional and safe: the statement is a description of what actions
 * *exist*, not of who may perform them. Every grant is still resolved and
 * enforced server-side.
 */
export const authClient = createAuthClient({
  plugins: [
    adminClient({ ac, roles: betterAuthRoles }),
    twoFactorClient({
      onTwoFactorRedirect() {
        /**
         * A full navigation, not `router.push`, and deliberately so: this
         * callback fires from Better-Auth's fetch plugin, outside React's
         * lifecycle, where no router instance exists. It also runs at the exact
         * moment the session cookie changes — a soft navigation would reuse the
         * client-side RSC cache rendered for the pre-2FA state.
         */
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/two-factor";
      },
    }),
  ],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  changePassword,
  updateUser,
  twoFactor,
  admin,
} = authClient;

export type AuthClient = typeof authClient;
