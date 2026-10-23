import { z } from "zod";
import { formatMoney } from "@/lib/format";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const COMMISSION_TYPES = ["PERCENTAGE_OF_SALE", "FIXED_PER_UNIT", "FIXED_PER_ORDER"] as const;
export type CommissionTypeValue = (typeof COMMISSION_TYPES)[number];
export const COMMISSION_TYPE_LABELS: Record<CommissionTypeValue, { label: string; hint: string; unit: string }> = {
  PERCENTAGE_OF_SALE: { label: "Percentage of sale", hint: "e.g. 10 → 10% of the line total", unit: "%" },
  FIXED_PER_UNIT: { label: "Fixed amount per unit", hint: "e.g. 3.00 → 3.00 × quantity", unit: "per unit" },
  FIXED_PER_ORDER: { label: "Fixed amount per order", hint: "e.g. 5.00 once per order", unit: "per order" },
};
/** Product-specific rules are per line, so a per-order amount makes no sense there. */
export const VARIANT_COMMISSION_TYPES = ["PERCENTAGE_OF_SALE", "FIXED_PER_UNIT"] as const;

export const COMMISSION_STATUS_LABELS = { PENDING: "Pending", EARNED: "Earned", CANCELLED: "Cancelled", PAID: "Paid" } as const;

/**
 * Human label for a commission rule, e.g. "10% of sale" / "3.00 per unit". Lives here (plain module) so server
 * components can call it — a helper exported from a "use client" file is only a client reference on the server.
 */
export function commissionRuleLabel(type: string | null, value: string | number | null, currency = "USD"): string | null {
  if (!type || value === null) return null;
  const n = Number(value);
  return type === "PERCENTAGE_OF_SALE" ? `${n}% of sale` : type === "FIXED_PER_UNIT" ? `${formatMoney(n, currency)} per unit` : `${formatMoney(n, currency)} per order`;
}

/** "" / null → no rule; otherwise a positive number (percent ≤ 100). */
const commissionValue = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === undefined || v === null || String(v).trim() === "" ? null : Number(String(v).trim())))
  .refine((v) => v === null || (Number.isFinite(v) && v > 0), "Enter a positive amount");

const commissionType = z
  .union([z.enum(COMMISSION_TYPES), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

function refineRule(data: { commissionType: CommissionTypeValue | null; commissionValue: number | null }, ctx: z.RefinementCtx) {
  if (data.commissionType && data.commissionValue === null) ctx.addIssue({ code: "custom", path: ["commissionValue"], message: "Enter the commission value" });
  if (!data.commissionType && data.commissionValue !== null) ctx.addIssue({ code: "custom", path: ["commissionType"], message: "Choose the commission type" });
  if (data.commissionType === "PERCENTAGE_OF_SALE" && data.commissionValue !== null && data.commissionValue > 100) ctx.addIssue({ code: "custom", path: ["commissionValue"], message: "A percentage cannot exceed 100" });
}

export const affiliateFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2, "Code is required (2–20 characters)")
      .max(20, "Code must be 20 characters or fewer")
      .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Use letters, numbers and hyphens only"),
    name: z.string().trim().min(2, "Name is required").max(120),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.email("Enter a valid email address").nullable())
      .nullable()
      .optional(),
    phone: optionalText(40),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    commissionType,
    commissionValue,
    notes: optionalText(2000),
  })
  .superRefine(refineRule);
export type AffiliateFormInput = z.input<typeof affiliateFormSchema>;
export type AffiliateFormValues = z.output<typeof affiliateFormSchema>;

/** Assign a variant by SKU with an optional product-specific rule (D-070). */
export const assignVariantSchema = z
  .object({
    sku: z.string().trim().toUpperCase().min(1, "Enter a SKU").max(64),
    commissionType: z
      .union([z.enum(VARIANT_COMMISSION_TYPES), z.literal(""), z.null()])
      .optional()
      .transform((v) => (v ? v : null)),
    commissionValue,
  })
  .superRefine(refineRule);
export type AssignVariantInput = z.input<typeof assignVariantSchema>;
export type AssignVariantValues = z.output<typeof assignVariantSchema>;

export const assignOwnersSchema = z.object({ ownerIds: z.array(z.string().trim().min(1)).max(200) });

export const markPaidSchema = z.object({
  commissionIds: z.array(z.string().trim().min(1)).min(1, "Choose at least one earned commission"),
  reference: optionalText(120),
  notes: optionalText(500),
});
export type MarkPaidInput = z.input<typeof markPaidSchema>;
