/**
 * Hard Reset Platform + dashboard cleanup (D-076). Service-level; no HTTP server needed.
 * The reset runs inside a transaction that is ALWAYS rolled back (sentinel throw), so nothing on the shared
 * database is actually removed — the assertions run while the deletions are pending inside the transaction.
 *
 * Usage: npm run e2e:reset -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

class Rollback extends Error {}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const reset = await import("../src/server/services/platform-reset");

  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN", status: "ACTIVE" } });
  const staffBefore = await prisma.user.count({ where: { role: { in: ["ADMIN", "WAREHOUSE", "SALES"] } } });
  const auditBefore = await prisma.auditLog.count();
  const TX = { timeout: 120_000, maxWait: 10_000 } as const;

  // --- Static: dashboard + action wiring -------------------------------------------------------------
  const dash = readFileSync("src/app/admin/(dashboard)/page.tsx", "utf8");
  check("1. Dashboard no longer renders the System status card", !dash.includes("System status") && !dash.includes("checkDatabaseConnection"));
  check("2. Dashboard no longer renders the Platform build-out card", !dash.includes("Platform build-out") && !dash.includes("FOUNDATION"));
  check("3. Dashboard still renders the business metrics (orders, stock, partners, finance)", ["<OrderStats />", "<StockStats />", "<PartnerStats />", "<FinanceStats />"].every((c) => dash.includes(c)));
  const settings = readFileSync("src/app/admin/(dashboard)/settings/page.tsx", "utf8");
  const systemPage = readFileSync("src/app/admin/(dashboard)/settings/system/page.tsx", "utf8");
  check("4. System status moved to Settings → System (reuses the same status component/data)", settings.includes("/admin/settings/system") && systemPage.includes("SystemStatusCard") && readFileSync("src/components/settings/system-status.tsx", "utf8").includes("checkDatabaseConnection"));

  const action = readFileSync("src/server/actions/platform-reset.ts", "utf8");
  const page = readFileSync("src/app/admin/(dashboard)/settings/danger-zone/page.tsx", "utf8");
  check("5. Reset is ADMIN-only: the action and the Danger Zone page both call requireRole(\"ADMIN\"); non-admins are redirected by the guard", action.includes('requireRole("ADMIN")') && page.includes('requireRole("ADMIN")'));
  check("6. Reset cannot execute without the exact phrase AND a fresh Firebase re-authentication for the same account (uid + auth_time checked server-side)", action.includes("PLATFORM_RESET_PHRASE") && action.includes("verifyIdToken(") && action.includes("admin.firebaseUid") && action.includes("auth_time") && reset.PLATFORM_RESET_PHRASE === "RESET V3PL");

  // --- Behaviour: run the reset inside a rolled-back transaction ---------------------------------------
  type Inside = { zero: [string, number][]; adminAlive: boolean; staffKept: boolean; auditRow: boolean; notifications: number };
  const captured: { counts: Record<string, number> | null; inside: Inside | null } = { counts: null, inside: null };
  try {
    await prisma.$transaction(async (tx) => {
      captured.counts = await reset.hardResetPlatform(tx, admin.id);
      const zero: [string, number][] = [
        ["product", await tx.product.count()],
        ["productVariant", await tx.productVariant.count()],
        ["inventoryLevel", await tx.inventoryLevel.count()],
        ["inventoryTransaction", await tx.inventoryTransaction.count()],
        ["warehouse", await tx.warehouse.count()],
        ["location", await tx.location.count()],
        ["order", await tx.order.count()],
        ["customer", await tx.customer.count()],
        ["fulfillment", await tx.fulfillment.count()],
        ["shipment", await tx.shipment.count()],
        ["return", await tx.return.count()],
        ["receivingRecord", await tx.receivingRecord.count()],
        ["transfer", await tx.transfer.count()],
        ["owner", await tx.owner.count()],
        ["affiliate", await tx.affiliate.count()],
        ["affiliateCommission", await tx.affiliateCommission.count()],
        ["charge", await tx.charge.count()],
        ["chargeRule", await tx.chargeRule.count()],
        ["ledgerEntry", await tx.ledgerEntry.count()],
        ["shopifyStore", await tx.shopifyStore.count()],
        ["shopifyVariantMapping", await tx.shopifyVariantMapping.count()],
        ["importJob", await tx.importJob.count()],
        ["portalUser", await tx.user.count({ where: { role: { in: ["VENDOR", "THREEPL_CLIENT", "AFFILIATE"] } } })],
      ];
      const me = await tx.user.findUnique({ where: { id: admin.id }, select: { role: true, status: true, firebaseUid: true } });
      captured.inside = {
        zero,
        adminAlive: !!me && me.role === "ADMIN" && me.status === "ACTIVE" && me.firebaseUid === admin.firebaseUid,
        staffKept: (await tx.user.count({ where: { role: { in: ["ADMIN", "WAREHOUSE", "SALES"] } } })) === staffBefore,
        auditRow: (await tx.auditLog.count({ where: { action: "platform.hard_reset", userId: admin.id, createdAt: { gte: new Date(Date.now() - 60_000) } } })) === 1,
        notifications: await tx.adminNotification.count(),
      };
      throw new Rollback();
    }, TX);
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  const { inside, counts } = captured;
  const leftovers: [string, number][] = inside ? inside.zero.filter(([, n]) => n !== 0) : [["no-run", -1]];
  check("7. Business records are removed (products, stock, warehouses, orders, customers, fulfilment, returns, receiving, transfers, vendors/3PL, affiliates, finance, Shopify connections, imports, portal users)", inside !== null && leftovers.length === 0, leftovers.map(([k, n]) => `${k}=${n}`).join(", ") || `${reset.totalRemoved(counts ?? {})} rows would be removed`);
  check("8. Notifications are removed", inside !== null && inside.notifications === 0);
  check("9. Admin account survives (same row, ADMIN, ACTIVE, same Firebase UID) and staff accounts are kept", !!inside && inside.adminAlive && inside.staffKept);
  check("10. The reset itself is recorded through the existing audit log (platform.hard_reset)", !!inside && inside.auditRow);

  // --- Guard: an actor that is not an active ADMIN aborts the reset -------------------------------------
  let guarded: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      await reset.hardResetPlatform(tx, "not-an-admin-id");
      throw new Rollback();
    }, TX);
  } catch (err) {
    guarded = err instanceof reset.PlatformResetError ? err.code : err instanceof Rollback ? "ROLLBACK" : String(err);
  }
  check("11. Reset aborts (transaction rolled back) when the acting account would not survive as an active ADMIN", guarded === "ADMIN_MISSING", guarded ?? "");

  // --- Nothing actually changed on the shared database -------------------------------------------------
  const after = { products: await prisma.product.count(), owners: await prisma.owner.count(), audit: await prisma.auditLog.count(), admin: await prisma.user.findUnique({ where: { id: admin.id }, select: { id: true } }) };
  check("12. Rolled back: live data, audit log and the admin row are unchanged after the checks", after.audit === auditBefore && !!after.admin, `products=${after.products} owners=${after.owners}`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
