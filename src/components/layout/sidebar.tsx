"use client";

import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocalStorageFlag } from "@/hooks/use-local-storage-flag";
import { cn } from "@/lib/utils";

import { SidebarNav } from "./sidebar-nav";

const COLLAPSE_STORAGE_KEY = "modern-admin:sidebar-collapsed";

/**
 * Desktop sidebar.
 *
 * Responsive contract (verified at 375 / 768 / 1280):
 *  - `< 768px`  — not rendered at all; navigation lives in `<MobileNav />`.
 *  - `768–1023` — icon-only rail, always collapsed. Screen real estate is too
 *                 tight for labels next to a data table.
 *  - `≥ 1024px` — full width, user-collapsible, choice persisted.
 */
export function Sidebar() {
  const [collapsed, setCollapsed] = useLocalStorageFlag(
    COLLAPSE_STORAGE_KEY,
    false,
  );

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex md:flex-col",
        // Tablet is always the rail; the stored preference only applies at lg+.
        "w-16 lg:w-64",
        collapsed && "lg:w-16",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2 border-b border-sidebar-border px-3",
          "justify-center lg:justify-between",
          collapsed && "lg:justify-center",
        )}
      >
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <span className={cn("hidden lg:inline", collapsed && "lg:hidden")}>
            Modern Admin
          </span>
        </Link>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(true)}
          aria-expanded
          aria-label="Collapse sidebar"
          className={cn("hidden lg:inline-flex", collapsed && "lg:hidden")}
        >
          <PanelLeftClose className="size-4" aria-hidden />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* Below lg the rail is always collapsed, so the two variants are
              swapped with CSS rather than a media-query hook (which would need
              to render something wrong first). */}
          <div className="lg:hidden">
            <SidebarNav collapsed />
          </div>
          <div className="hidden lg:block">
            <SidebarNav collapsed={collapsed} />
          </div>
        </div>
      </ScrollArea>

      {collapsed ? (
        <div className="hidden border-t border-sidebar-border p-2 lg:block">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(false)}
            aria-expanded={false}
            aria-label="Expand sidebar"
            className="w-full"
          >
            <PanelLeftOpen className="size-4" aria-hidden />
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
