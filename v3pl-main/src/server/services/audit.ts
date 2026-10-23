// No `server-only` import: shared with CLI scripts. Never import from client components.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Audit log foundation (spec §51). Append-only: this module exposes no update
 * or delete. Later phases add actions to AuditAction as they are implemented.
 */
/** Dotted "entity.verb" keys, e.g. "user.created", "inventory.received", "transfer.completed". */
export type AuditAction = `${string}.${string}`;

export type AuditInput = {
  /** Acting user id; null for system/bootstrap actions. */
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Writes one audit row. Pass the transaction client (`tx`) when the audited
 * change happens inside a transaction so the audit row commits atomically with it.
 */
export async function recordAudit(input: AuditInput, db: DbClient = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      oldValues: (input.oldValues ?? undefined) as Prisma.InputJsonValue | undefined,
      newValues: (input.newValues ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

// --- Read side: Settings → Activity Log (ADMIN only, read-only) -------------

const SENSITIVE_KEY = /(token|secret|password|passwd|credential|apikey|api_key|privatekey|private_key|authorization|cookie|session)/i;

/**
 * Returns a copy of an audit JSON value with credential-like keys replaced by "•••" at every depth.
 * Audit writers never store secrets on purpose; this is defence in depth for the read-only page.
 */
export function redactAuditValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValues);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "•••" : redactAuditValues(v)]));
  }
  return value;
}

export type AuditListParams = { q?: string; entityType?: string; page?: number; pageSize?: number };

/** Newest first. `q` matches action, entity type / id and the acting user's name or e-mail. */
export async function listAuditLog(params: AuditListParams = {}, db: DbClient = prisma) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const q = params.q?.trim();
  const where: Prisma.AuditLogWhereInput = {
    ...(params.entityType ? { entityType: params.entityType } : {}),
    ...(q
      ? {
          OR: [
            { action: { contains: q, mode: "insensitive" } },
            { entityType: { contains: q, mode: "insensitive" } },
            { entityId: { contains: q, mode: "insensitive" } },
            { user: { is: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { name: true, email: true, role: true } } } }),
  ]);
  const items = rows.map((r) => ({ ...r, oldValues: redactAuditValues(r.oldValues), newValues: redactAuditValues(r.newValues), metadata: redactAuditValues(r.metadata) }));
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Distinct entity types present in the log, for the filter select. */
export async function auditEntityTypes(db: DbClient = prisma): Promise<string[]> {
  const rows = await db.auditLog.groupBy({ by: ["entityType"], orderBy: { entityType: "asc" } });
  return rows.map((r) => r.entityType);
}
