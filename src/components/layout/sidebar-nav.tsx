"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useHasPermissionKey } from "@/modules/rbac/permission-provider";

import { isNavItemActive, navigation, type NavItem } from "./nav-config";

/**
 * The navigation list itself, shared by the desktop rail and the mobile drawer.
 *
 * `collapsed` renders an icon-only rail (tablet). Labels stay in the DOM as
 * `sr-only` text so the links remain announceable, with a `title` for sighted
 * users on hover.
 */
export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {navigation.map((group) => (
        <NavGroupSection
          key={group.label}
          label={group.label}
          items={group.items}
          pathname={pathname}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

function NavGroupSection({
  label,
  items,
  pathname,
  collapsed,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div>
      <h2
        className={cn(
          "px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase",
          collapsed && "sr-only",
        )}
      >
        {label}
      </h2>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isNavItemActive(item, pathname)}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </div>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  // Hooks can't be called conditionally, so every item resolves a key; ungated
  // items pass `null` and are always shown.
  const allowed = useHasPermissionKey(item.permission ?? null);

  if (!allowed) return null;

  const Icon = item.icon;

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.title : undefined}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
          collapsed && "justify-center px-2",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className={cn(collapsed && "sr-only")}>{item.title}</span>
      </Link>
    </li>
  );
}
