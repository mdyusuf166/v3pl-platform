// No `server-only` import: shared with the targeted test script. Never import from client components.
import type { UserRole } from "@/generated/prisma/client";
import { normalizeHeader, parseCsv, toCsv, type CsvRow } from "@/lib/csv";
import { prisma } from "@/lib/prisma";
import type { InventoryImportOptions } from "@/lib/validation/inventory";
import type { ReceivingFormValues } from "@/lib/validation/inventory";
import { getDefaultLocation } from "@/server/services/warehouses";

/**
 * INVENTORY CSV IMPORT (INV-IMP). Columns: SKU, Quantity (required); Location, Barcode (optional).
 * Preview validates every row against the live catalogue; confirm re-validates and books ONE receipt through the
 * existing `createReceiving` (ledger rows, balance locks, location checks, charges, audit). Nothing here writes stock.
 */

export const INVENTORY_IMPORT_ROLES: readonly UserRole[] = ["ADMIN", "WAREHOUSE"];
export const INVENTORY_MAX_ROWS = 500;
export const INVENTORY_REQUIRED = ["SKU", "Quantity"] as const;
const OPTIONAL = ["Location", "Barcode"] as const;

export type InventoryImportRow = {
  /** 1-based data row number (header is row 0). */
  index: number;
  raw: CsvRow;
  sku: string;
  barcode: string;
  quantity: number | null;
  locationLabel: string;
  variantId: string | null;
  variantSku: string | null;
  productName: string | null;
  locationId: string | null;
  resolvedLocation: string | null;
  errors: string[];
};

export type InventoryImportPreview = {
  format: "v3pl-inventory";
  headers: string[];
  missingRequired: string[];
  options: InventoryImportOptions;
  rows: InventoryImportRow[];
  summary: { totalRows: number; validRows: number; failedRows: number; units: number; ownerName: string | null; warehouseCode: string | null };
};

export type InventoryImportOutcome = { receivingId: string; lines: number; units: number };

function col(headers: string[], name: string): string | undefined {
  const want = normalizeHeader(name);
  return headers.find((h) => normalizeHeader(h) === want);
}

/** Parse + validate the CSV for one owner / warehouse. Pure read: no stock, no job row. */
export async function previewInventoryCsv(text: string, options: InventoryImportOptions): Promise<InventoryImportPreview> {
  const { headers, rows } = parseCsv(text);
  const missingRequired = INVENTORY_REQUIRED.filter((r) => !col(headers, r));
  const [owner, warehouse] = await Promise.all([
    prisma.owner.findUnique({ where: { id: options.ownerId }, select: { id: true, status: true, businessName: true } }),
    prisma.warehouse.findUnique({ where: { id: options.warehouseId }, select: { id: true, status: true, code: true } }),
  ]);
  const preview: InventoryImportPreview = { format: "v3pl-inventory", headers, missingRequired, options, rows: [], summary: { totalRows: rows.length, validRows: 0, failedRows: 0, units: 0, ownerName: owner?.businessName ?? null, warehouseCode: warehouse?.code ?? null } };
  const globalErrors: string[] = [];
  if (!owner || owner.status !== "ACTIVE") globalErrors.push("Choose an active vendor / 3PL client.");
  if (!warehouse || warehouse.status !== "ACTIVE") globalErrors.push("Choose an active warehouse.");
  if (missingRequired.length) globalErrors.push(`Missing required column(s): ${missingRequired.join(", ")}.`);
  if (rows.length > INVENTORY_MAX_ROWS) globalErrors.push(`Files are limited to ${INVENTORY_MAX_ROWS} rows; split the file.`);

  const skuCol = col(headers, "SKU");
  const qtyCol = col(headers, "Quantity");
  const locCol = col(headers, OPTIONAL[0]);
  const barCol = col(headers, OPTIONAL[1]);
  const parsed = rows.map((raw, i): InventoryImportRow => ({ index: i + 1, raw, sku: (skuCol ? raw[skuCol] : "")?.trim() ?? "", barcode: (barCol ? raw[barCol] : "")?.trim() ?? "", quantity: null, locationLabel: (locCol ? raw[locCol] : "")?.trim() ?? "", variantId: null, variantSku: null, productName: null, locationId: null, resolvedLocation: null, errors: [] }));

  // One catalogue lookup for the whole file (exact SKU / exact barcode, no fuzzy matching).
  const skus = [...new Set(parsed.map((r) => r.sku).filter(Boolean))];
  const barcodes = [...new Set(parsed.filter((r) => !r.sku && r.barcode).map((r) => r.barcode))];
  const variants = skus.length || barcodes.length ? await prisma.productVariant.findMany({ where: { OR: [...(skus.length ? [{ sku: { in: skus } }] : []), ...(barcodes.length ? [{ barcode: { in: barcodes } }] : [])] }, select: { id: true, sku: true, barcode: true, status: true, product: { select: { name: true, ownerId: true, status: true } } } }) : [];
  const bySku = new Map(variants.map((v) => [v.sku, v]));
  const byBarcode = new Map(variants.filter((v) => v.barcode).map((v) => [v.barcode!, v]));
  const labels = [...new Set(parsed.map((r) => r.locationLabel).filter(Boolean))];
  const locations = warehouse && labels.length ? await prisma.location.findMany({ where: { warehouseId: warehouse.id, label: { in: labels } }, select: { id: true, label: true, type: true, isActive: true } }) : [];
  const fallback = warehouse ? await getDefaultLocation(warehouse.id) : null;

  const seen = new Set<string>();
  for (const r of parsed) {
    r.errors.push(...globalErrors);
    const qtyRaw = (qtyCol ? r.raw[qtyCol] : "")?.trim() ?? "";
    if (!/^\d+$/.test(qtyRaw) || Number(qtyRaw) <= 0) r.errors.push(`Quantity must be a positive whole number (got "${qtyRaw || "blank"}").`);
    else r.quantity = Number(qtyRaw);

    const v = r.sku ? bySku.get(r.sku) : r.barcode ? byBarcode.get(r.barcode) : undefined;
    if (!r.sku && !r.barcode) r.errors.push("SKU (or Barcode) is required.");
    else if (!v) r.errors.push(r.sku ? `Unknown SKU "${r.sku}".` : `Unknown barcode "${r.barcode}".`);
    else if (owner && v.product.ownerId !== owner.id) r.errors.push(`SKU ${v.sku} belongs to another owner.`);
    else if (v.status !== "ACTIVE" || v.product.status !== "ACTIVE") r.errors.push(`SKU ${v.sku} is not active.`);
    else {
      r.variantId = v.id;
      r.variantSku = v.sku;
      r.productName = v.product.name;
    }

    if (r.locationLabel) {
      const loc = locations.find((l) => l.label === r.locationLabel);
      if (!loc) r.errors.push(`Location "${r.locationLabel}" not found in warehouse ${warehouse?.code ?? ""}.`);
      else if (!loc.isActive) r.errors.push(`Location ${loc.label} is inactive.`);
      else if (loc.type !== "AREA" && loc.type !== "BIN") r.errors.push(`Location ${loc.label} is a ${loc.type.toLowerCase()}; choose a bin or area.`);
      else {
        r.locationId = loc.id;
        r.resolvedLocation = loc.label;
      }
    } else if (fallback) {
      r.locationId = fallback.id;
      r.resolvedLocation = `${fallback.label} (default)`;
    } else if (warehouse) r.errors.push("Warehouse has no default location; add a Location column.");

    if (r.variantId && r.locationId) {
      const key = `${r.variantId}:${r.locationId}`;
      if (seen.has(key)) r.errors.push(`Duplicate SKU ${r.variantSku} + location in this file.`);
      seen.add(key);
    }
    if (r.errors.length) preview.summary.failedRows += 1;
    else {
      preview.summary.validRows += 1;
      preview.summary.units += r.quantity ?? 0;
    }
  }
  preview.rows = parsed;
  return preview;
}

/** The single receipt a fully valid preview books. Throws when any row failed — never books a partial file. */
export function buildReceivingValues(preview: InventoryImportPreview, fileName: string): ReceivingFormValues {
  if (preview.summary.failedRows > 0 || preview.rows.length === 0) throw new Error(`${preview.summary.failedRows} row(s) failed validation; nothing was imported.`);
  return {
    ownerId: preview.options.ownerId,
    warehouseId: preview.options.warehouseId,
    reference: preview.options.reference ?? `CSV import ${fileName}`.slice(0, 80),
    notes: `Imported from ${fileName} (${preview.rows.length} rows)`,
    lines: preview.rows.map((r) => ({ variantId: r.variantId!, locationId: r.locationId!, quantity: r.quantity! })),
  };
}

export function failedInventoryRowsCsv(preview: InventoryImportPreview): string {
  const headers = [...preview.headers, "Row", "Errors"];
  return toCsv(headers, preview.rows.filter((r) => r.errors.length).map((r) => ({ ...r.raw, Row: r.index, Errors: r.errors.join(" | ") })));
}
