"use server";

import { revalidatePath } from "next/cache";
import { contactSettingsSchema, PUBLIC_PAGE_SLUGS, publicPageSchema, type ContactSettings, type ContactSettingsInput, type PublicPageInput, type PublicPageSlug, type PublicPageValues } from "@/lib/validation/pages";
import { requireRole } from "@/server/auth/guards";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/server/actions/action-result";
import { saveContactSettings, savePublicPage } from "@/server/services/public-pages";

/** ADMIN only (PUB-01): publish the title + content of the public Privacy page. */
export async function savePublicPageAction(slug: PublicPageSlug, input: PublicPageInput): Promise<ActionResult<PublicPageValues>> {
  const actor = await requireRole("ADMIN");
  if (!PUBLIC_PAGE_SLUGS.includes(slug)) return fail("Unknown page.");
  const parsed = publicPageSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const saved = await savePublicPage(slug, parsed.data, actor.id);
    revalidatePath(`/${slug}`);
    revalidatePath("/admin/settings/pages");
    return ok(saved);
  } catch (err) {
    console.error("[public pages]", err);
    return fail("Could not save the page.");
  }
}

/** ADMIN only (PUB-01): the contact box shown at the foot of the public Privacy page. */
export async function saveContactSettingsAction(input: ContactSettingsInput): Promise<ActionResult<ContactSettings>> {
  const actor = await requireRole("ADMIN");
  const parsed = contactSettingsSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const saved = await saveContactSettings(parsed.data, actor.id);
    revalidatePath("/privacy");
    revalidatePath("/admin/settings/pages");
    return ok(saved);
  } catch (err) {
    console.error("[public pages contact]", err);
    return fail("Could not save the contact settings.");
  }
}
