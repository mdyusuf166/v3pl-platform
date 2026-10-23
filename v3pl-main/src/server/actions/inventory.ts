"use server";

import { revalidatePath } from "next/cache";
import {
  adjustmentFormSchema,
  moveFormSchema,
  receivingFormSchema,
  transferCompleteSchema,
  transferFormSchema,
  type AdjustmentFormInput,
  type MoveFormInput,
  type ReceivingFormInput,
  type TransferCompleteInput,
  type TransferFormInput,
} from "@/lib/validation/inventory";
import { requireRole } from "@/server/auth/guards";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { recordEventCharges } from "@/server/services/finance";
import { InventoryError, adjustStock, moveStock } from "@/server/services/inventory";
import { ReceivingServiceError, createReceiving } from "@/server/services/receiving";
import { TransferServiceError, cancelTransfer, completeTransfer, createTransfer } from "@/server/services/transfers";
import { listLocations } from "@/server/services/warehouses";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/server/actions/action-result";
import { notify } from "@/server/services/notifications";

function handleError(err: unknown): ActionResult<never> {
  if (err instanceof InventoryError) return fail(err.message);
  if (err instanceof ReceivingServiceError || err instanceof TransferServiceError) {
    return err.field ? fail(err.message, { [err.field]: err.message }) : fail(err.message);
  }
  console.error("[inventory action]", err);
  return fail("Something went wrong. Please try again.");
}

function revalidateStockViews() {
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
}

export async function createReceivingAction(input: ReceivingFormInput): Promise<ActionResult<{ id: string }>> {
  const actor = await requireRole("ADMIN", "WAREHOUSE");
  const parsed = receivingFormSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const record = await createReceiving(parsed.data, actor.id);
    revalidateStockViews();
    revalidatePath("/admin/receiving");
    return ok({ id: record.id });
  } catch (err) {
    return handleError(err);
  }
}

export async function adjustStockAction(input: AdjustmentFormInput): Promise<ActionResult<undefined>> {
  const actor = await requireRole("ADMIN", "WAREHOUSE");
  const parsed = adjustmentFormSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    // Movement + operational charge (D-071: DAMAGE / MISSING / ADJUSTMENT rules) in one transaction; one key per submission.
    const refKey = `adjust:${randomUUID()}`;
    await prisma.$transaction(async (tx) => {
      await adjustStock({ userId: actor.id, ...parsed.data }, tx);
      const variant = await tx.productVariant.findUnique({ where: { id: parsed.data.variantId }, select: { sku: true, product: { select: { ownerId: true } } } });
      if (variant) {
        const event = parsed.data.kind === "DAMAGE" ? "DAMAGE" : parsed.data.kind === "MISSING" ? "MISSING" : "ADJUSTMENT";
        await recordEventCharges(tx, { event, ownerId: variant.product.ownerId, refKey, reference: parsed.data.reason, lines: [{ variantId: parsed.data.variantId, quantity: parsed.data.quantity }], actorId: actor.id });
        const damageOrMissing = parsed.data.kind === "DAMAGE" || parsed.data.kind === "MISSING";
        await notify(tx, { type: damageOrMissing ? "INVENTORY_DAMAGE_MISSING" : "INVENTORY_ADJUSTED", title: `${parsed.data.kind === "DAMAGE" ? "Damaged" : parsed.data.kind === "MISSING" ? "Missing" : parsed.data.kind === "ADJUSTMENT_IN" ? "Stock added" : "Stock removed"}: ${parsed.data.quantity} × ${variant.sku}`, message: `${parsed.data.reason} — by ${actor.name}.`, href: "/admin/inventory/movements", dedupeKey: `${refKey}:notify` });
      }
    }, { timeout: 30_000, maxWait: 10_000 });
    revalidateStockViews();
    revalidatePath("/admin/finance");
    return ok(undefined);
  } catch (err) {
    return handleError(err);
  }
}

export async function moveStockAction(input: MoveFormInput): Promise<ActionResult<undefined>> {
  const actor = await requireRole("ADMIN", "WAREHOUSE");
  const parsed = moveFormSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    await moveStock({ userId: actor.id, ...parsed.data });
    revalidateStockViews();
    return ok(undefined);
  } catch (err) {
    return handleError(err);
  }
}

export async function createTransferAction(input: TransferFormInput): Promise<ActionResult<{ id: string }>> {
  const actor = await requireRole("ADMIN", "WAREHOUSE");
  const parsed = transferFormSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const t = await createTransfer(parsed.data, actor.id);
    revalidateStockViews();
    revalidatePath("/admin/transfers");
    return ok({ id: t.id });
  } catch (err) {
    return handleError(err);
  }
}

export async function completeTransferAction(id: string, input?: TransferCompleteInput): Promise<ActionResult<undefined>> {
  const actor = await requireRole("ADMIN", "WAREHOUSE");
  let lines: { itemId: string; destLocationId: string }[] | undefined;
  if (input) {
    const parsed = transferCompleteSchema.safeParse(input);
    if (!parsed.success) return fail("Choose a destination location for every line.", zodFieldErrors(parsed.error.issues));
    lines = parsed.data.lines;
  }
  try {
    await completeTransfer(id, lines, actor.id);
    revalidateStockViews();
    revalidatePath("/admin/transfers");
    revalidatePath(`/admin/transfers/${id}`);
    return ok(undefined);
  } catch (err) {
    return handleError(err);
  }
}

export async function cancelTransferAction(id: string, reason: string): Promise<ActionResult<undefined>> {
  const actor = await requireRole("ADMIN", "WAREHOUSE");
  const trimmed = reason.trim();
  if (trimmed.length < 3) return fail("Give a short reason for the cancellation.", { reason: "Required" });
  try {
    await cancelTransfer(id, trimmed, actor.id);
    revalidateStockViews();
    revalidatePath("/admin/transfers");
    revalidatePath(`/admin/transfers/${id}`);
    return ok(undefined);
  } catch (err) {
    return handleError(err);
  }
}

/** Locations of a warehouse for dependent selects. */
export async function listLocationsAction(warehouseId: string): Promise<ActionResult<{ id: string; label: string; isDefault: boolean }[]>> {
  await requireRole("ADMIN", "WAREHOUSE", "SALES");
  try {
    return ok(await listLocations(warehouseId));
  } catch (err) {
    return handleError(err);
  }
}
