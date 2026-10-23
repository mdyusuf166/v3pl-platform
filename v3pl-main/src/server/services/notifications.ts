import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Admin in-app notifications (D-075). `notify` is idempotent (unique `dedupeKey`, duplicates skipped) and never
 * throws into business flows. Called at existing event points only — no generic event framework.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type NotificationType = "ORDER_CREATED" | "ORDER_COMPLETED" | "ORDER_CANCELLED" | "SHIPMENT_STATUS" | "SHIPMENT_DELIVERED" | "RETURN_RECEIVED" | "RETURN_INSPECTED" | "INVENTORY_ADJUSTED" | "INVENTORY_DAMAGE_MISSING" | "ACCOUNT_CREATED" | "COMMISSION_EARNED" | "SHOPIFY_FAILURE";

export type NotifyInput = { type: NotificationType; title: string; message: string; href?: string | null; dedupeKey: string };

export async function notify(db: Db, input: NotifyInput): Promise<boolean> {
  try {
    const r = await db.adminNotification.createMany({ data: [{ type: input.type, title: input.title.slice(0, 200), message: input.message.slice(0, 1000), href: input.href ?? null, dedupeKey: input.dedupeKey }], skipDuplicates: true });
    return r.count > 0;
  } catch (err) {
    console.error("[notifications] ignored:", (err as Error).message);
    return false;
  }
}

export const NOTIFICATION_PAGE = 20;

export async function listNotifications(limit = NOTIFICATION_PAGE) {
  const [items, unread] = await Promise.all([
    prisma.adminNotification.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, type: true, title: true, message: true, href: true, readAt: true, createdAt: true } }),
    prisma.adminNotification.count({ where: { readAt: null } }),
  ]);
  return { items, unread };
}

export async function unreadCount() {
  return prisma.adminNotification.count({ where: { readAt: null } });
}

export async function markNotificationRead(id: string) {
  const r = await prisma.adminNotification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });
  return r.count;
}

export async function markAllNotificationsRead() {
  const r = await prisma.adminNotification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
  return r.count;
}
