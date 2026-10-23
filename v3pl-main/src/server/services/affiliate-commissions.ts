import type { CommissionType, OrderStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Affiliate commission records (D-070). Kept apart from `orders.ts` so the order service can call the
 * lifecycle sync without a circular import, and apart from vendor / 3PL finance entirely: commissions
 * never touch `LedgerEntry`, product value, payables, receivables or charges.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CommissionRule = { type: CommissionType; value: number; source: "AFFILIATE_DEFAULT" | "VARIANT" };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure calculation. `lineTotal` = quantity × unit price − discount (never negative). */
export function computeCommission(rule: CommissionRule, line: { quantity: number; unitPrice: number | null; discount?: number | null }) {
  const lineTotal = Math.max(0, line.quantity * (line.unitPrice ?? 0) - (line.discount ?? 0));
  switch (rule.type) {
    case "PERCENTAGE_OF_SALE":
      return { amount: round2((lineTotal * rule.value) / 100), baseAmount: round2(lineTotal), quantity: line.quantity };
    case "FIXED_PER_UNIT":
      return { amount: round2(line.quantity * rule.value), baseAmount: null, quantity: line.quantity };
    case "FIXED_PER_ORDER":
      return { amount: round2(rule.value), baseAmount: null, quantity: null };
  }
}

/**
 * Snapshot commissions for a freshly created affiliate order: one record per line (variant rule, else the
 * affiliate default when it is per line) plus one per-order record when the default is FIXED_PER_ORDER.
 * Idempotent through `dedupeKey`, so re-running for the same order writes nothing new.
 */
export async function recordOrderCommissions(db: Db, orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      currency: true,
      affiliateId: true,
      affiliate: { select: { commissionType: true, commissionValue: true } },
      items: { select: { id: true, variantId: true, quantity: true, cancelledQty: true, unitPrice: true, discount: true } },
    },
  });
  if (!order?.affiliateId || !order.affiliate) return [];
  const rules = await db.affiliateVariant.findMany({ where: { affiliateId: order.affiliateId, variantId: { in: order.items.map((i) => i.variantId) } }, select: { variantId: true, commissionType: true, commissionValue: true } });
  const byVariant = new Map(rules.map((r) => [r.variantId, r]));
  const fallback: CommissionRule | null = order.affiliate.commissionType && order.affiliate.commissionValue !== null ? { type: order.affiliate.commissionType, value: Number(order.affiliate.commissionValue), source: "AFFILIATE_DEFAULT" } : null;
  const rows: Prisma.AffiliateCommissionCreateManyInput[] = [];
  for (const item of order.items) {
    const specific = byVariant.get(item.variantId);
    const rule: CommissionRule | null = specific?.commissionType && specific.commissionValue !== null ? { type: specific.commissionType, value: Number(specific.commissionValue), source: "VARIANT" } : fallback && fallback.type !== "FIXED_PER_ORDER" ? fallback : null;
    if (!rule) continue;
    const calc = computeCommission(rule, { quantity: item.quantity - item.cancelledQty, unitPrice: item.unitPrice === null ? null : Number(item.unitPrice), discount: item.discount === null ? null : Number(item.discount) });
    rows.push({ affiliateId: order.affiliateId, orderId: order.id, orderItemId: item.id, type: rule.type, rateValue: rule.value, ruleSource: rule.source, baseAmount: calc.baseAmount, quantity: calc.quantity, amount: calc.amount, currency: order.currency, dedupeKey: `commission:${order.id}:item:${item.id}` });
  }
  if (fallback?.type === "FIXED_PER_ORDER") {
    const calc = computeCommission(fallback, { quantity: 1, unitPrice: null });
    rows.push({ affiliateId: order.affiliateId, orderId: order.id, orderItemId: null, type: fallback.type, rateValue: fallback.value, ruleSource: fallback.source, baseAmount: null, quantity: null, amount: calc.amount, currency: order.currency, dedupeKey: `commission:${order.id}:order` });
  }
  if (rows.length) await db.affiliateCommission.createMany({ data: rows, skipDuplicates: true });
  return rows;
}

/**
 * Lifecycle sync, called by the order service after every status recompute:
 * - order CANCELLED → every unpaid commission CANCELLED;
 * - order COMPLETED → line commissions of fully cancelled lines CANCELLED, all other PENDING → EARNED
 *   (a shipped order counts as earned; PAID is never touched).
 */
export async function syncOrderCommissions(db: Db, orderId: string, status: OrderStatus) {
  if (status !== "CANCELLED" && status !== "COMPLETED") return;
  const now = new Date();
  if (status === "CANCELLED") {
    await db.affiliateCommission.updateMany({ where: { orderId, status: { in: ["PENDING", "EARNED"] } }, data: { status: "CANCELLED", cancelledAt: now } });
    return;
  }
  const items = await db.orderItem.findMany({ where: { orderId }, select: { id: true, quantity: true, cancelledQty: true } });
  const dead = items.filter((i) => i.cancelledQty >= i.quantity).map((i) => i.id);
  if (dead.length) await db.affiliateCommission.updateMany({ where: { orderId, orderItemId: { in: dead }, status: { in: ["PENDING", "EARNED"] } }, data: { status: "CANCELLED", cancelledAt: now } });
  await db.affiliateCommission.updateMany({ where: { orderId, status: "PENDING" }, data: { status: "EARNED", earnedAt: now } });
}
