/**
 * Account linking regression (AUTH-BOOT): the two intended ways a platform account comes to exist.
 *  1. Bootstrap / Main Admin: an account created directly in Firebase Authentication is linked as ADMIN by the
 *     existing `seed:admin` mechanism (Firebase UID lookup, never email-only trust).
 *  2. Platform-created: `createUserAccount` creates the Firebase account AND the row with the role chosen in V3PL;
 *     it never becomes ADMIN implicitly, and `seed:admin` refuses to promote it without --force.
 *  Plus: a linked UID resolves at login; a Firebase account with no row gets `no_account`; the Shopify review
 *  account is linked by UID. Creates temporary Firebase users and rows and removes them in `finally`.
 *
 * Usage: npm run e2e:account-linking -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const RUN = `al${Date.now().toString(36)}`.toLowerCase();
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const seed = (args: string[]) => {
  try {
    return { code: 0, out: execFileSync("npx", ["tsx", "scripts/seed-admin.ts", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
};

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { firebaseAdminAuth } = await import("../src/lib/firebase/admin");
  const users = await import("../src/server/services/users");
  const { isStaffRole } = await import("../src/lib/roles");
  const auth = firebaseAdminAuth();
  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });
  const emails = { boot: `${RUN}-boot@example.test`, staff: `${RUN}-staff@example.test`, stray: `${RUN}-stray@example.test` };
  const fbUids: string[] = [];

  try {
    // 1. Firebase-created account → Main Admin via the existing bootstrap mechanism (UID link).
    const boot = await auth.createUser({ email: emails.boot, password: `Boot!${RUN}9x`, displayName: "Boot Admin" });
    fbUids.push(boot.uid);
    const r1 = seed([emails.boot, "Boot Admin"]);
    const bootRow = await prisma.user.findUnique({ where: { firebaseUid: boot.uid } });
    const seededAudit = bootRow ? await prisma.auditLog.count({ where: { action: "user.seeded", entityId: bootRow.id } }) : 0;
    check("1. Firebase-created account is linked as the Main Admin by seed:admin — row created by Firebase UID, role ADMIN, ACTIVE, audited as user.seeded", r1.code === 0 && !!bootRow && bootRow.role === "ADMIN" && bootRow.status === "ACTIVE" && bootRow.email === emails.boot && seededAudit === 1, r1.out.trim().split("\n").pop()?.replace(/firebaseUid \S+/, "firebaseUid <redacted>"));
    const r1b = seed([emails.boot, "Boot Admin"]);
    check("1b. Re-running seed:admin for an active ADMIN is a no-op (idempotent)", r1b.code === 0 && r1b.out.includes("Nothing to do") && (await prisma.user.count({ where: { email: emails.boot } })) === 1);

    // 2. Platform-created account keeps the role chosen in V3PL and is never promoted implicitly.
    const staff = await users.createUserAccount({ email: emails.staff, password: `Staff!${RUN}9x`, name: "Warehouse Person", role: "WAREHOUSE", ownerId: null, affiliateId: null, phone: null, notes: null }, admin.id);
    const staffFb = await auth.getUserByEmail(emails.staff);
    fbUids.push(staffFb.uid);
    const staffRow = await prisma.user.findUnique({ where: { id: staff.id } });
    check("2. Platform-created account: Firebase user + row created together, role is exactly the one selected (WAREHOUSE), linked by that Firebase UID, not ADMIN", !!staffRow && staffRow.role === "WAREHOUSE" && staffRow.status === "ACTIVE" && staffRow.firebaseUid === staffFb.uid);
    const r2 = seed([emails.staff, "Warehouse Person"]);
    const staffAfter = await prisma.user.findUnique({ where: { id: staff.id }, select: { role: true } });
    check("2b. seed:admin refuses to promote a platform-created account without --force; role stays WAREHOUSE", r2.code !== 0 && r2.out.includes("--force") && staffAfter?.role === "WAREHOUSE");

    // 3. A valid Firebase UID linked to an ACTIVE staff row is what the login route accepts.
    const route = readFileSync("src/app/api/auth/session/route.ts", "utf8");
    const current = readFileSync("src/server/auth/current-user.ts", "utf8");
    const lookup = await prisma.user.findUnique({ where: { firebaseUid: boot.uid }, select: { role: true, status: true } });
    check("3. Login resolves the platform account by Firebase UID (session route + getCurrentUser), requires ACTIVE, and the bootstrap admin passes as staff", route.includes("where: { firebaseUid: minted.decoded.uid }") && route.includes('if (user.status !== "ACTIVE")') && current.includes("where: { firebaseUid: claims.uid }") && !!lookup && lookup.status === "ACTIVE" && isStaffRole(lookup.role));

    // 4. A Firebase account with no platform row gets nothing — and email alone is never trusted.
    const stray = await auth.createUser({ email: emails.stray, password: `Stray!${RUN}9x` });
    fbUids.push(stray.uid);
    const strayRow = await prisma.user.findUnique({ where: { firebaseUid: stray.uid } });
    check("4. An unrelated Firebase account has no platform row → the route answers no_account (403); no auto-provisioning and no email-based matching at login", strayRow === null && route.includes('error: "no_account"') && route.includes("no auto-provisioning") && !/user\.findUnique\(\{\s*where:\s*\{\s*email/.test(route) && !/where:\s*\{\s*email/.test(current));

    // 5. The Shopify review account is linked by UID as an active ADMIN.
    const reviewFb = await auth.getUserByEmail("test-v3plmxvs@gmail.com").catch(() => null);
    const reviewRow = await prisma.user.findUnique({ where: { email: "test-v3plmxvs@gmail.com" }, select: { role: true, status: true, firebaseUid: true } });
    check("5. Shopify review account: Firebase user exists and its platform row is ADMIN / ACTIVE with the SAME Firebase UID (linked by UID via seed:admin)", !!reviewFb && !!reviewRow && reviewRow.role === "ADMIN" && reviewRow.status === "ACTIVE" && reviewRow.firebaseUid === reviewFb.uid);
  } finally {
    const rows = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: rows.map((r) => r.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    for (const uid of fbUids) await auth.deleteUser(uid).catch(() => undefined);
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
