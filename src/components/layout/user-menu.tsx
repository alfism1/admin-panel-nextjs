"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Settings, ShieldOff, User } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

export interface UserMenuProps {
  name: string;
  email: string;
  image?: string | null;
  roleLabels: string[];
  isImpersonating: boolean;
}

export function UserMenu({
  name,
  email,
  image,
  roleLabels,
  isImpersonating,
}: UserMenuProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  async function stopImpersonating() {
    setPending(true);
    const { error } = await authClient.admin.stopImpersonating();
    setPending(false);
    if (error) {
      toast.error(error.message ?? "Could not end the impersonation session.");
      return;
    }
    toast.success("Impersonation ended.");
    router.push("/users");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="size-9 rounded-full p-0"
          aria-label={`Account menu for ${name}`}
        >
          <Avatar className="size-9">
            {image ? <AvatarImage src={image} alt="" /> : null}
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
          {roleLabels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {roleLabels.map((role) => (
                <Badge key={role} variant="secondary" className="text-[10px]">
                  {role}
                </Badge>
              ))}
            </div>
          ) : null}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <User className="size-4" aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="size-4" aria-hidden />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {isImpersonating ? (
          <DropdownMenuItem
            disabled={pending}
            onSelect={() => void stopImpersonating()}
          >
            <ShieldOff className="size-4" aria-hidden />
            Stop impersonating
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={pending}
            onSelect={() => void signOut()}
            variant="destructive"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((part) => part.charAt(0)).join("");
  return letters.toUpperCase() || "?";
}
