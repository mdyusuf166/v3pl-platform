import { prisma } from "@/lib/prisma";
import { formatDateTime, formatMoney } from "@/lib/format";
import { recordAudit } from "@/server/services/audit";

/**
 * Transactional e-mail through EmailJS (D-073). Server-side only, via the REST API with the private access
 * token — nothing about EmailJS reaches the browser. ONE generic template is used for every message; it must
 * expose the params `to_email`, `to_name`, `subject`, `message` (plain text). Configuration is env-only:
 *   EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY
 * Sending never throws into business flows: failures are logged and recorded, orders are never affected.
 */

export type EmailMessage = { to: string; toName: string | null; subject: string; message: string };
export type EmailResult = { ok: true } | { ok: false; error: string };
export type EmailTransport = (msg: EmailMessage) => Promise<EmailResult>;

/** Env values as pasted into dashboards sometimes carry quotes / whitespace; a template id with a stray quote is "not found". */
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const ENV = () => ({
  serviceId: clean(process.env.EMAILJS_SERVICE_ID),
  templateId: clean(process.env.EMAILJS_TEMPLATE_ID),
  publicKey: clean(process.env.EMAILJS_PUBLIC_KEY),
  privateKey: clean(process.env.EMAILJS_PRIVATE_KEY),
});

export function isEmailConfigured(): boolean {
  const e = ENV();
  return !!(e.serviceId && e.templateId && e.publicKey && e.privateKey);
}

const emailJsTransport: EmailTransport = async (msg) => {
  const e = ENV();
  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_id: e.serviceId, template_id: e.templateId, user_id: e.publicKey, accessToken: e.privateKey, template_params: { to_email: msg.to, to_name: msg.toName ?? msg.to, subject: msg.subject, message: msg.message } }),
    });
    if (res.ok) return { ok: true };
    const text = (await res.text()).slice(0, 200);
    // Ids only (never keys): lets an admin compare with the EmailJS dashboard when a template / service is "not found".
    return { ok: false, error: `EmailJS ${res.status}: ${text} (service ${e.serviceId || "?"}, template ${e.templateId || "?"})` };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 200) };
  }
};

let transport: EmailTransport = emailJsTransport;
/** Tests only: swap the transport so nothing leaves the machine. */
export function __setEmailTransportForTests(t: EmailTransport | null) {
  transport = t ?? emailJsTransport;
}

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Send one message. Never throws. */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  if (!VALID_EMAIL.test(msg.to)) return { ok: false, error: "Invalid recipient e-mail." };
  if (transport === emailJsTransport && !isEmailConfigured()) return { ok: false, error: "E-mail is not configured (EMAILJS_* environment variables)." };
  return transport(msg);
}

// ---------------------------------------------------------------------------
// Customer e-mails: order confirmation + delivered. Idempotent through an OrderEvent claim keyed by
// externalEventId (`email:confirmation:{orderId}` / `email:delivered:{orderId}`): the claim row is written
// before sending, so retries, refreshes and replayed status events find it and stop.
// ---------------------------------------------------------------------------

/** Sources whose customers are notified by V3PL. Shopify notifies its own customers; CSV imports are historical. */
const NOTIFY_SOURCES = new Set(["MANUAL", "THREEPL_PORTAL", "AFFILIATE"]);

type OrderForEmail = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;
async function loadOrder(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, source: true, status: true, fulfillmentStatus: true, placedAt: true, currency: true, total: true, customerName: true, customerEmail: true, shipName: true, shipAddress1: true, shipAddress2: true, shipCity: true, shipProvince: true, shipZip: true, shipCountry: true, shippingMethod: true, items: { select: { sku: true, title: true, variantTitle: true, quantity: true, cancelledQty: true, unitPrice: true } } },
  });
}

function shipToBlock(o: OrderForEmail) {
  const lines = [o.shipName, o.shipAddress1, o.shipAddress2, [o.shipCity, o.shipProvince, o.shipZip].filter(Boolean).join(", "), o.shipCountry].filter(Boolean);
  return lines.length ? `Shipping to:\n${lines.join("\n")}${o.shippingMethod ? `\nMethod: ${o.shippingMethod}` : ""}` : "";
}

function itemsBlock(o: OrderForEmail) {
  return o.items
    .filter((i) => i.quantity - i.cancelledQty > 0)
    .map((i) => `- ${i.quantity - i.cancelledQty} × ${[i.title ?? i.sku, i.variantTitle].filter(Boolean).join(" / ")} (${i.sku})${i.unitPrice !== null ? ` — ${formatMoney(Number(i.unitPrice) * (i.quantity - i.cancelledQty), o.currency)}` : ""}`)
    .join("\n");
}

/**
 * Claim-then-send. Returns what happened so callers / tests can assert; never throws.
 * `kind` = "confirmation" | "delivered".
 */
async function sendCustomerEmail(orderId: string, kind: "confirmation" | "delivered", build: (o: OrderForEmail) => { subject: string; message: string }): Promise<"sent" | "duplicate" | "skipped" | "failed"> {
  const key = `email:${kind}:${orderId}`;
  try {
    const o = await loadOrder(orderId);
    if (!o) return "skipped";
    // Claim inside a transaction so two concurrent retries cannot both send.
    const claimed = await prisma.$transaction(async (tx) => {
      const seen = await tx.orderEvent.count({ where: { orderId, externalEventId: key } });
      if (seen > 0) return false;
      const to = o.customerEmail?.trim() ?? "";
      if (!NOTIFY_SOURCES.has(o.source) || !VALID_EMAIL.test(to)) {
        await tx.orderEvent.create({ data: { orderId, type: "email_skipped", message: `${kind === "confirmation" ? "Order confirmation" : "Delivered"} e-mail not sent: ${!NOTIFY_SOURCES.has(o.source) ? `${o.source.toLowerCase()} orders are notified by their channel` : "no valid customer e-mail on the order"}`, externalEventId: key, data: { kind, reason: !NOTIFY_SOURCES.has(o.source) ? "source" : "no_email" } } });
        return "skip" as const;
      }
      await tx.orderEvent.create({ data: { orderId, type: "email_sent", message: `${kind === "confirmation" ? "Order confirmation" : "Delivered"} e-mail sent to ${to}`, externalEventId: key, data: { kind, to } } });
      return true;
    });
    if (claimed === false) return "duplicate";
    if (claimed === "skip") return "skipped";
    const { subject, message } = build(o);
    const res = await sendEmail({ to: o.customerEmail!.trim(), toName: o.customerName ?? o.shipName ?? null, subject, message });
    if (!res.ok) {
      // Keep the claim (no retry storm) but record the failure so it is visible on the order history.
      await prisma.orderEvent.updateMany({ where: { orderId, externalEventId: key }, data: { type: "email_failed", message: `${kind === "confirmation" ? "Order confirmation" : "Delivered"} e-mail failed: ${res.error}` } });
      console.error(`[email] ${kind} for order ${o.orderNumber} failed: ${res.error}`);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error(`[email] ${kind} for order ${orderId} threw (ignored):`, err);
    return "failed";
  }
}

export async function sendOrderConfirmation(orderId: string) {
  return sendCustomerEmail(orderId, "confirmation", (o) => ({
    subject: `Order ${o.orderNumber} confirmed`,
    message: [
      `Hello ${o.customerName ?? o.shipName ?? "there"},`,
      "",
      `Thank you — we have received your order ${o.orderNumber} placed on ${formatDateTime(o.placedAt)}.`,
      "",
      "Items:",
      itemsBlock(o),
      o.total !== null ? `\nTotal: ${formatMoney(o.total, o.currency)}` : "",
      "",
      shipToBlock(o),
      "",
      "We will let you know when it has been delivered.",
    ]
      .filter((l) => l !== null)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n"),
  }));
}

export async function sendOrderDelivered(orderId: string) {
  return sendCustomerEmail(orderId, "delivered", (o) => ({
    subject: `Order ${o.orderNumber} delivered`,
    message: [`Hello ${o.customerName ?? o.shipName ?? "there"},`, "", `Your order ${o.orderNumber} has been delivered.`, "", "Items:", itemsBlock(o), "", shipToBlock(o), "", "Thank you for your order."].join("\n").replace(/\n{3,}/g, "\n\n"),
  }));
}

// ---------------------------------------------------------------------------
// Admin → partner (vendor / 3PL client / affiliate). Recipient is resolved from the record, never from the browser.
// ---------------------------------------------------------------------------

export class EmailServiceError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "NO_EMAIL" | "SEND_FAILED",
    message: string,
  ) {
    super(message);
  }
}

export type PartnerKind = "OWNER" | "AFFILIATE";

export async function partnerRecipient(kind: PartnerKind, id: string): Promise<{ name: string; email: string | null }> {
  if (kind === "OWNER") {
    const o = await prisma.owner.findUnique({ where: { id }, select: { businessName: true, email: true } });
    if (!o) throw new EmailServiceError("NOT_FOUND", "Account not found.");
    return { name: o.businessName, email: o.email };
  }
  const a = await prisma.affiliate.findUnique({ where: { id }, select: { name: true, email: true } });
  if (!a) throw new EmailServiceError("NOT_FOUND", "Account not found.");
  return { name: a.name, email: a.email };
}

export async function sendPartnerEmail(kind: PartnerKind, id: string, input: { subject: string; message: string }, actorId: string) {
  const r = await partnerRecipient(kind, id);
  if (!r.email || !VALID_EMAIL.test(r.email)) throw new EmailServiceError("NO_EMAIL", `${r.name} has no e-mail address on record. Add one on the account first.`);
  const res = await sendEmail({ to: r.email, toName: r.name, subject: input.subject, message: input.message });
  if (!res.ok) throw new EmailServiceError("SEND_FAILED", res.error);
  await recordAudit({ userId: actorId, action: "email.sent", entityType: kind === "OWNER" ? "Owner" : "Affiliate", entityId: id, newValues: { to: r.email, subject: input.subject } });
  return { to: r.email };
}
