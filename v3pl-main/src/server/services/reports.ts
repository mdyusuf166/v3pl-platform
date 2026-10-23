import { Prisma, type InventoryTransactionType } from "@/generated/prisma/client";
import { toCsv } from "@/lib/csv";
import { prisma } from "@/lib/prisma";
import { orderCounters } from "@/server/services/orders";
import { stockTotals } from "@/server/services/inventory";

/**
 * REPORTS (spec §48). Every figure is computed from the operational tables
 * (ledger, orders, shipments, returns) — nothing is stored or duplicated.
 *
 * Scope rules: `ownerId` in a ReportScope is set by the CALLER from the session for
 * portal users (never from a request parameter); admins may pass any owner or none.
 */

/** Headers + rows shared by the CSV and Excel exports (REP-09): one definition per report, two serialisations. */
export type ReportTable = { headers: string[]; rows: Array<Record<string, unknown>> };

export type ReportScope = {
  ownerId?: string;
  warehouseId?: string;
  from?: Date;
  to?: Date;
};

const dateRange = (s: ReportScope, field = "createdAt"): Record<string, { gte?: Date; lte?: Date }> | Record<string, never> =>
  s.from || s.to ? { [field]: { ...(s.from ? { gte: s.from } : {}), ...(s.to ? { lte: s.to } : {}) } } : {};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function portalDashboard(ownerId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [stock, counters, shipped30, received30, lost30, returnsAwaiting, byWarehouse, recentOrders, recentMovements, skuCount] = await Promise.all([
    stockTotals(ownerId),
    orderCounters(ownerId),
    prisma.inventoryTransaction.aggregate({ where: { ownerId, type: "SHIP", bucket: "ON_HAND", createdAt: { gte: since } }, _sum: { quantity: true } }),
    prisma.inventoryTransaction.aggregate({ where: { ownerId, type: "RECEIVE", createdAt: { gte: since } }, _sum: { quantity: true } }),
    prisma.inventoryTransaction.aggregate({ where: { ownerId, type: { in: ["DAMAGE", "MISSING"] }, createdAt: { gte: since } }, _sum: { quantity: true } }),
    prisma.return.count({ where: { status: "RECEIVED", items: { some: { ownerId } } } }),
    prisma.inventoryBalance.groupBy({ by: ["warehouseId"], where: { variant: { product: { ownerId } }, onHand: { gt: 0 } }, _sum: { onHand: true, reserved: true } }),
    prisma.order.findMany({
      where: { items: { some: { ownerId } } },
      orderBy: { placedAt: "desc" },
      take: 5,
      select: { id: true, orderNumber: true, status: true, fulfillmentStatus: true, placedAt: true, shipName: true, customerName: true, items: { where: { ownerId }, select: { quantity: true, cancelledQty: true, shippedQty: true, returnedQty: true } } },
    }),
    prisma.inventoryTransaction.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, type: true, bucket: true, quantity: true, createdAt: true, variant: { select: { sku: true } }, warehouse: { select: { code: true } } },
    }),
    prisma.productVariant.count({ where: { status: "ACTIVE", product: { ownerId, status: "ACTIVE" } } }),
  ]);
  const warehouses = byWarehouse.length ? await prisma.warehouse.findMany({ where: { id: { in: byWarehouse.map((w) => w.warehouseId) } }, select: { id: true, code: true, name: true, city: true, country: true } }) : [];
  return {
    stock,
    skuCount,
    counters,
    shippedUnits30d: Math.abs(shipped30._sum.quantity ?? 0),
    receivedUnits30d: received30._sum.quantity ?? 0,
    lostUnits30d: Math.abs(lost30._sum.quantity ?? 0),
    returnsAwaiting,
    byWarehouse: byWarehouse.map((w) => ({ ...(warehouses.find((x) => x.id === w.warehouseId) ?? { id: w.warehouseId, code: "?", name: "", city: null, country: null }), onHand: w._sum.onHand ?? 0, reserved: w._sum.reserved ?? 0, available: (w._sum.onHand ?? 0) - (w._sum.reserved ?? 0) })),
    recentOrders,
    recentMovements,
  };
}

// ---------------------------------------------------------------------------
// SKU activity
// ---------------------------------------------------------------------------

export type SkuActivityRow = {
  variantId: string;
  sku: string;
  product: string;
  variantName: string | null;
  owner: string;
  ownerCode: string;
  received: number;
  shipped: number;
  returned: number;
  damaged: number;
  missing: number;
  adjusted: number;
  transferred: number;
  onHand: number;
  reserved: number;
  available: number;
};

/** Per-SKU movement totals in the period + current stock. Sorted by shipped desc, then SKU. */
export async function skuActivityReport(scope: ReportScope): Promise<SkuActivityRow[]> {
  const where: Prisma.InventoryTransactionWhereInput = {
    bucket: "ON_HAND",
    ...(scope.ownerId ? { ownerId: scope.ownerId } : {}),
    ...(scope.warehouseId ? { warehouseId: scope.warehouseId } : {}),
    ...dateRange(scope),
  };
  const [movements, variants] = await Promise.all([
    prisma.inventoryTransaction.groupBy({ by: ["variantId", "type"], where, _sum: { quantity: true } }),
    prisma.productVariant.findMany({
      where: { ...(scope.ownerId ? { product: { ownerId: scope.ownerId } } : {}), OR: [{ status: "ACTIVE" }, { balances: { some: { onHand: { gt: 0 } } } }] },
      select: { id: true, sku: true, name: true, product: { select: { name: true, owner: { select: { code: true, businessName: true } } } }, balances: { where: scope.warehouseId ? { warehouseId: scope.warehouseId } : undefined, select: { onHand: true, reserved: true } } },
    }),
  ]);
  const byVariant = new Map<string, Record<string, number>>();
  for (const m of movements) {
    const row = byVariant.get(m.variantId) ?? {};
    row[m.type] = (row[m.type] ?? 0) + (m._sum.quantity ?? 0);
    byVariant.set(m.variantId, row);
  }
  const rows: SkuActivityRow[] = variants.map((v) => {
    const m = byVariant.get(v.id) ?? {};
    const onHand = v.balances.reduce((s, b) => s + b.onHand, 0);
    const reserved = v.balances.reduce((s, b) => s + b.reserved, 0);
    return {
      variantId: v.id,
      sku: v.sku,
      product: v.product.name,
      variantName: v.name,
      owner: v.product.owner.businessName,
      ownerCode: v.product.owner.code,
      received: m.RECEIVE ?? 0,
      shipped: Math.abs(m.SHIP ?? 0),
      returned: m.RETURN ?? 0,
      damaged: Math.abs(m.DAMAGE ?? 0),
      missing: Math.abs(m.MISSING ?? 0),
      adjusted: m.ADJUSTMENT ?? 0,
      transferred: (m.TRANSFER_IN ?? 0) + (m.TRANSFER_OUT ?? 0),
      onHand,
      reserved,
      available: onHand - reserved,
    };
  });
  // Include variants that only exist in movements (e.g. archived with history in period)
  return rows.sort((a, b) => b.shipped - a.shipped || a.sku.localeCompare(b.sku));
}

export function skuActivityTable(rows: SkuActivityRow[], includeOwner: boolean): ReportTable {
  const headers = [...(includeOwner ? ["Owner", "Owner Code"] : []), "SKU", "Product", "Variant", "Received", "Shipped", "Returned", "Damaged", "Missing", "Adjusted", "Transferred (net)", "On Hand", "Reserved", "Available"];
  return { headers, rows: rows.map((r) => ({ Owner: r.owner, "Owner Code": r.ownerCode, SKU: r.sku, Product: r.product, Variant: r.variantName ?? "", Received: r.received, Shipped: r.shipped, Returned: r.returned, Damaged: r.damaged, Missing: r.missing, Adjusted: r.adjusted, "Transferred (net)": r.transferred, "On Hand": r.onHand, Reserved: r.reserved, Available: r.available })) };
}

export function skuActivityCsv(rows: SkuActivityRow[], includeOwner: boolean): string {
  const t = skuActivityTable(rows, includeOwner);
  return toCsv(t.headers, t.rows);
}

// ---------------------------------------------------------------------------
// Orders summary
// ---------------------------------------------------------------------------

export async function ordersSummaryReport(scope: ReportScope) {
  const ownerLine = scope.ownerId ? { ownerId: scope.ownerId } : {};
  const orderWhere: Prisma.OrderWhereInput = {
    ...(scope.ownerId ? { items: { some: { ownerId: scope.ownerId } } } : {}),
    ...(scope.warehouseId ? { OR: [{ warehouseId: scope.warehouseId }, { items: { some: { warehouseId: scope.warehouseId } } }] } : {}),
    ...dateRange(scope, "placedAt"),
  };
  const [byStatus, byFulfillment, lines, bySource] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], where: orderWhere, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["fulfillmentStatus"], where: orderWhere, _count: { _all: true } }),
    prisma.orderItem.aggregate({ where: { ...ownerLine, order: orderWhere }, _sum: { quantity: true, shippedQty: true, cancelledQty: true, returnedQty: true, reservedQty: true }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["source"], where: orderWhere, _count: { _all: true } }),
  ]);
  const total = byStatus.reduce((s, r) => s + r._count._all, 0);
  return {
    totalOrders: total,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Record<string, number>,
    byFulfillment: Object.fromEntries(byFulfillment.map((r) => [r.fulfillmentStatus, r._count._all])) as Record<string, number>,
    bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count._all])) as Record<string, number>,
    lines: lines._count._all,
    units: { ordered: lines._sum.quantity ?? 0, shipped: lines._sum.shippedQty ?? 0, cancelled: lines._sum.cancelledQty ?? 0, returned: lines._sum.returnedQty ?? 0, reserved: lines._sum.reservedQty ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

export type ShipmentsReportParams = ReportScope & { status?: string; q?: string; page?: number; pageSize?: number };

export async function shipmentsReport(params: ShipmentsReportParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? 25;
  const where: Prisma.ShipmentWhereInput = {
    ...(params.ownerId ? { items: { some: { orderItem: { ownerId: params.ownerId } } } } : {}),
    ...(params.warehouseId ? { fulfillment: { warehouseId: params.warehouseId } } : {}),
    ...(params.status && params.status !== "ALL" ? { status: params.status as Prisma.EnumShipmentStatusFilter } : {}),
    ...dateRange(params, "shippedAt"),
    ...(params.q ? { OR: [{ trackingNumber: { contains: params.q, mode: "insensitive" } }, { carrier: { contains: params.q, mode: "insensitive" } }, { order: { orderNumber: { contains: params.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, items] = await prisma.$transaction([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where,
      orderBy: { shippedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        carrier: true,
        service: true,
        trackingNumber: true,
        trackingUrl: true,
        shippedAt: true,
        deliveredAt: true,
        order: { select: { id: true, orderNumber: true, shipName: true, shipCity: true, shipCountry: true, source: true } },
        fulfillment: { select: { warehouse: { select: { code: true } } } },
        items: { where: params.ownerId ? { orderItem: { ownerId: params.ownerId } } : undefined, select: { quantity: true, orderItem: { select: { sku: true, owner: { select: { businessName: true } } } } } },
      },
    }),
  ]);
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export function shipmentsTable(rows: Awaited<ReturnType<typeof shipmentsReport>>["items"], includeOwner: boolean): ReportTable {
  const headers = ["Order", "Shipped At", "Status", "Carrier", "Service", "Tracking Number", "Tracking URL", "Warehouse", "Ship To", "City", "Country", "SKU", "Quantity", ...(includeOwner ? ["Owner"] : [])];
  const out: Record<string, unknown>[] = [];
  for (const s of rows) {
    for (const it of s.items) {
      out.push({ Order: s.order.orderNumber, "Shipped At": s.shippedAt.toISOString(), Status: s.status, Carrier: s.carrier ?? "", Service: s.service ?? "", "Tracking Number": s.trackingNumber ?? "", "Tracking URL": s.trackingUrl ?? "", Warehouse: s.fulfillment.warehouse.code, "Ship To": s.order.shipName ?? "", City: s.order.shipCity ?? "", Country: s.order.shipCountry ?? "", SKU: it.orderItem.sku, Quantity: it.quantity, Owner: it.orderItem.owner.businessName });
    }
  }
  return { headers, rows: out };
}

export function shipmentsCsv(rows: Awaited<ReturnType<typeof shipmentsReport>>["items"], includeOwner: boolean): string {
  const t = shipmentsTable(rows, includeOwner);
  return toCsv(t.headers, t.rows);
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export type ReturnsReportParams = ReportScope & { status?: "RECEIVED" | "INSPECTED" | "ALL"; page?: number; pageSize?: number };

export async function returnsReport(params: ReturnsReportParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? 25;
  const where: Prisma.ReturnWhereInput = {
    ...(params.ownerId ? { items: { some: { ownerId: params.ownerId } } } : {}),
    ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
    ...(params.status && params.status !== "ALL" ? { status: params.status } : {}),
    ...dateRange(params, "receivedAt"),
  };
  const [total, items] = await prisma.$transaction([
    prisma.return.count({ where }),
    prisma.return.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        reference: true,
        reason: true,
        receivedAt: true,
        inspectedAt: true,
        order: { select: { id: true, orderNumber: true } },
        warehouse: { select: { code: true } },
        items: { where: params.ownerId ? { ownerId: params.ownerId } : undefined, select: { quantity: true, condition: true, orderItem: { select: { sku: true, owner: { select: { businessName: true } } } }, location: { select: { label: true } } } },
      },
    }),
  ]);
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export function returnsTable(rows: Awaited<ReturnType<typeof returnsReport>>["items"], includeOwner: boolean): ReportTable {
  const headers = ["Order", "Received At", "Inspected At", "Status", "Reference", "Reason", "Warehouse", "SKU", "Quantity", "Condition", "Location", ...(includeOwner ? ["Owner"] : [])];
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    for (const it of r.items) {
      out.push({ Order: r.order.orderNumber, "Received At": r.receivedAt.toISOString(), "Inspected At": r.inspectedAt?.toISOString() ?? "", Status: r.status, Reference: r.reference ?? "", Reason: r.reason ?? "", Warehouse: r.warehouse.code, SKU: it.orderItem.sku, Quantity: it.quantity, Condition: it.condition ?? "PENDING", Location: it.location?.label ?? "", Owner: it.orderItem.owner.businessName });
    }
  }
  return { headers, rows: out };
}

export function returnsCsv(rows: Awaited<ReturnType<typeof returnsReport>>["items"], includeOwner: boolean): string {
  const t = returnsTable(rows, includeOwner);
  return toCsv(t.headers, t.rows);
}

// ---------------------------------------------------------------------------
// Inventory snapshot (per SKU × warehouse) for CSV
// ---------------------------------------------------------------------------

export async function inventorySnapshotTable(scope: ReportScope, includeOwner: boolean): Promise<ReportTable> {
  const rows = await prisma.inventoryBalance.findMany({
    where: { ...(scope.ownerId ? { variant: { product: { ownerId: scope.ownerId } } } : {}), ...(scope.warehouseId ? { warehouseId: scope.warehouseId } : {}) },
    orderBy: [{ variant: { sku: "asc" } }, { warehouse: { code: "asc" } }],
    select: { onHand: true, reserved: true, warehouse: { select: { code: true } }, variant: { select: { sku: true, name: true, product: { select: { name: true, owner: { select: { code: true, businessName: true } } } } } } },
  });
  const headers = [...(includeOwner ? ["Owner", "Owner Code"] : []), "SKU", "Product", "Variant", "Warehouse", "On Hand", "Reserved", "Available"];
  return { headers, rows: rows.map((r) => ({ Owner: r.variant.product.owner.businessName, "Owner Code": r.variant.product.owner.code, SKU: r.variant.sku, Product: r.variant.product.name, Variant: r.variant.name ?? "", Warehouse: r.warehouse.code, "On Hand": r.onHand, Reserved: r.reserved, Available: r.onHand - r.reserved })) };
}

export async function inventorySnapshotCsv(scope: ReportScope, includeOwner: boolean): Promise<string> {
  const t = await inventorySnapshotTable(scope, includeOwner);
  return toCsv(t.headers, t.rows);
}

// ---------------------------------------------------------------------------
// Sales (REP-05): shipped lines by owner × source × currency. Aggregated in SQL so the line set is never loaded.
// Follows vendorGrossMargin: retail = order unit price, falling back to the variant's retail price; cost only for
// lines whose variant has a wholesale price (`unitsWithCost`). Cancelled orders excluded. Never netted across currencies.
// ---------------------------------------------------------------------------

export type SalesRow = {
  ownerId: string;
  owner: string;
  ownerCode: string;
  ownerType: "VENDOR" | "THREEPL_CLIENT";
  source: string;
  currency: string;
  units: number;
  unitsWithCost: number;
  sales: Prisma.Decimal;
  cost: Prisma.Decimal;
  grossMargin: Prisma.Decimal;
};

export async function salesReport(scope: ReportScope): Promise<SalesRow[]> {
  const conds: Prisma.Sql[] = [Prisma.sql`oi."shippedQty" > 0`, Prisma.sql`o."status" <> 'CANCELLED'`];
  if (scope.ownerId) conds.push(Prisma.sql`oi."ownerId" = ${scope.ownerId}`);
  if (scope.warehouseId) conds.push(Prisma.sql`(oi."warehouseId" = ${scope.warehouseId} OR (oi."warehouseId" IS NULL AND o."warehouseId" = ${scope.warehouseId}))`);
  if (scope.from) conds.push(Prisma.sql`o."placedAt" >= ${scope.from}`);
  if (scope.to) conds.push(Prisma.sql`o."placedAt" <= ${scope.to}`);
  const rows = await prisma.$queryRaw<
    { ownerId: string; owner: string; ownerCode: string; ownerType: "VENDOR" | "THREEPL_CLIENT"; source: string; currency: string; units: number; unitsWithCost: number; sales: Prisma.Decimal; cost: Prisma.Decimal }[]
  >(Prisma.sql`
    SELECT ow."id" AS "ownerId", ow."businessName" AS "owner", ow."code" AS "ownerCode", ow."type"::text AS "ownerType",
           o."source"::text AS "source", o."currency" AS "currency",
           SUM(oi."shippedQty")::int AS "units",
           SUM(CASE WHEN pv."wholesalePrice" IS NULL THEN 0 ELSE oi."shippedQty" END)::int AS "unitsWithCost",
           COALESCE(SUM(oi."shippedQty" * COALESCE(oi."unitPrice", pv."price")), 0)::numeric(14,2) AS "sales",
           COALESCE(SUM(oi."shippedQty" * pv."wholesalePrice"), 0)::numeric(14,2) AS "cost"
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    JOIN "Owner" ow ON ow."id" = oi."ownerId"
    JOIN "ProductVariant" pv ON pv."id" = oi."variantId"
    WHERE ${Prisma.join(conds, " AND ")}
    GROUP BY ow."id", ow."businessName", ow."code", ow."type", o."source", o."currency"
    ORDER BY ow."businessName", o."source", o."currency"
  `);
  return rows.map((r) => {
    const sales = new Prisma.Decimal(r.sales ?? 0);
    const cost = new Prisma.Decimal(r.cost ?? 0);
    return { ...r, units: Number(r.units), unitsWithCost: Number(r.unitsWithCost), sales, cost, grossMargin: sales.sub(cost) };
  });
}

export function salesTable(rows: SalesRow[], includeOwner: boolean): ReportTable {
  const headers = [...(includeOwner ? ["Owner", "Owner Code", "Owner Type"] : []), "Source", "Currency", "Units", "Units With Cost", "Sales Value", "Wholesale Cost", "Gross Margin"];
  return { headers, rows: rows.map((r) => ({ Owner: r.owner, "Owner Code": r.ownerCode, "Owner Type": r.ownerType, Source: r.source, Currency: r.currency, Units: r.units, "Units With Cost": r.unitsWithCost, "Sales Value": r.sales.toFixed(2), "Wholesale Cost": r.cost.toFixed(2), "Gross Margin": r.grossMargin.toFixed(2) })) };
}

export function salesCsv(rows: SalesRow[], includeOwner: boolean): string {
  const t = salesTable(rows, includeOwner);
  return toCsv(t.headers, t.rows);
}

// ---------------------------------------------------------------------------
// Owner activity (REP-06, ADMIN only): period movements + period charges per owner, current balances.
// Reuses the SKU-activity movement aggregation (grouped by owner) and allOwnerBalances; charges are summed per
// currency straight from the Charge table so a paged list is never summed.
// ---------------------------------------------------------------------------

export type OwnerActivityRow = {
  ownerId: string;
  owner: string;
  ownerCode: string;
  ownerType: "VENDOR" | "THREEPL_CLIENT";
  status: string;
  received: number;
  shipped: number;
  returned: number;
  damaged: number;
  missing: number;
  /** Charges raised in the period, per currency (never summed across currencies). */
  charges: { currency: string; amount: Prisma.Decimal; count: number }[];
  payable: Prisma.Decimal;
  receivable: Prisma.Decimal;
};

export async function ownerActivityReport(scope: Omit<ReportScope, "ownerId">): Promise<OwnerActivityRow[]> {
  const { allOwnerBalances } = await import("@/server/services/finance");
  const [balances, movements, charges] = await Promise.all([
    allOwnerBalances(),
    prisma.inventoryTransaction.groupBy({ by: ["ownerId", "type"], where: { bucket: "ON_HAND", ...(scope.warehouseId ? { warehouseId: scope.warehouseId } : {}), ...dateRange(scope) }, _sum: { quantity: true } }),
    prisma.charge.groupBy({ by: ["ownerId", "currency"], where: dateRange(scope), _sum: { amount: true }, _count: { _all: true } }),
  ]);
  return balances.rows.map((o) => {
    const m = Object.fromEntries(movements.filter((x) => x.ownerId === o.id).map((x) => [x.type, x._sum.quantity ?? 0]));
    return {
      ownerId: o.id,
      owner: o.businessName,
      ownerCode: o.code,
      ownerType: o.type,
      status: o.status,
      received: m.RECEIVE ?? 0,
      shipped: Math.abs(m.SHIP ?? 0),
      returned: m.RETURN ?? 0,
      damaged: Math.abs(m.DAMAGE ?? 0),
      missing: Math.abs(m.MISSING ?? 0),
      charges: charges.filter((c) => c.ownerId === o.id).map((c) => ({ currency: c.currency, amount: c._sum.amount ?? new Prisma.Decimal(0), count: c._count._all })).sort((a, b) => a.currency.localeCompare(b.currency)),
      payable: o.payable,
      receivable: o.receivable,
    };
  });
}

export function ownerActivityTable(rows: OwnerActivityRow[]): ReportTable {
  const headers = ["Owner", "Owner Code", "Type", "Status", "Units Received", "Units Shipped", "Units Returned", "Units Damaged", "Units Missing", "Charges", "Payable Balance", "Receivable Balance"];
  return { headers, rows: rows.map((r) => ({ Owner: r.owner, "Owner Code": r.ownerCode, Type: r.ownerType, Status: r.status, "Units Received": r.received, "Units Shipped": r.shipped, "Units Returned": r.returned, "Units Damaged": r.damaged, "Units Missing": r.missing, Charges: r.charges.map((c) => `${c.amount.toFixed(2)} ${c.currency}`).join("; "), "Payable Balance": r.payable.toFixed(2), "Receivable Balance": r.receivable.toFixed(2) })) };
}

export function ownerActivityCsv(rows: OwnerActivityRow[]): string {
  const t = ownerActivityTable(rows);
  return toCsv(t.headers, t.rows);
}

// ---------------------------------------------------------------------------
// Fulfilment (REP-07): shipments in the period per warehouse with lead-time medians from existing timestamps.
// Rows without a timestamp are simply left out of that median (never invented).
// ---------------------------------------------------------------------------

/** Median of a list of numbers; null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type FulfillmentRow = {
  warehouseId: string;
  warehouse: string;
  warehouseName: string;
  shipped: number;
  delivered: number;
  returned: number;
  cancelled: number;
  /** Median hours from order placed to shipped (1 decimal); null when no shipment has both timestamps. */
  medianPlacedToShippedH: number | null;
  /** Median hours from shipped to delivered; null when nothing was delivered. */
  medianShippedToDeliveredH: number | null;
};

const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

export async function fulfillmentReport(scope: ReportScope): Promise<FulfillmentRow[]> {
  const ownerShip = scope.ownerId ? { items: { some: { orderItem: { ownerId: scope.ownerId } } } } : {};
  const [shipments, cancelled] = await Promise.all([
    prisma.shipment.findMany({
      where: { ...ownerShip, ...(scope.warehouseId ? { fulfillment: { warehouseId: scope.warehouseId } } : {}), ...dateRange(scope, "shippedAt") },
      select: { status: true, shippedAt: true, deliveredAt: true, order: { select: { placedAt: true } }, fulfillment: { select: { warehouse: { select: { id: true, code: true, name: true } } } } },
    }),
    prisma.fulfillment.groupBy({
      by: ["warehouseId"],
      where: { status: "CANCELLED", ...(scope.warehouseId ? { warehouseId: scope.warehouseId } : {}), ...(scope.ownerId ? { order: { items: { some: { ownerId: scope.ownerId } } } } : {}), ...dateRange(scope, "cancelledAt") },
      _count: { _all: true },
    }),
  ]);
  const byWh = new Map<string, FulfillmentRow & { toShip: number[]; toDeliver: number[] }>();
  const row = (w: { id: string; code: string; name: string }) => {
    let r = byWh.get(w.id);
    if (!r) byWh.set(w.id, (r = { warehouseId: w.id, warehouse: w.code, warehouseName: w.name, shipped: 0, delivered: 0, returned: 0, cancelled: 0, medianPlacedToShippedH: null, medianShippedToDeliveredH: null, toShip: [], toDeliver: [] }));
    return r;
  };
  for (const s of shipments) {
    const r = row(s.fulfillment.warehouse);
    r.shipped += 1;
    if (s.status === "DELIVERED") r.delivered += 1;
    if (s.status === "RETURNED") r.returned += 1;
    r.toShip.push(hours(s.order.placedAt, s.shippedAt));
    if (s.deliveredAt) r.toDeliver.push(hours(s.shippedAt, s.deliveredAt));
  }
  if (cancelled.length) {
    const whs = await prisma.warehouse.findMany({ where: { id: { in: cancelled.map((c) => c.warehouseId) } }, select: { id: true, code: true, name: true } });
    for (const c of cancelled) {
      const w = whs.find((x) => x.id === c.warehouseId);
      if (w) row(w).cancelled += c._count._all;
    }
  }
  return [...byWh.values()]
    .map(({ toShip, toDeliver, ...r }) => ({ ...r, medianPlacedToShippedH: round1(median(toShip)), medianShippedToDeliveredH: round1(median(toDeliver)) }))
    .sort((a, b) => b.shipped - a.shipped || a.warehouse.localeCompare(b.warehouse));
}

export function fulfillmentTable(rows: FulfillmentRow[]): ReportTable {
  const headers = ["Warehouse", "Warehouse Name", "Shipped", "Delivered", "Returned", "Cancelled", "Median Hours Placed To Shipped", "Median Hours Shipped To Delivered"];
  return { headers, rows: rows.map((r) => ({ Warehouse: r.warehouse, "Warehouse Name": r.warehouseName, Shipped: r.shipped, Delivered: r.delivered, Returned: r.returned, Cancelled: r.cancelled, "Median Hours Placed To Shipped": r.medianPlacedToShippedH ?? "", "Median Hours Shipped To Delivered": r.medianShippedToDeliveredH ?? "" })) };
}

export function fulfillmentCsv(rows: FulfillmentRow[]): string {
  const t = fulfillmentTable(rows);
  return toCsv(t.headers, t.rows);
}

// ---------------------------------------------------------------------------
// Movements CSV (REP-08): the existing ledger browser (listMovements) with an optional type filter.
// ---------------------------------------------------------------------------

export async function movementsTable(scope: ReportScope, type: InventoryTransactionType | undefined, includeOwner: boolean): Promise<ReportTable> {
  const { listMovements } = await import("@/server/services/inventory");
  const r = await listMovements({ ownerId: scope.ownerId, warehouseId: scope.warehouseId, type, from: scope.from, to: scope.to, page: 1, pageSize: 5000 });
  const headers = ["Date", "Type", "Bucket", "SKU", "Product", "Variant", ...(includeOwner ? ["Owner", "Owner Code"] : []), "Warehouse", "Location", "Quantity", "Before", "After", "Reason", "Notes", "User", "Order Id", "Receiving Id", "Transfer Id"];
  return { headers, rows: r.items.map((m) => ({ Date: m.createdAt.toISOString(), Type: m.type, Bucket: m.bucket, SKU: m.variant.sku, Product: m.variant.product.name, Variant: m.variant.name ?? "", Owner: m.owner.businessName, "Owner Code": m.owner.code, Warehouse: m.warehouse.code, Location: m.location?.label ?? "", Quantity: m.quantity, Before: m.beforeQty, After: m.afterQty, Reason: m.reason ?? "", Notes: m.notes ?? "", User: m.user.name, "Order Id": m.orderId ?? "", "Receiving Id": m.receivingId ?? "", "Transfer Id": m.transferId ?? "" })) };
}

export async function movementsCsv(scope: ReportScope, type: InventoryTransactionType | undefined, includeOwner: boolean): Promise<string> {
  const t = await movementsTable(scope, type, includeOwner);
  return toCsv(t.headers, t.rows);
}
