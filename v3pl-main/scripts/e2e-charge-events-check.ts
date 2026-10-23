/**
 * Operational charge rules by event + handling category (D-071). Service-level; no HTTP server needed.
 * Creates temporary owners, products, warehouse, rules, orders, returns and removes them.
 *
 * Usage: npm run e2e:charge-events -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const RUN = `ce${Date.now().toString(36)}`.toUpperCase();
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const eq = (a: number | { toString(): string }, b: number) => Math.abs(Number(a) - b) < 0.005;
const blank = { contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null };

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const owners = await import("../src/server/services/owners");
  const products = await import("../src/server/services/products");
  const warehouses = await import("../src/server/services/warehouses");
  const receiving = await import("../src/server/services/receiving");
  const orders = await import("../src/server/services/orders");
  const fulfillment = await import("../src/server/services/fulfillment");
  const returns = await import("../src/server/services/returns");
  const charges = await import("../src/server/services/charges");
  const finance = await import("../src/server/services/finance");
  const { chargeRuleFormSchema } = await import("../src/lib/validation/finance");

  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });
  const created = { ownerIds: [] as string[], productIds: [] as string[], warehouseIds: [] as string[], ruleIds: [] as string[] };
  const commissionsBefore = await prisma.affiliateCommission.count();

  try {
    const V = await owners.createOwner("VENDOR", { code: `${RUN}-V`, businessName: `CE Vendor ${RUN}`, ...blank, chargesEnabled: true }, admin.id);
    const C = await owners.createOwner("THREEPL_CLIENT", { code: `${RUN}-C`, businessName: `CE Client ${RUN}`, ...blank, chargesEnabled: true }, admin.id);
    const N = await owners.createOwner("VENDOR", { code: `${RUN}-N`, businessName: `CE NoCharges ${RUN}`, ...blank }, admin.id);
    created.ownerIds.push(V.id, C.id, N.id);
    const W = await warehouses.createWarehouse({ code: `${RUN}-W`, name: "CE Warehouse", addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null }, admin.id);
    created.warehouseIds.push(W.id);
    const loc = (await warehouses.getDefaultLocation(W.id))!;
    const mk = async (ownerId: string, tag: string, category: "SMALL" | "MEDIUM" | "HIGH" | undefined) => {
      const p = await products.createProduct({ ownerId, name: `CE ${tag} ${RUN}`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-${tag}`, name: null, barcode: null, price: "10.00", wholesalePrice: "4.00", cost: null, status: "ACTIVE", ...(category ? { handlingCategory: category } : {}) }] }, admin.id);
      created.productIds.push(p.id);
      return p.variants[0];
    };
    const vS = await mk(V.id, "S", "SMALL");
    const vH = await mk(V.id, "H", "HIGH");
    const vD = await mk(V.id, "D", undefined); // default
    const cM = await mk(C.id, "M", "MEDIUM");
    const nX = await mk(N.id, "X", "HIGH");
    const cats = await prisma.productVariant.findMany({ where: { id: { in: [vS.id, vH.id, vD.id, cM.id] } }, select: { id: true, handlingCategory: true } });
    const cat = (id: string) => cats.find((c) => c.id === id)?.handlingCategory;
    check("1. Handling category on the variant: SMALL / HIGH / MEDIUM saved; a variant without a value defaults to MEDIUM", cat(vS.id) === "SMALL" && cat(vH.id) === "HIGH" && cat(cM.id) === "MEDIUM" && cat(vD.id) === "MEDIUM");

    // Rules
    const rule = async (v: Record<string, unknown>) => {
      const r = await charges.createChargeRule(chargeRuleFormSchema.parse({ name: String(v.name), chargeType: "OTHER", basis: "PER_UNIT", event: "SHIPMENT", handlingCategory: "", amount: "1.00", active: true, ownerType: "", ownerId: "", minWeightGrams: "", maxWeightGrams: "", minLongestCm: "", maxLongestCm: "", notes: "", ...v }), admin.id);
      created.ruleIds.push(r.id);
      return r;
    };
    const rRecvHigh = await rule({ name: `${RUN} receiving high`, chargeType: "RECEIVING", event: "RECEIVING", handlingCategory: "HIGH", basis: "PER_UNIT", amount: "1.50" });
    const rRecvAny3pl = await rule({ name: `${RUN} receiving 3pl receipt`, chargeType: "RECEIVING", event: "RECEIVING", basis: "PER_SHIPMENT", amount: "4.00", ownerType: "THREEPL_CLIENT" });
    const rReturn = await rule({ name: `${RUN} return handling`, chargeType: "RETURN_HANDLING", event: "RETURN", basis: "PER_UNIT", amount: "2.00" });
    const rRestock = await rule({ name: `${RUN} restock`, chargeType: "RESTOCKING", event: "RESTOCK", basis: "PER_UNIT", amount: "0.50" });
    const rDamage = await rule({ name: `${RUN} damage`, chargeType: "DAMAGE_HANDLING", event: "DAMAGE", basis: "PER_UNIT", amount: "3.00" });
    const rPackVendor = await rule({ name: `${RUN} packing vendor`, chargeType: "PACKING", event: "SHIPMENT", basis: "PER_ORDER", amount: "5.00", ownerType: "VENDOR" });
    const rPickSmall = await rule({ name: `${RUN} pick small`, chargeType: "PICKING", event: "SHIPMENT", basis: "PER_UNIT", amount: "0.25", handlingCategory: "SMALL" });
    check("2. Rules stored with event + category snapshot fields; lookup filters by event (RECEIVING rules ≠ SHIPMENT rules) and owner type", rRecvHigh.event === "RECEIVING" && rRecvHigh.handlingCategory === "HIGH" && (await charges.applicableRules(prisma, { id: V.id, type: "VENDOR" }, "RECEIVING")).every((r) => r.event === "RECEIVING") && (await charges.applicableRules(prisma, { id: V.id, type: "VENDOR" }, "RECEIVING")).some((r) => r.id === rRecvHigh.id) && !(await charges.applicableRules(prisma, { id: V.id, type: "VENDOR" }, "RECEIVING")).some((r) => r.id === rRecvAny3pl.id) && (await charges.applicableRules(prisma, { id: C.id, type: "THREEPL_CLIENT" }, "RECEIVING")).some((r) => r.id === rRecvAny3pl.id));

    // Receiving: vendor receives 3 SMALL + 2 HIGH + 1 default; 3PL receives 4 MEDIUM; no-charges owner receives 5 HIGH.
    const recV = await receiving.createReceiving({ ownerId: V.id, warehouseId: W.id, reference: `${RUN}-RV`, notes: null, lines: [{ variantId: vS.id, locationId: loc.id, quantity: 3 }, { variantId: vH.id, locationId: loc.id, quantity: 2 }, { variantId: vD.id, locationId: loc.id, quantity: 1 }] }, admin.id);
    const recC = await receiving.createReceiving({ ownerId: C.id, warehouseId: W.id, reference: `${RUN}-RC`, notes: null, lines: [{ variantId: cM.id, locationId: loc.id, quantity: 4 }] }, admin.id);
    await receiving.createReceiving({ ownerId: N.id, warehouseId: W.id, reference: `${RUN}-RN`, notes: null, lines: [{ variantId: nX.id, locationId: loc.id, quantity: 5 }] }, admin.id);
    const chV = await prisma.charge.findMany({ where: { ownerId: V.id, event: "RECEIVING" } });
    const chC = await prisma.charge.findMany({ where: { ownerId: C.id, event: "RECEIVING" } });
    const chN = await prisma.charge.count({ where: { ownerId: N.id } });
    check("3. Category resolution on receiving: vendor charged only for the 2 HIGH units (2 × 1.50 = 3.00), not SMALL / MEDIUM; rule snapshot on the charge (event, reference, unit amount)", chV.length === 1 && eq(chV[0].amount, 3) && chV[0].quantity === 2 && chV[0].event === "RECEIVING" && chV[0].reference === `${RUN}-RV` && eq(chV[0].unitAmount, 1.5) && chV[0].ruleId === rRecvHigh.id, `${chV.length} charges`);
    check("4. Owner-type resolution: 3PL receipt gets the per-receipt 4.00 (PER_SHIPMENT basis = once per event) and no HIGH charge (MEDIUM units); owner with charges disabled gets nothing", chC.length === 1 && eq(chC[0].amount, 4) && chC[0].ruleId === rRecvAny3pl.id && chN === 0);
    // Idempotency: re-run the engine for the same receipt.
    await prisma.$transaction((tx) => finance.recordEventCharges(tx, { event: "RECEIVING", ownerId: V.id, refKey: `receiving:${recV.id}`, reference: `${RUN}-RV`, lines: [{ variantId: vS.id, quantity: 3 }, { variantId: vH.id, quantity: 2 }, { variantId: vD.id, quantity: 1 }], actorId: admin.id }));
    await prisma.$transaction((tx) => finance.recordEventCharges(tx, { event: "RECEIVING", ownerId: C.id, refKey: `receiving:${recC.id}`, reference: `${RUN}-RC`, lines: [{ variantId: cM.id, quantity: 4 }], actorId: admin.id }));
    check("5. Retry / re-processing the same event creates no duplicate charge or ledger entry", (await prisma.charge.count({ where: { ownerId: { in: [V.id, C.id] }, event: "RECEIVING" } })) === 2 && (await prisma.ledgerEntry.count({ where: { ownerId: { in: [V.id, C.id] }, type: "CHARGE" } })) === 2);
    // Cross-owner attribution guard: C's line passed under V's owner id is ignored.
    await prisma.$transaction((tx) => finance.recordEventCharges(tx, { event: "RECEIVING", ownerId: V.id, refKey: `receiving:bogus:${RUN}`, reference: "bogus", lines: [{ variantId: cM.id, quantity: 9 }], actorId: admin.id }));
    check("6. Attribution guard: another owner's SKU never produces a charge for this owner", (await prisma.charge.count({ where: { ownerId: V.id } })) === 1);

    // Mixed-owner order shipped: vendor PER_ORDER packing 5.00 + pick 0.25 × 3 SMALL; 3PL gets neither (VENDOR-only rule; no SMALL units).
    const o = await orders.createOrder({ source: "MANUAL", warehouseId: W.id, reserve: true, lines: [{ variantId: vS.id, quantity: 3 }, { variantId: vH.id, quantity: 1 }, { variantId: cM.id, quantity: 2 }] }, admin.id);
    const f = await fulfillment.startPicking({ orderId: o.orderId, warehouseId: W.id }, admin.id);
    await fulfillment.shipFulfillment(f.id, { carrier: "UPS", trackingNumber: `${RUN}-T` }, admin.id);
    const shipV = await prisma.charge.findMany({ where: { ownerId: V.id, event: "SHIPMENT" } });
    const shipC = await prisma.charge.count({ where: { ownerId: C.id, event: "SHIPMENT" } });
    check("7. Multi-owner shipment: vendor gets packing 5.00 (per order) + picking 0.75 (3 SMALL × 0.25; the HIGH unit is skipped); 3PL client gets nothing (vendor-only / SMALL-only rules)", shipV.length === 2 && shipV.some((c) => c.ruleId === rPackVendor.id && eq(c.amount, 5)) && shipV.some((c) => c.ruleId === rPickSmall.id && eq(c.amount, 0.75) && c.quantity === 3) && shipC === 0, `${shipV.length} vendor / ${shipC} 3PL`);
    const balC = await finance.ownerBalance(C.id);
    check("8. 3PL product-value payable unchanged by charge rules: 2 × 4.00 = 8.00 payable; receivable = its 4.00 receipt charge only (separate sides)", eq(balC.payable.open, 8) && eq(balC.receivable.open, 4));

    // Return: 2 × SMALL + 1 × MEDIUM(C) returned → RETURN 2.00/unit per owner; inspect S sellable (restock 0.50 × 2), C damaged (damage 3.00 × 1).
    const full = (await orders.getOrder(o.orderId))!;
    const itemS = full.items.find((i) => i.variantId === vS.id)!;
    const itemC = full.items.find((i) => i.variantId === cM.id)!;
    const ret = await returns.receiveReturn({ orderId: o.orderId, warehouseId: W.id, reference: `${RUN}-RET`, lines: [{ orderItemId: itemS.id, quantity: 2 }, { orderItemId: itemC.id, quantity: 1 }] }, admin.id);
    const retV = await prisma.charge.findMany({ where: { ownerId: V.id, event: "RETURN" } });
    const retC = await prisma.charge.findMany({ where: { ownerId: C.id, event: "RETURN" } });
    check("9. Return handling per unit, attributed per owner: vendor 2 × 2.00 = 4.00, 3PL 1 × 2.00 = 2.00, reference kept, order linked", retV.length === 1 && eq(retV[0].amount, 4) && retV[0].orderId === o.orderId && retV[0].reference === `${RUN}-RET` && retC.length === 1 && eq(retC[0].amount, 2));
    const retItems = await prisma.returnItem.findMany({ where: { returnId: ret.id }, select: { id: true, variantId: true } });
    await returns.inspectReturn(ret.id, { lines: retItems.map((ri) => ({ returnItemId: ri.id, condition: ri.variantId === vS.id ? ("SELLABLE" as const) : ("DAMAGED" as const) })) }, admin.id);
    const restock = await prisma.charge.findMany({ where: { ownerId: V.id, event: "RESTOCK" } });
    const damage = await prisma.charge.findMany({ where: { ownerId: C.id, event: "DAMAGE" } });
    check("10. Inspection: restock 2 × 0.50 = 1.00 for the vendor's sellable units; damage 1 × 3.00 for the 3PL's damaged unit; no cross charges", restock.length === 1 && eq(restock[0].amount, 1) && damage.length === 1 && eq(damage[0].amount, 3) && (await prisma.charge.count({ where: { ownerId: C.id, event: "RESTOCK" } })) === 0 && (await prisma.charge.count({ where: { ownerId: V.id, event: "DAMAGE" } })) === 0);

    // Snapshot: change rules, historical charges untouched; new event uses new amounts.
    await charges.updateChargeRule(rRecvHigh.id, chargeRuleFormSchema.parse({ name: `${RUN} receiving high v2`, chargeType: "RECEIVING", event: "RECEIVING", handlingCategory: "HIGH", basis: "PER_UNIT", amount: "9.00", active: true, ownerType: "", ownerId: "", minWeightGrams: "", maxWeightGrams: "", minLongestCm: "", maxLongestCm: "", notes: "" }), admin.id);
    await charges.setChargeRuleActive(rReturn.id, false, admin.id);
    const chVAfter = await prisma.charge.findUniqueOrThrow({ where: { id: chV[0].id } });
    await receiving.createReceiving({ ownerId: V.id, warehouseId: W.id, reference: `${RUN}-RV2`, notes: null, lines: [{ variantId: vH.id, locationId: loc.id, quantity: 1 }] }, admin.id);
    const newCharge = await prisma.charge.findFirst({ where: { ownerId: V.id, event: "RECEIVING", reference: `${RUN}-RV2` } });
    check("11. Snapshot: after the rule changes to 9.00 / v2 and the return rule is deactivated, the historical charge still reads 1.50 × 2 = 3.00 under the old name; the next receipt uses 9.00", eq(chVAfter.amount, 3) && eq(chVAfter.unitAmount, 1.5) && chVAfter.ruleName === `${RUN} receiving high` && !!newCharge && eq(newCharge.amount, 9) && newCharge.ruleName === `${RUN} receiving high v2`);

    // No rule → no charge (event with no rule: MISSING / ADJUSTMENT have none here).
    await prisma.$transaction((tx) => finance.recordEventCharges(tx, { event: "MISSING", ownerId: V.id, refKey: `adjust:${RUN}-m`, reference: "count", lines: [{ variantId: vS.id, quantity: 1 }], actorId: admin.id }));
    check("12. No rule for the event → no charge is invented", (await prisma.charge.count({ where: { ownerId: V.id, event: "MISSING" } })) === 0);

    // Ledger consistency + finance separation.
    const balV = await finance.ownerBalance(V.id);
    const sumV = (await prisma.charge.aggregate({ where: { ownerId: V.id }, _sum: { amount: true } }))._sum.amount ?? 0;
    check("13. Vendor finance intact: receivable = Σ operational charges (3 + 5 + 0.75 + 4 + 1 + 9 = 22.75), payable stays 0 (no vendor payable from shipping / receiving)", eq(balV.receivable.open, 22.75) && eq(sumV, 22.75) && eq(balV.payable.open, 0), `receivable ${balV.receivable.open}`);
    check("14. Affiliate commissions unaffected (global count unchanged; no commission rows reference this run's orders)", (await prisma.affiliateCommission.count()) === commissionsBefore && (await prisma.affiliateCommission.count({ where: { orderId: o.orderId } })) === 0);
  } finally {
    const orderIds = (await prisma.order.findMany({ where: { items: { some: { ownerId: { in: created.ownerIds } } } }, select: { id: true } })).map((o) => o.id);
    await prisma.ledgerEntry.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.charge.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.chargeRule.deleteMany({ where: { id: { in: created.ruleIds } } });
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
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...created.ownerIds, ...created.productIds, ...created.warehouseIds, ...created.ruleIds, ...orderIds] } }, { entityType: { in: ["ReceivingRecord", "Location", "Shipment", "Fulfillment", "Return"] }, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } }] } }).catch(() => undefined);
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
