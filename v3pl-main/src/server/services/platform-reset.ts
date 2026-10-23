// No `server-only` import: shared with the targeted test script. Never import from client components.
import type { Prisma } from "@/generated/prisma/client";
import { PORTAL_ROLES } from "@/lib/roles";
import { recordAudit } from "@/server/services/audit";

/**
 * HARD RESET PLATFORM (D-076). Removes every business / test record so an ADMIN can start fresh during
 * development. Runs inside the caller's transaction, children before parents, in the order the Prisma
 * relations (mostly `onDelete: Restrict`) require — never a blind "truncate every table".
 *
 * Kept: schema + migrations, AuditLog (append-only foundation; the reset itself is recorded there),
 * staff users (ADMIN / WAREHOUSE / SALES — the acting admin is asserted to survive), environment / secrets.
 * Removed: everything listed in RESET_GROUPS. Local Shopify connection rows are deleted; data inside the
 * Shopify stores themselves is untouched (external system).
 */

export const PLATFORM_RESET_PHRASE = "RESET V3PL";

/** Human-readable scope, in deletion order, for the Danger Zone page and the report. */
export const RESET_GROUPS = [
  "Admin notifications",
  "Salesman commissions, product / partner assignments",
  "Finance: ledger entries, charges, charge rules",
  "Shopify: outbound jobs, sync logs, webhook events, variant mappings, warehouse links, store connections (local records only)",
  "Inventory movements and order events",
  "Returns",
  "Shipments and fulfillments",
  "Orders, order lines and customers",
  "Transfers and receiving records",
  "Inventory levels and balances",
  "Products, variants and images",
  "Warehouse locations (bins → shelves → racks → zones → areas) and warehouses",
  "Vendor / 3PL / salesman portal users",
  "Salesmen, vendors and 3PL clients",
  "CSV import jobs",
] as const;

export type ResetCounts = Record<string, number>;

export class PlatformResetError extends Error {
  constructor(
    public readonly code: "ADMIN_MISSING" | "BAD_PHRASE",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Executes the reset inside `tx`. Throws PlatformResetError("ADMIN_MISSING") — rolling the whole
 * transaction back — if the acting admin is not an ACTIVE ADMIN row at the end.
 */
export async function hardResetPlatform(tx: Prisma.TransactionClient, adminUserId: string): Promise<ResetCounts> {
  const counts: ResetCounts = {};
  const del = async (name: string, run: () => Promise<{ count: number }>) => {
    counts[name] = (counts[name] ?? 0) + (await run()).count;
  };

  await del("adminNotification", () => tx.adminNotification.deleteMany());

  await del("affiliateCommission", () => tx.affiliateCommission.deleteMany());
  await del("affiliateVariant", () => tx.affiliateVariant.deleteMany());
  await del("affiliateOwner", () => tx.affiliateOwner.deleteMany());

  await del("ledgerEntry", () => tx.ledgerEntry.deleteMany());
  await del("charge", () => tx.charge.deleteMany());
  await del("chargeRule", () => tx.chargeRule.deleteMany());

  await del("shopifyOutboundJob", () => tx.shopifyOutboundJob.deleteMany());
  await del("shopifySyncLog", () => tx.shopifySyncLog.deleteMany());
  await del("shopifyWebhookEvent", () => tx.shopifyWebhookEvent.deleteMany());
  await del("shopifyVariantMapping", () => tx.shopifyVariantMapping.deleteMany());
  await del("shopifyStoreWarehouse", () => tx.shopifyStoreWarehouse.deleteMany());
  await del("shopifyStore", () => tx.shopifyStore.deleteMany());

  // Movements reference shipments, receiving, transfers, orders and locations: clear them before any of those.
  await del("inventoryTransaction", () => tx.inventoryTransaction.deleteMany());
  await del("orderEvent", () => tx.orderEvent.deleteMany());

  await del("returnItem", () => tx.returnItem.deleteMany());
  await del("return", () => tx.return.deleteMany());

  await del("shipmentItem", () => tx.shipmentItem.deleteMany());
  await del("shipment", () => tx.shipment.deleteMany());
  await del("fulfillmentItem", () => tx.fulfillmentItem.deleteMany());
  await del("fulfillment", () => tx.fulfillment.deleteMany());

  await del("orderItem", () => tx.orderItem.deleteMany());
  await del("order", () => tx.order.deleteMany());
  await del("customer", () => tx.customer.deleteMany());

  await del("transferItem", () => tx.transferItem.deleteMany());
  await del("transfer", () => tx.transfer.deleteMany());
  await del("receivingItem", () => tx.receivingItem.deleteMany());
  await del("receivingRecord", () => tx.receivingRecord.deleteMany());

  await del("inventoryLevel", () => tx.inventoryLevel.deleteMany());
  await del("inventoryBalance", () => tx.inventoryBalance.deleteMany());

  await del("productImage", () => tx.productImage.deleteMany());
  await del("productVariant", () => tx.productVariant.deleteMany());
  await del("product", () => tx.product.deleteMany());

  // Location tree is self-referencing with Restrict: leaves first (D-069 levels), then flat areas.
  for (const type of ["BIN", "SHELF", "RACK", "ZONE", "AREA"] as const) {
    await del("location", () => tx.location.deleteMany({ where: { type } }));
  }
  await del("warehouse", () => tx.warehouse.deleteMany());

  // Portal users must go before their owner / affiliate (Restrict). Staff rows are kept.
  await del("portalUser", () => tx.user.deleteMany({ where: { role: { in: [...PORTAL_ROLES] } } }));
  await del("affiliate", () => tx.affiliate.deleteMany());
  await del("owner", () => tx.owner.deleteMany());

  await del("importJob", () => tx.importJob.deleteMany());

  const admin = await tx.user.findUnique({ where: { id: adminUserId }, select: { role: true, status: true } });
  if (!admin || admin.role !== "ADMIN" || admin.status !== "ACTIVE") {
    throw new PlatformResetError("ADMIN_MISSING", "The acting admin account would not survive the reset; nothing was changed.");
  }

  await recordAudit({ userId: adminUserId, action: "platform.hard_reset", entityType: "Platform", entityId: null, metadata: { counts } }, tx);
  return counts;
}

/** Total rows removed, for the success message. */
export function totalRemoved(counts: ResetCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
