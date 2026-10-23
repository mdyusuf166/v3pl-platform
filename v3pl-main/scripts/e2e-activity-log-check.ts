/**
 * Settings → Activity Log (read-only audit view). Service-level; no HTTP server needed.
 * Test rows are written inside a transaction that is always rolled back, so the live audit log is untouched.
 *
 * Usage: npm run e2e:activity-log -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const RUN = `al${Date.now().toString(36)}`.toUpperCase();
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
class Rollback extends Error {}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const audit = await import("../src/server/services/audit");
  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });

  // --- Access ---------------------------------------------------------------------------------------------
  const page = readFileSync("src/app/admin/(dashboard)/settings/activity-log/page.tsx", "utf8");
  const settings = readFileSync("src/app/admin/(dashboard)/settings/page.tsx", "utf8");
  const guards = readFileSync("src/server/auth/guards.ts", "utf8");
  check("1. ADMIN can access: the page is guarded by requireRole(\"ADMIN\") and Settings links to /admin/settings/activity-log", page.includes('await requireRole("ADMIN")') && settings.includes('href="/admin/settings/activity-log"') && settings.includes("Activity Log"));
  check("2. WAREHOUSE / SALES cannot access: requireRole redirects any role not listed and the page lists only ADMIN", /if \(!roles\.includes\(user\.role\)\) redirect\("\/admin\?forbidden=1"\)/.test(guards) && !/requireRole\("ADMIN",\s*"/.test(page));

  // --- Data (rolled back) ---------------------------------------------------------------------------------
  const liveTotal = await prisma.auditLog.count();
  const liveAuditBefore = liveTotal;
  const captured: { first: Awaited<ReturnType<typeof audit.listAuditLog>> | null; filtered: Awaited<ReturnType<typeof audit.listAuditLog>> | null; byType: Awaited<ReturnType<typeof audit.listAuditLog>> | null; types: string[] } = { first: null, filtered: null, byType: null, types: [] };
  try {
    await prisma.$transaction(async (tx) => {
      await audit.recordAudit({ userId: admin.id, action: `activitytest.${RUN.toLowerCase()}_first`, entityType: `ActivityTest${RUN}`, entityId: `${RUN}-1`, oldValues: { status: "DRAFT" }, newValues: { status: "ACTIVE" } }, tx);
      await audit.recordAudit({ userId: admin.id, action: `activitytest.${RUN.toLowerCase()}_second`, entityType: `ActivityTest${RUN}`, entityId: `${RUN}-2`, newValues: { encAccessToken: `TOK-${RUN}`, password: `PW-${RUN}`, nested: { apiKey: `KEY-${RUN}`, keep: "visible" }, status: "ACTIVE" }, metadata: { shopifySecret: `SEC-${RUN}`, note: "fine" } }, tx);
      captured.first = await audit.listAuditLog({}, tx);
      captured.filtered = await audit.listAuditLog({ q: `${RUN.toLowerCase()}_first` }, tx);
      captured.byType = await audit.listAuditLog({ entityType: `ActivityTest${RUN}` }, tx);
      captured.types = await audit.auditEntityTypes(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  const { first, filtered, byType } = captured;
  const top = first?.items[0];
  const second = first?.items[1];
  const sorted = !!first && first.items.every((r, i) => i === 0 || first.items[i - 1].createdAt >= r.createdAt);
  check("3. Existing audit records are displayed newest first with the acting user, action, area and details", !!first && first.total === liveTotal + 2 && sorted && !!top && !!second && top.action.endsWith("_second") && second.action.endsWith("_first") && top.user?.email === admin.email && top.entityType === `ActivityTest${RUN}` && JSON.stringify(second.oldValues) === '{"status":"DRAFT"}', `total=${first?.total}`);
  check("3b. Search by action and filter by area narrow the list; the area appears in the filter options", !!filtered && filtered.total === 1 && filtered.items[0].entityId === `${RUN}-1` && !!byType && byType.total === 2 && captured.types.includes(`ActivityTest${RUN}`));

  // --- Append-only ----------------------------------------------------------------------------------------
  const auditSrc = readFileSync("src/server/services/audit.ts", "utf8");
  const table = readFileSync("src/components/settings/activity-log-table.tsx", "utf8");
  const mutating = /auditLog\.(update|updateMany|delete|deleteMany|upsert|create)/;
  const exported = [...auditSrc.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]).sort();
  check("4. Audit records stay append-only / read-only: the service exposes no update or delete, the page and table issue no writes and use no server actions", !/auditLog\.(update|updateMany|delete|deleteMany|upsert)/.test(auditSrc) && !mutating.test(page) && !mutating.test(table) && !page.includes("server/actions") && !table.includes("use client") && exported.join(",") === "auditEntityTypes,listAuditLog,recordAudit,redactAuditValues", exported.join(","));
  const liveAuditAfter = await prisma.auditLog.count();
  check("4b. Rolled back: the live audit log is unchanged after the checks", liveAuditAfter === liveAuditBefore, `rows=${liveAuditAfter}`);

  // --- Redaction ------------------------------------------------------------------------------------------
  const dump = JSON.stringify([top?.newValues, top?.metadata]);
  const direct = audit.redactAuditValues({ encAccessToken: "a", refreshToken: "b", clientSecret: "c", password: "d", api_key: "e", list: [{ privateKey: "f" }], status: "ok" }) as Record<string, unknown>;
  check("5. Sensitive credential values are not exposed: token / password / secret / key fields are shown as ••• at every depth while ordinary fields stay visible", !dump.includes(`TOK-${RUN}`) && !dump.includes(`PW-${RUN}`) && !dump.includes(`KEY-${RUN}`) && !dump.includes(`SEC-${RUN}`) && dump.includes('"status":"ACTIVE"') && dump.includes('"keep":"visible"') && dump.includes('"note":"fine"') && Object.entries(direct).filter(([k]) => k !== "list" && k !== "status").every(([, v]) => v === "•••") && (direct.list as { privateKey: string }[])[0].privateKey === "•••" && direct.status === "ok");

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
