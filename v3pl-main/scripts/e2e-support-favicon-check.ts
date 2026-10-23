/**
 * Global support button + favicon (SUP-01). Service-level; no HTTP server needed.
 * Settings writes happen inside a transaction that is always rolled back, so the live configuration is untouched.
 *
 * Usage: npm run e2e:support -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";

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
  const sup = await import("../src/lib/validation/support");
  const svc = await import("../src/server/services/support-settings");
  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });

  // 1. ADMIN-only configuration
  const action = readFileSync("src/server/actions/support.ts", "utf8");
  const page = readFileSync("src/app/admin/(dashboard)/settings/support/page.tsx", "utf8");
  const settings = readFileSync("src/app/admin/(dashboard)/settings/page.tsx", "utf8");
  check("1. Support configuration is ADMIN-only: the save action and the Settings → Support page call requireRole(\"ADMIN\"); Settings links to the page", action.includes('requireRole("ADMIN")') && page.includes('requireRole("ADMIN")') && settings.includes('href="/admin/settings/support"'));

  // 2 + 3. Where the button renders
  const portals = ["src/app/portal/vendor/layout.tsx", "src/app/portal/3pl/layout.tsx", "src/app/portal/affiliate/layout.tsx"].map((f) => readFileSync(f, "utf8"));
  const adminLayout = readFileSync("src/app/admin/(dashboard)/layout.tsx", "utf8");
  check("2. Non-admin portals render the support button: vendor, 3PL and affiliate layouts, plus the staff shell for WAREHOUSE / SALES", portals.every((l) => l.includes("<SupportButton destination={support} />") && l.includes("getSupportSettings()")) && adminLayout.includes('{user.role !== "ADMIN" && <SupportButton destination={support} />}'));
  check("3. ADMIN dashboard does not render it: the staff layout resolves no destination for ADMIN and never mounts the button for that role", adminLayout.includes('user.role === "ADMIN" ? null : supportDestination(') && adminLayout.includes('user.role !== "ADMIN" && <SupportButton'));

  // 4–6. Destinations (pure) + persistence round-trip inside a rolled-back transaction
  const email = sup.supportDestination({ enabled: true, method: "EMAIL", email: "help@example.com", whatsapp: "" });
  check("4. EMAIL generates the mailto destination", email?.method === "EMAIL" && email.href.startsWith("mailto:help@example.com?subject="), email?.href);
  const wa = sup.supportDestination({ enabled: true, method: "WHATSAPP", email: "", whatsapp: "017 1234-5678" });
  const waIntl = sup.supportDestination({ enabled: true, method: "WHATSAPP", email: "", whatsapp: "+44 20 7946 0958" });
  check("5. WHATSAPP generates the wa.me destination (digits only, local Bangladeshi number normalised to 880…, international kept)", wa?.href.startsWith("https://wa.me/8801712345678?text=") === true && waIntl?.href.startsWith("https://wa.me/442079460958?text=") === true, wa?.href);
  const off = sup.supportDestination({ enabled: false, method: "EMAIL", email: "help@example.com", whatsapp: "" });
  const noEmail = sup.supportDestination({ enabled: true, method: "EMAIL", email: "", whatsapp: "+8801712345678" });
  const badWa = sup.supportDestination({ enabled: true, method: "WHATSAPP", email: "help@example.com", whatsapp: "12ab" });
  const badEmailSchema = sup.supportSettingsSchema.safeParse({ enabled: true, method: "EMAIL", email: "not-an-email", whatsapp: "" });
  const badWaSchema = sup.supportSettingsSchema.safeParse({ enabled: true, method: "WHATSAPP", email: "", whatsapp: "12345" });
  const disabledIncomplete = sup.supportSettingsSchema.safeParse({ enabled: false, method: "EMAIL", email: "", whatsapp: "" });
  const buttonSrc = readFileSync("src/components/layout/support-button.tsx", "utf8");
  check("6. Disabled / unconfigured support produces no action: destination is null (button renders nothing); invalid e-mail or number is rejected when enabled; a disabled, incomplete config is still saveable", off === null && noEmail === null && badWa === null && !badEmailSchema.success && !badWaSchema.success && disabledIncomplete.success && buttonSrc.includes("if (!destination) return null;"));

  let saved: Awaited<ReturnType<typeof svc.getSupportSettings>> | null = null;
  let audited = false;
  try {
    await prisma.$transaction(async (tx) => {
      await svc.saveSupportSettings({ enabled: true, method: "WHATSAPP", email: "", whatsapp: "01712345678" }, admin.id, tx);
      saved = await svc.getSupportSettings(tx);
      audited = (await tx.auditLog.count({ where: { action: "settings.support_updated", userId: admin.id, entityId: svc.SUPPORT_SETTING_KEY } })) >= 1;
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  const s = saved as Awaited<ReturnType<typeof svc.getSupportSettings>> | null;
  check("6b. Settings persist through the PlatformSetting row (only the four fields), are read back, and the change is audited; rolled back afterwards", !!s && s.enabled && s.method === "WHATSAPP" && s.whatsapp === "01712345678" && Object.keys(s).sort().join(",") === "email,enabled,method,whatsapp" && audited);

  // 7. Favicon assets
  const ico = existsSync("src/app/favicon.ico") ? readFileSync("src/app/favicon.ico") : null;
  const svg = existsSync("src/app/icon.svg") ? readFileSync("src/app/icon.svg", "utf8") : "";
  const apple = existsSync("src/app/apple-icon.png") ? readFileSync("src/app/apple-icon.png") : null;
  const icoValid = !!ico && ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) >= 1 && ico.subarray(ico.readUInt32LE(18), ico.readUInt32LE(18) + 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const pngValid = !!apple && apple.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  check("7. Favicon metadata/assets present under src/app (Next.js file-based icons): icon.svg (green recycle / sync mark), favicon.ico (valid ICO with PNG entries), apple-icon.png", svg.includes("<svg") && svg.includes("#16a34a") && icoValid && pngValid);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
