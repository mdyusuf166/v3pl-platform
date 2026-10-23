"use server";

import { revalidatePath } from "next/cache";
import { affiliateFormSchema, assignOwnersSchema, assignVariantSchema, markPaidSchema, type AffiliateFormInput, type AssignVariantInput, type MarkPaidInput } from "@/lib/validation/affiliates";
import { manualOrderFormSchema, type ManualOrderFormInput } from "@/lib/validation/orders";
import { requireAffiliate, requireRole } from "@/server/auth/guards";
import { prisma } from "@/lib/prisma";
import { AffiliateServiceError, assignVariantBySku, createAffiliate, createAffiliateOrder, markCommissionsPaid, setAssignedOwners, unassignVariant, updateAffiliate } from "@/server/services/affiliates";
import { CustomerServiceError, resolveOrderCustomer } from "@/server/services/customers";
import { InventoryError } from "@/server/services/inventory";
import { OrderServiceError } from "@/server/services/orders";
import type { OrderCreated } from "@/server/actions/orders";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/server/actions/action-result";

function handleError(err: unknown): ActionResult<never> {
  if (err instanceof AffiliateServiceError) return err.field ? fail(err.message, { [err.field]: err.message }) : fail(err.message);
  if (err instanceof CustomerServiceError) return err.field ? fail(err.message, { [err.field]: err.message }) : fail(err.message);
  if (err instanceof OrderServiceError || err instanceof InventoryError) return fail(err.message);
  console.error("[affiliates action]", err);
  return fail("Something went wrong. Please try again.");
}

const BASE = "/admin/affiliates";

// --- Admin -------------------------------------------------------------------------------

export async function createAffiliateAction(input: AffiliateFormInput): Promise<ActionResult<{ id: string }>> {
  const actor = await requireRole("ADMIN");
  const parsed = affiliateFormSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const a = await createAffiliate(parsed.data, actor.id);
    revalidatePath(BASE);
    return ok({ id: a.id });
  } catch (err) {
    return handleError(err);
  }
}

export async function updateAffiliateAction(id: string, input: AffiliateFormInput): Promise<ActionResult<{ id: string }>> {
  const actor = await requireRole("ADMIN");
  const parsed = affiliateFormSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    await updateAffiliate(id, parsed.data, actor.id);
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${id}`);
    return ok({ id });
  } catch (err) {
    return handleError(err);
  }
}

export async function setAffiliateOwnersAction(id: string, input: { ownerIds: string[] }): Promise<ActionResult<undefined>> {
  const actor = await requireRole("ADMIN");
  const parsed = assignOwnersSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid selection.");
  try {
    await setAssignedOwners(id, parsed.data.ownerIds, actor.id);
    revalidatePath(`${BASE}/${id}`);
    return ok(undefined);
  } catch (err) {
    return handleError(err);
  }
}

export async function assignVariantAction(id: string, input: AssignVariantInput): Promise<ActionResult<undefined>> {
  const actor = await requireRole("ADMIN");
  const parsed = assignVariantSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    await assignVariantBySku(id, parsed.data, actor.id);
    revalidatePath(`${BASE}/${id}`);
    return ok(undefined);
  } catch (err) {
    return handleError(err);
  }
}

export async function unassignVariantAction(id: string, variantId: string): Promise<ActionResult<undefined>> {
  const actor = await requireRole("ADMIN");
  try {
    await unassignVariant(id, variantId, actor.id);
    revalidatePath(`${BASE}/${id}`);
    return ok(undefined);
  } catch (err) {
    return handleError(err);
  }
}

export async function markCommissionsPaidAction(id: string, input: MarkPaidInput): Promise<ActionResult<{ count: number; total: number }>> {
  const actor = await requireRole("ADMIN");
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const res = await markCommissionsPaid(id, parsed.data.commissionIds, { reference: parsed.data.reference ?? null, notes: parsed.data.notes ?? null }, actor.id);
    revalidatePath(`${BASE}/${id}`);
    return ok(res);
  } catch (err) {
    return handleError(err);
  }
}

// --- Affiliate portal ----------------------------------------------------------------------

/**
 * Affiliate sale (D-070). The affiliate id comes from the session only. Directory customers are never
 * picked (an affiliate has no owner scope); a saved customer becomes a company customer tagged with the affiliate.
 */
export async function createAffiliateOrderAction(input: ManualOrderFormInput): Promise<ActionResult<OrderCreated>> {
  const user = await requireAffiliate();
  const parsed = manualOrderFormSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const { lines, warehouseId, shippingMethod, notes, saveCustomer, ...shipTo } = parsed.data;
    const customer = await resolveOrderCustomer({ ownerId: undefined }, { customerId: null, saveCustomer, shipTo, ownerIdForNew: null, source: "AFFILIATE" }, user.id);
    if (customer.created && customer.customerId) await prisma.customer.update({ where: { id: customer.customerId }, data: { affiliateId: user.affiliateId } });
    const res = await createAffiliateOrder(user.affiliateId, { ...shipTo, customerId: customer.customerId, warehouseId, shippingMethod, notes, lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) }, user.id);
    revalidatePath("/portal/affiliate");
    revalidatePath("/portal/affiliate/orders");
    revalidatePath("/admin/orders");
    revalidatePath("/admin/inventory");
    return ok({ id: res.orderId, orderNumber: res.orderNumber, short: res.reservation.short.length, customer: customer.customerId ? { id: customer.customerId, name: customer.customerName, created: customer.created, reused: customer.reused } : null });
  } catch (err) {
    return handleError(err);
  }
}
