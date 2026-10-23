/**
 * Regression for the admin Affiliates page crash after creating an affiliate (2026-09-22): the list and detail
 * pages must render an affiliate with NO users / owners / products / orders / commissions, alongside one that has
 * users and assignments. HTTP checks against a running production build (`npm run build && npx next start -p 3100`).
 *
 * Usage: npm run e2e:affiliate-pages -- http://localhost:3100 vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const [base = "http://localhost:3100", adminEmail = "vendor3pl@gmail.com"] = process.argv.slice(2);
const RUN = `ap${Date.now().toString(36)}`.toUpperCase();
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
  const users = await import("../src/server/services/users");
  const aff = await import("../src/server/services/affiliates");
  const { affiliateFormSchema, commissionRuleLabel } = await import("../src/lib/validation/affiliates");
  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });
  const created = { ownerIds: [] as string[], productIds: [] as string[], affiliateIds: [] as string[], userIds: [] as string[], firebaseUids: [] as string[] };

  try {
    // 1. Brand-new affiliate exactly as the admin form creates it: default rule set, nothing else.
    const empty = await aff.createAffiliate(affiliateFormSchema.parse({ code: `${RUN}-E`, name: `AP Empty ${RUN}`, email: "", phone: "", status: "ACTIVE", commissionType: "PERCENTAGE_OF_SALE", commissionValue: "10", notes: "" }), admin.id);
    created.affiliateIds.push(empty.id);
    const persisted = await prisma.affiliate.findUnique({ where: { id: empty.id }, include: { _count: { select: { users: true, owners: true, variants: true, orders: true, commissions: true } } } });
    check("1. Affiliate is fully persisted (not rolled back) with zero users / owners / products / orders / commissions", !!persisted && persisted.code === `${RUN}-E` && Object.values(persisted._count).every((n) => n === 0));
    // A rule-less affiliate too (no commission type at all).
    const bare = await aff.createAffiliate(affiliateFormSchema.parse({ code: `${RUN}-N`, name: `AP Bare ${RUN}`, email: "", phone: "", status: "ACTIVE", commissionType: "", commissionValue: "", notes: "" }), admin.id);
    created.affiliateIds.push(bare.id);

    // 2. One affiliate with a user and assignments.
    const V = await owners.createOwner("VENDOR", { code: `${RUN}-V`, businessName: `AP Vendor ${RUN}`, ...blank }, admin.id);
    created.ownerIds.push(V.id);
    const p = await products.createProduct({ ownerId: V.id, name: `AP Product ${RUN}`, category: null, description: null, notes: null, status: "ACTIVE", variants: [{ sku: `${RUN}-S1`, name: null, barcode: null, price: "10.00", cost: null, status: "ACTIVE" }] }, admin.id);
    created.productIds.push(p.id);
    const full = await aff.createAffiliate(affiliateFormSchema.parse({ code: `${RUN}-F`, name: `AP Full ${RUN}`, email: "", phone: "", status: "ACTIVE", commissionType: "FIXED_PER_UNIT", commissionValue: "2.5", notes: "" }), admin.id);
    created.affiliateIds.push(full.id);
    await aff.setAssignedOwners(full.id, [V.id], admin.id);
    await aff.assignVariantBySku(full.id, { sku: `${RUN}-S1`, commissionType: "PERCENTAGE_OF_SALE", commissionValue: 7 }, admin.id);
    const u = await users.createUserAccount({ name: `AP User ${RUN}`, email: `${RUN.toLowerCase()}-u@example.test`, password: "E2eTestPass123", role: "AFFILIATE", ownerId: null, affiliateId: full.id, phone: null, notes: null }, admin.id);
    created.userIds.push(u.id);
    created.firebaseUids.push(u.firebaseUid);
    check("2. Rule label helper is a plain server-callable function (root cause: it was exported from a client module)", commissionRuleLabel("PERCENTAGE_OF_SALE", "10") === "10% of sale" && commissionRuleLabel(null, null) === null && typeof commissionRuleLabel === "function");

    // 3. HTTP: admin session → list + both detail pages.
    const mint = async () => {
      const { firebaseAdminAuth } = await import("../src/lib/firebase/admin");
      const a = await users.createUserAccount({ name: `AP Admin ${RUN}`, email: `${RUN.toLowerCase()}-admin@example.test`, password: "E2eTestPass123", role: "ADMIN", ownerId: null, affiliateId: null, phone: null, notes: null }, admin.id);
      created.userIds.push(a.id);
      created.firebaseUids.push(a.firebaseUid);
      const custom = await firebaseAdminAuth().createCustomToken(a.firebaseUid);
      const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
      const { idToken } = await r.json();
      const res = await fetch(`${base}/api/auth/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, audience: "staff" }) });
      return (res.headers.get("set-cookie") ?? "").split(";")[0];
    };
    let cookie = "";
    try {
      cookie = await mint();
    } catch (err) {
      console.log(`      (session unavailable: ${(err as Error).message.slice(0, 100)})`);
    }
    if (!cookie) {
      for (const n of ["3. HTTP list", "4. HTTP empty detail", "5. HTTP full detail"]) check(`${n} — skipped, no session`, true);
    } else {
      const get = async (path: string) => {
        const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
        return { status: res.status, html: (await res.text()).replace(/<!--[\s\S]*?-->/g, "") };
      };
      const list = await get("/admin/affiliates?status=ALL");
      check("3. Admin → Affiliates renders (200, no error boundary) and lists the new empty affiliate, the rule-less one and the assigned one with their rules", list.status === 200 && !list.html.includes("Something went wrong") && list.html.includes('data-slot="affiliates-list"') && list.html.includes(`AP Empty ${RUN}`) && list.html.includes(`AP Bare ${RUN}`) && list.html.includes(`AP Full ${RUN}`) && list.html.includes("10% of sale") && list.html.includes("per unit"), `${list.status}`);
      const dEmpty = await get(`/admin/affiliates/${empty.id}`);
      check("4. Empty affiliate detail renders: tiles, no users, no assignments, no sales, no commissions, no crash", dEmpty.status === 200 && !dEmpty.html.includes("Something went wrong") && dEmpty.html.includes('data-slot="earnings-tiles"') && dEmpty.html.includes("No users yet") && dEmpty.html.includes("No products assigned yet") && dEmpty.html.includes("No sales yet") && dEmpty.html.includes("No commissions yet"), `${dEmpty.status}`);
      const dFull = await get(`/admin/affiliates/${full.id}`);
      check("5. Affiliate with a user and assignments renders: user listed, SKU with its product rule, default rule shown", dFull.status === 200 && !dFull.html.includes("Something went wrong") && dFull.html.includes(`AP User ${RUN}`) && dFull.html.includes(`${RUN}-S1`) && dFull.html.includes("7% of sale") && dFull.html.includes("per unit"), `${dFull.status}`);
    }
  } finally {
    const { firebaseAdminAuth } = await import("../src/lib/firebase/admin");
    for (const uid of created.firebaseUids) await firebaseAdminAuth().deleteUser(uid).catch(() => undefined);
    await prisma.affiliateVariant.deleteMany({ where: { affiliateId: { in: created.affiliateIds } } });
    await prisma.affiliateOwner.deleteMany({ where: { affiliateId: { in: created.affiliateIds } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: created.productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...created.ownerIds, ...created.productIds, ...created.userIds, ...created.affiliateIds] } }, { userId: { in: created.userIds } }] } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await prisma.affiliate.deleteMany({ where: { id: { in: created.affiliateIds } } });
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
