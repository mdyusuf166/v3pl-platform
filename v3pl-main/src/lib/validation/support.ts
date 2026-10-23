import { z } from "zod";
import { toE164Phone } from "@/lib/phone";

/**
 * Support destination (SUP-01): ADMIN-configured, shown as a floating button on every non-admin portal.
 * V3PL never sends the message itself — the button opens mailto: or WhatsApp in the user's own apps.
 */

export const SUPPORT_METHODS = ["EMAIL", "WHATSAPP"] as const;
export type SupportMethod = (typeof SUPPORT_METHODS)[number];
export const SUPPORT_METHOD_LABELS: Record<SupportMethod, string> = { EMAIL: "E-mail", WHATSAPP: "WhatsApp" };

export const supportSettingsSchema = z
  .object({
    enabled: z.boolean(),
    method: z.enum(SUPPORT_METHODS),
    email: z.string().trim().max(200).default(""),
    whatsapp: z.string().trim().max(40).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.method === "EMAIL" && v.enabled && !z.email().safeParse(v.email).success) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Enter a valid support e-mail address." });
    }
    if (v.method === "WHATSAPP" && v.enabled && !toE164Phone(v.whatsapp)) {
      ctx.addIssue({ code: "custom", path: ["whatsapp"], message: "Enter an international number (e.g. +8801XXXXXXXXX or 017XXXXXXXX)." });
    }
  });

export type SupportSettingsInput = z.input<typeof supportSettingsSchema>;
export type SupportSettings = z.output<typeof supportSettingsSchema>;

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = { enabled: false, method: "EMAIL", email: "", whatsapp: "" };

export type SupportDestination = { href: string; label: string; method: SupportMethod };

/**
 * The link the button opens, or null when support is disabled or the selected method is not configured —
 * callers hide the button rather than render a dead action.
 */
export function supportDestination(s: SupportSettings | null | undefined): SupportDestination | null {
  if (!s || !s.enabled) return null;
  if (s.method === "EMAIL") {
    if (!z.email().safeParse(s.email).success) return null;
    return { method: "EMAIL", label: "E-mail support", href: `mailto:${s.email}?subject=${encodeURIComponent("V3PL support request")}` };
  }
  const e164 = toE164Phone(s.whatsapp);
  if (!e164) return null;
  return { method: "WHATSAPP", label: "Chat on WhatsApp", href: `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent("Hello, I need help with V3PL.")}` };
}
