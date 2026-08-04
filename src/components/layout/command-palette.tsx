"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Monitor, Moon, Search, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useHasPermissionKey } from "@/modules/rbac/permission-provider";

import { navigation, type NavItem } from "./nav-config";

/**
 * Global search / command palette (⌘K, Ctrl+K).
 *
 * Navigation entries the user can't access are filtered out — the palette must
 * not become a directory of pages that 403.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-9 w-9 justify-center p-0 text-muted-foreground sm:w-56 sm:justify-start sm:px-3"
        aria-label="Search or jump to a page"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Command palette"
        description="Search for a page or run a command"
      >
        <CommandInput placeholder="Search pages and commands…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {navigation.map((group) => (
            <CommandGroup key={group.label} heading={group.label}>
              {group.items.map((item) => (
                <PaletteNavItem
                  key={item.href}
                  item={item}
                  onSelect={() => run(() => router.push(item.href))}
                />
              ))}
            </CommandGroup>
          ))}

          <CommandSeparator />

          <CommandGroup heading="Theme">
            <CommandItem onSelect={() => run(() => setTheme("light"))}>
              <Sun className="size-4" aria-hidden />
              Light theme
            </CommandItem>
            <CommandItem onSelect={() => run(() => setTheme("dark"))}>
              <Moon className="size-4" aria-hidden />
              Dark theme
            </CommandItem>
            <CommandItem onSelect={() => run(() => setTheme("system"))}>
              <Monitor className="size-4" aria-hidden />
              System theme
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

function PaletteNavItem({
  item,
  onSelect,
}: {
  item: NavItem;
  onSelect: () => void;
}) {
  const allowed = useHasPermissionKey(item.permission ?? null);

  if (!allowed) return null;

  const Icon = item.icon;

  return (
    <CommandItem
      value={`${item.title} ${item.description}`}
      onSelect={onSelect}
    >
      <Icon className="size-4" aria-hidden />
      <span>{item.title}</span>
      <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:inline">
        {item.description}
      </span>
    </CommandItem>
  );
}
