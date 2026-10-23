"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Longest stagger on a dashboard row; later tiles share the last slot so the whole row lands within ~0.6 s. */
const MAX_STAGGER_INDEX = 6;
const STAGGER_MS = 60;
export const COUNT_UP_MS = 700;

/** Eased value between 0 and `target` for progress p ∈ [0, 1] (ease-out cubic), integer-rounded and monotonic. */
export function countUpValue(progress: number, target: number): number {
  const p = Math.min(1, Math.max(0, progress));
  const eased = 1 - Math.pow(1 - p, 3);
  return Math.round(target * eased);
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts an integer up from 0 to `value` once on mount (~0.7 s, requestAnimationFrame). Server HTML and the
 * reduced-motion path show the final value immediately; the displayed number is never anything but `value`
 * once the animation ends. Purely presentational — the value itself comes from the server component.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    // State starts at the final value, so these cases simply keep it.
    if (!Number.isFinite(value) || value === 0 || reducedMotion()) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = (now - start) / COUNT_UP_MS;
      setShown(countUpValue(p, value));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span className={className} data-slot="count-up" data-final={shown === value ? "1" : "0"}>
      {formatInt(shown)}
    </span>
  );
}

export type StatTileProps = {
  label: string;
  /** Integer metric: counts up once. */
  value?: number;
  /** Pre-formatted metric (money, ratios): shown as-is, no count-up. */
  display?: string;
  hint?: React.ReactNode;
  href: string;
  /** Rendered icon element (server components pass `<Icon className="…" />`). */
  icon: React.ReactNode;
  /** Position in its row → entrance stagger. */
  index: number;
  className?: string;
};

/**
 * Dashboard metric tile (UI-15): short fade + 8 px rise on entry, staggered per tile, plus a subtle lift and
 * ring on hover / keyboard focus. `fill-mode-both` keeps the first frame invisible without reserving less
 * space (no layout shift); `motion-reduce:animate-none` shows the tile immediately for reduced-motion users.
 */
export function StatTile({ label, value, display, hint, href, icon, index, className }: StatTileProps) {
  return (
    <Link href={href} className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background" data-slot="stat-tile">
      <Card
        className={cn(
          "animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500 motion-reduce:animate-none",
          "transition-[transform,box-shadow,--tw-ring-color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:ring-foreground/25 group-hover:shadow-sm group-focus-visible:ring-foreground/25 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0",
          className,
        )}
        style={{ animationDelay: `${Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS}ms` }}
      >
        <CardContent className="flex items-center justify-between pt-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold tabular-nums">{display ?? <CountUp value={value ?? 0} />}</p>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          <span className="shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100">{icon}</span>
        </CardContent>
      </Card>
    </Link>
  );
}
