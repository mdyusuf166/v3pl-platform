// No `server-only` import: shared with the targeted test script. Never import from client components.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { contactSettingsSchema, DEFAULT_CONTACT_SETTINGS, DEFAULT_PUBLIC_PAGES, publicPageSchema, type ContactSettings, type PublicPageSlug, type PublicPageValues } from "@/lib/validation/pages";
import { recordAudit } from "@/server/services/audit";

type DbClient = PrismaClient | Prisma.TransactionClient;

export const pageSettingKey = (slug: PublicPageSlug) => `page:${slug}`;
export const CONTACT_SETTING_KEY = "page:contact";

/** Published content for a public page; the built-in default until an ADMIN saves one. Never throws. */
export async function getPublicPage(slug: PublicPageSlug, db: DbClient = prisma): Promise<PublicPageValues & { customised: boolean; updatedAt: Date | null }> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: pageSettingKey(slug) } });
    const parsed = row ? publicPageSchema.safeParse(row.value) : null;
    if (parsed?.success) return { ...parsed.data, customised: true, updatedAt: row!.updatedAt };
  } catch {
    // fall through to the default
  }
  return { ...DEFAULT_PUBLIC_PAGES[slug], customised: false, updatedAt: null };
}

/** Validates and publishes the page (title + plain-text content only) and records the change in the audit log. */
export async function savePublicPage(slug: PublicPageSlug, values: PublicPageValues, actorId: string, db: DbClient = prisma): Promise<PublicPageValues> {
  const data = publicPageSchema.parse(values);
  const before = await getPublicPage(slug, db);
  await db.platformSetting.upsert({ where: { key: pageSettingKey(slug) }, create: { key: pageSettingKey(slug), value: data, updatedById: actorId }, update: { value: data, updatedById: actorId } });
  await recordAudit({ userId: actorId, action: "settings.page_updated", entityType: "PlatformSetting", entityId: pageSettingKey(slug), oldValues: { title: before.title, contentLength: before.content.length }, newValues: { title: data.title, contentLength: data.content.length } }, db);
  return data;
}

/** Contact box settings for the public Privacy page; disabled default until an ADMIN configures it. Never throws. */
export async function getContactSettings(db: DbClient = prisma): Promise<ContactSettings> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: CONTACT_SETTING_KEY } });
    const parsed = contactSettingsSchema.safeParse(row?.value ?? DEFAULT_CONTACT_SETTINGS);
    return parsed.success ? parsed.data : DEFAULT_CONTACT_SETTINGS;
  } catch {
    return DEFAULT_CONTACT_SETTINGS;
  }
}

export async function saveContactSettings(values: ContactSettings, actorId: string, db: DbClient = prisma): Promise<ContactSettings> {
  const data = contactSettingsSchema.parse(values);
  const before = await getContactSettings(db);
  await db.platformSetting.upsert({ where: { key: CONTACT_SETTING_KEY }, create: { key: CONTACT_SETTING_KEY, value: data, updatedById: actorId }, update: { value: data, updatedById: actorId } });
  await recordAudit({ userId: actorId, action: "settings.contact_updated", entityType: "PlatformSetting", entityId: CONTACT_SETTING_KEY, oldValues: before, newValues: data }, db);
  return data;
}
