"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { firebaseAdminAuth } from "@/lib/firebase/admin";
import { requireRole } from "@/server/auth/guards";
import { fail, ok, type ActionResult } from "@/server/actions/action-result";
import { PLATFORM_RESET_PHRASE, PlatformResetError, hardResetPlatform, totalRemoved, type ResetCounts } from "@/server/services/platform-reset";

/** A re-authentication token older than this is refused (same window the login route uses). */
const MAX_REAUTH_AGE_SECONDS = 5 * 60;

const schema = z.object({
  /** Fresh Firebase ID token obtained by signing the admin in again in the browser (password never reaches V3PL). */
  idToken: z.string().min(1),
  confirmation: z.string(),
});

/**
 * Settings → Danger Zone → Hard Reset Platform (D-076). ADMIN only. The browser's "confirmed" state is never
 * trusted: the server re-checks the role, verifies a fresh Firebase ID token for the SAME account as the session
 * (auth_time within 5 minutes) and requires the exact phrase, then runs the whole reset in one transaction.
 */
export async function hardResetPlatformAction(input: { idToken: string; confirmation: string }): Promise<ActionResult<{ removed: number; counts: ResetCounts }>> {
  const admin = await requireRole("ADMIN");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  if (parsed.data.confirmation.trim() !== PLATFORM_RESET_PHRASE) {
    return fail(`Type exactly "${PLATFORM_RESET_PHRASE}" to continue.`, { confirmation: "Does not match" });
  }

  let uid: string;
  let authTime: number;
  try {
    const decoded = await firebaseAdminAuth().verifyIdToken(parsed.data.idToken, true);
    uid = decoded.uid;
    authTime = decoded.auth_time;
  } catch {
    return fail("Re-authentication failed. Sign in again with your admin password.", { password: "Could not verify" });
  }
  if (uid !== admin.firebaseUid) return fail("Re-authentication must use the currently signed-in admin account.", { password: "Wrong account" });
  if (Math.floor(Date.now() / 1000) - authTime > MAX_REAUTH_AGE_SECONDS) return fail("Re-authentication expired. Enter your password again.", { password: "Expired" });

  try {
    const counts = await prisma.$transaction((tx) => hardResetPlatform(tx, admin.id), { timeout: 120_000, maxWait: 10_000 });
    revalidatePath("/", "layout");
    return ok({ removed: totalRemoved(counts), counts });
  } catch (err) {
    if (err instanceof PlatformResetError) return fail(err.message);
    console.error("[platform reset]", err);
    return fail("The reset could not be completed. Nothing was changed.");
  }
}
