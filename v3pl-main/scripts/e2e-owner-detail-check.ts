/**
 * Admin vendor / 3PL client detail → Products, Inventory, Orders sections (owner-scoped).
 * Service-level scoping checks plus HTTP checks against a running production build.
 * Creates temporary data (2 vendors, 1 3PL client, 1 warehouse, a mixed-owner order) and removes it.
 *
 * Usage: npm run e2e:owner-detail -- http://localhost:3100 vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const [base = "http://localhost:3100", adminEmail = "vendor3pl@gmail.com"] = process.argv.slice(2);
const RUN = `od${Date.now().toString(36)}`.toUpperCase();
const results: { name: string; ok: boolean; skipped?: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const skip = (name: string, why: string) => {
  results.push({ name, ok: true, skipped: true });
  console.log(`SKIP  ${name} — ${why}`);
};
const blankAddress = { contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null };

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const owners = await import("../src/server/services/owners");
  const products = await import("../src/server/services/products");
  const inventory = await import("../src/server/services/inventory");
  const warehouses = await import("../src/server/services/warehouses");
  const receiving = await import("../src/server/services/receiving");
  const orders = await import("../src/server/services/orders");
  const users = await import("../src/server/services/users");

  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });
  const created = { ownerIds: [] as string[], productIds: [] as string[], warehouseIds: [] as string[], orderIds: new Set<string>(), userIds: [] as string[], firebaseUids: [] as string[] };

  try {
    const A = await owners.createOwner("VENDOR", { code: `${RUN}-A`, businessName: `OD Vendor A ${RUN}`, ...blankAddress }, admin.id);
    const B = await owners.createOwner("VENDOR", { code: `${RUN}-B`, businessName: `OD Vendor B ${RUN}`, ...blankAddress }, admin.id);
    const C = await owners.createOwner("THREEPL_CLIENT", { code: `${RUN}-C`, businessName: `OD Client C ${RUN}`, ...blankAddress }, admin.id);
    created.ownerIds.push(A.id, B.id, C.id);
    const W = await warehouses.createWarehouse({ code: `${RUN}-W`, name: "OD Warehouse", addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null }, admin.id);
    created.warehouseIds.push(W.id);
    const loc = (await warehouses.getDefaultLocation(W.id))!;

    const mk = async (ownerId: string, tag: string) => {
      const p = await products.createProduct({ ownerId, name: `OD Product ${tag} ${RUN}`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-${tag}1`, name: null, barcode: null, price: "5.00", cost: null, status: "ACTIVE" }] }, admin.id);
      created.productIds.push(p.id);
      return p.variants[0];
    };
    const [vA, vB, vC] = [await mk(A.id, "A"), await mk(B.id, "B"), await mk(C.id, "C")];
    for (const [o, v, qty] of [[A, vA, 10], [B, vB, 20], [C, vC, 30]] as const) await receiving.createReceiving({ ownerId: o.id, warehouseId: W.id, reference: `${RUN}-R-${o.code}`, notes: null, lines: [{ variantId: v.id, locationId: loc.id, quantity: qty }] }, admin.id);

    // Mixed-owner order: A ×2, B ×3, C ×4 in ONE customer order; plus one order only for B.
    const mixed = await orders.createOrder({ source: "MANUAL", warehouseId: W.id, reserve: true, customerName: `OD Customer ${RUN}`, lines: [{ variantId: vA.id, quantity: 2 }, { variantId: vB.id, quantity: 3 }, { variantId: vC.id, quantity: 4 }] }, admin.id);
    const onlyB = await orders.createOrder({ source: "MANUAL", warehouseId: W.id, reserve: true, lines: [{ variantId: vB.id, quantity: 1 }] }, admin.id);
    created.orderIds.add(mixed.orderId).add(onlyB.orderId);

    // ---------------------------------------------------------------- service-level scoping
    const pA = await products.listProducts({ ownerId: A.id, status: "ALL" });
    const pC = await products.listProducts({ ownerId: C.id, status: "ALL" });
    check("Products: vendor A scope returns only A's products; 3PL C scope returns only C's", pA.total === 1 && pA.items.every((p) => p.owner.id === A.id) && pA.items[0].variants[0].sku === vA.sku && pC.total === 1 && pC.items[0].variants[0].sku === vC.sku);

    const sA = await inventory.listStock({ ownerId: A.id });
    const sB = await inventory.listStock({ ownerId: B.id });
    const sC = await inventory.listStock({ ownerId: C.id });
    const tA = await inventory.stockTotals(A.id);
    const tC = await inventory.stockTotals(C.id);
    check("Inventory: each owner's stock rows and totals contain only that owner's SKUs (A 10/2 reserved, B 20/4, C 30/4)", sA.items.length === 1 && sA.items[0].variant.sku === vA.sku && sA.items[0].onHand === 10 && sA.items[0].reserved === 2 && sB.items.length === 1 && sB.items[0].variant.sku === vB.sku && sB.items[0].reserved === 4 && sC.items.length === 1 && sC.items[0].variant.sku === vC.sku && sC.items[0].onHand === 30 && tA.onHand === 10 && tA.reserved === 2 && tA.available === 8 && tC.onHand === 30 && tC.available === 26, `A ${sA.items.length} rows / B ${sB.items.length} / C ${sC.items.length}`);

    const oA = await orders.listOrders({ scopeOwnerId: A.id });
    const oB = await orders.listOrders({ scopeOwnerId: B.id });
    const oC = await orders.listOrders({ scopeOwnerId: C.id });
    const mixedForA = oA.items.find((o) => o.id === mixed.orderId);
    const mixedForB = oB.items.find((o) => o.id === mixed.orderId);
    const mixedForC = oC.items.find((o) => o.id === mixed.orderId);
    check("Mixed order: A sees only its line (A1 ×2), B only B1 ×3, C only C1 ×4 — order/customer context kept, other owners' lines absent", !!mixedForA && mixedForA.items.length === 1 && mixedForA.items[0].sku === vA.sku && mixedForA.items[0].quantity === 2 && mixedForA.customerName === `OD Customer ${RUN}` && !!mixedForB && mixedForB.items.length === 1 && mixedForB.items[0].sku === vB.sku && mixedForB.items[0].quantity === 3 && !!mixedForC && mixedForC.items.length === 1 && mixedForC.items[0].sku === vC.sku && mixedForC.items[0].quantity === 4);
    check("Order lists: A has 1 order, B has 2 (mixed + own), C has 1; no list contains an order without that owner's lines", oA.total === 1 && oB.total === 2 && oC.total === 1 && oA.items.every((o) => o.items.every((i) => i.ownerId === A.id)) && oB.items.every((o) => o.items.length > 0 && o.items.every((i) => i.ownerId === B.id)) && oC.items.every((o) => o.items.every((i) => i.ownerId === C.id)), `A ${oA.total} / B ${oB.total} / C ${oC.total}`);
    check("Vendor vs 3PL separation: C's product / stock / order scopes never include vendor SKUs and vice versa", !JSON.stringify([pC, sC, oC]).includes(`${RUN}-A1`) && !JSON.stringify([pC, sC, oC]).includes(`${RUN}-B1`) && !JSON.stringify([pA, sA, oA]).includes(`${RUN}-C1`));

    // ---------------------------------------------------------------- HTTP (admin detail pages)
    const mint = async (tag: string, role: "ADMIN" | "VENDOR", ownerId: string | null, audience: "staff" | "portal") => {
      const { firebaseAdminAuth } = await import("../src/lib/firebase/admin");
      const u = await users.createUserAccount({ name: `OD ${tag}`, email: `${RUN.toLowerCase()}-${tag}@example.test`, password: "E2eTestPass123", role, ownerId, phone: null, notes: null }, admin.id);
      created.userIds.push(u.id);
      created.firebaseUids.push(u.firebaseUid);
      const custom = await firebaseAdminAuth().createCustomToken(u.firebaseUid);
      const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
      const { idToken } = await r.json();
      const res = await fetch(`${base}/api/auth/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, audience }) });
      return (res.headers.get("set-cookie") ?? "").split(";")[0];
    };
    let ck = { admin: "", vendor: "" };
    try {
      ck = { admin: await mint("admin", "ADMIN", null, "staff"), vendor: await mint("vendor", "VENDOR", A.id, "portal") };
    } catch (err) {
      console.log(`      (session unavailable: ${(err as Error).message.slice(0, 100)})`);
    }
    const httpNames = ["HTTP: admin vendor A detail renders Products / Inventory / Orders with only A's SKU, its mixed-order line (A1 × 2) and no B or C SKU; placeholder gone", "HTTP: admin vendor B detail shows B1 only (mixed + own order, B1 × 3) and no A / C SKU", "HTTP: admin 3PL client C detail shows C1 only (C1 × 4, 30 on hand) and no vendor SKU; 'View all' links carry ownerId", "HTTP: portal vendor user cannot open the admin detail pages (redirect / non-200)"];
    if (!ck.admin || !ck.vendor) for (const nm of httpNames) skip(nm, "no session");
    else {
      const get = async (cookie: string, path: string) => {
        const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
        return { status: res.status, location: res.headers.get("location"), html: (await res.text()).replace(/<!--[\s\S]*?-->/g, "") };
      };
      const has = (html: string, ...parts: string[]) => parts.every((p) => html.includes(p));
      const lacks = (html: string, ...parts: string[]) => parts.every((p) => !html.includes(p));
      const dA = await get(ck.admin, `/admin/vendors/${A.id}`);
      check(httpNames[0], dA.status === 200 && has(dA.html, 'data-slot="owner-operations"', 'data-slot="owner-products"', 'data-slot="owner-inventory"', 'data-slot="owner-orders"', `${RUN}-A1`, `${RUN}-A1 × 2`, `OD Customer ${RUN}`) && lacks(dA.html, `${RUN}-B1`, `${RUN}-C1`, "Phase 3 onwards"), `${dA.status}`);
      const dB = await get(ck.admin, `/admin/vendors/${B.id}`);
      check(httpNames[1], dB.status === 200 && has(dB.html, `${RUN}-B1 × 3`, `${RUN}-B1 × 1`) && lacks(dB.html, `${RUN}-A1`, `${RUN}-C1`), `${dB.status}`);
      const dC = await get(ck.admin, `/admin/3pl-clients/${C.id}`);
      check(httpNames[2], dC.status === 200 && has(dC.html, `${RUN}-C1 × 4`, `/admin/products?ownerId=${C.id}`, `/admin/inventory?ownerId=${C.id}`, `/admin/orders?ownerId=${C.id}`) && lacks(dC.html, `${RUN}-A1`, `${RUN}-B1`), `${dC.status}`);
      const pv = await get(ck.vendor, `/admin/vendors/${B.id}`);
      const pc = await get(ck.vendor, `/admin/3pl-clients/${C.id}`);
      check(httpNames[3], pv.status !== 200 && pc.status !== 200 && lacks(pv.html, `${RUN}-B1`) && lacks(pc.html, `${RUN}-C1`), `${pv.status}${pv.location ? `→${pv.location}` : ""} / ${pc.status}`);
    }
  } finally {
    const { firebaseAdminAuth } = await import("../src/lib/firebase/admin");
    for (const uid of created.firebaseUids) await firebaseAdminAuth().deleteUser(uid).catch(() => undefined);
    const all = await prisma.order.findMany({ where: { items: { some: { ownerId: { in: created.ownerIds } } } }, select: { id: true } });
    all.forEach((o) => created.orderIds.add(o.id));
    const orderIds = [...created.orderIds];
    await prisma.inventoryTransaction.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { variant: { productId: { in: created.productIds } } }] } });
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
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...created.ownerIds, ...created.productIds, ...created.warehouseIds, ...created.userIds, ...orderIds] } }, { userId: { in: created.userIds } }, { entityType: { in: ["ReceivingRecord", "Location"] }, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } }] } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
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
