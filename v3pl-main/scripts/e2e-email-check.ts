/**
 * Transactional e-mail (D-073) with the EmailJS transport replaced by an in-memory capture — nothing is sent.
 * Service-level; no HTTP server needed. Creates temporary data and removes it.
 *
 * Usage: npm run e2e:email -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const RUN = `em${Date.now().toString(36)}`.toUpperCase();
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
const blank = { contactName: null, phone: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null };

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const owners = await import("../src/server/services/owners");
  const products = await import("../src/server/services/products");
  const warehouses = await import("../src/server/services/warehouses");
  const receiving = await import("../src/server/services/receiving");
  const orders = await import("../src/server/services/orders");
  const fulfillment = await import("../src/server/services/fulfillment");
  const email = await import("../src/server/services/email");
  const aff = await import("../src/server/services/affiliates");
  const { affiliateFormSchema } = await import("../src/lib/validation/affiliates");

  const sent: { to: string; subject: string; message: string }[] = [];
  let failNext = false;
  email.__setEmailTransportForTests(async (m) => {
    if (failNext) {
      failNext = false;
      return { ok: false, error: "simulated outage" };
    }
    sent.push({ to: m.to, subject: m.subject, message: m.message });
    return { ok: true };
  });

  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });
  const created = { ownerIds: [] as string[], productIds: [] as string[], warehouseIds: [] as string[], affiliateIds: [] as string[] };

  try {
    const V = await owners.createOwner("VENDOR", { code: `${RUN}-V`, businessName: `EM Vendor ${RUN}`, email: `${RUN.toLowerCase()}-vendor@example.test`, ...blank }, admin.id);
    const C = await owners.createOwner("THREEPL_CLIENT", { code: `${RUN}-C`, businessName: `EM Client ${RUN}`, email: `${RUN.toLowerCase()}-client@example.test`, ...blank }, admin.id);
    const N = await owners.createOwner("VENDOR", { code: `${RUN}-N`, businessName: `EM NoMail ${RUN}`, email: null, ...blank }, admin.id);
    created.ownerIds.push(V.id, C.id, N.id);
    const W = await warehouses.createWarehouse({ code: `${RUN}-W`, name: "EM Warehouse", addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, notes: null }, admin.id);
    created.warehouseIds.push(W.id);
    const loc = (await warehouses.getDefaultLocation(W.id))!;
    const p = await products.createProduct({ ownerId: V.id, name: `EM Widget ${RUN}`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-S1`, name: null, barcode: null, price: "12.50", cost: null, status: "ACTIVE" }] }, admin.id);
    created.productIds.push(p.id);
    const v = p.variants[0];
    await receiving.createReceiving({ ownerId: V.id, warehouseId: W.id, reference: `${RUN}-R`, notes: null, lines: [{ variantId: v.id, locationId: loc.id, quantity: 20 }] }, admin.id);

    // 1–2. Confirmation once; retrying the confirmation is a no-op.
    const o1 = await orders.createOrder({ source: "MANUAL", warehouseId: W.id, reserve: true, customerName: `EM Customer ${RUN}`, customerEmail: `${RUN.toLowerCase()}-cust@example.test`, shipName: "EM Customer", shipAddress1: "1 Test St", shipCity: "Dhaka", shipCountry: "BD", total: "25.00", lines: [{ variantId: v.id, quantity: 2, unitPrice: "12.50" }] }, admin.id);
    const conf = sent.filter((m) => m.subject.includes(o1.orderNumber) && m.subject.includes("confirmed"));
    check("1. Order confirmation sent once after creation, to the order's customer e-mail, with name / order number / items / total / ship-to", conf.length === 1 && conf[0].to === `${RUN.toLowerCase()}-cust@example.test` && conf[0].message.includes(`EM Customer ${RUN}`) && conf[0].message.includes(o1.orderNumber) && conf[0].message.includes(`2 × EM Widget ${RUN}`) && conf[0].message.includes("25.00") && conf[0].message.includes("1 Test St"), conf[0]?.message.split("\n").slice(0, 3).join(" | "));
    const again = await email.sendOrderConfirmation(o1.orderId);
    const replay = await orders.createOrder({ source: "MANUAL", sourceRef: `${RUN}-REF`, warehouseId: W.id, reserve: false, customerEmail: `${RUN.toLowerCase()}-cust2@example.test`, lines: [{ variantId: v.id, quantity: 1 }] }, admin.id);
    const replay2 = await orders.createOrder({ source: "MANUAL", sourceRef: `${RUN}-REF`, warehouseId: W.id, reserve: false, customerEmail: `${RUN.toLowerCase()}-cust2@example.test`, lines: [{ variantId: v.id, quantity: 1 }] }, admin.id);
    check("2. Retry safety: re-running the confirmation → duplicate (no send); an idempotent replay of the same order identity (created:false) sends nothing more; exactly one claim event per order", again === "duplicate" && sent.filter((m) => m.subject.includes(o1.orderNumber)).length === 1 && replay.created && !replay2.created && sent.filter((m) => m.subject.includes(replay.orderNumber)).length === 1 && (await prisma.orderEvent.count({ where: { orderId: o1.orderId, externalEventId: `email:confirmation:${o1.orderId}` } })) === 1);

    // 3. No e-mail → skipped, order fine.
    const o3 = await orders.createOrder({ source: "MANUAL", warehouseId: W.id, reserve: true, customerName: "No Mail", lines: [{ variantId: v.id, quantity: 1 }] }, admin.id);
    const skipEv = await prisma.orderEvent.findFirst({ where: { orderId: o3.orderId, type: "email_skipped" } });
    check("3. Missing customer e-mail: order created normally, nothing sent, skip recorded on the order history", o3.created && !sent.some((m) => m.subject.includes(o3.orderNumber)) && !!skipEv && skipEv.message.includes("no valid customer e-mail"));
    // 3b. Shopify-sourced orders are not e-mailed by V3PL (channel notifies).
    const so = await orders.createExternal({ source: "SHOPIFY", shopify: { storeId: `${RUN}-STORE`, orderId: `${RUN}-9001`, orderName: "#9001" }, warehouseId: W.id, reserve: false, customerEmail: `${RUN.toLowerCase()}-shop@example.test`, lines: [{ sku: v.sku, quantity: 1, externalLineId: "L1" }] }, null);
    check("4. Shopify-sourced order: no V3PL confirmation (channel notifies its customer); skip recorded", !sent.some((m) => m.to === `${RUN.toLowerCase()}-shop@example.test`) && (await prisma.orderEvent.count({ where: { orderId: so.orderId, type: "email_skipped" } })) === 1);

    // 5–6. Delivered once; reprocessing is a no-op; intermediate statuses send nothing.
    const f = await fulfillment.startPicking({ orderId: o1.orderId, warehouseId: W.id }, admin.id);
    const sh = await fulfillment.shipFulfillment(f.id, { carrier: "UPS", trackingNumber: `${RUN}-T` }, admin.id);
    await fulfillment.updateShipmentStatus(sh.id, "IN_TRANSIT", admin.id);
    const beforeDelivered = sent.length;
    await fulfillment.updateShipmentStatus(sh.id, "DELIVERED", admin.id);
    const del = sent.filter((m) => m.subject === `Order ${o1.orderNumber} delivered`);
    check("5. Delivered e-mail sent once when the existing lifecycle reaches Delivered (order FULFILLED); shipping / in-transit sent nothing", del.length === 1 && sent.length === beforeDelivered + 1 && del[0].to === `${RUN.toLowerCase()}-cust@example.test` && del[0].message.includes("has been delivered"));
    await fulfillment.updateShipmentStatus(sh.id, "DELIVERED", admin.id, `${RUN}-EVT`);
    const redo = await email.sendOrderDelivered(o1.orderId);
    check("6. Reprocessing Delivered (same status again, or the sender called again) does not duplicate", redo === "duplicate" && sent.filter((m) => m.subject === `Order ${o1.orderNumber} delivered`).length === 1);

    // 7. Transport failure never breaks the flow and is recorded.
    failNext = true;
    const o7 = await orders.createOrder({ source: "MANUAL", warehouseId: W.id, reserve: false, customerEmail: `${RUN.toLowerCase()}-fail@example.test`, lines: [{ variantId: v.id, quantity: 1 }] }, admin.id);
    check("7. Provider failure: order still created; failure recorded as email_failed on the order; no retry storm (claim kept)", o7.created && (await prisma.orderEvent.count({ where: { orderId: o7.orderId, type: "email_failed" } })) === 1 && (await email.sendOrderConfirmation(o7.orderId)) === "duplicate");

    // 8–10. Admin → partner e-mails, recipient resolved server-side.
    const A = await aff.createAffiliate(affiliateFormSchema.parse({ code: `${RUN}-A`, name: `EM Affiliate ${RUN}`, email: `${RUN.toLowerCase()}-aff@example.test`, phone: "", status: "ACTIVE", commissionType: "", commissionValue: "", notes: "" }), admin.id);
    created.affiliateIds.push(A.id);
    const rv = await email.sendPartnerEmail("OWNER", V.id, { subject: `${RUN} hello vendor`, message: "Test to vendor" }, admin.id);
    const rc = await email.sendPartnerEmail("OWNER", C.id, { subject: `${RUN} hello client`, message: "Test to client" }, admin.id);
    const ra = await email.sendPartnerEmail("AFFILIATE", A.id, { subject: `${RUN} hello affiliate`, message: "Test to affiliate" }, admin.id);
    check("8. Admin → Vendor, 3PL client and Affiliate: each sent to the address on the record (server-resolved), audit row per send", rv.to === `${RUN.toLowerCase()}-vendor@example.test` && rc.to === `${RUN.toLowerCase()}-client@example.test` && ra.to === `${RUN.toLowerCase()}-aff@example.test` && sent.filter((m) => m.subject.startsWith(`${RUN} hello`)).length === 3 && (await prisma.auditLog.count({ where: { action: "email.sent", entityId: { in: [V.id, C.id, A.id] } } })) === 3);
    const noMail = await expectError(() => email.sendPartnerEmail("OWNER", N.id, { subject: "x", message: "y" }, admin.id), "NO_EMAIL");
    const missing = await expectError(() => email.sendPartnerEmail("AFFILIATE", "does-not-exist", { subject: "x", message: "y" }, admin.id), "NOT_FOUND");
    check("9. Account without an e-mail → NO_EMAIL (nothing sent); unknown account → NOT_FOUND; the caller never supplies a recipient address", noMail.hit && missing.hit && !sent.some((m) => m.subject === "x"));
    const src = await import("node:fs/promises").then((fs) => fs.readFile("src/server/actions/email.ts", "utf8"));
    check("10. Manual e-mail actions are ADMIN-only server actions (both actions call requireRole(\"ADMIN\")) and take no recipient parameter", (src.match(/requireRole\("ADMIN"\)/g) ?? []).length === 2 && !/to:\s*z\./.test(src) && !src.includes("input.to"));
    check("11. Invalid / unconfigured sends never throw from sendEmail", (await email.sendEmail({ to: "not-an-email", toName: null, subject: "s", message: "m" })).ok === false);

    // 12–13. Real EmailJS transport invocation with fetch stubbed: exact REST payload and error handling (no network).
    const saved = { fetch: globalThis.fetch, env: { ...process.env } };
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let respond: { status: number; text: string } = { status: 200, text: "OK" };
    try {
      process.env.EMAILJS_SERVICE_ID = ' "service_test" ';
      process.env.EMAILJS_TEMPLATE_ID = "template_test";
      process.env.EMAILJS_PUBLIC_KEY = "pub_test";
      process.env.EMAILJS_PRIVATE_KEY = "priv_test";
      email.__setEmailTransportForTests(null);
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
        return new Response(respond.text, { status: respond.status });
      }) as typeof fetch;
      const okSend = await email.sendEmail({ to: "someone@example.test", toName: "Someone", subject: "Subj", message: "Body" });
      const b = calls[0]?.body as { service_id?: string; template_id?: string; user_id?: string; accessToken?: string; template_params?: Record<string, string> };
      check("12. EmailJS REST invocation: POST api.emailjs.com/…/email/send with service_id (quotes / spaces stripped), template_id, user_id = public key, accessToken = private key, template_params to_email / to_name / subject / message", okSend.ok && calls.length === 1 && calls[0].url === "https://api.emailjs.com/api/v1.0/email/send" && b.service_id === "service_test" && b.template_id === "template_test" && b.user_id === "pub_test" && b.accessToken === "priv_test" && b.template_params?.to_email === "someone@example.test" && b.template_params?.to_name === "Someone" && b.template_params?.subject === "Subj" && b.template_params?.message === "Body");
      respond = { status: 400, text: "The template ID not found." };
      const bad = await email.sendEmail({ to: "someone@example.test", toName: null, subject: "s", message: "m" });
      check("13. Provider 400 surfaces as a readable failure naming the ids (never the keys) and does not throw", !bad.ok && bad.error.includes("template ID not found") && bad.error.includes("template template_test") && !bad.error.includes("priv_test"));
    } finally {
      globalThis.fetch = saved.fetch;
      for (const k of ["EMAILJS_SERVICE_ID", "EMAILJS_TEMPLATE_ID", "EMAILJS_PUBLIC_KEY", "EMAILJS_PRIVATE_KEY"]) {
        if (saved.env[k] === undefined) delete process.env[k];
        else process.env[k] = saved.env[k];
      }
    }
  } finally {
    email.__setEmailTransportForTests(null);
    const orderIds = (await prisma.order.findMany({ where: { items: { some: { ownerId: { in: created.ownerIds } } } }, select: { id: true } })).map((o) => o.id);
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
    await prisma.inventoryLevel.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.inventoryBalance.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingItem.deleteMany({ where: { variant: { productId: { in: created.productIds } } } });
    await prisma.receivingRecord.deleteMany({ where: { ownerId: { in: created.ownerIds } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: created.productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    await prisma.location.deleteMany({ where: { warehouseId: { in: created.warehouseIds } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: created.warehouseIds } } });
    await prisma.affiliate.deleteMany({ where: { id: { in: created.affiliateIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...created.ownerIds, ...created.productIds, ...created.warehouseIds, ...created.affiliateIds, ...orderIds] } }, { entityType: { in: ["ReceivingRecord", "Location", "Shipment", "Fulfillment"] }, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } }] } }).catch(() => undefined);
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
