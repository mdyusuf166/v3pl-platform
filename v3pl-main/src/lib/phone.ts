/**
 * Phone normalisation for outbound integrations (D-074). Shopify validates phones as E.164; a locally typed
 * Bangladeshi mobile ("017XXXXXXXX") or a number with spaces / dashes fails there and blocks the whole order.
 * V3PL keeps the customer's original phone untouched — this only shapes what is sent.
 *
 * Returns "+<country><number>" or null when the number cannot be made safely valid (then omit the field).
 * Accepted: an explicit international number (+ or 00 prefix, 8–15 digits); a Bangladesh mobile in local
 * form (01[3-9] + 8 digits) or with the 880 country code. Anything else is null — never guessed.
 */
export function toE164Phone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("+")) {
    const digits = s.slice(1);
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (!/^\d+$/.test(s)) return null;
  if (/^01[3-9]\d{8}$/.test(s)) return `+88${s}`; // Bangladesh mobile, local form
  if (/^8801[3-9]\d{8}$/.test(s)) return `+${s}`; // Bangladesh mobile with country code, no plus
  return null;
}
