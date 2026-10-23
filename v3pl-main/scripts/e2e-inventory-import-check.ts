/**
 * Inventory CSV import (INV-IMP). Service-level; no HTTP server needed. Creates temporary owners / warehouse /
 * products / import jobs and removes them in `finally`. Stock only ever moves through createReceiving.
 *
 * Usage: npm run e2e:inventory-import -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const RUN = `ii${Date.now().toString(36)}`.toUpperCase();
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const blank = { contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null };
const csv = (lines: string[]) => ["SKU,Quantity,Location,Barcode", ...lines].join("\n");

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { parseCsv } = await import("../src/lib/csv");
  const owners = await import("../src/server/services/owners");
  const products = await import("../src/server/services/products");
  const warehouses = await import("../src/server/services/warehouses");
  const charges = await import("../src/server/services/charges");
  const { chargeRuleFormSchema } = await import("../src/lib/validation/finance");
  const imports = await import("../src/server/services/imports");
  const inv = await import("../src/server/services/inventory-csv");
  const { stockForVariant } = await import("../src/server/services/inventory");
  const email = await import("../src/server/services/email");
  email.__setEmailTransportForTests(async () => ({ ok: true }));

  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });
  const created = { ownerIds: [] as string[], productIds: [] as string[], warehouseIds: [] as string[], ruleIds: [] as string[] };
  const startedAt = new Date();
  const asWarehouse = { id: admin.id, role: "WAREHOUSE" as const };
  const asSales = { id: admin.id, role: "SALES" as const };

  try {
    const A = await owners.createOwner("VENDOR", { code: `${RUN}-A`, businessName: `II Vendor A ${RUN}`, ...blank, chargesEnabled: true }, admin.id);
    const B = await owners.createOwner("VENDOR", { code: `${RUN}-B`, businessName: `II Vendor B ${RUN}`, ...blank }, admin.id);
    created.ownerIds.push(A.id, B.id);
    const W = await warehouses.createWarehouse({ code: `${RUN}-W`, name: "II Warehouse", addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null }, admin.id);
    created.warehouseIds.push(W.id);
    const def = (await warehouses.getDefaultLocation(W.id))!;
    const zone = await warehouses.createLocationNode(W.id, { type: "ZONE", parentId: null, code: "Z", notes: null }, admin.id);
    const rack = await warehouses.createLocationNode(W.id, { type: "RACK", parentId: zone.id, code: "01", notes: null }, admin.id);
    const shelf = await warehouses.createLocationNode(W.id, { type: "SHELF", parentId: rack.id, code: "01", notes: null }, admin.id);
    const bin = await warehouses.createLocationNode(W.id, { type: "BIN", parentId: shelf.id, code: "B1", notes: null }, admin.id);
    const pA = await products.createProduct({ ownerId: A.id, name: `II A ${RUN}`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-A1`, name: null, barcode: `${RUN}-BC1`, price: "10.00", cost: null, status: "ACTIVE" }, { sku: `${RUN}-A2`, name: null, barcode: null, price: "20.00", cost: null, status: "ACTIVE" }] }, admin.id);
    const pB = await products.createProduct({ ownerId: B.id, name: `II B ${RUN}`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-B1`, name: null, barcode: null, price: "8.00", cost: null, status: "ACTIVE" }] }, admin.id);
    created.productIds.push(pA.id, pB.id);
    const a1 = pA.variants.find((v) => v.sku === `${RUN}-A1`)!;
    const a2 = pA.variants.find((v) => v.sku === `${RUN}-A2`)!;
    const rule = await charges.createChargeRule(chargeRuleFormSchema.parse({ name: `II receiving ${RUN}`, chargeType: "RECEIVING", basis: "PER_UNIT", event: "RECEIVING", handlingCategory: "", amount: "0.50", active: true, ownerType: "VENDOR", ownerId: A.id, minWeightGrams: "", maxWeightGrams: "", minLongestCm: "", maxLongestCm: "", notes: "" }), admin.id);
    created.ruleIds.push(rule.id);
    const opts = { ownerId: A.id, warehouseId: W.id, reference: `${RUN}-REF` };
    const preview = (text: string, actor: { id: string; role: "ADMIN" | "WAREHOUSE" | "SALES" }) => imports.createInventoryImportPreview(`${RUN}.csv`, text, opts, actor);
    const rowErrors = (p: Awaited<ReturnType<typeof inv.previewInventoryCsv>>, i: number) => p.rows[i - 1]?.errors.join(" ") ?? "";

    // --- Permissions ------------------------------------------------------------------------------------
    const good = csv([`${RUN}-A1,5,${bin.label},`, `${RUN}-A2,7,,`, `,3,,${RUN}-BC1`]);
    const jAdmin = await preview(good, { id: admin.id, role: "ADMIN" });
    check("1. ADMIN can preview an inventory CSV (INVENTORY job in PREVIEW, all rows valid)", jAdmin.preview.summary.validRows === 3 && jAdmin.preview.summary.failedRows === 0 && (await prisma.importJob.findUniqueOrThrow({ where: { id: jAdmin.jobId } })).type === "INVENTORY");
    const jWh = await preview(good, asWarehouse);
    check("2. WAREHOUSE can preview an inventory CSV", jWh.preview.summary.validRows === 3);
    let salesErr = "";
    try {
      await preview(good, asSales);
    } catch (e) {
      salesErr = e instanceof imports.ImportServiceError ? e.code : String(e);
    }
    const actions = readFileSync("src/server/actions/imports.ts", "utf8");
    check("3. SALES is rejected for inventory import (service FORBIDDEN; preview action requires ADMIN / WAREHOUSE)", salesErr === "FORBIDDEN" && /previewInventoryImportAction[\s\S]*?requireRole\("ADMIN", "WAREHOUSE"\)/.test(actions));
    let portalErr = "";
    for (const role of ["VENDOR", "THREEPL_CLIENT", "AFFILIATE"] as const) {
      try {
        imports.assertRoleForJobType("INVENTORY", role);
      } catch (e) {
        portalErr += e instanceof imports.ImportServiceError ? e.code : "?";
      }
    }
    const importsPage = readFileSync("src/app/admin/(dashboard)/imports/page.tsx", "utf8");
    check("4. Vendor / 3PL / affiliate roles are rejected by the role matrix; the imports pages are staff-only (requireStaff via requireRole) and the card renders only for ADMIN / WAREHOUSE", portalErr === "FORBIDDENFORBIDDENFORBIDDEN" && importsPage.includes('(user.role === "ADMIN" || user.role === "WAREHOUSE") && <InventoryImportUploadForm'));

    // --- Row validation ---------------------------------------------------------------------------------
    const p1 = jAdmin.preview;
    check("5. Valid SKU row resolves to the variant, product and bin", p1.rows[0].variantId === a1.id && p1.rows[0].productName === `II A ${RUN}` && p1.rows[0].locationId === bin.id && p1.rows[0].quantity === 5);
    check("6. Barcode fallback: blank SKU + known barcode resolves to that variant", p1.rows[2].variantId === a1.id && p1.rows[2].variantSku === `${RUN}-A1`);
    const bad = await inv.previewInventoryCsv(csv([`${RUN}-B1,1,,`, `NOPE-${RUN},1,,`, `${RUN}-A1,0,,`, `${RUN}-A1,-2,,`, `${RUN}-A1,1.5,,`, `${RUN}-A1,abc,,`, `${RUN}-A2,1,${def.label},`, `${RUN}-A2,1,${def.label},`, `${RUN}-A1,1,NOWHERE-${RUN},`, `${RUN}-A1,1,${zone.label},`, `${RUN}-A1,1,${rack.label},`, `${RUN}-A1,1,${shelf.label},`, `,4,,`]), opts);
    check("7. SKU of another owner fails", rowErrors(bad, 1).includes("belongs to another owner"));
    check("8. Unknown SKU fails", rowErrors(bad, 2).includes("Unknown SKU"));
    check("9. Invalid quantities fail: 0, negative, decimal, non-numeric", [3, 4, 5, 6].every((i) => rowErrors(bad, i).includes("positive whole number")));
    check("10. Duplicate SKU + location in the same file fails the second row only", !rowErrors(bad, 7).includes("Duplicate") && rowErrors(bad, 8).includes("Duplicate"));
    check("11. Unknown location fails", rowErrors(bad, 9).includes("not found in warehouse"));
    check("12. Zone / rack / shelf locations are rejected (only bins and areas receive)", rowErrors(bad, 10).includes("is a zone") && rowErrors(bad, 11).includes("is a rack") && rowErrors(bad, 12).includes("is a shelf") && rowErrors(bad, 13).includes("SKU (or Barcode) is required"));
    check("13. Blank location uses the warehouse default location", p1.rows[1].locationId === def.id && p1.rows[1].resolvedLocation === `${def.label} (default)`);
    const big = csv(Array.from({ length: 501 }, () => `${RUN}-A1,1,,`));
    let bigErr = "";
    try {
      await preview(big, { id: admin.id, role: "ADMIN" });
    } catch (e) {
      bigErr = e instanceof imports.ImportServiceError ? e.code : String(e);
    }
    check("14. More than 500 rows is refused", bigErr === "TOO_LARGE" && inv.INVENTORY_MAX_ROWS === 500);

    // --- Confirm ----------------------------------------------------------------------------------------
    const jBad = await preview(csv([`${RUN}-A1,5,,`, `NOPE-${RUN},1,,`]), { id: admin.id, role: "ADMIN" });
    const stockBefore = await stockForVariant(a1.id);
    let badConfirm = "";
    try {
      await imports.confirmImportJob(jBad.jobId, admin.id, "ADMIN");
    } catch (e) {
      badConfirm = e instanceof imports.ImportServiceError ? e.code : String(e);
    }
    const jBadRow = await prisma.importJob.findUniqueOrThrow({ where: { id: jBad.jobId } });
    const stockAfterBad = await stockForVariant(a1.id);
    const receiptsAfterBad = await prisma.receivingRecord.count({ where: { ownerId: A.id } });
    check("15. Any failed row prevents confirmation: job → FAILED, no receipt, stock unchanged; confirm button count is 0 in the UI", badConfirm === "INVALID_ROWS" && jBadRow.status === "FAILED" && receiptsAfterBad === 0 && JSON.stringify(stockAfterBad) === JSON.stringify(stockBefore) && readFileSync("src/app/admin/(dashboard)/imports/[id]/page.tsx", "utf8").includes("validCount={failed > 0 ? 0 : preview.summary.validRows}"));

    const outcome = (await imports.confirmImportJob(jWh.jobId, admin.id, "WAREHOUSE")) as { receivingId: string; lines: number; units: number };
    const receipt = await prisma.receivingRecord.findUnique({ where: { id: outcome.receivingId }, include: { items: true } });
    const ledger = await prisma.inventoryTransaction.findMany({ where: { receivingId: outcome.receivingId }, select: { type: true, quantity: true, variantId: true, locationId: true } });
    check("16. Successful confirmation creates ONE receipt (3 lines, 15 units) and RECEIVE ledger rows through createReceiving", !!receipt && receipt.reference === `${RUN}-REF` && receipt.items.length === 3 && outcome.units === 15 && ledger.length === 3 && ledger.every((l) => l.type === "RECEIVE") && (await prisma.importJob.findUniqueOrThrow({ where: { id: jWh.jobId } })).status === "COMPLETED");
    const levels = await prisma.inventoryLevel.findMany({ where: { variant: { productId: pA.id }, warehouseId: W.id }, select: { variantId: true, locationId: true, onHand: true } });
    const a1Bin = levels.find((l) => l.variantId === a1.id && l.locationId === bin.id)?.onHand;
    const a1Def = levels.find((l) => l.variantId === a1.id && l.locationId === def.id)?.onHand;
    const a2Def = levels.find((l) => l.variantId === a2.id && l.locationId === def.id)?.onHand;
    check("17. Imported stock sits in the right warehouse and locations (A1: 5 in the bin + 3 in default via barcode row; A2: 7 in default)", a1Bin === 5 && a1Def === 3 && a2Def === 7 && (await stockForVariant(a1.id)).reduce((s, b) => s + b.onHand, 0) === 8);
    const chargeRows = await prisma.charge.findMany({ where: { ownerId: A.id, event: "RECEIVING" }, select: { amount: true, quantity: true } });
    // recordEventCharges dedupes PER_UNIT charges per variant within one receipt (existing behaviour), so a SKU on two
    // lines is charged once: one charge per distinct variant, amount = 0.50 × that charge's quantity.
    const chargeTotal = chargeRows.reduce((s, c) => s + Number(c.amount), 0);
    const chargeUnits = chargeRows.reduce((s, c) => s + (c.quantity ?? 0), 0);
    check("18. Existing receiving charges still apply for the charges-enabled owner (one PER_UNIT 0.50 charge per distinct SKU on the receipt, amounts consistent)", chargeRows.length === 2 && chargeUnits > 0 && Math.abs(chargeTotal - 0.5 * chargeUnits) < 0.001, `${chargeRows.length} charge(s), ${chargeUnits} units, ${chargeTotal.toFixed(2)}`);

    // Failed confirmation (live catalogue changed after preview) leaves inventory unchanged.
    const jLate = await preview(csv([`${RUN}-A2,4,,`, `${RUN}-B1,1,,`]), { id: admin.id, role: "ADMIN" });
    await prisma.productVariant.update({ where: { id: a2.id }, data: { status: "ARCHIVED" } });
    const beforeLate = await stockForVariant(a2.id);
    let lateErr = "";
    try {
      await imports.confirmImportJob(jLate.jobId, admin.id, "ADMIN");
    } catch (e) {
      lateErr = e instanceof imports.ImportServiceError ? e.code : String(e);
    }
    await prisma.productVariant.update({ where: { id: a2.id }, data: { status: "ACTIVE" } });
    check("19. Failed confirmation (SKU archived after preview) re-validates live, rolls nothing in, inventory unchanged, job FAILED", lateErr === "INVALID_ROWS" && JSON.stringify(await stockForVariant(a2.id)) === JSON.stringify(beforeLate) && (await prisma.receivingRecord.count({ where: { ownerId: A.id } })) === 1 && (await prisma.importJob.findUniqueOrThrow({ where: { id: jLate.jobId } })).status === "FAILED");
    let twice = "";
    try {
      await imports.confirmImportJob(jWh.jobId, admin.id, "ADMIN");
    } catch (e) {
      twice = e instanceof imports.ImportServiceError ? e.code : String(e);
    }
    check("20. The same job cannot be confirmed twice (BAD_STATUS, still one receipt)", twice === "BAD_STATUS" && (await prisma.receivingRecord.count({ where: { ownerId: A.id } })) === 1);
    const failedCsv = await imports.failedRowsCsvForJob(jBad.jobId);
    const parsedFailed = failedCsv ? parseCsv(failedCsv.csv.replace(/^﻿/, "")) : null;
    check("21. Existing failed-rows download works for inventory jobs (only failed rows, with Row + Errors columns)", !!parsedFailed && parsedFailed.rows.length === 1 && parsedFailed.rows[0].SKU === `NOPE-${RUN}` && parsedFailed.headers.includes("Errors") && parsedFailed.rows[0].Errors.includes("Unknown SKU"));
    const audit = await prisma.auditLog.findFirst({ where: { action: "import.completed", entityId: jWh.jobId } });
    const auditReceipt = await prisma.auditLog.count({ where: { action: "inventory.received", entityId: outcome.receivingId } });
    check("22. Completion audit recorded for the job (type INVENTORY, receivingId) plus the receipt's own inventory.received audit", !!audit && (audit.newValues as { type?: string; receivingId?: string }).type === "INVENTORY" && (audit.newValues as { receivingId?: string }).receivingId === outcome.receivingId && auditReceipt === 1);
    const svc = readFileSync("src/server/services/imports.ts", "utf8");
    const invSvc = readFileSync("src/server/services/inventory-csv.ts", "utf8");
    check("23. Orders / products import unchanged: their role matrix is ADMIN+SALES / ADMIN, role is optional for existing callers, the ORDERS and PRODUCTS confirm branches are intact, and the inventory module never touches inventory tables", JSON.stringify(imports.IMPORT_ROLES.ORDERS) === '["ADMIN","SALES"]' && JSON.stringify(imports.IMPORT_ROLES.PRODUCTS) === '["ADMIN"]' && svc.includes("if (!role) return;") && svc.includes('if (job.type === "PRODUCTS") {') && svc.includes("await executeOrderImport(fresh, options, actorId);") && !/inventoryBalance|inventoryLevel|inventoryTransaction/.test(invSvc) && !invSvc.includes('from "@/server/services/receiving"') && svc.includes("await createReceiving(buildReceivingValues(fresh, job.fileName), actorId);"));
  } finally {
    email.__setEmailTransportForTests(null);
    await prisma.importJob.deleteMany({ where: { type: "INVENTORY", fileName: `${RUN}.csv` } });
    await prisma.adminNotification.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.ledgerEntry.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.charge.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.chargeRule.deleteMany({ where: { id: { in: created.ruleIds } } });
    await prisma.inventoryTransaction.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.inventoryLevel.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.inventoryBalance.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingItem.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingRecord.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: created.productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    for (const type of ["BIN", "SHELF", "RACK", "ZONE", "AREA"] as const) await prisma.location.deleteMany({ where: { warehouseId: { in: created.warehouseIds }, type } });
    await prisma.warehouse.deleteMany({ where: { id: { in: created.warehouseIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...created.ownerIds, ...created.productIds, ...created.warehouseIds, ...created.ruleIds] } }, { entityType: { in: ["ReceivingRecord", "Location", "ImportJob", "ChargeRule"] }, createdAt: { gte: startedAt } }] } });
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
