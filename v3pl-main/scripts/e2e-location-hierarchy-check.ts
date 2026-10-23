/**
 * Warehouse location hierarchy (D-069): Warehouse → Zone → Rack → Shelf → Bin as Location rows.
 * Service-level; no HTTP server needed. Creates temporary data and removes it.
 *
 * Usage: npm run e2e:locations -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const RUN = `lh${Date.now().toString(36)}`.toUpperCase();
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const expectError = async (fn: () => Promise<unknown>, code: string) => {
  try {
    await fn();
    return { hit: false, message: "" };
  } catch (e) {
    return { hit: (e as { code?: string }).code === code, message: (e as Error).message };
  }
};

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const owners = await import("../src/server/services/owners");
  const products = await import("../src/server/services/products");
  const warehouses = await import("../src/server/services/warehouses");
  const receiving = await import("../src/server/services/receiving");
  const inventory = await import("../src/server/services/inventory");
  const { locationPath, locationNodeSchema } = await import("../src/lib/validation/warehouses");

  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });
  const created = { ownerIds: [] as string[], productIds: [] as string[], warehouseIds: [] as string[] };

  try {
    // Existing data snapshot: every pre-existing location is a flat AREA without parent, and stock rows are untouched.
    const legacy = await prisma.location.count({ where: { createdAt: { lt: new Date(Date.now() - 60_000) } } });
    const legacyArea = await prisma.location.count({ where: { createdAt: { lt: new Date(Date.now() - 60_000) }, type: "AREA", parentId: null } });
    const levelsBefore = await prisma.inventoryLevel.count();
    check("Existing locations survive the migration as flat AREA rows without parent (no data rewritten)", legacy === legacyArea && legacy > 0, `${legacyArea}/${legacy} legacy locations, ${levelsBefore} stock rows`);

    const W = await warehouses.createWarehouse({ code: `${RUN}-W`, name: `${RUN} Dhaka Warehouse`, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null }, admin.id);
    const W2 = await warehouses.createWarehouse({ code: `${RUN}-W2`, name: `${RUN} Other`, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null }, admin.id);
    created.warehouseIds.push(W.id, W2.id);
    const main = (await warehouses.getDefaultLocation(W.id))!;
    const mainRow = await prisma.location.findUniqueOrThrow({ where: { id: main.id } });
    check("1. Create warehouse: default MAIN is a flat AREA storage location (isDefault, no parent)", mainRow.type === "AREA" && mainRow.parentId === null && mainRow.isDefault && mainRow.label === "MAIN");

    const zone = await warehouses.createLocationNode(W.id, { type: "ZONE", parentId: null, code: "A", notes: null }, admin.id);
    check("2. Create Zone under warehouse: type ZONE, no parent, label A, zone column A", zone.type === "ZONE" && zone.parentId === null && zone.label === "A" && zone.zone === "A");
    const rack = await warehouses.createLocationNode(W.id, { type: "RACK", parentId: zone.id, code: "01", notes: null }, admin.id);
    check("3. Create Rack under zone: parent = zone, label A-01, path columns zone A / rack 01", rack.type === "RACK" && rack.parentId === zone.id && rack.label === "A-01" && rack.zone === "A" && rack.rack === "01");
    const shelf = await warehouses.createLocationNode(W.id, { type: "SHELF", parentId: rack.id, code: "01", notes: null }, admin.id);
    check("4. Create Shelf under rack: label A-01-01", shelf.type === "SHELF" && shelf.parentId === rack.id && shelf.label === "A-01-01");
    const bin = await warehouses.createLocationNode(W.id, { type: "BIN", parentId: shelf.id, code: "A01", notes: null }, admin.id);
    check("5. Create Bin under shelf: label A-01-01-A01, readable path Zone A / Rack 01 / Shelf 01 / Bin A01", bin.type === "BIN" && bin.parentId === shelf.id && bin.label === "A-01-01-A01" && bin.bin === "A01" && locationPath(bin) === "Zone A / Rack 01 / Shelf 01 / Bin A01");

    // Invalid parents
    const zoneWithParent = await expectError(() => warehouses.createLocationNode(W.id, { type: "ZONE", parentId: zone.id, code: "B", notes: null }, admin.id), "INVALID_PARENT");
    const rackNoParent = await expectError(() => warehouses.createLocationNode(W.id, { type: "RACK", parentId: null, code: "02", notes: null }, admin.id), "INVALID_PARENT");
    const shelfUnderZone = await expectError(() => warehouses.createLocationNode(W.id, { type: "SHELF", parentId: zone.id, code: "02", notes: null }, admin.id), "INVALID_PARENT");
    const binUnderRack = await expectError(() => warehouses.createLocationNode(W.id, { type: "BIN", parentId: rack.id, code: "B01", notes: null }, admin.id), "INVALID_PARENT");
    const rackUnderShelf = await expectError(() => warehouses.createLocationNode(W.id, { type: "RACK", parentId: shelf.id, code: "03", notes: null }, admin.id), "INVALID_PARENT");
    const binUnderMain = await expectError(() => warehouses.createLocationNode(W.id, { type: "BIN", parentId: main.id, code: "B01", notes: null }, admin.id), "INVALID_PARENT");
    check("6. Invalid parents rejected: zone with parent, rack without parent, shelf under zone, bin under rack, rack under shelf, bin under a flat area", zoneWithParent.hit && rackNoParent.hit && shelfUnderZone.hit && binUnderRack.hit && rackUnderShelf.hit && binUnderMain.hit, binUnderRack.message);
    const otherWh = await expectError(() => warehouses.createLocationNode(W2.id, { type: "RACK", parentId: zone.id, code: "01", notes: null }, admin.id), "INVALID_PARENT");
    const unknown = await expectError(() => warehouses.createLocationNode(W.id, { type: "RACK", parentId: "does-not-exist", code: "01", notes: null }, admin.id), "INVALID_PARENT");
    check("7. Parent from another warehouse / unknown parent rejected (no orphans, no cross-warehouse links)", otherWh.hit && unknown.hit);
    const dupRack = await expectError(() => warehouses.createLocationNode(W.id, { type: "RACK", parentId: zone.id, code: "01", notes: null }, admin.id), "LABEL_TAKEN");
    const dupZone = await expectError(() => warehouses.createLocationNode(W.id, locationNodeSchema.parse({ type: "ZONE", parentId: null, code: "a", notes: "" }), admin.id), "LABEL_TAKEN");
    const zoneB = await warehouses.createLocationNode(W.id, { type: "ZONE", parentId: null, code: "B", notes: null }, admin.id);
    const rackB01 = await warehouses.createLocationNode(W.id, { type: "RACK", parentId: zoneB.id, code: "01", notes: null }, admin.id);
    check("8. Duplicate code among siblings rejected (case-insensitive); the same code under a different parent is allowed (B-01)", dupRack.hit && dupZone.hit && rackB01.label === "B-01");

    // Inventory at the bin; containers refuse stock.
    const V = await owners.createOwner("VENDOR", { code: `${RUN}-V`, businessName: `LH Vendor ${RUN}`, contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null }, admin.id);
    created.ownerIds.push(V.id);
    const p = await products.createProduct({ ownerId: V.id, name: `LH Widget ${RUN}`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-S1`, name: null, barcode: null, price: "5.00", cost: null, status: "ACTIVE" }] }, admin.id);
    created.productIds.push(p.id);
    const v = p.variants[0];
    await receiving.createReceiving({ ownerId: V.id, warehouseId: W.id, reference: `${RUN}-R1`, notes: null, lines: [{ variantId: v.id, locationId: bin.id, quantity: 7 }] }, admin.id);
    const lvl = await prisma.inventoryLevel.findUnique({ where: { variantId_warehouseId_locationId: { variantId: v.id, warehouseId: W.id, locationId: bin.id } } });
    const bal = await prisma.inventoryBalance.findUnique({ where: { variantId_warehouseId: { variantId: v.id, warehouseId: W.id } } });
    const byLoc = await warehouses.warehouseStockByLocation(W.id);
    check("9. Inventory can be received into the bin: level at the bin = 7, warehouse balance 7, stock-by-location map reports the bin", lvl?.onHand === 7 && bal?.onHand === 7 && byLoc[bin.id] === 7);
    const intoShelf = await expectError(() => receiving.createReceiving({ ownerId: V.id, warehouseId: W.id, reference: `${RUN}-R2`, notes: null, lines: [{ variantId: v.id, locationId: shelf.id, quantity: 1 }] }, admin.id), "LOCATION_INVALID");
    const intoZone = await expectError(() => inventory.adjustStock({ userId: admin.id, variantId: v.id, warehouseId: W.id, locationId: zone.id, kind: "ADJUSTMENT_IN", quantity: 1, reason: "test" }), "LOCATION_INVALID");
    check("10. Stock cannot be placed at a shelf or a zone (inventory service guard) — bins and flat areas only", intoShelf.hit && intoZone.hit, intoShelf.message);
    const pickers = await warehouses.listLocations(W.id);
    check("11. Location pickers list only storage locations: MAIN (default first) and the bin; zones / racks / shelves hidden", pickers.length === 2 && pickers[0].label === "MAIN" && pickers[1].id === bin.id);
    const stockView = await inventory.stockForVariant(v.id);
    check("12. Existing inventory queries keep working and show the bin's full path label (A-01-01-A01)", stockView.length === 1 && stockView[0].onHand === 7 && stockView[0].locations[0].label === "A-01-01-A01");

    // Unsafe deletion / deactivation
    const delShelf = await expectError(() => warehouses.deleteLocation(shelf.id, admin.id), "HAS_CHILDREN");
    const delBin = await expectError(() => warehouses.deleteLocation(bin.id, admin.id), "HAS_HISTORY");
    const deactZone = await expectError(() => warehouses.setLocationActive(zone.id, false, admin.id), "HAS_STOCK");
    const zoneAfter = await prisma.location.findUniqueOrThrow({ where: { id: zone.id }, select: { isActive: true } });
    check("13. Unsafe deletion rejected: shelf with a bin inside (HAS_CHILDREN), bin with stock/history (HAS_HISTORY); zone containing stock cannot be deactivated and stays active", delShelf.hit && delBin.hit && deactZone.hit && zoneAfter.isActive, deactZone.message);
    const asDefault = await expectError(() => warehouses.setDefaultLocation(rack.id, admin.id), "INVALID_PARENT");
    check("14. A rack cannot become the default storage location; a bin can", asDefault.hit && (await warehouses.setDefaultLocation(bin.id, admin.id)).id === bin.id);
    await warehouses.setDefaultLocation(main.id, admin.id);

    // Rename cascades labels; deactivate an empty zone cascades; reactivating a child under an inactive parent is refused.
    await warehouses.updateLocationNode(zone.id, { code: "Z", notes: "renamed" }, admin.id);
    const binAfter = await prisma.location.findUniqueOrThrow({ where: { id: bin.id } });
    const lvlAfter = await prisma.inventoryLevel.findUnique({ where: { variantId_warehouseId_locationId: { variantId: v.id, warehouseId: W.id, locationId: bin.id } } });
    check("15. Renaming a zone relabels every descendant (bin → Z-01-01-A01) while the bin keeps its id and its stock", binAfter.label === "Z-01-01-A01" && binAfter.zone === "Z" && lvlAfter?.onHand === 7);
    const clashRename = await expectError(() => warehouses.updateLocationNode(zoneB.id, { code: "Z", notes: null }, admin.id), "LABEL_TAKEN");
    check("16. Renaming into an existing sibling code is rejected", clashRename.hit);
    await warehouses.setLocationActive(zoneB.id, false, admin.id);
    const rackB01After = await prisma.location.findUniqueOrThrow({ where: { id: rackB01.id }, select: { isActive: true } });
    const reactChild = await expectError(() => warehouses.setLocationActive(rackB01.id, true, admin.id), "INACTIVE");
    const addUnderInactive = await expectError(() => warehouses.createLocationNode(W.id, { type: "RACK", parentId: zoneB.id, code: "02", notes: null }, admin.id), "INACTIVE");
    check("17. Deactivating an empty zone deactivates its contents; a child cannot be reactivated or added under an inactive parent", !rackB01After.isActive && reactChild.hit && addUnderInactive.hit);
    const legacyEdit = await expectError(() => warehouses.updateLocation(bin.id, { label: "X", zone: null, rack: null, shelf: null, bin: null, notes: null }, admin.id), "INVALID_PARENT");
    check("18. The legacy flat-area form cannot rewrite a hierarchy node's path", legacyEdit.hit);
    const levelsAfter = await prisma.inventoryLevel.count();
    check("19. No duplicate inventory records were created by the hierarchy (exactly one new level row for the received bin)", levelsAfter === levelsBefore + 1, `${levelsBefore} → ${levelsAfter}`);
  } finally {
    await prisma.inventoryTransaction.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.inventoryLevel.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.inventoryBalance.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingItem.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingRecord.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: created.productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    // Delete deepest nodes first (self-referencing RESTRICT FK).
    for (const type of ["BIN", "SHELF", "RACK", "ZONE", "AREA"] as const) await prisma.location.deleteMany({ where: { warehouseId: { in: created.warehouseIds }, type } });
    await prisma.warehouse.deleteMany({ where: { id: { in: created.warehouseIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...created.ownerIds, ...created.productIds, ...created.warehouseIds] } }, { entityType: { in: ["ReceivingRecord", "Location"] }, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } }] } }).catch(() => undefined);
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
