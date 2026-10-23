import Link from "next/link";
import { ArrowLeftRight, BarChart3, Building2, Coins, PackageCheck, RotateCcw, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { Pagination } from "@/components/common/pagination";
import { StatusBadge } from "@/components/common/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { ReportFilters } from "@/components/reports/report-filters";
import { formatDateTime, formatInt, formatMoney } from "@/lib/format";
import { MOVEMENT_TYPE_LABELS, REPORT_LABELS, REPORT_TYPES, movementTypeFromQuery, scopeFromQuery, type ReportQuery, type ReportType } from "@/lib/validation/reports";
import { listMovements, listStock } from "@/server/services/inventory";
import { fulfillmentReport, ordersSummaryReport, ownerActivityReport, returnsReport, salesReport, shipmentsReport, skuActivityReport } from "@/server/services/reports";

type Props = {
  /** Portal: the session owner id. Admin: the optional filter value. */
  scopeOwnerId?: string;
  isStaff: boolean;
  basePath: string;
  ordersPath: string;
  query: ReportQuery;
  warehouses: { id: string; code: string; name: string }[];
  owners?: { id: string; businessName: string }[];
  reports?: readonly ReportType[];
  title?: string;
  description?: string;
};

function csvHrefFor(query: ReportQuery, isStaff: boolean, format: "csv" | "xlsx" = "csv") {
  const p = new URLSearchParams();
  if (format === "xlsx") p.set("format", "xlsx");
  if (query.from) p.set("from", query.from);
  if (query.to) p.set("to", query.to);
  if (query.warehouseId) p.set("warehouseId", query.warehouseId);
  if (query.status) p.set("status", query.status);
  if (query.q) p.set("q", query.q);
  if (isStaff && query.ownerId) p.set("ownerId", query.ownerId);
  const s = p.toString();
  return `/api/reports/${query.report}${s ? `?${s}` : ""}`;
}

/** Shared report screen for admin (/admin/reports) and portals (/portal/x/reports, /shipments, /returns). */
export async function ReportView({ scopeOwnerId, isStaff, basePath, ordersPath, query: rawQuery, warehouses, owners, reports = REPORT_TYPES, title, description }: Props) {
  // A tab this screen does not offer (e.g. ?report=owner-activity on a portal) falls back to the first allowed tab.
  const query: ReportQuery = reports.includes(rawQuery.report) ? rawQuery : { ...rawQuery, report: reports[0] };
  const ownerId = isStaff ? query.ownerId || undefined : scopeOwnerId;
  const scope = scopeFromQuery(query, ownerId);
  const meta = REPORT_LABELS[query.report];
  const hrefFor = (page: number) => {
    const p = new URLSearchParams();
    p.set("report", query.report);
    for (const [k, v] of Object.entries({ from: query.from, to: query.to, warehouseId: query.warehouseId, status: query.status, q: query.q, ownerId: isStaff ? query.ownerId : undefined })) if (v) p.set(k, v);
    if (page > 1) p.set("page", String(page));
    return `${basePath}?${p.toString()}`;
  };
  const periodLabel = query.from || query.to ? `${query.from ?? "start"} → ${query.to ?? "today"}` : "all time";

  return (
    <>
      <PageHeader title={title ?? "Reports"} description={description ?? "Operational reports from live data. Filter by period and warehouse, then download as CSV."} />
      <ReportFilters basePath={basePath} query={query} warehouses={warehouses} owners={owners} reports={reports} showTabs={reports.length > 1} csvHref={csvHrefFor(query, isStaff)} xlsxHref={csvHrefFor(query, isStaff, "xlsx")} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-4 text-muted-foreground" /> {meta.title}
            <Badge variant="outline">{periodLabel}</Badge>
          </CardTitle>
          <CardDescription>{meta.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {query.report === "activity" && <ActivityTable scope={scope} isStaff={isStaff && !ownerId} />}
          {query.report === "orders" && <OrdersSummary scope={scope} ordersPath={ordersPath} />}
          {query.report === "shipments" && <ShipmentsTable scope={scope} query={query} ordersPath={ordersPath} hrefFor={hrefFor} isStaff={isStaff && !ownerId} />}
          {query.report === "returns" && <ReturnsTable scope={scope} query={query} ordersPath={ordersPath} hrefFor={hrefFor} isStaff={isStaff && !ownerId} />}
          {query.report === "inventory" && <InventoryTable scope={scope} query={query} hrefFor={hrefFor} isStaff={isStaff && !ownerId} />}
          {query.report === "sales" && <SalesTable scope={scope} isStaff={isStaff && !ownerId} />}
          {query.report === "fulfillment" && <FulfillmentTable scope={scope} />}
          {query.report === "movements" && <MovementsTable scope={scope} query={query} hrefFor={hrefFor} isStaff={isStaff && !ownerId} />}
          {query.report === "owner-activity" && isStaff && <OwnerActivityTable scope={scope} />}
        </CardContent>
      </Card>
    </>
  );
}

type Scope = ReturnType<typeof scopeFromQuery>;

async function ActivityTable({ scope, isStaff }: { scope: Scope; isStaff: boolean }) {
  const rows = await skuActivityReport(scope);
  if (rows.length === 0) return <EmptyState icon={BarChart3} title="No SKUs to report" description="Add products and receive stock to see activity here." />;
  const totals = rows.reduce((t, r) => ({ received: t.received + r.received, shipped: t.shipped + r.shipped, returned: t.returned + r.returned, damaged: t.damaged + r.damaged, missing: t.missing + r.missing, onHand: t.onHand + r.onHand, available: t.available + r.available }), { received: 0, shipped: 0, returned: 0, damaged: 0, missing: 0, onHand: 0, available: 0 });
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Product</TableHead>
            {isStaff && <TableHead className="hidden lg:table-cell">Owner</TableHead>}
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">Shipped</TableHead>
            <TableHead className="hidden text-right md:table-cell">Returned</TableHead>
            <TableHead className="hidden text-right md:table-cell">Damaged</TableHead>
            <TableHead className="hidden text-right md:table-cell">Missing</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Adjusted</TableHead>
            <TableHead className="text-right">On hand</TableHead>
            <TableHead className="text-right">Available</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.variantId}>
              <TableCell className="font-mono text-xs">{r.sku}</TableCell>
              <TableCell>
                {r.product}
                {r.variantName && <span className="text-muted-foreground"> · {r.variantName}</span>}
              </TableCell>
              {isStaff && <TableCell className="hidden text-muted-foreground lg:table-cell">{r.owner}</TableCell>}
              <TableCell className="text-right tabular-nums">{formatInt(r.received)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInt(r.shipped)}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{formatInt(r.returned)}</TableCell>
              <TableCell className={`hidden text-right tabular-nums md:table-cell ${r.damaged ? "text-red-700" : ""}`}>{formatInt(r.damaged)}</TableCell>
              <TableCell className={`hidden text-right tabular-nums md:table-cell ${r.missing ? "text-red-700" : ""}`}>{formatInt(r.missing)}</TableCell>
              <TableCell className="hidden text-right tabular-nums lg:table-cell">{r.adjusted > 0 ? `+${r.adjusted}` : r.adjusted}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInt(r.onHand)}</TableCell>
              <TableCell className={`text-right font-medium tabular-nums ${r.available <= 5 ? "text-amber-700" : ""}`}>{formatInt(r.available)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-muted/40 font-medium">
            <TableCell colSpan={isStaff ? 3 : 2}>Total</TableCell>
            <TableCell className="text-right tabular-nums">{formatInt(totals.received)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatInt(totals.shipped)}</TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">{formatInt(totals.returned)}</TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">{formatInt(totals.damaged)}</TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">{formatInt(totals.missing)}</TableCell>
            <TableCell className="hidden lg:table-cell" />
            <TableCell className="text-right tabular-nums">{formatInt(totals.onHand)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatInt(totals.available)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", NEW: "New", CONFIRMED: "Confirmed", CANCELLED: "Cancelled", COMPLETED: "Completed", UNFULFILLED: "Unfulfilled", RESERVED: "Reserved", PICKING: "Picking", PACKED: "Packed", PARTIALLY_SHIPPED: "Partially shipped", SHIPPED: "Shipped", FULFILLED: "Fulfilled", MANUAL: "Manual", CSV_IMPORT: "CSV import", SHOPIFY: "Shopify", THREEPL_PORTAL: "3PL portal" };

async function OrdersSummary({ scope, ordersPath }: { scope: Scope; ordersPath: string }) {
  const s = await ordersSummaryReport(scope);
  if (s.totalOrders === 0) return <EmptyState icon={PackageCheck} title="No orders in this period" description="Change the date range or wait for new orders." />;
  const block = (title: string, entries: Record<string, number>) => (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      <ul className="divide-y rounded-lg border text-sm">
        {Object.entries(entries)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <li key={k} className="flex justify-between px-3 py-1.5">
              <span>{STATUS_LABEL[k] ?? k}</span>
              <span className="tabular-nums">{formatInt(v)}</span>
            </li>
          ))}
      </ul>
    </div>
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {[
          ["Orders", s.totalOrders],
          ["Lines", s.lines],
          ["Units ordered", s.units.ordered],
          ["Units shipped", s.units.shipped],
          ["Units cancelled", s.units.cancelled],
          ["Units returned", s.units.returned],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{label as string}</p>
            <p className="text-xl font-semibold tabular-nums">{formatInt(v as number)}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {block("By order status", s.byStatus)}
        {block("By fulfilment status", s.byFulfillment)}
        {block("By source", s.bySource)}
      </div>
      <p className="text-sm text-muted-foreground">
        Need the line-level detail? <Link href={ordersPath} className="underline underline-offset-4">Open the orders list</Link> or download the CSV above (Shopify-compatible order layout).
      </p>
    </div>
  );
}

async function ShipmentsTable({ scope, query, ordersPath, hrefFor, isStaff }: { scope: Scope; query: ReportQuery; ordersPath: string; hrefFor: (p: number) => string; isStaff: boolean }) {
  const r = await shipmentsReport({ ...scope, status: query.status, q: query.q, page: query.page });
  if (r.items.length === 0) return <EmptyState icon={Truck} title="No shipments match" description="Change the period, status or search." />;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shipped</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Carrier · tracking</TableHead>
              <TableHead className="hidden md:table-cell">Ship to</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.items.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(s.shippedAt)}</TableCell>
                <TableCell>
                  <Link href={`${ordersPath}/${s.order.id}`} className="font-medium hover:underline">
                    {s.order.orderNumber}
                  </Link>
                  <div className="text-xs text-muted-foreground">{s.fulfillment.warehouse.code}</div>
                </TableCell>
                <TableCell>
                  {s.carrier ?? "—"}
                  {s.trackingNumber && (
                    <div className="font-mono text-xs">
                      {s.trackingUrl ? (
                        <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                          {s.trackingNumber}
                        </a>
                      ) : (
                        s.trackingNumber
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{[s.order.shipName, s.order.shipCity, s.order.shipCountry].filter(Boolean).join(", ") || "—"}</TableCell>
                <TableCell className="text-xs">
                  {s.items.map((i, idx) => (
                    <div key={idx}>
                      <span className="font-mono">{i.orderItem.sku}</span> × {i.quantity}
                      {isStaff && <span className="text-muted-foreground"> · {i.orderItem.owner.businessName}</span>}
                    </div>
                  ))}
                </TableCell>
                <TableCell>
                  <StatusBadge status={s.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={r.page} pageCount={r.pageCount} total={r.total} pageSize={r.pageSize} hrefFor={hrefFor} />
    </div>
  );
}

async function ReturnsTable({ scope, query, ordersPath, hrefFor, isStaff }: { scope: Scope; query: ReportQuery; ordersPath: string; hrefFor: (p: number) => string; isStaff: boolean }) {
  const status = (["RECEIVED", "INSPECTED", "ALL"].includes(query.status ?? "") ? query.status : "ALL") as "RECEIVED" | "INSPECTED" | "ALL";
  const r = await returnsReport({ ...scope, status, page: query.page });
  if (r.items.length === 0) return <EmptyState icon={RotateCcw} title="No returns match" description="Returns appear here once the warehouse receives them." />;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Order</TableHead>
              <TableHead className="hidden md:table-cell">Reference · reason</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.items.map((ret) => (
              <TableRow key={ret.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(ret.receivedAt)}</TableCell>
                <TableCell>
                  <Link href={`${ordersPath}/${ret.order.id}`} className="font-medium hover:underline">
                    {ret.order.orderNumber}
                  </Link>
                  <div className="text-xs text-muted-foreground">{ret.warehouse.code}</div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{[ret.reference, ret.reason].filter(Boolean).join(" · ") || "—"}</TableCell>
                <TableCell className="text-xs">
                  {ret.items.map((i, idx) => (
                    <div key={idx}>
                      <span className="font-mono">{i.orderItem.sku}</span> × {i.quantity} <span className="text-muted-foreground">· {i.condition ? (i.condition === "SELLABLE" ? "restocked" : "damaged") : "pending"}</span>
                      {isStaff && <span className="text-muted-foreground"> · {i.orderItem.owner.businessName}</span>}
                    </div>
                  ))}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={ret.status === "RECEIVED" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
                    {ret.status === "RECEIVED" ? "Awaiting inspection" : "Inspected"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={r.page} pageCount={r.pageCount} total={r.total} pageSize={r.pageSize} hrefFor={hrefFor} />
    </div>
  );
}

async function InventoryTable({ scope, query, hrefFor, isStaff }: { scope: Scope; query: ReportQuery; hrefFor: (p: number) => string; isStaff: boolean }) {
  const r = await listStock({ ownerId: scope.ownerId, warehouseId: scope.warehouseId, page: query.page });
  if (r.items.length === 0) return <EmptyState icon={BarChart3} title="No stock" description="Nothing is currently in stock for this selection." />;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Product</TableHead>
              {isStaff && <TableHead className="hidden lg:table-cell">Owner</TableHead>}
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">Available</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.items.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-xs">{b.variant.sku}</TableCell>
                <TableCell>{b.variant.product.name}</TableCell>
                {isStaff && <TableCell className="hidden text-muted-foreground lg:table-cell">{b.variant.product.owner.businessName}</TableCell>}
                <TableCell>{b.warehouse.code}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInt(b.onHand)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{formatInt(b.reserved)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatInt(b.onHand - b.reserved)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={r.page} pageCount={r.pageCount} total={r.total} pageSize={r.pageSize} hrefFor={hrefFor} />
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { MANUAL: "Manual", CSV_IMPORT: "CSV import", SHOPIFY: "Shopify", THREEPL_PORTAL: "3PL portal", AFFILIATE: "Salesman" };

async function SalesTable({ scope, isStaff }: { scope: Scope; isStaff: boolean }) {
  const rows = await salesReport(scope);
  if (rows.length === 0) return <EmptyState icon={Coins} title="No shipped lines in this period" description="Sales appear once order lines are shipped. Change the period or owner." />;
  // Totals per currency only — different currencies are never added together.
  const byCurrency = new Map<string, { units: number; unitsWithCost: number; sales: number; cost: number; margin: number }>();
  for (const r of rows) {
    const t = byCurrency.get(r.currency) ?? { units: 0, unitsWithCost: 0, sales: 0, cost: 0, margin: 0 };
    t.units += r.units;
    t.unitsWithCost += r.unitsWithCost;
    t.sales += r.sales.toNumber();
    t.cost += r.cost.toNumber();
    t.margin += r.grossMargin.toNumber();
    byCurrency.set(r.currency, t);
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {isStaff && <TableHead>Owner</TableHead>}
            <TableHead>Source</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead className="text-right">Units</TableHead>
            <TableHead className="hidden text-right md:table-cell">Units with cost</TableHead>
            <TableHead className="text-right">Sales value</TableHead>
            <TableHead className="hidden text-right md:table-cell">Wholesale cost</TableHead>
            <TableHead className="text-right">Gross margin</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.ownerId}:${r.source}:${r.currency}`}>
              {isStaff && (
                <TableCell>
                  {r.owner} <span className="text-xs text-muted-foreground">· {r.ownerType === "VENDOR" ? "Vendor" : "3PL client"}</span>
                </TableCell>
              )}
              <TableCell>{SOURCE_LABEL[r.source] ?? r.source}</TableCell>
              <TableCell className="font-mono text-xs">{r.currency}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInt(r.units)}</TableCell>
              <TableCell className={`hidden text-right tabular-nums md:table-cell ${r.unitsWithCost < r.units ? "text-amber-700" : "text-muted-foreground"}`}>{formatInt(r.unitsWithCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(r.sales, r.currency)}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{formatMoney(r.cost, r.currency)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatMoney(r.grossMargin, r.currency)}</TableCell>
            </TableRow>
          ))}
          {[...byCurrency.entries()].map(([cur, t]) => (
            <TableRow key={`total:${cur}`} className="bg-muted/40 font-medium">
              <TableCell colSpan={isStaff ? 2 : 1}>Total</TableCell>
              <TableCell className="font-mono text-xs">{cur}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInt(t.units)}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{formatInt(t.unitsWithCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(t.sales, cur)}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{formatMoney(t.cost, cur)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(t.margin, cur)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="px-3 py-2 text-xs text-muted-foreground">Sales value = shipped units × order unit price (falls back to the variant retail price). Wholesale cost covers only units whose variant has a wholesale price. Informational; no ledger entries are created.</p>
    </div>
  );
}

async function FulfillmentTable({ scope }: { scope: Scope }) {
  const rows = await fulfillmentReport(scope);
  if (rows.length === 0) return <EmptyState icon={Truck} title="No shipments in this period" description="Fulfilment figures appear once orders are shipped." />;
  const h = (v: number | null) => (v === null ? "—" : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`);
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Warehouse</TableHead>
            <TableHead className="text-right">Shipped</TableHead>
            <TableHead className="text-right">Delivered</TableHead>
            <TableHead className="text-right">Returned</TableHead>
            <TableHead className="text-right">Cancelled</TableHead>
            <TableHead className="hidden text-right md:table-cell">Median placed → shipped</TableHead>
            <TableHead className="hidden text-right md:table-cell">Median shipped → delivered</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.warehouseId}>
              <TableCell>
                <span className="font-medium">{r.warehouse}</span> <span className="text-muted-foreground">· {r.warehouseName}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatInt(r.shipped)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInt(r.delivered)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInt(r.returned)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInt(r.cancelled)}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{h(r.medianPlacedToShippedH)}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{h(r.medianShippedToDeliveredH)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="px-3 py-2 text-xs text-muted-foreground">Medians use recorded timestamps only; shipments without a delivery time are left out of the delivery median. Cancelled counts cancelled fulfilments in the period.</p>
    </div>
  );
}

async function OwnerActivityTable({ scope }: { scope: Scope }) {
  const rows = await ownerActivityReport({ warehouseId: scope.warehouseId, from: scope.from, to: scope.to });
  if (rows.length === 0) return <EmptyState icon={Building2} title="No vendors or 3PL clients yet" description="Owner activity appears once accounts exist." />;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Owner</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">Shipped</TableHead>
            <TableHead className="hidden text-right md:table-cell">Returned</TableHead>
            <TableHead className="hidden text-right md:table-cell">Damaged</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Charges (period)</TableHead>
            <TableHead className="text-right">Payable</TableHead>
            <TableHead className="text-right">Receivable</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.ownerId} className={r.status !== "ACTIVE" ? "text-muted-foreground" : undefined}>
              <TableCell>
                <Link href={`/admin/finance/${r.ownerId}`} className="font-medium hover:underline">
                  {r.owner}
                </Link>
                <div className="font-mono text-[11px] text-muted-foreground">{r.ownerCode}</div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{r.ownerType === "VENDOR" ? "Vendor" : "3PL client"}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatInt(r.received)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInt(r.shipped)}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{formatInt(r.returned)}</TableCell>
              <TableCell className={`hidden text-right tabular-nums md:table-cell ${r.damaged ? "text-red-700" : ""}`}>{formatInt(r.damaged)}</TableCell>
              <TableCell className="hidden text-right tabular-nums lg:table-cell">{r.charges.length === 0 ? "—" : r.charges.map((c) => <div key={c.currency}>{formatMoney(c.amount, c.currency)}</div>)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(r.payable)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(r.receivable)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="px-3 py-2 text-xs text-muted-foreground">Units and charges are for the selected period; payable and receivable are the current open balances from the ledger (gross, never netted). Open an owner for the full ledger.</p>
    </div>
  );
}

async function MovementsTable({ scope, query, hrefFor, isStaff }: { scope: Scope; query: ReportQuery; hrefFor: (p: number) => string; isStaff: boolean }) {
  const r = await listMovements({ ownerId: scope.ownerId, warehouseId: scope.warehouseId, type: movementTypeFromQuery(query.status), from: scope.from, to: scope.to, page: query.page, pageSize: 50 });
  if (r.items.length === 0) return <EmptyState icon={ArrowLeftRight} title="No movements match" description="Change the period, warehouse or movement type." />;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>SKU</TableHead>
              {isStaff && <TableHead className="hidden lg:table-cell">Owner</TableHead>}
              <TableHead className="hidden md:table-cell">Warehouse · location</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="hidden text-right md:table-cell">After</TableHead>
              <TableHead className="hidden lg:table-cell">Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.items.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{MOVEMENT_TYPE_LABELS[m.type as keyof typeof MOVEMENT_TYPE_LABELS] ?? m.type}</Badge>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs">{m.variant.sku}</span>
                  <div className="text-xs text-muted-foreground">{m.variant.product.name}</div>
                </TableCell>
                {isStaff && <TableCell className="hidden text-muted-foreground lg:table-cell">{m.owner.businessName}</TableCell>}
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {m.warehouse.code}
                  {m.location ? ` · ${m.location.label}` : ""}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${m.quantity < 0 ? "text-red-700" : ""}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</TableCell>
                <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">{formatInt(m.afterQty)}</TableCell>
                <TableCell className="hidden max-w-[260px] truncate text-xs text-muted-foreground lg:table-cell">{m.reason ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={r.page} pageCount={r.pageCount} total={r.total} pageSize={r.pageSize} hrefFor={hrefFor} />
    </div>
  );
}
