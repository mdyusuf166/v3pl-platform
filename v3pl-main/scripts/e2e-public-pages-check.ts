/**
 * Public Privacy page + ADMIN-managed contact section (PUB-01). Static + service-level; writes happen inside an
 * always-rolled-back transaction so the live published text is untouched. Also asserts Learn More is gone.
 *
 * Usage: npm run e2e:public-pages -- vendor3pl@gmail.com
 */
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

loadEnv({ path: ".env.local" });
loadEnv();

const adminEmail = process.argv[2] && process.argv[2].includes("@") ? process.argv[2] : (process.argv[3] ?? "vendor3pl@gmail.com");
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
class Rollback extends Error {}
const read = (f: string) => readFileSync(f, "utf8");

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const pages = await import("../src/lib/validation/pages");
  const svc = await import("../src/server/services/public-pages");
  const admin = await prisma.user.findFirstOrThrow({ where: { email: adminEmail, role: "ADMIN" } });

  const proxy = read("src/proxy.ts");
  const component = read("src/components/public/public-page.tsx");
  const guardsRe = /requireStaff|requireRole|requirePortal|getCurrentUser|readSessionClaims/;
  const privacyRoute = read("src/app/privacy/page.tsx");
  const privacy = await svc.getPublicPage("privacy");
  const def = pages.DEFAULT_PUBLIC_PAGES.privacy.content;

  // 1. /privacy public
  const noInvented = !/@[a-z0-9-]+\.[a-z]{2,}/i.test(def) && !/\+?\d[\d\s-]{7,}\d/.test(def) && !/ISO ?\d|GDPR|SOC ?2|\bLtd\b|\bInc\b|\bLLC\b|certif|compliant|complian/i.test(def);
  check("1. /privacy is public (no session guard in route or component; proxy guards only /admin and /portal) and its default is plain-spoken with the expected sections and no invented contact, company, certification or compliance claims", existsSync("src/app/privacy/page.tsx") && !guardsRe.test(privacyRoute) && !guardsRe.test(component) && proxy.includes('matcher: ["/admin/:path*", "/portal/:path*"]') && privacy.title.length > 0 && ["What we hold", "How it is used", "Shopify stores", "Who can see it", "How it is protected", "How long we keep it", "Your choices", "Questions"].every((h) => def.includes(`## ${h}`)) && /by invitation/i.test(def) && noInvented);

  // 2. Learn More removed
  const srcHits = execSync("grep -rl 'learn-more\\|Learn More\\|learnMore' src || true", { encoding: "utf8" }).trim();
  const learnRows = await prisma.platformSetting.count({ where: { key: "page:learn-more" } });
  check("2. Learn More is gone: no /learn-more route, no reference anywhere in src, slug list is exactly [privacy], no page:learn-more setting row, public page and footer link only to Privacy", !existsSync("src/app/learn-more") && srcHits === "" && JSON.stringify(pages.PUBLIC_PAGE_SLUGS) === '["privacy"]' && learnRows === 0 && !component.includes("learn-more") && component.includes('href="/privacy"'), srcHits || "no hits");

  // 3. Login links
  const authPage = read("src/components/auth/auth-page.tsx");
  const shells = ["src/components/layout/admin-shell.tsx", "src/components/layout/portal-shell.tsx", "src/components/layout/sidebar-nav.tsx", "src/config/navigation.ts"].map(read).join("\n");
  const loginPages = ["src/app/admin/login/page.tsx", "src/app/user/login/page.tsx"].map(read);
  check("3. Both login screens show only a Privacy link (shared AuthPage); no Learn More; authenticated shells and navigation link to neither", authPage.includes('href="/privacy"') && !authPage.includes("Learn More") && !authPage.includes("learn-more") && loginPages.every((p) => p.includes("AuthPage")) && !shells.includes("/privacy") && !shells.includes("learn-more"));

  // 4 + 5. ADMIN edits (rolled back)
  const captured: { page?: { title: string; customised: boolean; audited: boolean }; contact?: { saved: boolean; audited: boolean } } = {};
  try {
    await prisma.$transaction(async (tx) => {
      await svc.savePublicPage("privacy", { title: "Test privacy", content: `## Heading\nBody line one\nline two\n\n- a\n- b` }, admin.id, tx);
      const after = await svc.getPublicPage("privacy", tx);
      captured.page = { title: after.title, customised: after.customised, audited: (await tx.auditLog.count({ where: { action: "settings.page_updated", entityId: svc.pageSettingKey("privacy"), userId: admin.id } })) === 1 };
      await svc.saveContactSettings({ enabled: true, heading: "Talk to us", message: "We reply within a day.", email: "team@example.com", phone: "01712345678", buttonLabel: "Get in touch" }, admin.id, tx);
      const c = await svc.getContactSettings(tx);
      captured.contact = { saved: c.enabled && c.heading === "Talk to us" && c.email === "team@example.com" && c.phone === "01712345678" && c.buttonLabel === "Get in touch", audited: (await tx.auditLog.count({ where: { action: "settings.contact_updated", entityId: svc.CONTACT_SETTING_KEY, userId: admin.id } })) === 1 };
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  check("4. ADMIN can edit the Privacy page: saved title/content read back as published (customised) and audited; rolled back so live text is unchanged", captured.page?.title === "Test privacy" && captured.page.customised && captured.page.audited && (await svc.getPublicPage("privacy")).title === privacy.title);
  check("5. ADMIN can edit the contact settings (enable, heading, message, e-mail, WhatsApp, button label) with an audit row", !!captured.contact && captured.contact.saved && captured.contact.audited);

  // 6. Non-admin
  const action = read("src/server/actions/public-pages.ts");
  const settingsPage = read("src/app/admin/(dashboard)/settings/pages/page.tsx");
  const writes = execSync("grep -rl 'savePublicPage\\|saveContactSettings' src || true", { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort();
  check("6. Non-admin cannot edit: both server actions call requireRole(\"ADMIN\"), the editor page is ADMIN-only, and the only callers of the save functions are the action module and the ADMIN forms", (action.match(/requireRole\("ADMIN"\)/g) ?? []).length === 2 && settingsPage.includes('requireRole("ADMIN")') && !component.includes("save") && writes.every((f) => /server\/actions\/public-pages|server\/services\/public-pages|components\/settings\//.test(f)), writes.join(","));

  // 7–9. Contact rendering rules
  const base = { heading: "Contact", message: "", email: "team@example.com", phone: "+8801712345678", buttonLabel: "" };
  const disabled = pages.contactActions({ ...base, enabled: false });
  check("7. Disabled contact section renders nothing (no actions; component renders the section only when actions exist)", disabled.length === 0 && component.includes("actions.length > 0 && (") && !component.includes("getSupportSettings"));
  const both = pages.contactActions({ ...base, enabled: true, buttonLabel: "Get in touch" });
  check("8. Configured contact renders correctly: e-mail → mailto button carrying the custom label, WhatsApp → wa.me/<digits> button; heading and message come from the settings", both.length === 2 && both[0].kind === "email" && both[0].href === "mailto:team@example.com" && both[0].label === "Get in touch" && both[1].kind === "whatsapp" && both[1].href === "https://wa.me/8801712345678" && component.includes("{contact.heading}") && component.includes("{contact.message}"));
  const emailOnly = pages.contactActions({ ...base, enabled: true, phone: "" });
  const badPhone = pages.contactSettingsSchema.safeParse({ ...base, enabled: true, phone: "12ab" });
  const neither = pages.contactSettingsSchema.safeParse({ ...base, enabled: true, email: "", phone: "" });
  const badEmail = pages.contactSettingsSchema.safeParse({ ...base, enabled: true, email: "nope" });
  const disabledEmpty = pages.contactSettingsSchema.safeParse({ ...base, enabled: false, email: "", phone: "" });
  check("9. Empty or invalid methods never produce a broken link: e-mail only → one button; invalid phone / e-mail rejected; enabled with neither method rejected; disabled with neither method is still saveable", emailOnly.length === 1 && emailOnly[0].kind === "email" && !badPhone.success && !badEmail.success && !neither.success && disabledEmpty.success);

  await prisma.$disconnect();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
