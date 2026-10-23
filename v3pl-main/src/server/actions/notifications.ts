"use server";

import { requireRole } from "@/server/auth/guards";
import { listNotifications, markAllNotificationsRead, markNotificationRead, unreadCount } from "@/server/services/notifications";
import { fail, ok, type ActionResult } from "@/server/actions/action-result";

/** ADMIN only (D-075): the feed is for administrators; vendor / 3PL / affiliate sessions are refused by the guard. */
export async function listNotificationsAction(): Promise<ActionResult<Awaited<ReturnType<typeof listNotifications>>>> {
  await requireRole("ADMIN");
  try {
    return ok(await listNotifications());
  } catch {
    return fail("Could not load notifications.");
  }
}

export async function unreadCountAction(): Promise<ActionResult<{ unread: number }>> {
  await requireRole("ADMIN");
  try {
    return ok({ unread: await unreadCount() });
  } catch {
    return fail("Could not load notifications.");
  }
}

export async function markNotificationReadAction(id: string): Promise<ActionResult<{ unread: number }>> {
  await requireRole("ADMIN");
  try {
    await markNotificationRead(id);
    return ok({ unread: await unreadCount() });
  } catch {
    return fail("Could not update the notification.");
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult<{ marked: number }>> {
  await requireRole("ADMIN");
  try {
    return ok({ marked: await markAllNotificationsRead() });
  } catch {
    return fail("Could not update notifications.");
  }
}
