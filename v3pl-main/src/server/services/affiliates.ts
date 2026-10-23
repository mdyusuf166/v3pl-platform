import type { AffiliateStatus, CommissionStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { AffiliateFormValues, AssignVariantValues } from "@/lib/validation/affiliates";
import { recordAudit } from "@/server/services/audit";
import { recordOrderCommissions } from "@/server/services/affiliate-commissions";
import { createOrder, getOrder, listOrders, type CreateOrderInput, type OrderListParams } from "@/server/services/orders";

/**
 * Affiliates / external sales partners (D-070). An affiliate is neither an Owner nor staff: it sells the
 * variants explicitly assigned to it (which must belong to its assigned vendors / 3PL clients) and earns
 * commissions recorded in `AffiliateCommission` — never in the vendor / 3PL ledger.
 *
 * Every affiliate-facing read takes the affiliate id from the SESSION (`requireAffiliate()`), never from
 * the browser; admin functions take it from the admin URL.
 */

export type AffiliateErrorCode = "NOT_FOUND" | "CODE_TAKEN" | "FORBIDDEN" | "INVALID" | "INACTIVE";

export class AffiliateServiceError extends Error {
  constructor(
    public readonly code: AffiliateErrorCode,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
  }
}

const TX = { timeout: 30_000, maxWait: 10_000 } as const;
const PAGE = 25;

// --- Admin: affiliates ---------------------------------------------------------------------

export async function listAffiliates(params: { q?: string; status?: AffiliateStatus | "ALL" } = {}) {
  return prisma.affiliate.findMany({
    where: {
      ...(params.status && params.status !== "ALL" ? { status: params.status } : {}),
      ...(params.q ? { OR: [{ name: { contains: params.q, mode: "insensitive" } }, { code: { contains: params.q, mode: "insensitive" } }, { email: { contains: params.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: { _count: { select: { users: { where: { status: { not: "DELETED" } } }, variants: true, orders: true } } },
  });
}

export async function getAffiliate(id: string) {
  return prisma.affiliate.findUnique({
    where: { id },
    include: {
      users: { where: { status: { not: "DELETED" } }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, status: true, lastLoginAt: true } },
      owners: { include: { owner: { select: { id: true, code: true, businessName: true, type: true, status: true } } }, orderBy: { owner: { businessName: "asc" } } },
      variants: {
        include: { variant: { select: { id: true, sku: true, name: true, price: true, currency: true, status: true, product: { select: { id: true, name: true, status: true, owner: { select: { id: true, code: true, businessName: true } } } } } } },
        orderBy: { variant: { sku: "asc" } },
      },
    },
  });
}

export async function createAffiliate(values: AffiliateFormValues, actorId: string) {
  const clash = await prisma.affiliate.findUnique({ where: { code: values.code }, select: { id: true } });
  if (clash) throw new AffiliateServiceError("CODE_TAKEN", `Code "${values.code}" is already used by another salesman.`, "code");
  return prisma.$transaction(async (tx) => {
    const a = await tx.affiliate.create({ data: { code: values.code, name: values.name, email: values.email ?? null, phone: values.phone ?? null, status: values.status ?? "ACTIVE", commissionType: values.commissionType, commissionValue: values.commissionValue, notes: values.notes ?? null } });
    await recordAudit({ userId: actorId, action: "affiliate.created", entityType: "Affiliate", entityId: a.id, newValues: { code: a.code, name: a.name, commissionType: values.commissionType, commissionValue: values.commissionValue } }, tx);
    return a;
  });
}

/** Changing the default rule never rewrites recorded commissions — they keep their snapshot (D-070). */
export async function updateAffiliate(id: string, values: AffiliateFormValues, actorId: string) {
  const current = await prisma.affiliate.findUnique({ where: { id } });
  if (!current) throw new AffiliateServiceError("NOT_FOUND", "Salesman not found.");
  if (values.code !== current.code) {
    const clash = await prisma.affiliate.findUnique({ where: { code: values.code }, select: { id: true } });
    if (clash && clash.id !== id) throw new AffiliateServiceError("CODE_TAKEN", `Code "${values.code}" is already used by another salesman.`, "code");
  }
  return prisma.$transaction(async (tx) => {
    const a = await tx.affiliate.update({ where: { id }, data: { code: values.code, name: values.name, email: values.email ?? null, phone: values.phone ?? null, status: values.status ?? current.status, commissionType: values.commissionType, commissionValue: values.commissionValue, notes: values.notes ?? null } });
    await recordAudit({ userId: actorId, action: "affiliate.updated", entityType: "Affiliate", entityId: id, oldValues: { code: current.code, name: current.name, status: current.status, commissionType: current.commissionType, commissionValue: current.commissionValue?.toString() ?? null }, newValues: { code: a.code, name: a.name, status: a.status, commissionType: a.commissionType, commissionValue: a.commissionValue?.toString() ?? null } }, tx);
    return a;
  });
}

// --- Admin: assignments ------------------------------------------------------------------

/** Replace the assigned vendors / 3PL clients. Removing an owner that still has assigned products is refused (no silent unassignment). */
export async function setAssignedOwners(affiliateId: string, ownerIds: string[], actorId: string) {
  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId }, select: { id: true, owners: { select: { ownerId: true } } } });
  if (!affiliate) throw new AffiliateServiceError("NOT_FOUND", "Salesman not found.");
  const wanted = [...new Set(ownerIds)];
  const owners = await prisma.owner.findMany({ where: { id: { in: wanted } }, select: { id: true } });
  if (owners.length !== wanted.length) throw new AffiliateServiceError("INVALID", "One of the selected vendors / 3PL clients does not exist.");
  const removed = affiliate.owners.map((o) => o.ownerId).filter((o) => !wanted.includes(o));
  if (removed.length) {
    const stillAssigned = await prisma.affiliateVariant.count({ where: { affiliateId, variant: { product: { ownerId: { in: removed } } } } });
    if (stillAssigned > 0) throw new AffiliateServiceError("INVALID", `${stillAssigned} assigned product${stillAssigned === 1 ? "" : "s"} belong to a vendor / 3PL client you are removing. Unassign those products first.`);
  }
  return prisma.$transaction(async (tx) => {
    if (removed.length) await tx.affiliateOwner.deleteMany({ where: { affiliateId, ownerId: { in: removed } } });
    if (wanted.length) await tx.affiliateOwner.createMany({ data: wanted.map((ownerId) => ({ affiliateId, ownerId })), skipDuplicates: true });
    await recordAudit({ userId: actorId, action: "affiliate.owners_set", entityType: "Affiliate", entityId: affiliateId, oldValues: { ownerIds: affiliate.owners.map((o) => o.ownerId) }, newValues: { ownerIds: wanted } }, tx);
    return { ownerIds: wanted };
  });
}

/** Assign one variant by SKU. The variant's owner must already be assigned; an optional product-specific rule may be set. */
export async function assignVariantBySku(affiliateId: string, values: AssignVariantValues, actorId: string) {
  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId }, select: { id: true, owners: { select: { ownerId: true } } } });
  if (!affiliate) throw new AffiliateServiceError("NOT_FOUND", "Salesman not found.");
  const variant = await prisma.productVariant.findUnique({ where: { sku: values.sku }, select: { id: true, sku: true, status: true, product: { select: { ownerId: true, status: true, owner: { select: { businessName: true } } } } } });
  if (!variant) throw new AffiliateServiceError("NOT_FOUND", `No SKU "${values.sku}" exists.`, "sku");
  if (variant.status !== "ACTIVE" || variant.product.status !== "ACTIVE") throw new AffiliateServiceError("INVALID", `SKU ${variant.sku} is archived and cannot be sold.`, "sku");
  if (!affiliate.owners.some((o) => o.ownerId === variant.product.ownerId)) throw new AffiliateServiceError("FORBIDDEN", `SKU ${variant.sku} belongs to ${variant.product.owner.businessName}, which is not assigned to this salesman. Assign the vendor / 3PL client first.`, "sku");
  return prisma.$transaction(async (tx) => {
    const row = await tx.affiliateVariant.upsert({
      where: { affiliateId_variantId: { affiliateId, variantId: variant.id } },
      create: { affiliateId, variantId: variant.id, commissionType: values.commissionType, commissionValue: values.commissionValue },
      update: { commissionType: values.commissionType, commissionValue: values.commissionValue },
    });
    await recordAudit({ userId: actorId, action: "affiliate.variant_assigned", entityType: "Affiliate", entityId: affiliateId, newValues: { sku: variant.sku, variantId: variant.id, commissionType: values.commissionType, commissionValue: values.commissionValue } }, tx);
    return row;
  });
}

export async function unassignVariant(affiliateId: string, variantId: string, actorId: string) {
  const row = await prisma.affiliateVariant.findUnique({ where: { affiliateId_variantId: { affiliateId, variantId } }, select: { variant: { select: { sku: true } } } });
  if (!row) throw new AffiliateServiceError("NOT_FOUND", "That product is not assigned.");
  await prisma.$transaction(async (tx) => {
    await tx.affiliateVariant.delete({ where: { affiliateId_variantId: { affiliateId, variantId } } });
    await recordAudit({ userId: actorId, action: "affiliate.variant_unassigned", entityType: "Affiliate", entityId: affiliateId, oldValues: { sku: row.variant.sku, variantId } }, tx);
  });
  return row;
}

// --- Affiliate scope reads (affiliateId ALWAYS from the session) -----------------------------

export async function assignedVariantIds(affiliateId: string) {
  const rows = await prisma.affiliateVariant.findMany({ where: { affiliateId, variant: { status: "ACTIVE", product: { status: "ACTIVE" } } }, select: { variantId: true } });
  return rows.map((r) => r.variantId);
}

/** "My products": assigned, active variants with price, owner, available stock and the rule that applies. */
export async function listAssignedProducts(affiliateId: string, params: { q?: string; page?: number } = {}) {
  const page = Math.max(1, params.page ?? 1);
  const where: Prisma.AffiliateVariantWhereInput = {
    affiliateId,
    variant: {
      status: "ACTIVE",
      product: { status: "ACTIVE" },
      ...(params.q ? { OR: [{ sku: { contains: params.q, mode: "insensitive" } }, { name: { contains: params.q, mode: "insensitive" } }, { product: { name: { contains: params.q, mode: "insensitive" } } }] } : {}),
    },
  };
  const [total, rows, affiliate] = await Promise.all([
    prisma.affiliateVariant.count({ where }),
    prisma.affiliateVariant.findMany({
      where,
      orderBy: { variant: { sku: "asc" } },
      skip: (page - 1) * PAGE,
      take: PAGE,
      select: { commissionType: true, commissionValue: true, variant: { select: { id: true, sku: true, name: true, price: true, currency: true, product: { select: { id: true, name: true, owner: { select: { businessName: true } } } }, balances: { select: { onHand: true, reserved: true } } } } },
    }),
    prisma.affiliate.findUnique({ where: { id: affiliateId }, select: { commissionType: true, commissionValue: true } }),
  ]);
  const items = rows.map((r) => {
    const rule = r.commissionType && r.commissionValue !== null ? { type: r.commissionType, value: Number(r.commissionValue), source: "VARIANT" as const } : affiliate?.commissionType && affiliate.commissionValue !== null ? { type: affiliate.commissionType, value: Number(affiliate.commissionValue), source: "AFFILIATE_DEFAULT" as const } : null;
    const onHand = r.variant.balances.reduce((s, b) => s + b.onHand, 0);
    const reserved = r.variant.balances.reduce((s, b) => s + b.reserved, 0);
    return { id: r.variant.id, sku: r.variant.sku, name: r.variant.name, price: r.variant.price, currency: r.variant.currency, product: r.variant.product, available: onHand - reserved, rule };
  });
  return { items, total, page, pageSize: PAGE, pageCount: Math.max(1, Math.ceil(total / PAGE)) };
}

export type AffiliateOrderInput = Omit<CreateOrderInput, "source" | "affiliateId" | "reserve" | "lines" | "submittedByOwnerId" | "shopify" | "sourceRef"> & { lines: { variantId: string; quantity: number }[] };

/**
 * Affiliate sale: only assigned, active variants; lines priced at the variant's current retail price so the
 * commission base is known; stock is reserved through the existing order service; commissions are snapshotted.
 */
export async function createAffiliateOrder(affiliateId: string, input: AffiliateOrderInput, actorId: string) {
  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId }, select: { id: true, status: true } });
  if (!affiliate) throw new AffiliateServiceError("NOT_FOUND", "Salesman not found.");
  if (affiliate.status !== "ACTIVE") throw new AffiliateServiceError("INACTIVE", "This salesman account is inactive.");
  const allowed = new Set(await assignedVariantIds(affiliateId));
  const wanted = [...new Set(input.lines.map((l) => l.variantId))];
  const variants = await prisma.productVariant.findMany({ where: { id: { in: wanted } }, select: { id: true, sku: true, price: true } });
  const foreign = variants.filter((v) => !allowed.has(v.id)).map((v) => v.sku);
  const missing = wanted.filter((id) => !variants.some((v) => v.id === id));
  if (foreign.length || missing.length) throw new AffiliateServiceError("FORBIDDEN", `You can only sell products assigned to you${foreign.length ? ` (not assigned: ${foreign.join(", ")})` : ""}.`, "lines");
  const price = new Map(variants.map((v) => [v.id, v.price]));
  const { lines, ...rest } = input;
  const res = await createOrder({ ...rest, source: "AFFILIATE", affiliateId, reserve: true, lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPrice: price.get(l.variantId)?.toString() ?? null })) }, actorId);
  if (res.created) await recordOrderCommissions(prisma, res.orderId);
  return res;
}

export async function affiliateOrders(affiliateId: string, params: Omit<OrderListParams, "affiliateId" | "scopeOwnerId" | "ownerId"> = {}) {
  return listOrders({ ...params, affiliateId });
}

/** Full order for the affiliate portal — null unless this affiliate placed it. */
export async function affiliateOrder(affiliateId: string, orderId: string) {
  const owned = await prisma.order.findFirst({ where: { id: orderId, affiliateId }, select: { id: true } });
  if (!owned) return null;
  return getOrder(orderId);
}

/** Customers the affiliate acquired (saved from its orders) or sold to. */
export async function affiliateCustomers(affiliateId: string, params: { q?: string; page?: number } = {}) {
  const page = Math.max(1, params.page ?? 1);
  const where: Prisma.CustomerWhereInput = {
    OR: [{ affiliateId }, { orders: { some: { affiliateId } } }],
    ...(params.q ? { AND: [{ OR: [{ name: { contains: params.q, mode: "insensitive" } }, { email: { contains: params.q, mode: "insensitive" } }, { phone: { contains: params.q, mode: "insensitive" } }] }] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * PAGE, take: PAGE, select: { id: true, name: true, email: true, phone: true, shipCity: true, shipCountry: true, createdAt: true, _count: { select: { orders: { where: { affiliateId } } } } } }),
  ]);
  return { items, total, page, pageSize: PAGE, pageCount: Math.max(1, Math.ceil(total / PAGE)) };
}

/** Earnings summary: sales from the affiliate's non-cancelled lines; commission by status. Outstanding = pending + earned. */
export async function affiliateEarnings(affiliateId: string) {
  const [orders, items, byStatus] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], where: { affiliateId }, _count: { _all: true } }),
    prisma.orderItem.findMany({ where: { order: { affiliateId, status: { not: "CANCELLED" } } }, select: { quantity: true, cancelledQty: true, unitPrice: true, discount: true } }),
    prisma.affiliateCommission.groupBy({ by: ["status"], where: { affiliateId }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const sales = items.reduce((s, i) => s + Math.max(0, (i.quantity - i.cancelledQty) * Number(i.unitPrice ?? 0) - Number(i.discount ?? 0)), 0);
  const sum = (st: CommissionStatus) => Number(byStatus.find((b) => b.status === st)?._sum.amount ?? 0);
  const count = (st: CommissionStatus) => byStatus.find((b) => b.status === st)?._count._all ?? 0;
  const pending = sum("PENDING");
  const earned = sum("EARNED");
  const paid = sum("PAID");
  return {
    orders: orders.reduce((s, o) => s + o._count._all, 0),
    openOrders: orders.filter((o) => o.status === "NEW" || o.status === "CONFIRMED").reduce((s, o) => s + o._count._all, 0),
    sales: Math.round(sales * 100) / 100,
    pending,
    earned,
    paid,
    cancelled: sum("CANCELLED"),
    outstanding: Math.round((pending + earned) * 100) / 100,
    counts: { pending: count("PENDING"), earned: count("EARNED"), paid: count("PAID"), cancelled: count("CANCELLED") },
  };
}

export async function listCommissions(params: { affiliateId?: string; status?: CommissionStatus | "ALL"; page?: number; pageSize?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? PAGE;
  const where: Prisma.AffiliateCommissionWhereInput = { ...(params.affiliateId ? { affiliateId: params.affiliateId } : {}), ...(params.status && params.status !== "ALL" ? { status: params.status } : {}) };
  const [total, items] = await Promise.all([
    prisma.affiliateCommission.count({ where }),
    prisma.affiliateCommission.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { order: { select: { id: true, orderNumber: true, placedAt: true, status: true } }, orderItem: { select: { sku: true, quantity: true } }, affiliate: { select: { id: true, name: true, code: true } } },
    }),
  ]);
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Admin: EARNED → PAID for the given commissions of ONE affiliate (others are ignored, never touched). */
export async function markCommissionsPaid(affiliateId: string, commissionIds: string[], meta: { reference: string | null; notes: string | null }, actorId: string) {
  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId }, select: { id: true } });
  if (!affiliate) throw new AffiliateServiceError("NOT_FOUND", "Salesman not found.");
  return prisma.$transaction(async (tx) => {
    const rows = await tx.affiliateCommission.findMany({ where: { id: { in: commissionIds }, affiliateId, status: "EARNED" }, select: { id: true, amount: true } });
    if (rows.length === 0) throw new AffiliateServiceError("INVALID", "None of the selected commissions are earned and unpaid.");
    await tx.affiliateCommission.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "PAID", paidAt: new Date(), paidReference: meta.reference, paidById: actorId, notes: meta.notes } });
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    await recordAudit({ userId: actorId, action: "affiliate.commissions_paid", entityType: "Affiliate", entityId: affiliateId, newValues: { commissionIds: rows.map((r) => r.id), total: Math.round(total * 100) / 100, reference: meta.reference } }, tx);
    return { count: rows.length, total: Math.round(total * 100) / 100 };
  }, TX);
}
