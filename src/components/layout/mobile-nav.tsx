"use client";

import { useState } from "react";
import { Menu, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

import { SidebarNav } from "./sidebar-nav";

/**
 * Off-canvas navigation for `< 768px`.
 *
 * Radix's Dialog underneath gives focus trapping, Escape-to-close, scroll lock
 * and `aria-modal` for free. Dismissal on navigation is handled by the
 * `onNavigate` callback each link calls, rather than an effect watching the
 * pathname — the click is the event, the URL change is just its consequence.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="h-14 flex-row items-center gap-2 border-b px-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <SheetTitle>Modern Admin</SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100svh-3.5rem)]">
          <div className="p-2">
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
