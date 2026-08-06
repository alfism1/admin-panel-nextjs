import {
  Flag,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { PermissionKey } from "@/lib/permissions";
import { resources } from "@/lib/resource/registry";

/**
 * The single source of truth for dashboard navigation.
 *
 * Sidebar, mobile drawer, command palette and breadcrumbs all read this array,
 * so a new section appears in four places by adding one entry. `permission`
 * hides the link from users who can't use the page — the page itself still
 * enforces the same check server-side.
 */
export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
  /** Hidden unless the user holds this permission. `undefined` = always shown. */
  permission?: PermissionKey;
  /** Match child routes too (`/users/123` highlights `/users`). */
  matchNested?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Navigation contributed by the resource registry.
 *
 * A registered resource with a `nav` block appears in the sidebar, mobile
 * drawer, command palette and breadcrumbs without touching this file. Groups
 * are merged by label, so a resource can join an existing section by naming it.
 */
const resourceGroups: NavGroup[] = [];

for (const resource of resources) {
  if (!resource.nav) continue;

  const item: NavItem = {
    title: resource.pluralLabel,
    href: resource.route,
    icon: resource.icon,
    description: resource.nav.description,
    permission: `${resource.name}:read` as PermissionKey,
    matchNested: true, // /products/123 highlights /products
  };

  const existing = resourceGroups.find(
    (group) => group.label === resource.nav!.group,
  );
  if (existing) existing.items.push(item);
  else resourceGroups.push({ label: resource.nav.group, items: [item] });
}

const staticNavigation: NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        title: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
        description: "Activity and system health at a glance",
      },
    ],
  },
  {
    label: "Access",
    items: [
      {
        title: "Users",
        href: "/users",
        icon: Users,
        description: "Invite, edit, ban and assign roles",
        permission: "user:read",
        matchNested: true,
      },
      {
        title: "Roles",
        href: "/roles",
        icon: ShieldCheck,
        description: "Define roles and their permission matrix",
        permission: "role:read",
        matchNested: true,
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        title: "Audit logs",
        href: "/audit-logs",
        icon: ScrollText,
        description: "Every mutation, who made it, and what changed",
        permission: "auditLog:read",
        matchNested: true,
      },
      {
        title: "Feature flags",
        href: "/feature-flags",
        icon: Flag,
        description: "Toggle behaviour without a redeploy",
        permission: "featureFlag:read",
        matchNested: true,
      },
    ],
  },
  {
    label: "Account",
    items: [
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
        description: "Profile, password, two-factor and sessions",
        matchNested: true,
      },
    ],
  },
];

/**
 * Static groups first, then resource groups — except where a resource names an
 * existing group, in which case its items join that one in place.
 */
export const navigation: NavGroup[] = [
  ...staticNavigation.map((group) => {
    const contributed = resourceGroups.find(
      (candidate) => candidate.label === group.label,
    );
    return contributed
      ? { ...group, items: [...group.items, ...contributed.items] }
      : group;
  }),
  ...resourceGroups.filter(
    (group) =>
      !staticNavigation.some((candidate) => candidate.label === group.label),
  ),
];

/** Flattened, for the command palette and breadcrumb lookup. */
export const allNavItems: NavItem[] = navigation.flatMap(
  (group) => group.items,
);

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  if (item.matchNested) {
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  return pathname === item.href;
}
