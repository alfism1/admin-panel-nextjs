import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  hint?: string;
  /** Percentage change vs. the previous period. Sign drives the arrow. */
  trend?: { value: number; label: string };
  /**
   * Which direction is *good*. Falling error counts are positive news; the
   * colour has to follow the meaning, not the sign.
   */
  trendPolarity?: "up-is-good" | "down-is-good";
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  trend,
  trendPolarity = "up-is-good",
  className,
}: StatCardProps) {
  const rising = trend ? trend.value >= 0 : false;
  const good = trendPolarity === "up-is-good" ? rising : !rising;
  const TrendIcon = rising ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className={className}>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>

          {trend ? (
            <p
              className={cn(
                "flex items-center gap-1 text-xs font-medium",
                good
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive",
              )}
            >
              <TrendIcon className="size-3" aria-hidden />
              {/* The sign is already carried by the arrow and the colour. */}
              {Math.abs(trend.value)}%
              <span className="font-normal text-muted-foreground">
                {trend.label}
              </span>
            </p>
          ) : hint ? (
            <p className="text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>

        {Icon ? (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="w-full space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="size-9 rounded-lg" />
      </CardContent>
    </Card>
  );
}
