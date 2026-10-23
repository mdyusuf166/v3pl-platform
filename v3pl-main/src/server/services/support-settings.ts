// No `server-only` import: shared with the targeted test script. Never import from client components.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SUPPORT_SETTINGS, supportSettingsSchema, type SupportSettings } from "@/lib/validation/support";
import { recordAudit } from "@/server/services/audit";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** PlatformSetting key holding the support destination (SUP-01). */
export const SUPPORT_SETTING_KEY = "support";

/** Current support settings; defaults (disabled) when never saved or unreadable. Never throws. */
export async function getSupportSettings(db: DbClient = prisma): Promise<SupportSettings> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: SUPPORT_SETTING_KEY } });
    const parsed = supportSettingsSchema.safeParse(row?.value ?? DEFAULT_SUPPORT_SETTINGS);
    return parsed.success ? parsed.data : DEFAULT_SUPPORT_SETTINGS;
  } catch {
    return DEFAULT_SUPPORT_SETTINGS;
  }
}

/** Validates and stores the settings (only the four fields) and records the change in the audit log. */
export async function saveSupportSettings(values: SupportSettings, actorId: string, db: DbClient = prisma): Promise<SupportSettings> {
  const data = supportSettingsSchema.parse(values);
  const before = await getSupportSettings(db);
  await db.platformSetting.upsert({ where: { key: SUPPORT_SETTING_KEY }, create: { key: SUPPORT_SETTING_KEY, value: data, updatedById: actorId }, update: { value: data, updatedById: actorId } });
  await recordAudit({ userId: actorId, action: "settings.support_updated", entityType: "PlatformSetting", entityId: SUPPORT_SETTING_KEY, oldValues: before, newValues: data }, db);
  return data;
}
