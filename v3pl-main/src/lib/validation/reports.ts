import { z } from "zod";

export const REPORT_TYPES = ["activity", "orders", "sales", "fulfillment", "shipments", "returns", "inventory", "movements", "owner-activity"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** Tabs a vendor / 3PL portal may open: everything except the cross-owner Owner activity report (ADMIN only). */
export const PORTAL_REPORT_TYPES = REPORT_TYPES.filter((r) => r !== "owner-activity") as readonly ReportType[];
export const ADMIN_ONLY_REPORT_TYPES: readonly ReportType[] = ["owner-activity"];

/** Movement types for the Movements report / CSV type filter (matches `InventoryTransactionType`). */
export const MOVEMENT_TYPES = ["RECEIVE", "SHIP", "RETURN", "DAMAGE", "MISSING", "ADJUSTMENT", "TRANSFER_OUT", "TRANSFER_IN", "MOVE", "RESERVE", "RELEASE"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = { RECEIVE: "Receiving", SHIP: "Shipping", RETURN: "Returns", DAMAGE: "Damage", MISSING: "Missing", ADJUSTMENT: "Adjustment", TRANSFER_OUT: "Transfer out", TRANSFER_IN: "Transfer in", MOVE: "Move (bin to bin)", RESERVE: "Reserve", RELEASE: "Release" };

const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional();

/** Shared report filters; `ownerId` is honoured for staff only (portal scope comes from the session). */
export const reportQuerySchema = z.object({
  report: z.enum(REPORT_TYPES).default("activity"),
  from: isoDate,
  to: isoDate,
  warehouseId: z.string().trim().optional(),
  ownerId: z.string().trim().optional(),
  /** Shipments / returns status, or the movement type for the Movements report. */
  status: z.string().trim().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  /** Download format for /api/reports (REP-09); pages ignore it. */
  format: z.enum(["csv", "xlsx"]).default("csv"),
});
export type ReportQuery = z.output<typeof reportQuerySchema>;

/** Convert the parsed query into a service scope (inclusive end of day for `to`). */
export function scopeFromQuery(q: { from?: string; to?: string; warehouseId?: string }, ownerId?: string) {
  return {
    ownerId,
    warehouseId: q.warehouseId || undefined,
    from: q.from ? new Date(`${q.from}T00:00:00.000Z`) : undefined,
    to: q.to ? new Date(`${q.to}T23:59:59.999Z`) : undefined,
  };
}

/** The movement type a `status` query value selects, or undefined for "all". */
export function movementTypeFromQuery(status: string | undefined): MovementType | undefined {
  return status && (MOVEMENT_TYPES as readonly string[]).includes(status) ? (status as MovementType) : undefined;
}

export const REPORT_LABELS: Record<ReportType, { title: string; description: string }> = {
  activity: { title: "SKU activity", description: "Units received, shipped, returned, damaged, missing and adjusted per SKU in the period, with current stock." },
  orders: { title: "Orders summary", description: "Order counts by status and source, and units ordered, shipped, cancelled and returned in the period." },
  sales: { title: "Sales", description: "Shipped order lines in the period by owner, source and currency: units, sales value, wholesale cost and gross margin. Informational only — computed per line, never from order totals." },
  fulfillment: { title: "Fulfilment", description: "Shipments in the period per warehouse: shipped, delivered, returned and cancelled, with median hours from order placed to shipped and from shipped to delivered." },
  shipments: { title: "Shipments", description: "Every shipment in the period with carrier, tracking and status." },
  returns: { title: "Returns", description: "Returns received in the period and their inspection outcome." },
  inventory: { title: "Inventory snapshot", description: "Current stock per SKU and warehouse (not affected by the date range)." },
  movements: { title: "Movements", description: "Every stock movement in the period — receiving, shipping, returns, damage, missing, adjustments, transfers — filterable by type and downloadable as CSV." },
  "owner-activity": { title: "Owner activity", description: "One row per vendor and 3PL client: units received, shipped, returned and damaged in the period, charges raised in the period, and the current payable and receivable balances." },
};
