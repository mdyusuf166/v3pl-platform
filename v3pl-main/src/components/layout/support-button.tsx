"use client";

import { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SupportDestination } from "@/lib/validation/support";

const FIRST_PEEK_MS = 4_000;
const PEEK_VISIBLE_MS = 4_500;
const PEEK_EVERY_MS = 60_000;

/**
 * Floating Help/Support button (SUP-01) for non-admin portals. Compact icon; a small text panel slides out
 * occasionally (once shortly after load, then about once a minute) and slides back, or stays out on hover /
 * focus. With `prefers-reduced-motion` nothing moves on its own — the panel only appears on hover / focus.
 * Renders nothing when `destination` is null (support disabled or not configured), so there is never a dead link.
 */
export function SupportButton({ destination }: { destination: SupportDestination | null }) {
  const [peek, setPeek] = useState(false);

  useEffect(() => {
    if (!destination) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      setPeek(true);
      hide = setTimeout(() => setPeek(false), PEEK_VISIBLE_MS);
    };
    const first = setTimeout(show, FIRST_PEEK_MS);
    const every = setInterval(show, PEEK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      if (hide) clearTimeout(hide);
    };
  }, [destination]);

  if (!destination) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex justify-end print:hidden" data-slot="support-button">
      <a
        href={destination.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Need help? ${destination.label}`}
        className={cn(
          "group pointer-events-auto flex h-11 items-center gap-2 rounded-full bg-primary pl-3 pr-3 text-primary-foreground shadow-lg ring-1 ring-black/5",
          "transition-shadow hover:shadow-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
        data-peek={peek ? "1" : "0"}
      >
        <LifeBuoy className="size-5 shrink-0" aria-hidden />
        <span
          className={cn(
            "max-w-0 overflow-hidden whitespace-nowrap text-sm font-medium opacity-0 transition-[max-width,opacity] duration-500 ease-out motion-reduce:transition-none",
            "group-hover:max-w-[16rem] group-hover:opacity-100 group-focus-visible:max-w-[16rem] group-focus-visible:opacity-100",
            peek && "max-w-[16rem] opacity-100",
          )}
        >
          Need help? Reach support
        </span>
      </a>
    </div>
  );
}
