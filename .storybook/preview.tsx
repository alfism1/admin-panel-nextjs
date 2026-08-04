import * as React from "react";
import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Toaster } from "../src/components/ui/sonner";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { PermissionProvider } from "../src/modules/rbac/permission-provider";
import { ALL_PERMISSION_KEYS } from "../src/lib/permissions";

import "../src/app/globals.css";

/**
 * Mirrors `AppProviders` so components behave in Storybook the way they do in
 * the app. Without `PermissionProvider` every component calling
 * `usePermission` would throw.
 *
 * Stories can narrow the granted set with `parameters.permissions`, which is
 * how the "read-only" variants are built.
 */
function StorybookProviders({
  permissionKeys,
  children,
}: {
  permissionKeys: string[];
  children: React.ReactNode;
}) {
  // Per-story client, so one story's cached queries can't leak into the next.
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
      >
        <TooltipProvider>
          <PermissionProvider permissionKeys={permissionKeys}>
            <div className="bg-background p-4 text-foreground">{children}</div>
            <Toaster richColors closeButton />
          </PermissionProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const withProviders: Decorator = (Story, context) => (
  <StorybookProviders
    permissionKeys={
      (context.parameters.permissions as string[] | undefined) ??
      (ALL_PERMISSION_KEYS as string[])
    }
  >
    <Story />
  </StorybookProviders>
);

const preview: Preview = {
  decorators: [withProviders],

  parameters: {
    layout: "fullscreen",
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },

    /**
     * Named viewports so every component can be checked at the three widths the
     * brief calls out. `mobile` is the one that matters — 375px is where admin
     * layouts break.
     */
    viewport: {
      options: {
        mobile: {
          name: "Mobile (375px)",
          styles: { width: "375px", height: "812px" },
        },
        tablet: {
          name: "Tablet (768px)",
          styles: { width: "768px", height: "1024px" },
        },
        desktop: {
          name: "Desktop (1280px)",
          styles: { width: "1280px", height: "800px" },
        },
      },
    },

    a11y: {
      // Fail the story on an unresolved violation instead of reporting it.
      test: "error",
    },
  },

  initialGlobals: {
    viewport: { value: "desktop", isRotated: false },
  },
};

export default preview;
