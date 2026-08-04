"use client";

import { useState } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

import { createQueryClient } from "@/lib/query-client";

/**
 * Client-side providers for the whole app.
 *
 * The QueryClient is created inside `useState` rather than at module scope: a
 * module-level client would be shared across every request on the server and
 * leak one user's cached data into another's render.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
