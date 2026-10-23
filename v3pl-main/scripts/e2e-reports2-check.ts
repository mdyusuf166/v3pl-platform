/**
 * Reports enhancement (REP-05…REP-08): Sales, Owner activity, Fulfilment, Movements CSV + regression of the five
 * original reports. Service-level; no HTTP server needed. Creates temporary data and removes it in `finally`.
 *
 * Usage: npm run e2e:reports2 -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const RUN = `rp${Date.now().toString(36)}`.toUpperCase();
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const blank = { contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null };
const near = (v: number | null, target: number, tol = 0.15) => v !== null && Math.abs(v - target) <= tol;
const H = 3_600_000;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { parseCsv } = await import("../src/lib/csv");
  const owners = await import("../src/server/services/owners");
  const products = await import("../src/server/services/products");
  const warehouses = await import("../src/server/services/warehouses");
  const receiving = await import("../src/server/services/receiving");
  const orders = await import("../src/server/services/orders");
  const fulfillment = await import("../src/server/services/fulfillment");
  const returns = await import("../src/server/services/returns");
  const finance = await import("../src/server/services/finance");
  const rep = await import("../src/server/services/reports");
  const val = await import("../src/lib/validation/reports");
  const email = await import("../src/server/services/email");
  email.__setEmailTransportForTests(async () => ({ ok: true }));

  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });
  const created = { ownerIds: [] as string[], productIds: [] as string[], warehouseIds: [] as string[] };
  const startedAt = new Date();

  try {
    const A = await owners.createOwner("VENDOR", { code: `${RUN}-A`, businessName: `RP Vendor A ${RUN}`, ...blank }, admin.id);
    const B = await owners.createOwner("VENDOR", { code: `${RUN}-B`, businessName: `RP Vendor B ${RUN}`, ...blank }, admin.id);
    created.ownerIds.push(A.id, B.id);
    const mine = <T extends { ownerId: string }>(rows: T[]): T[] => rows.filter((r) => created.ownerIds.includes(r.ownerId));
    const W = await warehouses.createWarehouse({ code: `${RUN}-W`, name: "RP Warehouse", addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null }, admin.id);
    created.warehouseIds.push(W.id);
    const loc = (await warehouses.getDefaultLocation(W.id))!;
    const pA = await products.createProduct({ ownerId: A.id, name: `RP A ${RUN}`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-A1`, name: null, barcode: null, price: "10.00", wholesalePrice: "6.00", cost: null, status: "ACTIVE" }, { sku: `${RUN}-A2`, name: null, barcode: null, price: "20.00", cost: null, status: "ACTIVE" }] }, admin.id);
    const pB = await products.createProduct({ ownerId: B.id, name: `RP B ${RUN}`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-B1`, name: null, barcode: null, price: "8.00", wholesalePrice: "5.00", cost: null, status: "ACTIVE" }] }, admin.id);
    created.productIds.push(pA.id, pB.id);
    const a1 = pA.variants.find((v) => v.sku === `${RUN}-A1`)!;
    const a2 = pA.variants.find((v) => v.sku === `${RUN}-A2`)!;
    const b1 = pB.variants[0];
    await receiving.createReceiving({ ownerId: A.id, warehouseId: W.id, reference: `${RUN}-RA`, notes: null, lines: [{ variantId: a1.id, locationId: loc.id, quantity: 20 }, { variantId: a2.id, locationId: loc.id, quantity: 20 }] }, admin.id);
    await receiving.createReceiving({ ownerId: B.id, warehouseId: W.id, reference: `${RUN}-RB`, notes: null, lines: [{ variantId: b1.id, locationId: loc.id, quantity: 20 }] }, admin.id);

    // O1: mixed-owner USD order, placed 4 h ago, shipped 2 h ago, delivered now.
    const o1 = await orders.createOrder({ source: "MANUAL", warehouseId: W.id, reserve: true, customerName: `RP Cust ${RUN}`, lines: [{ variantId: a1.id, quantity: 2 }, { variantId: b1.id, quantity: 3 }] }, admin.id);
    await prisma.order.update({ where: { id: o1.orderId }, data: { placedAt: new Date(Date.now() - 4 * H), total: "999.00" } });
    const f1 = await fulfillment.startPicking({ orderId: o1.orderId, warehouseId: W.id }, admin.id);
    const sh1 = await fulfillment.shipFulfillment(f1.id, { carrier: "UPS", trackingNumber: `${RUN}-T1`, shippedAt: new Date(Date.now() - 2 * H) }, admin.id);
    await fulfillment.updateShipmentStatus(sh1.id, "DELIVERED", admin.id);
    // O2: A only, BDT, no wholesale price on the variant, shipped now (not delivered).
    const o2 = await orders.createOrder({ source: "MANUAL", currency: "BDT", warehouseId: W.id, reserve: true, lines: [{ variantId: a2.id, quantity: 1 }] }, admin.id);
    const f2 = await fulfillment.startPicking({ orderId: o2.orderId, warehouseId: W.id }, admin.id);
    await fulfillment.shipFulfillment(f2.id, { carrier: "DHL" }, admin.id);
    // O3: A only, picking cancelled.
    const o3 = await orders.createOrder({ source: "MANUAL", warehouseId: W.id, reserve: true, lines: [{ variantId: a1.id, quantity: 1 }] }, admin.id);
    const f3 = await fulfillment.startPicking({ orderId: o3.orderId, warehouseId: W.id }, admin.id);
    await fulfillment.cancelFulfillment(f3.id, admin.id);
    // Return one B unit from O1, inspected as damaged.
    const full1 = (await orders.getOrder(o1.orderId))!;
    const bLine = full1.items.find((i) => i.variantId === b1.id)!;
    const ret = await returns.receiveReturn({ orderId: o1.orderId, warehouseId: W.id, reference: `${RUN}-RET`, lines: [{ orderItemId: bLine.id, quantity: 1 }] }, admin.id);
    const ri = await prisma.returnItem.findFirstOrThrow({ where: { returnId: ret.id } });
    await returns.inspectReturn(ret.id, { lines: [{ returnItemId: ri.id, condition: "DAMAGED" }] }, admin.id);

    // --- Sales -------------------------------------------------------------------------------------------
    const all = mine(await rep.salesReport({}));
    const aUsd = all.find((r) => r.ownerId === A.id && r.currency === "USD");
    const aBdt = all.find((r) => r.ownerId === A.id && r.currency === "BDT");
    const bUsd = all.find((r) => r.ownerId === B.id && r.currency === "USD");
    const money = (r: { sales: { toFixed(n: number): string }; cost: { toFixed(n: number): string }; grossMargin: { toFixed(n: number): string } } | undefined) => (r ? `${r.sales.toFixed(2)}/${r.cost.toFixed(2)}/${r.grossMargin.toFixed(2)}` : "none");
    check("1. Sales: shipped units × unit price, wholesale cost, gross margin per owner (A USD 2 units = 20.00 / 12.00 / 8.00; B USD 3 units = 24.00 / 15.00 / 9.00)", all.length === 3 && aUsd?.units === 2 && money(aUsd) === "20.00/12.00/8.00" && bUsd?.units === 3 && money(bUsd) === "24.00/15.00/9.00" && aUsd.source === "MANUAL" && aUsd.ownerType === "VENDOR", `${money(aUsd)} ${money(bUsd)}`);
    check("2. Mixed-owner order is split by line, never by order total (order total 999.00 is ignored; A's USD row excludes B's 24.00)", money(aUsd) === "20.00/12.00/8.00" && !all.some((r) => r.sales.toFixed(2) === "999.00" || r.sales.toFixed(2) === "44.00"));
    const onlyA = await rep.salesReport({ ownerId: A.id });
    const onlyB = await rep.salesReport({ ownerId: B.id });
    check("3. Vendor scope isolation: ownerId A returns only A's rows, ownerId B only B's", onlyA.length === 2 && onlyA.every((r) => r.ownerId === A.id) && onlyB.length === 1 && onlyB[0].ownerId === B.id);
    check("4. Currency grouping: A has separate USD and BDT rows (never merged into one total)", !!aUsd && !!aBdt && aBdt.units === 1 && aBdt.sales.toFixed(2) === "20.00");
    check("5. Nullable wholesale price: the BDT line's variant has no wholesale price → unitsWithCost 0, cost 0.00, margin = sales", aBdt?.unitsWithCost === 0 && aBdt.cost.toFixed(2) === "0.00" && aBdt.grossMargin.toFixed(2) === "20.00" && aUsd?.unitsWithCost === 2);
    const early = mine(await rep.salesReport({ to: new Date(Date.now() - 3 * H) }));
    const future = mine(await rep.salesReport({ from: new Date(Date.now() + 24 * H) }));
    check("6. Date boundaries use placedAt: 'to 3 h ago' keeps only the 4 h-old order (A USD + B USD, no BDT); a future 'from' returns nothing", early.length === 2 && !early.some((r) => r.currency === "BDT") && future.length === 0);

    // --- Owner activity ----------------------------------------------------------------------------------
    const act = await rep.ownerActivityReport({});
    const actA = act.find((r) => r.ownerId === A.id);
    const actB = act.find((r) => r.ownerId === B.id);
    const bal = await finance.allOwnerBalances();
    const balB = bal.rows.find((r) => r.id === B.id)!;
    const chargesB = await prisma.charge.groupBy({ by: ["currency"], where: { ownerId: B.id }, _sum: { amount: true } });
    check("7. Owner activity values: A received 40 / shipped 3 / returned 0 / damaged 0; B received 20 / shipped 3 / returned 1 / damaged 1; balances equal allOwnerBalances; charges per currency match the Charge table", actA?.received === 40 && actA.shipped === 3 && actA.returned === 0 && actA.damaged === 0 && actB?.received === 20 && actB.shipped === 3 && actB.returned === 1 && actB.damaged === 1 && actB.payable.equals(balB.payable) && actB.receivable.equals(balB.receivable) && actB.charges.length === chargesB.length && actB.charges.every((c) => chargesB.find((x) => x.currency === c.currency)?._sum.amount?.equals(c.amount)), `A=${actA?.received}/${actA?.shipped} B=${actB?.received}/${actB?.shipped}/${actB?.returned}/${actB?.damaged}`);

    // --- Fulfilment --------------------------------------------------------------------------------------
    const ful = (await rep.fulfillmentReport({})).find((r) => r.warehouseId === W.id);
    check("8. Fulfilment counts per warehouse: 2 shipped, 1 delivered, 0 returned, 1 cancelled", ful?.shipped === 2 && ful.delivered === 1 && ful.returned === 0 && ful.cancelled === 1, JSON.stringify(ful));
    check("9. Fulfilment medians from real timestamps: placed → shipped median of [2 h, ~0 h] ≈ 1.0 h; shipped → delivered ≈ 2.0 h (undelivered shipment excluded, not invented)", !!ful && near(ful.medianPlacedToShippedH, 1.0) && near(ful.medianShippedToDeliveredH, 2.0), `${ful?.medianPlacedToShippedH} / ${ful?.medianShippedToDeliveredH}`);
    const fulB = (await rep.fulfillmentReport({ ownerId: B.id })).find((r) => r.warehouseId === W.id);
    check("10. Fulfilment respects owner scope: B sees only the mixed shipment (1 shipped, 1 delivered, 0 cancelled, both medians 2.0 h)", fulB?.shipped === 1 && fulB.delivered === 1 && fulB.cancelled === 0 && near(fulB.medianPlacedToShippedH, 2.0) && near(fulB.medianShippedToDeliveredH, 2.0));
    check("11. median(): [] → null, [3] → 3, [1,3] → 2, [5,1,3] → 3", rep.median([]) === null && rep.median([3]) === 3 && rep.median([1, 3]) === 2 && rep.median([5, 1, 3]) === 3);

    // --- Movements CSV -----------------------------------------------------------------------------------
    const recvA = parseCsv(await rep.movementsCsv({ ownerId: A.id }, "RECEIVE", false));
    const dmgB = parseCsv(await rep.movementsCsv({ ownerId: B.id }, "DAMAGE", true));
    const allA = parseCsv(await rep.movementsCsv({ ownerId: A.id }, undefined, false));
    check("12. Movements CSV type filter: A RECEIVE → 2 rows (A1, A2) all RECEIVE; B DAMAGE → 1 row of −1; unfiltered A export has several types and only A's SKUs", recvA.rows.length === 2 && recvA.rows.every((r) => r.Type === "RECEIVE" && r.SKU.startsWith(`${RUN}-A`)) && dmgB.rows.length === 1 && dmgB.rows[0].Type === "DAMAGE" && dmgB.rows[0].Quantity === "-1" && dmgB.rows[0].Owner === `RP Vendor B ${RUN}` && new Set(allA.rows.map((r) => r.Type)).size >= 3 && allA.rows.every((r) => r.SKU.startsWith(`${RUN}-A`)), `recv=${recvA.rows.length} dmg=${dmgB.rows.length} types=${[...new Set(allA.rows.map((r) => r.Type))].join("|")}`);

    // --- CSV columns -------------------------------------------------------------------------------------
    const salesAdmin = parseCsv(rep.salesCsv(all, true));
    const salesPortal = parseCsv(rep.salesCsv(onlyA, false));
    const fulCsv = parseCsv(rep.fulfillmentCsv([ful!]));
    const actCsv = parseCsv(rep.ownerActivityCsv(act));
    check("13. CSV columns: Sales (admin has Owner / Owner Code / Owner Type, portal does not), Fulfilment, Owner activity, Movements (portal has no Owner column)", salesAdmin.headers.join(",") === "Owner,Owner Code,Owner Type,Source,Currency,Units,Units With Cost,Sales Value,Wholesale Cost,Gross Margin" && salesPortal.headers[0] === "Source" && !salesPortal.headers.includes("Owner") && salesPortal.rows.find((r) => r.Currency === "USD")?.["Gross Margin"] === "8.00" && fulCsv.headers.join(",") === "Warehouse,Warehouse Name,Shipped,Delivered,Returned,Cancelled,Median Hours Placed To Shipped,Median Hours Shipped To Delivered" && actCsv.headers.join(",") === "Owner,Owner Code,Type,Status,Units Received,Units Shipped,Units Returned,Units Damaged,Units Missing,Charges,Payable Balance,Receivable Balance" && recvA.headers.includes("Quantity") && !recvA.headers.includes("Owner") && dmgB.headers.includes("Owner"));

    // --- ADMIN-only owner activity -----------------------------------------------------------------------
    const route = readFileSync("src/app/api/reports/[report]/route.ts", "utf8");
    const view = readFileSync("src/components/reports/report-view.tsx", "utf8");
    const portalPages = ["src/app/portal/vendor/reports/page.tsx", "src/app/portal/3pl/reports/page.tsx"].map((f) => readFileSync(f, "utf8"));
    check("14. Owner activity is ADMIN-only: the CSV route returns 403 for any non-ADMIN role; portal tab lists exclude it; ReportView falls back to an allowed tab and renders it only for staff", route.includes('ADMIN_ONLY_REPORT_TYPES.includes(type) && user.role !== "ADMIN"') && !val.PORTAL_REPORT_TYPES.includes("owner-activity") && val.ADMIN_ONLY_REPORT_TYPES.includes("owner-activity") && portalPages.every((p) => p.includes("reports={PORTAL_REPORT_TYPES}")) && view.includes("reports.includes(rawQuery.report) ? rawQuery : { ...rawQuery, report: reports[0] }") && view.includes('query.report === "owner-activity" && isStaff &&'));

    // --- Regression: the five original reports ------------------------------------------------------------
    const skuA = await rep.skuActivityReport({ ownerId: A.id });
    const sumA = await rep.ordersSummaryReport({ ownerId: A.id });
    const shB = await rep.shipmentsReport({ ownerId: B.id });
    const rtA = await rep.returnsReport({ ownerId: A.id, status: "ALL" });
    const rtB = await rep.returnsReport({ ownerId: B.id, status: "ALL" });
    const invA = parseCsv(await rep.inventorySnapshotCsv({ ownerId: A.id }, false));
    check("15. Regression: SKU activity (A: A1 shipped 2, A2 shipped 1, only A's SKUs), Orders summary (A: 3 orders, 3 units shipped), Shipments (B: 1 shipment, only B's line), Returns (B 1, A 0), Inventory snapshot CSV (A, no Owner column) unchanged", skuA.every((r) => r.sku.startsWith(`${RUN}-A`)) && skuA.find((r) => r.sku === `${RUN}-A1`)?.shipped === 2 && skuA.find((r) => r.sku === `${RUN}-A2`)?.shipped === 1 && sumA.totalOrders === 3 && sumA.units.shipped === 3 && shB.total === 1 && shB.items[0].items.length === 1 && shB.items[0].items[0].orderItem.sku === `${RUN}-B1` && rtB.total === 1 && rtA.total === 0 && !invA.headers.includes("Owner") && invA.rows.length === 2 && invA.rows.every((r) => r.SKU.startsWith(`${RUN}-A`)), `orders=${sumA.totalOrders} shipped=${sumA.units.shipped} shB=${shB.total}`);
    check("16. Existing report tabs preserved in order and labels; new tabs appended (sales, fulfillment, movements, owner-activity)", ["activity", "orders", "shipments", "returns", "inventory"].every((t) => (val.REPORT_TYPES as readonly string[]).includes(t)) && (val.REPORT_TYPES as readonly string[]).includes("sales") && (val.REPORT_TYPES as readonly string[]).includes("fulfillment") && (val.REPORT_TYPES as readonly string[]).includes("movements") && val.REPORT_LABELS.activity.title === "SKU activity" && val.REPORT_LABELS.inventory.title === "Inventory snapshot");
  } finally {
    email.__setEmailTransportForTests(null);
    const orderIds = (await prisma.order.findMany({ where: { items: { some: { ownerId: { in: created.ownerIds } } } }, select: { id: true } })).map((o) => o.id);
    await prisma.adminNotification.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.ledgerEntry.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.charge.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.inventoryTransaction.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { variant: { productId: { in: created.productIds } } }] } });
    await prisma.returnItem.deleteMany({ where: { return: { orderId: { in: orderIds } } } });
    await prisma.return.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.shipmentItem.deleteMany({ where: { shipment: { orderId: { in: orderIds } } } });
    await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.fulfillmentItem.deleteMany({ where: { fulfillment: { orderId: { in: orderIds } } } });
    await prisma.fulfillment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.inventoryLevel.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.inventoryBalance.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingItem.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingRecord.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: created.productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    await prisma.location.deleteMany({ where: { warehouseId: { in: created.warehouseIds } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: created.warehouseIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...created.ownerIds, ...created.productIds, ...created.warehouseIds, ...orderIds] } }, { entityType: { in: ["ReceivingRecord", "Location", "Shipment", "Fulfillment", "Return"] }, createdAt: { gte: startedAt } }] } });
    await prisma.owner.deleteMany({ where: { id: { in: created.ownerIds } } });
    await prisma.$disconnect();
    console.log("Cleanup done.");
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
