import { Breadcrumbs } from "./breadcrumbs";
import { CommandPalette } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu, type UserMenuProps } from "./user-menu";

/**
 * Sticky top bar. A Server Component: only the interactive pieces inside it
 * (`MobileNav`, `CommandPalette`, `ThemeToggle`, `UserMenu`) ship JavaScript.
 *
 * Breadcrumbs are hidden below `sm` — at 375px the row is already carrying the
 * menu button, search and account menu.
 */
export function Topbar({ user }: { user: UserMenuProps }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
      <MobileNav />

      <div className="hidden min-w-0 flex-1 sm:block">
        <Breadcrumbs />
      </div>

      <div className="flex flex-1 items-center justify-end gap-1 sm:flex-none sm:gap-2">
        <CommandPalette />
        <ThemeToggle />
        <UserMenu {...user} />
      </div>
    </header>
  );
}
