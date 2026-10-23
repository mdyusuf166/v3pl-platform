import { NextResponse, type NextRequest } from "next/server";
import { isPortalRole, isStaffRole } from "@/lib/roles";
import { ADMIN_ONLY_REPORT_TYPES, REPORT_TYPES, movementTypeFromQuery, reportQuerySchema, scopeFromQuery, type ReportType } from "@/lib/validation/reports";
import { exportFiltersSchema } from "@/lib/validation/orders";
import { getCurrentUser } from "@/server/auth/current-user";
import { exportOrdersCsv } from "@/server/services/order-csv";
import { toCsv, parseCsv } from "@/lib/csv";
import { XLSX_MIME, toXlsx } from "@/lib/xlsx";
import { fulfillmentReport, fulfillmentTable, inventorySnapshotTable, movementsTable, ownerActivityReport, ownerActivityTable, returnsReport, returnsTable, salesReport, salesTable, shipmentsReport, shipmentsTable, skuActivityReport, skuActivityTable, type ReportTable } from "@/server/services/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/:report?from&to&warehouseId[&ownerId][&status][&q] → CSV.
 * Staff may filter by owner; portal users are ALWAYS scoped to their own owner and any
 * ownerId parameter is ignored. The "orders" report reuses the Shopify-compatible order export.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ report: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { report } = await ctx.params;
  if (!(REPORT_TYPES as readonly string[]).includes(report)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = reportQuerySchema.safeParse({ ...Object.fromEntries(req.nextUrl.searchParams.entries()), report });
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const q = parsed.data;
  const staff = isStaffRole(user.role);
  if (!staff && !(isPortalRole(user.role) && user.ownerId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const ownerId = staff ? q.ownerId || undefined : user.ownerId!;
  const includeOwner = staff && !ownerId;
  const scope = scopeFromQuery(q, ownerId);

  const type = report as ReportType;
  // Cross-owner reports are for administrators only (REP-06); WAREHOUSE / SALES / portals get 403.
  if (ADMIN_ONLY_REPORT_TYPES.includes(type) && user.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // One table per report (same filters, same scope) → CSV or Excel (REP-09). The orders export keeps its Shopify-compatible layout.
  let table: ReportTable;
  if (type === "activity") table = skuActivityTable(await skuActivityReport(scope), includeOwner);
  else if (type === "shipments") table = shipmentsTable((await shipmentsReport({ ...scope, status: q.status, q: q.q, page: 1, pageSize: 5000 })).items, includeOwner);
  else if (type === "returns") table = returnsTable((await returnsReport({ ...scope, status: (q.status as "RECEIVED" | "INSPECTED" | "ALL" | undefined) ?? "ALL", page: 1, pageSize: 5000 })).items, includeOwner);
  else if (type === "inventory") table = await inventorySnapshotTable(scope, includeOwner);
  else if (type === "sales") table = salesTable(await salesReport(scope), includeOwner);
  else if (type === "fulfillment") table = fulfillmentTable(await fulfillmentReport(scope));
  else if (type === "owner-activity") table = ownerActivityTable(await ownerActivityReport({ warehouseId: scope.warehouseId, from: scope.from, to: scope.to }));
  else if (type === "movements") table = await movementsTable(scope, movementTypeFromQuery(q.status), includeOwner);
  else {
    const filters = exportFiltersSchema.parse({ status: "ALL", fulfillmentStatus: "ALL", shipmentStatus: "ALL", source: "ALL", warehouseId: q.warehouseId, from: q.from, to: q.to, ownerId: staff ? q.ownerId : undefined });
    const { csv } = await exportOrdersCsv({ ...filters, scopeOwnerId: staff ? undefined : ownerId });
    if (q.format === "csv") return csvResponse(csv, type);
    const parsed = parseCsv(csv.replace(/^\uFEFF/, ""));
    table = { headers: parsed.headers, rows: parsed.rows };
  }
  if (q.format === "xlsx") {
    const period = `${q.from ?? "start"}_${q.to ?? "today"}`;
    const body = new Uint8Array(toXlsx(table.headers, table.rows, type));
    return new NextResponse(body, { status: 200, headers: { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="v3pl-${type}-${period}-${new Date().toISOString().slice(0, 10)}.xlsx"`, "Cache-Control": "no-store" } });
  }
  return csvResponse(toCsv(table.headers, table.rows), type);
}

function csvResponse(csv: string, type: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="v3pl-${type}-${stamp}.csv"`, "Cache-Control": "no-store" },
  });
}
