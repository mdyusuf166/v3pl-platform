import type { Prisma, WarehouseStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { NODE_COLUMN, NODE_LABEL, NODE_PARENT, type LocationFormValues, type LocationNodeValues, type WarehouseFormValues } from "@/lib/validation/warehouses";
import { recordAudit } from "@/server/services/audit";

export type WarehouseErrorCode = "CODE_TAKEN" | "NOT_FOUND" | "LABEL_TAKEN" | "HAS_STOCK" | "IS_DEFAULT" | "INACTIVE" | "HAS_HISTORY" | "INVALID_PARENT" | "HAS_CHILDREN";

export class WarehouseServiceError extends Error {
  constructor(
    public readonly code: WarehouseErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const DEFAULT_LOCATION_LABEL = "MAIN";

export async function listWarehouses(includeInactive = false) {
  return prisma.warehouse.findMany({
    where: includeInactive ? undefined : { status: "ACTIVE" },
    orderBy: [{ status: "asc" }, { code: "asc" }],
    include: { _count: { select: { locations: { where: { isActive: true } } } } },
  });
}

export async function getWarehouse(id: string) {
  return prisma.warehouse.findUnique({
    where: { id },
    include: { locations: { orderBy: [{ isDefault: "desc" }, { label: "asc" }] } },
  });
}

/** Active STORAGE locations of a warehouse for pickers: flat areas and bins only (zones / racks / shelves are containers, D-069). */
export async function listLocations(warehouseId: string) {
  return prisma.location.findMany({ where: { warehouseId, isActive: true, type: { in: ["AREA", "BIN"] } }, orderBy: [{ isDefault: "desc" }, { label: "asc" }], select: { id: true, label: true, isDefault: true } });
}

/** Units on hand per location of a warehouse (for the hierarchy view; containers roll up in the UI). */
export async function warehouseStockByLocation(warehouseId: string) {
  const rows = await prisma.inventoryLevel.groupBy({ by: ["locationId"], where: { warehouseId, onHand: { not: 0 } }, _sum: { onHand: true } });
  return Object.fromEntries(rows.map((r) => [r.locationId, r._sum.onHand ?? 0]));
}

export async function getDefaultLocation(warehouseId: string, db: Prisma.TransactionClient = prisma) {
  return db.location.findFirst({ where: { warehouseId, isDefault: true }, select: { id: true, label: true } });
}

/** Creates the warehouse together with its default MAIN location (D-043). */
export async function createWarehouse(values: WarehouseFormValues, actorId: string) {
  const clash = await prisma.warehouse.findUnique({ where: { code: values.code }, select: { id: true } });
  if (clash) throw new WarehouseServiceError("CODE_TAKEN", `Warehouse code "${values.code}" is already used.`);
  return prisma.$transaction(async (tx) => {
    const wh = await tx.warehouse.create({ data: values });
    await tx.location.create({ data: { warehouseId: wh.id, label: DEFAULT_LOCATION_LABEL, isDefault: true } });
    await recordAudit({ userId: actorId, action: "warehouse.created", entityType: "Warehouse", entityId: wh.id, newValues: values }, tx);
    return wh;
  });
}

export async function updateWarehouse(id: string, values: WarehouseFormValues, actorId: string) {
  const current = await prisma.warehouse.findUnique({ where: { id } });
  if (!current) throw new WarehouseServiceError("NOT_FOUND", "Warehouse not found.");
  if (values.code !== current.code) {
    const clash = await prisma.warehouse.findUnique({ where: { code: values.code }, select: { id: true } });
    if (clash && clash.id !== id) throw new WarehouseServiceError("CODE_TAKEN", `Warehouse code "${values.code}" is already used.`);
  }
  return prisma.$transaction(async (tx) => {
    const wh = await tx.warehouse.update({ where: { id }, data: values });
    await recordAudit({ userId: actorId, action: "warehouse.updated", entityType: "Warehouse", entityId: id, oldValues: pick(current, values), newValues: values }, tx);
    return wh;
  });
}

/** INACTIVE warehouses cannot receive or ship; requires zero stock. */
export async function setWarehouseStatus(id: string, status: WarehouseStatus, actorId: string) {
  const current = await prisma.warehouse.findUnique({ where: { id }, select: { id: true, status: true, code: true } });
  if (!current) throw new WarehouseServiceError("NOT_FOUND", "Warehouse not found.");
  if (current.status === status) return current;
  if (status === "INACTIVE") {
    const stock = await prisma.inventoryBalance.aggregate({ where: { warehouseId: id }, _sum: { onHand: true } });
    if ((stock._sum.onHand ?? 0) > 0) throw new WarehouseServiceError("HAS_STOCK", `Warehouse ${current.code} still holds stock; transfer or adjust it out first.`);
  }
  return prisma.$transaction(async (tx) => {
    const wh = await tx.warehouse.update({ where: { id }, data: { status } });
    await recordAudit({ userId: actorId, action: status === "ACTIVE" ? "warehouse.reactivated" : "warehouse.deactivated", entityType: "Warehouse", entityId: id, oldValues: { status: current.status }, newValues: { status } }, tx);
    return wh;
  });
}

export async function createLocation(warehouseId: string, values: LocationFormValues, actorId: string) {
  const wh = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, status: true } });
  if (!wh) throw new WarehouseServiceError("NOT_FOUND", "Warehouse not found.");
  if (wh.status !== "ACTIVE") throw new WarehouseServiceError("INACTIVE", "Cannot add locations to an inactive warehouse.");
  const clash = await prisma.location.findUnique({ where: { warehouseId_label: { warehouseId, label: values.label } }, select: { id: true } });
  if (clash) throw new WarehouseServiceError("LABEL_TAKEN", `Location "${values.label}" already exists in this warehouse.`);
  return prisma.$transaction(async (tx) => {
    const loc = await tx.location.create({ data: { warehouseId, label: values.label, zone: values.zone ?? null, rack: values.rack ?? null, shelf: values.shelf ?? null, bin: values.bin ?? null, notes: values.notes ?? null } });
    await recordAudit({ userId: actorId, action: "location.created", entityType: "Location", entityId: loc.id, newValues: { warehouseId, ...values } }, tx);
    return loc;
  });
}

export async function updateLocation(id: string, values: LocationFormValues, actorId: string) {
  const current = await prisma.location.findUnique({ where: { id } });
  if (!current) throw new WarehouseServiceError("NOT_FOUND", "Location not found.");
  if (current.type !== "AREA") throw new WarehouseServiceError("INVALID_PARENT", "Hierarchy nodes are edited by code; their path is derived from the parent.");
  if (values.label !== current.label) {
    const clash = await prisma.location.findUnique({ where: { warehouseId_label: { warehouseId: current.warehouseId, label: values.label } }, select: { id: true } });
    if (clash && clash.id !== id) throw new WarehouseServiceError("LABEL_TAKEN", `Location "${values.label}" already exists in this warehouse.`);
  }
  return prisma.$transaction(async (tx) => {
    const loc = await tx.location.update({ where: { id }, data: { label: values.label, zone: values.zone ?? null, rack: values.rack ?? null, shelf: values.shelf ?? null, bin: values.bin ?? null, notes: values.notes ?? null } });
    await recordAudit({ userId: actorId, action: "location.updated", entityType: "Location", entityId: id, oldValues: pick(current, values), newValues: values }, tx);
    return loc;
  });
}

// ---------------------------------------------------------------------------
// Location hierarchy (D-069): ZONE → RACK → SHELF → BIN as Location rows linked by `parentId`.
// A node's label is the path of codes ("A-01-01-A01"); its zone/rack/shelf/bin columns carry the path
// so every existing display of `label` / parts keeps working and stock rows never change.
// ---------------------------------------------------------------------------

type NodeRow = { id: string; warehouseId: string; type: "AREA" | "ZONE" | "RACK" | "SHELF" | "BIN"; isActive: boolean; zone: string | null; rack: string | null; shelf: string | null; bin: string | null };
const NODE_SELECT = { id: true, warehouseId: true, type: true, isActive: true, zone: true, rack: true, shelf: true, bin: true } as const;

/** Validates the parent for a node type and returns the parent's path parts (or none for a ZONE). */
async function resolveParent(db: Prisma.TransactionClient | typeof prisma, warehouseId: string, type: LocationNodeValues["type"], parentId: string | null | undefined): Promise<{ parent: NodeRow | null; parts: Pick<NodeRow, "zone" | "rack" | "shelf" | "bin"> }> {
  const required = NODE_PARENT[type];
  if (!required) {
    if (parentId) throw new WarehouseServiceError("INVALID_PARENT", "A zone sits directly under the warehouse and cannot have a parent.");
    return { parent: null, parts: { zone: null, rack: null, shelf: null, bin: null } };
  }
  if (!parentId) throw new WarehouseServiceError("INVALID_PARENT", `Choose the ${NODE_LABEL[required].toLowerCase()} this ${NODE_LABEL[type].toLowerCase()} belongs to.`);
  const parent = await db.location.findUnique({ where: { id: parentId }, select: NODE_SELECT });
  if (!parent || parent.warehouseId !== warehouseId) throw new WarehouseServiceError("INVALID_PARENT", "The parent location does not belong to this warehouse.");
  if (parent.type !== required) throw new WarehouseServiceError("INVALID_PARENT", `A ${NODE_LABEL[type].toLowerCase()} must belong to a ${NODE_LABEL[required].toLowerCase()}, not a ${NODE_LABEL[parent.type as keyof typeof NODE_LABEL].toLowerCase()}.`);
  if (!parent.isActive) throw new WarehouseServiceError("INACTIVE", "The parent location is inactive; reactivate it first.");
  return { parent, parts: { zone: parent.zone, rack: parent.rack, shelf: parent.shelf, bin: parent.bin } };
}

function pathParts(parts: Pick<NodeRow, "zone" | "rack" | "shelf" | "bin">, type: LocationNodeValues["type"], code: string) {
  const next = { zone: parts.zone, rack: parts.rack, shelf: parts.shelf, bin: parts.bin };
  next[NODE_COLUMN[type]] = code;
  const label = [next.zone, next.rack, next.shelf, next.bin].filter((p): p is string => !!p).join("-");
  return { ...next, label };
}

/** All descendants of a node (depth ≤ 3), nearest level first. */
async function descendantsOf(db: Prisma.TransactionClient | typeof prisma, id: string): Promise<NodeRow[]> {
  const out: NodeRow[] = [];
  let frontier = [id];
  while (frontier.length) {
    const rows = await db.location.findMany({ where: { parentId: { in: frontier } }, select: NODE_SELECT });
    out.push(...rows);
    frontier = rows.map((r) => r.id);
  }
  return out;
}

export async function createLocationNode(warehouseId: string, values: LocationNodeValues, actorId: string) {
  const wh = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, status: true } });
  if (!wh) throw new WarehouseServiceError("NOT_FOUND", "Warehouse not found.");
  if (wh.status !== "ACTIVE") throw new WarehouseServiceError("INACTIVE", "Cannot add locations to an inactive warehouse.");
  const { parent, parts } = await resolveParent(prisma, warehouseId, values.type, values.parentId);
  const data = pathParts(parts, values.type, values.code);
  const clash = await prisma.location.findUnique({ where: { warehouseId_label: { warehouseId, label: data.label } }, select: { id: true } });
  if (clash) throw new WarehouseServiceError("LABEL_TAKEN", `${NODE_LABEL[values.type]} "${values.code}" already exists ${parent ? "under this parent" : "in this warehouse"} (label ${data.label}).`);
  return prisma.$transaction(async (tx) => {
    const loc = await tx.location.create({ data: { warehouseId, type: values.type, parentId: parent?.id ?? null, ...data, notes: values.notes ?? null } });
    await recordAudit({ userId: actorId, action: "location.created", entityType: "Location", entityId: loc.id, newValues: { warehouseId, type: values.type, parentId: parent?.id ?? null, code: values.code, label: data.label } }, tx);
    return loc;
  });
}

/** Rename a node's code / notes. The parent never changes here (no silent moves); descendants are relabelled to the new path. */
export async function updateLocationNode(id: string, values: Pick<LocationNodeValues, "code" | "notes">, actorId: string) {
  const current = await prisma.location.findUnique({ where: { id }, select: { ...NODE_SELECT, label: true, notes: true, parentId: true } });
  if (!current) throw new WarehouseServiceError("NOT_FOUND", "Location not found.");
  if (current.type === "AREA") throw new WarehouseServiceError("INVALID_PARENT", "Flat areas are edited with the location form.");
  const type = current.type;
  const column = NODE_COLUMN[type];
  const oldCode = current[column] ?? "";
  return prisma.$transaction(async (tx) => {
    if (values.code !== oldCode) {
      const rows = [current, ...(await descendantsOf(tx, id))];
      for (const row of rows) {
        const next = { zone: row.zone, rack: row.rack, shelf: row.shelf, bin: row.bin };
        next[column] = values.code;
        const label = [next.zone, next.rack, next.shelf, next.bin].filter((p): p is string => !!p).join("-");
        const clash = await tx.location.findUnique({ where: { warehouseId_label: { warehouseId: row.warehouseId, label } }, select: { id: true } });
        if (clash && clash.id !== row.id) throw new WarehouseServiceError("LABEL_TAKEN", `${NODE_LABEL[type]} "${values.code}" already exists here (label ${label}).`);
        await tx.location.update({ where: { id: row.id }, data: { ...next, label } });
      }
    }
    const loc = await tx.location.update({ where: { id }, data: { notes: values.notes ?? null } });
    await recordAudit({ userId: actorId, action: "location.updated", entityType: "Location", entityId: id, oldValues: { code: oldCode, notes: current.notes }, newValues: { code: values.code, notes: values.notes ?? null } }, tx);
    return loc;
  });
}

/**
 * Deactivate a location: not the default, and only when neither it nor any descendant holds stock;
 * descendants are deactivated with it (explicit, audited — stock is never moved). Reactivation needs an active parent.
 */
export async function setLocationActive(id: string, isActive: boolean, actorId: string) {
  const current = await prisma.location.findUnique({ where: { id }, select: { id: true, isActive: true, isDefault: true, label: true, parent: { select: { isActive: true, label: true } } } });
  if (!current) throw new WarehouseServiceError("NOT_FOUND", "Location not found.");
  if (current.isActive === isActive) return current;
  const descendants = await descendantsOf(prisma, id);
  if (!isActive) {
    if (current.isDefault) throw new WarehouseServiceError("IS_DEFAULT", "The default location cannot be deactivated.");
    const ids = [id, ...descendants.map((d) => d.id)];
    const stock = await prisma.inventoryLevel.aggregate({ where: { locationId: { in: ids } }, _sum: { onHand: true } });
    if ((stock._sum.onHand ?? 0) > 0) throw new WarehouseServiceError("HAS_STOCK", `Location ${current.label}${descendants.length ? " or a location inside it" : ""} still holds stock; move it first.`);
  } else if (current.parent && !current.parent.isActive) throw new WarehouseServiceError("INACTIVE", `Reactivate ${current.parent.label} first.`);
  return prisma.$transaction(async (tx) => {
    const loc = await tx.location.update({ where: { id }, data: { isActive } });
    if (!isActive && descendants.length) await tx.location.updateMany({ where: { id: { in: descendants.map((d) => d.id) } }, data: { isActive: false } });
    await recordAudit({ userId: actorId, action: isActive ? "location.reactivated" : "location.deactivated", entityType: "Location", entityId: id, newValues: { isActive, descendants: isActive ? undefined : descendants.length } }, tx);
    return loc;
  });
}

export async function setDefaultLocation(id: string, actorId: string) {
  const target = await prisma.location.findUnique({ where: { id }, select: { id: true, warehouseId: true, isActive: true, isDefault: true, type: true } });
  if (!target) throw new WarehouseServiceError("NOT_FOUND", "Location not found.");
  if (!target.isActive) throw new WarehouseServiceError("INACTIVE", "Activate the location before making it the default.");
  if (target.type !== "AREA" && target.type !== "BIN") throw new WarehouseServiceError("INVALID_PARENT", "Only a bin or a flat area can be the default storage location.");
  if (target.isDefault) return target;
  return prisma.$transaction(async (tx) => {
    await tx.location.updateMany({ where: { warehouseId: target.warehouseId, isDefault: true }, data: { isDefault: false } });
    const loc = await tx.location.update({ where: { id }, data: { isDefault: true } });
    await recordAudit({ userId: actorId, action: "location.default_changed", entityType: "Location", entityId: id, newValues: { isDefault: true } }, tx);
    return loc;
  });
}

function pick<T extends Record<string, unknown>>(current: T, next: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next)) out[k] = current[k] ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// Deletion (D-054): hard delete only while nothing references the record; the database's
// RESTRICT foreign keys are the final guard (P2003 → HAS_HISTORY).
// ---------------------------------------------------------------------------

export type DeleteCheck = { canDelete: boolean; blockers: string[] };

export async function warehouseDeleteCheck(id: string): Promise<DeleteCheck> {
  const w = await prisma.warehouse.findUnique({
    where: { id },
    select: { _count: { select: { transactions: true, balances: true, receivingRecords: true, transfersOut: true, transfersIn: true, orders: true, fulfillments: true, returns: true, orderItems: true, shopifyStores: true } } },
  });
  if (!w) return { canDelete: false, blockers: ["Warehouse not found"] };
  const c = w._count;
  const blockers: string[] = [];
  if (c.transactions > 0) blockers.push("Has inventory history (ledger entries)");
  else if (c.balances > 0) blockers.push("Has stock records");
  if (c.receivingRecords > 0) blockers.push("Has receiving records");
  if (c.transfersOut + c.transfersIn > 0) blockers.push("Appears on transfers");
  if (c.orders + c.orderItems > 0) blockers.push("Referenced by orders");
  if (c.fulfillments > 0) blockers.push("Has fulfilment records");
  if (c.returns > 0) blockers.push("Has returns");
  if (c.shopifyStores > 0) blockers.push("Linked to a Shopify store");
  return { canDelete: blockers.length === 0, blockers };
}

export async function deleteWarehouse(id: string, actorId: string) {
  const current = await prisma.warehouse.findUnique({ where: { id }, select: { id: true, code: true, name: true } });
  if (!current) throw new WarehouseServiceError("NOT_FOUND", "Warehouse not found.");
  const check = await warehouseDeleteCheck(id);
  if (!check.canDelete) throw new WarehouseServiceError("HAS_HISTORY", `Warehouse ${current.code} cannot be deleted: ${check.blockers.join("; ")}. Deactivate it instead.`);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.inventoryLevel.deleteMany({ where: { warehouseId: id, onHand: 0 } });
      await tx.location.deleteMany({ where: { warehouseId: id } });
      await tx.warehouse.delete({ where: { id } });
      await recordAudit({ userId: actorId, action: "warehouse.deleted", entityType: "Warehouse", entityId: id, oldValues: { code: current.code, name: current.name } }, tx);
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2003") throw new WarehouseServiceError("HAS_HISTORY", `Warehouse ${current.code} is still referenced by operational records and cannot be deleted. Deactivate it instead.`);
    throw err;
  }
  return current;
}

export async function locationDeleteCheck(id: string): Promise<DeleteCheck> {
  const l = await prisma.location.findUnique({ where: { id }, select: { isDefault: true, _count: { select: { children: true, levels: true, transactions: true, receivingItems: true, transferItemsSource: true, transferItemsDest: true, fulfillmentItems: true, returnItems: true } } } });
  if (!l) return { canDelete: false, blockers: ["Location not found"] };
  const blockers: string[] = [];
  if (l.isDefault) blockers.push("It is the warehouse's default location");
  const c = l._count;
  if (c.children > 0) blockers.push(`Contains ${c.children} location${c.children === 1 ? "" : "s"} (delete those first)`);
  if (c.transactions > 0) blockers.push("Has inventory history (ledger entries)");
  else if (c.levels > 0) blockers.push("Has stock records");
  if (c.receivingItems > 0) blockers.push("Appears on receiving records");
  if (c.transferItemsSource + c.transferItemsDest > 0) blockers.push("Appears on transfers");
  if (c.fulfillmentItems > 0) blockers.push("Appears on picks");
  if (c.returnItems > 0) blockers.push("Appears on returns");
  return { canDelete: blockers.length === 0, blockers };
}

export async function deleteLocation(id: string, actorId: string) {
  const current = await prisma.location.findUnique({ where: { id }, select: { id: true, label: true, warehouseId: true } });
  if (!current) throw new WarehouseServiceError("NOT_FOUND", "Location not found.");
  const check = await locationDeleteCheck(id);
  if (!check.canDelete) throw new WarehouseServiceError(check.blockers.some((b) => b.startsWith("Contains")) ? "HAS_CHILDREN" : "HAS_HISTORY", `Location ${current.label} cannot be deleted: ${check.blockers.join("; ")}.${check.blockers.some((b) => b.startsWith("It is") || b.startsWith("Contains")) ? "" : " Deactivate it instead."}`);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.location.delete({ where: { id } });
      await recordAudit({ userId: actorId, action: "location.deleted", entityType: "Location", entityId: id, oldValues: { label: current.label, warehouseId: current.warehouseId } }, tx);
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2003") throw new WarehouseServiceError("HAS_HISTORY", `Location ${current.label} is still referenced by operational records and cannot be deleted. Deactivate it instead.`);
    throw err;
  }
  return current;
}
