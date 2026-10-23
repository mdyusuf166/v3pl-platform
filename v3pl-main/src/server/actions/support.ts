"use server";

import { revalidatePath } from "next/cache";
import { supportSettingsSchema, type SupportSettingsInput, type SupportSettings } from "@/lib/validation/support";
import { requireRole } from "@/server/auth/guards";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/server/actions/action-result";
import { saveSupportSettings } from "@/server/services/support-settings";

/** ADMIN only (SUP-01). */
export async function saveSupportSettingsAction(input: SupportSettingsInput): Promise<ActionResult<SupportSettings>> {
  const actor = await requireRole("ADMIN");
  const parsed = supportSettingsSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const saved = await saveSupportSettings(parsed.data, actor.id);
    revalidatePath("/", "layout");
    return ok(saved);
  } catch (err) {
    console.error("[support settings]", err);
    return fail("Could not save the support settings.");
  }
}
