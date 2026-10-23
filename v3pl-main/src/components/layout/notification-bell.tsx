"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Bell, Check, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction, unreadCountAction } from "@/server/actions/notifications";

type Item = { id: string; type: string; title: string; message: string; href: string | null; readAt: Date | null; createdAt: Date };

/**
 * Admin notification bell (D-075): sits beside the V3PL brand in the admin sidebar (desktop) and in the mobile header,
 * so it never overlaps page controls (ADMIN sessions only — the layout renders it for that role and every action re-checks the role). Unread count loads once on mount; the list loads on open
 * (refresh-on-open, no polling).
 */
export function NotificationBell() {
  const [unread, setUnread] = useState<number | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void unreadCountAction().then((r) => {
      if (r.ok) setUnread(r.data.unread);
    });
  }, []);

  function load() {
    startTransition(async () => {
      const r = await listNotificationsAction();
      if (r.ok) {
        setItems(r.data.items);
        setUnread(r.data.unread);
      }
    });
  }

  function markOne(id: string) {
    startTransition(async () => {
      const r = await markNotificationReadAction(id);
      if (r.ok) {
        setUnread(r.data.unread);
        setItems((list) => list?.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date() } : n)) ?? null);
      }
    });
  }

  function markAll() {
    startTransition(async () => {
      const r = await markAllNotificationsReadAction();
      if (r.ok) {
        setUnread(0);
        setItems((list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? new Date() })) ?? null);
      }
    });
  }

  return (
    <div className="shrink-0" data-slot="notification-bell">
      <DropdownMenu
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) load();
        }}
      >
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} className="relative text-inherit hover:bg-sidebar-accent hover:text-inherit" />}>
          <Bell />
          {!!unread && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white" data-slot="notification-unread">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="w-[380px] max-w-[calc(100vw-2rem)] p-0">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <Button variant="ghost" size="sm" onClick={markAll} disabled={pending || !unread}>
              <CheckCheck /> Mark all read
            </Button>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            {items === null ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet. New orders, shipments, returns, stock adjustments and account changes will appear here.</p>
            ) : (
              <ul className="divide-y">
                {items.map((n) => {
                  const body = (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <span className={cn("text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                    </>
                  );
                  return (
                    <li key={n.id} className={cn("flex gap-2 px-3 py-2", !n.readAt && "bg-accent/40")} data-notification-read={n.readAt ? "1" : "0"}>
                      {n.href ? (
                        <Link
                          href={n.href}
                          className="min-w-0 flex-1 rounded-md hover:underline"
                          onClick={() => {
                            if (!n.readAt) markOne(n.id);
                            setOpen(false);
                          }}
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="min-w-0 flex-1">{body}</div>
                      )}
                      {!n.readAt && (
                        <Button variant="ghost" size="icon-xs" aria-label="Mark as read" disabled={pending} onClick={() => markOne(n.id)}>
                          <Check />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
