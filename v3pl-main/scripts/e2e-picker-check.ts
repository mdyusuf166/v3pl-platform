/**
 * Shared Product → Variant picker data layer (D-072): `browseCatalog` grouping, search modes and scoping,
 * plus the session-scope rules the action applies. Service-level; no HTTP server needed.
 *
 * Usage: npm run e2e:picker -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const RUN = `pk${Date.now().toString(36)}`.toUpperCase();
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const blank = { contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null };

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const owners = await import("../src/server/services/owners");
  const products = await import("../src/server/services/products");
  const warehouses = await import("../src/server/services/warehouses");
  const receiving = await import("../src/server/services/receiving");
  const orders = await import("../src/server/services/orders");
  const aff = await import("../src/server/services/affiliates");
  const { variantSearchScope } = await import("../src/lib/variant-search-scope");
  const { affiliateFormSchema } = await import("../src/lib/validation/affiliates");

  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });
  const created = { ownerIds: [] as string[], productIds: [] as string[], warehouseIds: [] as string[], affiliateIds: [] as string[], orderIds: [] as string[] };

  try {
    const V = await owners.createOwner("VENDOR", { code: `${RUN}-V`, businessName: `PK Vendor ${RUN}`, ...blank }, admin.id);
    const C = await owners.createOwner("THREEPL_CLIENT", { code: `${RUN}-C`, businessName: `PK Client ${RUN}`, ...blank }, admin.id);
    created.ownerIds.push(V.id, C.id);
    const W = await warehouses.createWarehouse({ code: `${RUN}-W`, name: "PK Warehouse", addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null }, admin.id);
    created.warehouseIds.push(W.id);
    const loc = (await warehouses.getDefaultLocation(W.id))!;
    const tee = await products.createProduct({ ownerId: V.id, name: `${RUN} Classic T-Shirt`, category: null, description: null, notes: null, status: "ACTIVE", options: ["Color", "Size"], variants: [
      { sku: `${RUN}-TS-BLK-M`, optionValues: ["Black", "M"], name: null, barcode: `${RUN}BC1`, price: "10.00", cost: null, status: "ACTIVE" },
      { sku: `${RUN}-TS-BLK-L`, optionValues: ["Black", "L"], name: null, barcode: null, price: "10.00", cost: null, status: "ACTIVE" },
      { sku: `${RUN}-TS-WHT-M`, optionValues: ["White", "M"], name: null, barcode: null, price: "10.00", cost: null, status: "ACTIVE" },
    ] }, admin.id);
    const pants = await products.createProduct({ ownerId: V.id, name: `${RUN} Baggy Pants`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-BP`, name: null, barcode: null, price: "20.00", cost: null, status: "ACTIVE" }] }, admin.id);
    const panjabi = await products.createProduct({ ownerId: C.id, name: `${RUN} Panjabi`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-PJ`, name: null, barcode: null, price: "30.00", cost: null, status: "ACTIVE" }] }, admin.id);
    created.productIds.push(tee.id, pants.id, panjabi.id);
    const blkM = tee.variants.find((v) => v.sku.endsWith("TS-BLK-M"))!;
    const blkL = tee.variants.find((v) => v.sku.endsWith("TS-BLK-L"))!;
    // Stock: BLK-M 12 on hand, 2 reserved by an order → available 10; BLK-L 8; others 0.
    await receiving.createReceiving({ ownerId: V.id, warehouseId: W.id, reference: `${RUN}-R`, notes: null, lines: [{ variantId: blkM.id, locationId: loc.id, quantity: 12 }, { variantId: blkL.id, locationId: loc.id, quantity: 8 }] }, admin.id);
    const o = await orders.createOrder({ source: "MANUAL", warehouseId: W.id, reserve: true, lines: [{ variantId: blkM.id, quantity: 2 }] }, admin.id);
    created.orderIds.push(o.orderId);

    // 1. Browse (empty query) — grouped by product, variants inside, availability from the existing figure.
    const browse = await products.browseCatalog("", { ownerId: V.id });
    const teeRow = browse.products.find((p) => p.id === tee.id);
    check("1. Browse without a SKU: vendor scope lists its 2 products grouped, T-Shirt has 3 variants with options; Panjabi (other owner) absent", browse.total === 2 && !!teeRow && teeRow.variants.length === 3 && teeRow.options.join("/") === "Color/Size" && !browse.products.some((p) => p.id === panjabi.id));
    check("2. Available = on hand − reserved via the existing balances: BLK-M 12 − 2 = 10, BLK-L 8, WHT-M 0", teeRow?.variants.find((v) => v.id === blkM.id)?.available === 10 && teeRow?.variants.find((v) => v.id === blkL.id)?.available === 8 && teeRow?.variants.find((v) => v.sku.endsWith("WHT-M"))?.available === 0);
    // 3. Product-name search.
    const byName = await products.browseCatalog(`${RUN} Classic`, {});
    check("3. Product-name search: 'Classic' finds the T-Shirt only, with all 3 variants and no variant flagged as the match", byName.products.length === 1 && byName.products[0].id === tee.id && byName.products[0].variants.length === 3 && byName.products[0].variants.every((v) => !v.matches));
    // 4. Variant option search ("Black / M" label).
    const byOption = await products.browseCatalog("Black / M", { ownerId: V.id });
    check("4. Variant search by option label: 'Black / M' finds the T-Shirt with exactly that variant flagged", byOption.products.some((p) => p.id === tee.id) && byOption.products.find((p) => p.id === tee.id)!.variants.filter((v) => v.matches).map((v) => v.id).join() === blkM.id);
    // 5. SKU and barcode search.
    const bySku = await products.browseCatalog(`${RUN}-TS-BLK-M`, {});
    const byBarcode = await products.browseCatalog(`${RUN}BC1`, {});
    check("5. SKU search still works: exact SKU → the T-Shirt with BLK-M flagged; barcode search flags the same variant", bySku.products.length === 1 && bySku.products[0].variants.find((v) => v.matches)?.id === blkM.id && byBarcode.products.length === 1 && byBarcode.products[0].variants.find((v) => v.matches)?.id === blkM.id);
    // 6. Scopes: admin (all owners), owner filter, affiliate variant ids.
    const all = await products.browseCatalog(RUN, {});
    const only3pl = await products.browseCatalog(RUN, { ownerId: C.id });
    check("6. Admin scope sees every owner (3 products); 3PL owner scope sees only Panjabi", all.total === 3 && only3pl.total === 1 && only3pl.products[0].id === panjabi.id);
    const A = await aff.createAffiliate(affiliateFormSchema.parse({ code: `${RUN}-A`, name: `PK Affiliate ${RUN}`, email: "", phone: "", status: "ACTIVE", commissionType: "", commissionValue: "", notes: "" }), admin.id);
    created.affiliateIds.push(A.id);
    await aff.setAssignedOwners(A.id, [V.id], admin.id);
    await aff.assignVariantBySku(A.id, { sku: blkL.sku, commissionType: null, commissionValue: null }, admin.id);
    const affIds = await aff.assignedVariantIds(A.id);
    const affBrowse = await products.browseCatalog("", { variantIds: affIds });
    const affSku = await products.browseCatalog(`${RUN}-TS-BLK-M`, { variantIds: affIds });
    const none = await products.browseCatalog("", { variantIds: [] });
    check("7. Affiliate scope: only the assigned variant appears (T-Shirt with just BLK-L, 3 variants → 1); searching an unassigned SKU finds nothing; no assignments → empty", affBrowse.total === 1 && affBrowse.products[0].id === tee.id && affBrowse.products[0].variants.length === 1 && affBrowse.products[0].variants[0].id === blkL.id && affSku.total === 0 && none.total === 0);
    // 8. Session-scope rule the action applies (pure): staff honours a filter, portal users are pinned, no session refused.
    const staff = variantSearchScope({ role: "ADMIN", ownerId: null }, C.id);
    const vendor = variantSearchScope({ role: "VENDOR", ownerId: V.id }, C.id);
    const anon = variantSearchScope(null, undefined);
    check("8. Action scope rules: staff filter honoured; a vendor session asking for another owner is pinned to its own owner; no session → refused", staff.ok && staff.ownerId === C.id && vendor.ok && vendor.ownerId === V.id && !anon.ok);
    // 9. Archived variants / products never offered.
    await prisma.productVariant.update({ where: { id: blkL.id }, data: { status: "ARCHIVED" } });
    const afterArchive = await products.browseCatalog(`${RUN} Classic`, {});
    check("9. Archived variants are excluded from the picker", afterArchive.products[0].variants.length === 2 && !afterArchive.products[0].variants.some((v) => v.id === blkL.id));
    // 10. Downstream contract unchanged: order creation with the picked variant id still reserves as before.
    const o2 = await orders.createOrder({ source: "MANUAL", warehouseId: W.id, reserve: true, lines: [{ variantId: blkM.id, quantity: 3 }] }, admin.id);
    created.orderIds.push(o2.orderId);
    const bal = await prisma.inventoryBalance.findUniqueOrThrow({ where: { variantId_warehouseId: { variantId: blkM.id, warehouseId: W.id } } });
    check("10. Existing order creation unchanged: picked variant id → order line + reservation (reserved 2 → 5, on hand 12)", o2.created && bal.reserved === 5 && bal.onHand === 12);
  } finally {
    const orderIds = created.orderIds;
    await prisma.inventoryTransaction.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { variant: { productId: { in: created.productIds } } }] } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.affiliateVariant.deleteMany({ where: { affiliateId: { in: created.affiliateIds } } });
    await prisma.affiliateOwner.deleteMany({ where: { affiliateId: { in: created.affiliateIds } } });
    await prisma.affiliate.deleteMany({ where: { id: { in: created.affiliateIds } } });
    await prisma.inventoryLevel.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.inventoryBalance.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingItem.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingRecord.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: created.productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    await prisma.location.deleteMany({ where: { warehouseId: { in: created.warehouseIds } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: created.warehouseIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...created.ownerIds, ...created.productIds, ...created.warehouseIds, ...created.affiliateIds, ...orderIds] } }, { entityType: { in: ["ReceivingRecord", "Location"] }, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } }] } }).catch(() => undefined);
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
