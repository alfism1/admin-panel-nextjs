"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Confirmation dialog for destructive or irreversible actions.
 *
 * Built on Radix's AlertDialog, so focus is trapped, Escape cancels, and the
 * cancel button is the default focus target — a stray Enter dismisses rather
 * than confirms.
 *
 * `confirmPhrase` adds a type-to-confirm gate for the genuinely unrecoverable
 * (deleting a role that N users depend on). Use it sparingly: if everything
 * demands typing, people stop reading.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  confirmPhrase,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmPhrase?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [typed, setTyped] = useState("");

  const phraseSatisfied = !confirmPhrase || typed.trim() === confirmPhrase;

  async function confirm(event: React.MouseEvent) {
    // Keep the dialog mounted while the action runs so the spinner is visible
    // and a second click can't fire.
    event.preventDefault();
    if (!phraseSatisfied || pending) return;

    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
      setTyped("");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setTyped("");
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {description}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {confirmPhrase ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-phrase">
              Type{" "}
              <span className="font-mono font-medium">{confirmPhrase}</span> to
              continue
            </Label>
            <Input
              id="confirm-phrase"
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            disabled={pending || !phraseSatisfied}
            className={cn(
              destructive && buttonVariants({ variant: "destructive" }),
            )}
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Working…
              </>
            ) : (
              confirmLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
