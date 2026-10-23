/**
 * Affiliates / external sales partners (D-070). Service-level; no HTTP server needed.
 * Creates temporary data (vendor, 3PL client, products, warehouse, two affiliates + users, orders) and removes it.
 *
 * Usage: npm run e2e:affiliates -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const RUN = `af${Date.now().toString(36)}`.toUpperCase();
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
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;
const blank = { contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null };

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const owners = await import("../src/server/services/owners");
  const products = await import("../src/server/services/products");
  const warehouses = await import("../src/server/services/warehouses");
  const receiving = await import("../src/server/services/receiving");
  const orders = await import("../src/server/services/orders");
  const users = await import("../src/server/services/users");
  const aff = await import("../src/server/services/affiliates");
  const { computeCommission } = await import("../src/server/services/affiliate-commissions");
  const { homePathForRole, isPortalRole, isStaffRole } = await import("../src/lib/roles");
  const { userCreateSchema } = await import("../src/lib/validation/users");
  const { affiliateFormSchema } = await import("../src/lib/validation/affiliates");

  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });
  const created = { ownerIds: [] as string[], productIds: [] as string[], warehouseIds: [] as string[], affiliateIds: [] as string[], userIds: [] as string[], firebaseUids: [] as string[] };
  const ledgerBefore = await prisma.ledgerEntry.count();
  const chargesBefore = await prisma.charge.count();

  try {
    // ---------------------------------------------------------------- setup
    const V = await owners.createOwner("VENDOR", { code: `${RUN}-V`, businessName: `AF Vendor ${RUN}`, ...blank }, admin.id);
    const C = await owners.createOwner("THREEPL_CLIENT", { code: `${RUN}-C`, businessName: `AF Client ${RUN}`, ...blank }, admin.id);
    const X = await owners.createOwner("VENDOR", { code: `${RUN}-X`, businessName: `AF Other Vendor ${RUN}`, ...blank }, admin.id);
    created.ownerIds.push(V.id, C.id, X.id);
    const W = await warehouses.createWarehouse({ code: `${RUN}-W`, name: "AF Warehouse", addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null }, admin.id);
    created.warehouseIds.push(W.id);
    const loc = (await warehouses.getDefaultLocation(W.id))!;
    const mk = async (ownerId: string, tag: string, price: string) => {
      const p = await products.createProduct({ ownerId, name: `AF ${tag} ${RUN}`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-${tag}`, name: null, barcode: null, price, cost: null, status: "ACTIVE" }] }, admin.id);
      created.productIds.push(p.id);
      await receiving.createReceiving({ ownerId, warehouseId: W.id, reference: `${RUN}-R-${tag}`, notes: null, lines: [{ variantId: p.variants[0].id, locationId: loc.id, quantity: 100 }] }, admin.id);
      return p.variants[0];
    };
    const v1 = await mk(V.id, "V1", "100.00"); // vendor SKU, default rule
    const v2 = await mk(V.id, "V2", "20.00"); // vendor SKU, product-specific rule
    const c1 = await mk(C.id, "C1", "50.00"); // 3PL SKU
    const x1 = await mk(X.id, "X1", "10.00"); // unassigned owner

    // ---------------------------------------------------------------- 1. creation + auth
    const A = await aff.createAffiliate(affiliateFormSchema.parse({ code: `${RUN}-A`, name: `AF Partner A ${RUN}`, email: "", phone: "", status: "ACTIVE", commissionType: "PERCENTAGE_OF_SALE", commissionValue: "10", notes: "" }), admin.id);
    const B = await aff.createAffiliate(affiliateFormSchema.parse({ code: `${RUN}-B`, name: `AF Partner B ${RUN}`, email: "", phone: "", status: "ACTIVE", commissionType: "FIXED_PER_ORDER", commissionValue: "5", notes: "" }), admin.id);
    created.affiliateIds.push(A.id, B.id);
    const dup = await expectError(() => aff.createAffiliate(affiliateFormSchema.parse({ code: `${RUN}-A`, name: "dup", email: "", phone: "", commissionType: "", commissionValue: "", notes: "" }), admin.id), "CODE_TAKEN");
    check("1. Affiliate created (10% default) and a second one (5.00 per order); duplicate code rejected", A.commissionType === "PERCENTAGE_OF_SALE" && Number(A.commissionValue) === 10 && B.commissionType === "FIXED_PER_ORDER" && dup.hit);

    const noAff = userCreateSchema.safeParse({ name: "x", email: `${RUN.toLowerCase()}-x@example.test`, password: "E2eTestPass123", role: "AFFILIATE", ownerId: null, affiliateId: null, phone: "", notes: "" });
    const staffWithAff = userCreateSchema.safeParse({ name: "x", email: `${RUN.toLowerCase()}-y@example.test`, password: "E2eTestPass123", role: "ADMIN", ownerId: null, affiliateId: A.id, phone: "", notes: "" });
    const uA = await users.createUserAccount(userCreateSchema.parse({ name: `AF User A ${RUN}`, email: `${RUN.toLowerCase()}-a@example.test`, password: "E2eTestPass123", role: "AFFILIATE", ownerId: null, affiliateId: A.id, phone: "", notes: "" }), admin.id);
    const uB = await users.createUserAccount(userCreateSchema.parse({ name: `AF User B ${RUN}`, email: `${RUN.toLowerCase()}-b@example.test`, password: "E2eTestPass123", role: "AFFILIATE", ownerId: null, affiliateId: B.id, phone: "", notes: "" }), admin.id);
    created.userIds.push(uA.id, uB.id);
    created.firebaseUids.push(uA.firebaseUid, uB.firebaseUid);
    const uAdb = await prisma.user.findUniqueOrThrow({ where: { id: uA.id }, select: { role: true, ownerId: true, affiliateId: true } });
    const badLink = await prisma.user.updateMany({ where: { id: uA.id }, data: { ownerId: V.id } }).then(() => false).catch(() => true);
    check("2. Affiliate authentication identity: AFFILIATE user (Firebase + platform row) linked to the affiliate, never to an owner; schema rejects AFFILIATE without affiliate and staff with affiliate; DB CHECK blocks an owner link; role is a portal (non-staff) role with its own home", !noAff.success && !staffWithAff.success && uAdb.role === "AFFILIATE" && uAdb.affiliateId === A.id && uAdb.ownerId === null && badLink && isPortalRole("AFFILIATE") && !isStaffRole("AFFILIATE") && homePathForRole("AFFILIATE") === "/portal/affiliate");

    // ---------------------------------------------------------------- 2. assignments
    const skuBeforeOwner = await expectError(() => aff.assignVariantBySku(A.id, { sku: v1.sku, commissionType: null, commissionValue: null }, admin.id), "FORBIDDEN");
    await aff.setAssignedOwners(A.id, [V.id, C.id], admin.id);
    await aff.assignVariantBySku(A.id, { sku: v1.sku, commissionType: null, commissionValue: null }, admin.id);
    await aff.assignVariantBySku(A.id, { sku: v2.sku, commissionType: "FIXED_PER_UNIT", commissionValue: 3 }, admin.id);
    await aff.assignVariantBySku(A.id, { sku: c1.sku, commissionType: null, commissionValue: null }, admin.id);
    const unassignedOwnerSku = await expectError(() => aff.assignVariantBySku(A.id, { sku: x1.sku, commissionType: null, commissionValue: null }, admin.id), "FORBIDDEN");
    const unknownSku = await expectError(() => aff.assignVariantBySku(A.id, { sku: `${RUN}-NOPE`, commissionType: null, commissionValue: null }, admin.id), "NOT_FOUND");
    const removeOwnerInUse = await expectError(() => aff.setAssignedOwners(A.id, [C.id], admin.id), "INVALID");
    const mine = await aff.listAssignedProducts(A.id);
    check("3. Affiliate sees only assigned products: 3 SKUs (V1 default 10%, V2 product rule 3.00/unit, C1); SKU of an unassigned owner, SKU before its owner is assigned, and unknown SKU rejected; removing an owner that still has assigned SKUs refused", skuBeforeOwner.hit && unassignedOwnerSku.hit && unknownSku.hit && removeOwnerInUse.hit && mine.total === 3 && mine.items.every((i) => [v1.id, v2.id, c1.id].includes(i.id)) && mine.items.find((i) => i.id === v2.id)?.rule?.type === "FIXED_PER_UNIT" && mine.items.find((i) => i.id === v1.id)?.rule?.source === "AFFILIATE_DEFAULT");
    const ids = await aff.assignedVariantIds(A.id);
    const search = await products.searchVariants(RUN, { variantIds: ids, limit: 50 });
    const searchB = await products.searchVariants(RUN, { variantIds: await aff.assignedVariantIds(B.id), limit: 50 });
    check("4. SKU search restricted to assigned variant ids: A finds V1/V2/C1 only (not X1); B (nothing assigned) finds nothing", search.length === 3 && !search.some((s) => s.id === x1.id) && searchB.length === 0);

    // ---------------------------------------------------------------- 3. orders + commissions
    const forbidden = await expectError(() => aff.createAffiliateOrder(A.id, { warehouseId: W.id, customerName: "Nope", lines: [{ variantId: x1.id, quantity: 1 }] }, uA.id), "FORBIDDEN");
    const mixed = await expectError(() => aff.createAffiliateOrder(A.id, { warehouseId: W.id, customerName: "Nope", lines: [{ variantId: v1.id, quantity: 1 }, { variantId: x1.id, quantity: 1 }] }, uA.id), "FORBIDDEN");
    check("5. Affiliate cannot sell an unassigned product (alone or mixed into an order); nothing created", forbidden.hit && mixed.hit && (await prisma.order.count({ where: { affiliateId: A.id } })) === 0, forbidden.message);

    const o1 = await aff.createAffiliateOrder(A.id, { warehouseId: W.id, customerName: `AF Customer ${RUN}`, lines: [{ variantId: v1.id, quantity: 2 }, { variantId: v2.id, quantity: 4 }, { variantId: c1.id, quantity: 1 }] }, uA.id);
    const order1 = await prisma.order.findUniqueOrThrow({ where: { id: o1.orderId }, include: { items: true } });
    check("6. Affiliate order stores the affiliate relationship (order.affiliateId, source AFFILIATE) and prices lines at retail; stock reserved through the existing order service", order1.affiliateId === A.id && order1.source === "AFFILIATE" && order1.createdById === uA.id && Number(order1.items.find((i) => i.variantId === v1.id)?.unitPrice) === 100 && order1.items.every((i) => i.reservedQty === i.quantity) && o1.reservation.short.length === 0);

    const comm1 = await prisma.affiliateCommission.findMany({ where: { orderId: o1.orderId }, orderBy: { amount: "desc" } });
    const cV1 = comm1.find((c) => c.orderItemId === order1.items.find((i) => i.variantId === v1.id)!.id);
    const cV2 = comm1.find((c) => c.orderItemId === order1.items.find((i) => i.variantId === v2.id)!.id);
    const cC1 = comm1.find((c) => c.orderItemId === order1.items.find((i) => i.variantId === c1.id)!.id);
    check("7. Percentage commission: V1 2 × 100.00 at 10% → 20.00 (base 200.00, rule snapshot 10, source AFFILIATE_DEFAULT, PENDING)", !!cV1 && eq(Number(cV1.amount), 20) && eq(Number(cV1.baseAmount), 200) && Number(cV1.rateValue) === 10 && cV1.type === "PERCENTAGE_OF_SALE" && cV1.ruleSource === "AFFILIATE_DEFAULT" && cV1.status === "PENDING");
    check("8. Fixed-per-unit (product-specific): V2 4 units × 3.00 → 12.00 (source VARIANT), overriding the 10% default; C1 1 × 50.00 at 10% → 5.00", !!cV2 && eq(Number(cV2.amount), 12) && cV2.type === "FIXED_PER_UNIT" && cV2.ruleSource === "VARIANT" && cV2.quantity === 4 && !!cC1 && eq(Number(cC1.amount), 5) && comm1.length === 3);

    await aff.setAssignedOwners(B.id, [V.id], admin.id);
    await aff.assignVariantBySku(B.id, { sku: v1.sku, commissionType: null, commissionValue: null }, admin.id);
    const o2 = await aff.createAffiliateOrder(B.id, { warehouseId: W.id, customerName: `AF Customer B ${RUN}`, lines: [{ variantId: v1.id, quantity: 3 }] }, uB.id);
    const comm2 = await prisma.affiliateCommission.findMany({ where: { orderId: o2.orderId } });
    check("9. Fixed-per-order: B's order (3 × 100.00) → exactly one whole-order commission of 5.00, no line records", comm2.length === 1 && comm2[0].orderItemId === null && eq(Number(comm2[0].amount), 5) && comm2[0].type === "FIXED_PER_ORDER");
    check("10. Pure calculator: 100 × 1 @ 10% = 10; 3.00 × 4 = 12; per order 5 = 5; discount reduces the percentage base", eq(computeCommission({ type: "PERCENTAGE_OF_SALE", value: 10, source: "AFFILIATE_DEFAULT" }, { quantity: 1, unitPrice: 100 }).amount, 10) && eq(computeCommission({ type: "FIXED_PER_UNIT", value: 3, source: "VARIANT" }, { quantity: 4, unitPrice: 20 }).amount, 12) && eq(computeCommission({ type: "FIXED_PER_ORDER", value: 5, source: "AFFILIATE_DEFAULT" }, { quantity: 1, unitPrice: null }).amount, 5) && eq(computeCommission({ type: "PERCENTAGE_OF_SALE", value: 10, source: "AFFILIATE_DEFAULT" }, { quantity: 2, unitPrice: 100, discount: 50 }).amount, 15));

    // ---------------------------------------------------------------- 4. snapshot
    await aff.updateAffiliate(A.id, affiliateFormSchema.parse({ code: `${RUN}-A`, name: `AF Partner A ${RUN}`, email: "", phone: "", status: "ACTIVE", commissionType: "PERCENTAGE_OF_SALE", commissionValue: "5", notes: "" }), admin.id);
    await aff.assignVariantBySku(A.id, { sku: v2.sku, commissionType: "FIXED_PER_UNIT", commissionValue: 1 }, admin.id);
    const cV1After = await prisma.affiliateCommission.findUniqueOrThrow({ where: { id: cV1!.id } });
    const cV2After = await prisma.affiliateCommission.findUniqueOrThrow({ where: { id: cV2!.id } });
    const o3 = await aff.createAffiliateOrder(A.id, { warehouseId: W.id, customerName: `AF Customer ${RUN}`, lines: [{ variantId: v1.id, quantity: 1 }, { variantId: v2.id, quantity: 1 }] }, uA.id);
    const comm3 = await prisma.affiliateCommission.findMany({ where: { orderId: o3.orderId } });
    check("11. Commission snapshot: after changing the default 10% → 5% and V2's rule 3.00 → 1.00, yesterday's records still say 20.00 @ 10 and 12.00 @ 3.00; a new order uses 5% (5.00) and 1.00", eq(Number(cV1After.amount), 20) && Number(cV1After.rateValue) === 10 && eq(Number(cV2After.amount), 12) && Number(cV2After.rateValue) === 3 && comm3.some((c) => eq(Number(c.amount), 5) && Number(c.rateValue) === 5) && comm3.some((c) => eq(Number(c.amount), 1) && Number(c.rateValue) === 1));
    const again = await aff.createAffiliateOrder(A.id, { warehouseId: W.id, customerName: "x", lines: [{ variantId: v1.id, quantity: 1 }] }, uA.id);
    const { recordOrderCommissions } = await import("../src/server/services/affiliate-commissions");
    await recordOrderCommissions(prisma, again.orderId);
    check("12. Re-recording commissions for an order is idempotent (dedupeKey)", (await prisma.affiliateCommission.count({ where: { orderId: again.orderId } })) === 1);

    // ---------------------------------------------------------------- 5. lifecycle
    await orders.cancelOrder(o3.orderId, "customer changed mind", admin.id);
    const comm3After = await prisma.affiliateCommission.findMany({ where: { orderId: o3.orderId } });
    check("13. Cancelled order → its commissions CANCELLED (never payable)", comm3After.length === 2 && comm3After.every((c) => c.status === "CANCELLED" && c.cancelledAt !== null));
    // Ship order 1 through the existing fulfilment flow → COMPLETED → EARNED.
    const fulfillment = await import("../src/server/services/fulfillment");
    const f = await fulfillment.startPicking({ orderId: o1.orderId, warehouseId: W.id }, admin.id);
    await fulfillment.shipFulfillment(f.id, { carrier: "UPS", trackingNumber: `${RUN}-T1` }, admin.id);
    const o1After = await prisma.order.findUniqueOrThrow({ where: { id: o1.orderId }, select: { status: true } });
    const comm1After = await prisma.affiliateCommission.findMany({ where: { orderId: o1.orderId } });
    check("14. Shipped order → COMPLETED → all three commissions EARNED with earnedAt", o1After.status === "COMPLETED" && comm1After.length === 3 && comm1After.every((c) => c.status === "EARNED" && c.earnedAt !== null));
    const eA = await aff.affiliateEarnings(A.id);
    check("15. Earnings summary for A: sales 430.00 (200+80+50 shipped + 100 open; cancelled order excluded), earned 37.00, pending 5.00 (open order), paid 0, outstanding 42.00, 3 orders", eq(eA.sales, 430) && eq(eA.earned, 37) && eq(eA.pending, 5) && eq(eA.paid, 0) && eq(eA.outstanding, 42) && eA.orders === 3, JSON.stringify({ sales: eA.sales, earned: eA.earned, pending: eA.pending, outstanding: eA.outstanding, orders: eA.orders }));
    const payB = await expectError(() => aff.markCommissionsPaid(B.id, comm1After.map((c) => c.id), { reference: "x", notes: null }, admin.id), "INVALID");
    const paid = await aff.markCommissionsPaid(A.id, [...comm1After.map((c) => c.id), comm3After[0].id], { reference: `${RUN}-PAY`, notes: null }, admin.id);
    const eA2 = await aff.affiliateEarnings(A.id);
    check("16. Mark paid: only A's EARNED rows become PAID (3 rows, 37.00, reference kept); cancelled row untouched; B cannot pay A's commissions; outstanding drops to 5.00", payB.hit && paid.count === 3 && eq(paid.total, 37) && eq(eA2.paid, 37) && eq(eA2.outstanding, 5) && (await prisma.affiliateCommission.count({ where: { orderId: o1.orderId, status: "PAID", paidReference: `${RUN}-PAY` } })) === 3 && (await prisma.affiliateCommission.findUniqueOrThrow({ where: { id: comm3After[0].id } })).status === "CANCELLED");

    // ---------------------------------------------------------------- 6. isolation
    const ordersA = await aff.affiliateOrders(A.id, {});
    const ordersB = await aff.affiliateOrders(B.id, {});
    const commsB = await aff.listCommissions({ affiliateId: B.id });
    const custA = await aff.affiliateCustomers(A.id);
    const custB = await aff.affiliateCustomers(B.id);
    const eB = await aff.affiliateEarnings(B.id);
    const crossOrder = await aff.affiliateOrder(B.id, o1.orderId);
    const ownOrder = await aff.affiliateOrder(A.id, o1.orderId);
    check("17. Affiliate A cannot access Affiliate B data and vice versa: orders (A 3 / B 1, disjoint), commissions (B sees only its per-order row), customers, earnings (B: sales 300, pending 5), B opening A's order → null", ordersA.total === 3 && ordersB.total === 1 && ordersA.items.every((o) => o.id !== o2.orderId) && ordersB.items[0].id === o2.orderId && commsB.total === 1 && commsB.items[0].affiliateId === B.id && custA.items.every((c) => c.name !== `AF Customer B ${RUN}`) && custB.items.every((c) => c.name !== `AF Customer ${RUN}`) && eq(eB.sales, 300) && eq(eB.pending, 5) && crossOrder === null && ownOrder?.id === o1.orderId);
    const prodB = await aff.listAssignedProducts(B.id);
    check("18. B's product list holds only its own assignment (V1) — none of A's product rules or C1", prodB.total === 1 && prodB.items[0].id === v1.id && prodB.items[0].rule?.source === "AFFILIATE_DEFAULT");

    // ---------------------------------------------------------------- 7. vendor / 3PL finance untouched
    const finance = await import("../src/server/services/finance");
    const balV = await finance.ownerBalance(V.id);
    const balC = await finance.ownerBalance(C.id);
    const ledgerNow = await prisma.ledgerEntry.count({ where: { ownerId: { in: created.ownerIds } } });
    check("19. Vendor / 3PL finance unaffected by commissions: vendor has no payable (shipment creates none), 3PL has exactly its product-value payable (1 × wholesale, none by default = 0) and no receivable; no ledger entry or charge mentions commissions; global ledger/charge counts only moved by the shipment itself", eq(Number(balV.payable.open), 0) && eq(Number(balV.receivable.open), 0) && eq(Number(balC.receivable.open), 0) && ledgerNow === (await prisma.ledgerEntry.count({ where: { ownerId: { in: created.ownerIds } } })) && (await prisma.charge.count()) === chargesBefore, `vendor payable ${balV.payable.open}, 3PL payable ${balC.payable.open}, ledger rows for run ${ledgerNow}`);
    check("20. Inactive affiliate: users locked out (current-user rule) and new sales refused", await (async () => {
      await prisma.affiliate.update({ where: { id: B.id }, data: { status: "INACTIVE" } });
      const refused = await expectError(() => aff.createAffiliateOrder(B.id, { warehouseId: W.id, customerName: "x", lines: [{ variantId: v1.id, quantity: 1 }] }, uB.id), "INACTIVE");
      return refused.hit;
    })());
  } finally {
    const { firebaseAdminAuth } = await import("../src/lib/firebase/admin");
    for (const uid of created.firebaseUids) await firebaseAdminAuth().deleteUser(uid).catch(() => undefined);
    const all = await prisma.order.findMany({ where: { OR: [{ affiliateId: { in: created.affiliateIds } }, { items: { some: { ownerId: { in: created.ownerIds } } } }] }, select: { id: true } });
    const orderIds = all.map((o) => o.id);
    await prisma.affiliateCommission.deleteMany({ where: { affiliateId: { in: created.affiliateIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.charge.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.inventoryTransaction.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { variant: { productId: { in: created.productIds } } }] } });
    await prisma.shipmentItem.deleteMany({ where: { shipment: { orderId: { in: orderIds } } } });
    await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.fulfillmentItem.deleteMany({ where: { fulfillment: { orderId: { in: orderIds } } } });
    await prisma.fulfillment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.deleteMany({ where: { OR: [{ affiliateId: { in: created.affiliateIds } }, { name: { contains: RUN } }] } });
    await prisma.inventoryLevel.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.inventoryBalance.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingItem.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingRecord.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.affiliateVariant.deleteMany({ where: { affiliateId: { in: created.affiliateIds } } });
    await prisma.affiliateOwner.deleteMany({ where: { affiliateId: { in: created.affiliateIds } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: created.productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    await prisma.location.deleteMany({ where: { warehouseId: { in: created.warehouseIds } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: created.warehouseIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...created.ownerIds, ...created.productIds, ...created.warehouseIds, ...created.userIds, ...created.affiliateIds, ...orderIds] } }, { userId: { in: created.userIds } }, { entityType: { in: ["ReceivingRecord", "Location", "Shipment", "Fulfillment", "Customer"] }, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } }] } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.affiliate.deleteMany({ where: { id: { in: created.affiliateIds } } });
    await prisma.owner.deleteMany({ where: { id: { in: created.ownerIds } } });
    await prisma.$disconnect();
    console.log(`Cleanup done. (ledger before ${ledgerBefore})`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
