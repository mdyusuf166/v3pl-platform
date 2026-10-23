"use server";

import { z } from "zod";
import { requireRole } from "@/server/auth/guards";
import { EmailServiceError, isEmailConfigured, partnerRecipient, sendPartnerEmail, type PartnerKind } from "@/server/services/email";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/server/actions/action-result";

const schema = z.object({
  subject: z.string().trim().min(2, "Subject is required").max(150, "Subject must be 150 characters or fewer"),
  message: z.string().trim().min(2, "Message is required").max(5000, "Message must be 5000 characters or fewer"),
});
export type PartnerEmailInput = z.input<typeof schema>;

/** ADMIN only (D-073). The recipient is the account's own e-mail, resolved server-side — the browser never supplies it. */
export async function sendPartnerEmailAction(kind: PartnerKind, id: string, input: PartnerEmailInput): Promise<ActionResult<{ to: string }>> {
  const actor = await requireRole("ADMIN");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  if (!isEmailConfigured()) return fail("E-mail is not configured on this server yet (EMAILJS_* environment variables).");
  try {
    return ok(await sendPartnerEmail(kind, id, parsed.data, actor.id));
  } catch (err) {
    if (err instanceof EmailServiceError) return fail(err.message);
    console.error("[email action]", err);
    return fail("Something went wrong. Please try again.");
  }
}

/** ADMIN only: the resolved recipient for the composer's read-only "To" field. */
export async function partnerRecipientAction(kind: PartnerKind, id: string): Promise<ActionResult<{ name: string; email: string | null; configured: boolean }>> {
  await requireRole("ADMIN");
  try {
    const r = await partnerRecipient(kind, id);
    return ok({ ...r, configured: isEmailConfigured() });
  } catch (err) {
    if (err instanceof EmailServiceError) return fail(err.message);
    return fail("Something went wrong. Please try again.");
  }
}
