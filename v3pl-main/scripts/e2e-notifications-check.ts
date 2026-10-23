/**
 * Admin in-app notifications (D-075). Service-level; no HTTP server needed. Creates temporary data and removes it.
 *
 * Usage: npm run e2e:notifications -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const RUN = `nt${Date.now().toString(36)}`.toUpperCase();
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
  const fulfillment = await import("../src/server/services/fulfillment");
  const returns = await import("../src/server/services/returns");
  const email = await import("../src/server/services/email");
  const nt = await import("../src/server/services/notifications");
  email.__setEmailTransportForTests(async () => ({ ok: true }));

  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });
  const created = { ownerIds: [] as string[], productIds: [] as string[], warehouseIds: [] as string[] };
  const startedAt = new Date();
  const mine = (where: Record<string, unknown> = {}) => prisma.adminNotification.findMany({ where: { createdAt: { gte: startedAt }, ...where }, orderBy: { createdAt: "asc" } });

  try {
    const V = await owners.createOwner("VENDOR", { code: `${RUN}-V`, businessName: `NT Vendor ${RUN}`, ...blank }, admin.id);
    created.ownerIds.push(V.id);
    const acct = await mine({ type: "ACCOUNT_CREATED" });
    check("1. New vendor account → one ACCOUNT_CREATED notification linking to the vendor page", acct.length === 1 && acct[0].href === `/admin/vendors/${V.id}` && acct[0].title.includes(`NT Vendor ${RUN}`));
    const W = await warehouses.createWarehouse({ code: `${RUN}-W`, name: "NT Warehouse", addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null }, admin.id);
    created.warehouseIds.push(W.id);
    const loc = (await warehouses.getDefaultLocation(W.id))!;
    const p = await products.createProduct({ ownerId: V.id, name: `NT Widget ${RUN}`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-S1`, name: null, barcode: null, price: "5.00", cost: null, status: "ACTIVE" }] }, admin.id);
    created.productIds.push(p.id);
    const v = p.variants[0];
    await receiving.createReceiving({ ownerId: V.id, warehouseId: W.id, reference: `${RUN}-R`, notes: null, lines: [{ variantId: v.id, locationId: loc.id, quantity: 20 }] }, admin.id);
    check("2. Receiving itself is not a notification event (no noise)", (await mine()).length === 1);

    // New order → one notification; idempotent replay → none.
    const o = await orders.createOrder({ source: "MANUAL", sourceRef: `${RUN}-REF`, warehouseId: W.id, reserve: true, customerName: `NT Customer ${RUN}`, lines: [{ variantId: v.id, quantity: 2 }] }, admin.id);
    const again = await orders.createOrder({ source: "MANUAL", sourceRef: `${RUN}-REF`, warehouseId: W.id, reserve: true, customerName: `NT Customer ${RUN}`, lines: [{ variantId: v.id, quantity: 2 }] }, admin.id);
    const createdN = await mine({ type: "ORDER_CREATED" });
    check("3. New order → exactly one ORDER_CREATED (title has the order number, link to the admin order); replaying the same order identity adds none", !again.created && createdN.length === 1 && createdN[0].title === `New order ${o.orderNumber}` && createdN[0].href === `/admin/orders/${o.orderId}` && createdN[0].message.includes(`NT Customer ${RUN}`));
    const dup = await nt.notify(prisma, { type: "ORDER_CREATED", title: "x", message: "y", dedupeKey: `order:${o.orderId}:created` });
    check("4. notify() with an existing dedupeKey is skipped (retry-safe) and returns false", dup === false && (await mine({ type: "ORDER_CREATED" })).length === 1);

    // Fulfilment: ship → in transit → delivered; replayed status → no duplicate.
    const f = await fulfillment.startPicking({ orderId: o.orderId, warehouseId: W.id }, admin.id);
    const sh = await fulfillment.shipFulfillment(f.id, { carrier: "UPS", trackingNumber: `${RUN}-T` }, admin.id);
    const afterShip = await mine();
    await fulfillment.updateShipmentStatus(sh.id, "IN_TRANSIT", admin.id);
    await fulfillment.updateShipmentStatus(sh.id, "DELIVERED", admin.id);
    await fulfillment.updateShipmentStatus(sh.id, "DELIVERED", admin.id, `${RUN}-EVT`);
    const status = await mine({ type: { in: ["SHIPMENT_STATUS", "SHIPMENT_DELIVERED"] } });
    const completed = await mine({ type: "ORDER_COMPLETED" });
    check("5. Fulfilment events: one SHIPMENT_STATUS (in transit) + one SHIPMENT_DELIVERED, one ORDER_COMPLETED; replaying Delivered adds nothing", status.length === 2 && status.filter((n) => n.type === "SHIPMENT_DELIVERED").length === 1 && status.every((n) => n.href === `/admin/orders/${o.orderId}`) && completed.length === 1, `${status.length} status, ${completed.length} completed, ${afterShip.length} after ship`);

    // Return received + inspected.
    const full = (await orders.getOrder(o.orderId))!;
    const ret = await returns.receiveReturn({ orderId: o.orderId, warehouseId: W.id, reference: `${RUN}-RET`, lines: [{ orderItemId: full.items[0].id, quantity: 1 }] }, admin.id);
    const ri = await prisma.returnItem.findFirstOrThrow({ where: { returnId: ret.id } });
    await returns.inspectReturn(ret.id, { lines: [{ returnItemId: ri.id, condition: "SELLABLE" }] }, admin.id);
    check("6. Return received and inspected → one notification each, linking to the order", (await mine({ type: "RETURN_RECEIVED" })).length === 1 && (await mine({ type: "RETURN_INSPECTED" })).length === 1 && (await mine({ type: "RETURN_RECEIVED" }))[0].href === `/admin/orders/${o.orderId}`);

    // Cancel another order.
    const o2 = await orders.createOrder({ source: "MANUAL", warehouseId: W.id, reserve: true, lines: [{ variantId: v.id, quantity: 1 }] }, admin.id);
    await orders.cancelOrder(o2.orderId, "customer changed mind", admin.id);
    check("7. Order cancelled → one ORDER_CANCELLED with the reason", (await mine({ type: "ORDER_CANCELLED" })).length === 1 && (await mine({ type: "ORDER_CANCELLED" }))[0].message === "customer changed mind");

    // Feed, unread count, mark read, mark all read.
    const feed = await nt.listNotifications();
    const unreadBefore = await nt.unreadCount();
    const target = (await mine({ type: "ORDER_CREATED" }))[0];
    const marked = await nt.markNotificationRead(target.id);
    const markedAgain = await nt.markNotificationRead(target.id);
    const unreadAfterOne = await nt.unreadCount();
    check("8. Feed is newest-first, capped at 20, with an efficient unread count; mark one read decrements once (second call is a no-op)", feed.items.length <= 20 && feed.items.length > 0 && feed.items[0].createdAt >= feed.items[feed.items.length - 1].createdAt && feed.unread === unreadBefore && marked === 1 && markedAgain === 0 && unreadAfterOne === unreadBefore - 1);
    const all = await nt.markAllNotificationsRead();
    check("9. Mark all read clears the unread count", all >= 1 && (await nt.unreadCount()) === 0 && (await mine({ readAt: null })).length === 0);

    // Security by construction: every action re-checks ADMIN; portals never render the bell.
    const actions = readFileSync("src/server/actions/notifications.ts", "utf8");
    const layout = readFileSync("src/app/admin/(dashboard)/layout.tsx", "utf8");
    const portalLayouts = ["src/app/portal/vendor/layout.tsx", "src/app/portal/3pl/layout.tsx", "src/app/portal/affiliate/layout.tsx"].map((f) => readFileSync(f, "utf8"));
    check("10. Non-admins cannot reach admin notifications: all 4 actions call requireRole(\"ADMIN\"); the bell renders only for ADMIN in the admin layout and never in the vendor / 3PL / affiliate portal layouts", (actions.match(/requireRole\("ADMIN"\)/g) ?? []).length === 4 && layout.includes('user.role === "ADMIN" ? <NotificationBell /> : undefined') && portalLayouts.every((l) => !l.includes("NotificationBell")));
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
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...created.ownerIds, ...created.productIds, ...created.warehouseIds, ...orderIds] } }, { entityType: { in: ["ReceivingRecord", "Location", "Shipment", "Fulfillment", "Return"] }, createdAt: { gte: startedAt } }] } }).catch(() => undefined);
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
