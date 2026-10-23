import { z } from "zod";
import { toE164Phone } from "@/lib/phone";

/**
 * Public Privacy page (PUB-01): plain-text content edited by ADMIN in Settings → Privacy page, stored in
 * PlatformSetting (key `page:privacy`), rendered with a tiny line-based formatter (no HTML is ever accepted or
 * rendered): `## Heading`, `- bullet`, blank line = new paragraph, single newline = line break.
 * The contact box at the foot of the page has its own ADMIN-managed settings (key `page:contact`).
 */

export const PUBLIC_PAGE_SLUGS = ["privacy"] as const;
export type PublicPageSlug = (typeof PUBLIC_PAGE_SLUGS)[number];
export const PUBLIC_PAGE_LABELS: Record<PublicPageSlug, string> = { privacy: "Privacy" };

export const publicPageSchema = z.object({
  title: z.string().trim().min(2, "Title is required").max(120, "Title must be 120 characters or fewer"),
  content: z.string().trim().min(10, "Content is required").max(20_000, "Content must be 20 000 characters or fewer"),
});
export type PublicPageInput = z.input<typeof publicPageSchema>;
export type PublicPageValues = z.output<typeof publicPageSchema>;

export type PageBlock = { kind: "heading"; text: string } | { kind: "list"; items: string[] } | { kind: "paragraph"; lines: string[] };

/** Splits stored plain text into render blocks. Pure; safe for any input (text is rendered as text, never HTML). */
export function pageBlocks(content: string): PageBlock[] {
  const blocks: PageBlock[] = [];
  for (const raw of content.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = raw.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    if (lines.length === 1 && /^##\s+/.test(lines[0])) blocks.push({ kind: "heading", text: lines[0].replace(/^##\s+/, "") });
    else if (lines.every((l) => /^-\s+/.test(l))) blocks.push({ kind: "list", items: lines.map((l) => l.replace(/^-\s+/, "")) });
    else if (/^##\s+/.test(lines[0])) {
      blocks.push({ kind: "heading", text: lines[0].replace(/^##\s+/, "") });
      const rest = lines.slice(1);
      if (rest.every((l) => /^-\s+/.test(l))) blocks.push({ kind: "list", items: rest.map((l) => l.replace(/^-\s+/, "")) });
      else blocks.push({ kind: "paragraph", lines: rest });
    } else blocks.push({ kind: "paragraph", lines });
  }
  return blocks;
}

export const DEFAULT_PUBLIC_PAGES: Record<PublicPageSlug, PublicPageValues> = {
  privacy: {
    title: "Privacy",
    content: `V3PL is a private platform that helps vendors, 3PL clients and warehouse teams run stock, orders and shipments in one place. Access is by invitation. This page describes, in plain terms, what information the platform holds and how it is used.

## What we hold
- Account details for the people who are given access: name, e-mail address, role and when they last signed in.
- The business records that users enter or import: products, stock levels, warehouses and bin locations, orders, customer names and delivery addresses, shipments, returns, charges and settlement entries.
- An activity log of changes made in the platform, kept so that stock and order history can be explained.

## How it is used
We use this information to run the platform and nothing else: to sign people in, to show each business only its own data, to process orders and stock movements, to produce reports and to keep an accurate record of who changed what. We do not sell it and we do not use it for advertising.

## Shopify stores
If a business connects a Shopify store, V3PL reads and writes only what that connection needs: products and variants, inventory levels, orders with the customer details attached to them, and fulfilment updates. Store access tokens are stored encrypted and used only for the sync the business has switched on. Disconnecting a store stops the sync; V3PL does not delete anything inside Shopify.

## Who can see it
Each vendor, 3PL client and salesman sees only their own records. The warehouse and admin team see what they need to do their work. Outside the platform, data goes only to the providers we rely on to run it, such as hosting, database, sign-in and e-mail delivery, and only as far as those services require.

## How it is protected
Sign-in is handled by a dedicated authentication service, so V3PL never stores passwords. Sessions use secure cookies, every request is checked on the server against the user's role and business, and integration credentials are encrypted and never shown on screen.

## How long we keep it
Business records stay for as long as the business uses V3PL, because stock, order and financial history need to stay complete. Accounts can be switched off at any time. When a business stops using the platform, its data can be removed on request.

## Your choices
You can ask us to show, correct or remove the information we hold about you or your business. We will do so unless it is needed to keep an accurate operational or financial record.

## Questions
If anything here is unclear, get in touch using the contact details below or ask your V3PL administrator.`,
  },
};

// ---------------------------------------------------------------------------
// Contact box on the public Privacy page (independent of the in-app support button)
// ---------------------------------------------------------------------------

export const contactSettingsSchema = z
  .object({
    enabled: z.boolean(),
    heading: z.string().trim().min(2, "Heading is required").max(80, "Heading must be 80 characters or fewer"),
    message: z.string().trim().max(600, "Message must be 600 characters or fewer").default(""),
    email: z.string().trim().max(200).default(""),
    phone: z.string().trim().max(40).default(""),
    buttonLabel: z.string().trim().max(40, "Button label must be 40 characters or fewer").default(""),
  })
  .superRefine((v, ctx) => {
    if (v.email && !z.email().safeParse(v.email).success) ctx.addIssue({ code: "custom", path: ["email"], message: "Enter a valid e-mail address." });
    if (v.phone && !toE164Phone(v.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter an international number (e.g. +8801XXXXXXXXX or 017XXXXXXXX)." });
    if (v.enabled && !v.email && !v.phone) ctx.addIssue({ code: "custom", path: ["email"], message: "Add an e-mail address or a WhatsApp number, or disable the contact section." });
  });
export type ContactSettingsInput = z.input<typeof contactSettingsSchema>;
export type ContactSettings = z.output<typeof contactSettingsSchema>;

export const DEFAULT_CONTACT_SETTINGS: ContactSettings = { enabled: false, heading: "Contact the V3PL team", message: "Questions about this page or about getting an account? We are happy to help.", email: "", phone: "", buttonLabel: "" };

export type ContactAction = { kind: "email" | "whatsapp"; href: string; label: string };

/** Only configured, valid methods become buttons — never an empty or broken link. Disabled → none. */
export function contactActions(c: ContactSettings | null | undefined): ContactAction[] {
  if (!c || !c.enabled) return [];
  const out: ContactAction[] = [];
  if (c.email && z.email().safeParse(c.email).success) out.push({ kind: "email", href: `mailto:${c.email}`, label: c.buttonLabel || `E-mail ${c.email}` });
  const e164 = toE164Phone(c.phone);
  if (e164) out.push({ kind: "whatsapp", href: `https://wa.me/${e164.slice(1)}`, label: c.buttonLabel && !out.length ? c.buttonLabel : `WhatsApp ${e164}` });
  return out;
}
