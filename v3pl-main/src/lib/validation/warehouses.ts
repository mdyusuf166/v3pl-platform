import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const warehouseCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, "Code is required")
  .max(12, "Code must be 12 characters or fewer")
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Use letters, numbers and hyphens only");

export const warehouseFormSchema = z.object({
  code: warehouseCodeSchema,
  name: z.string().trim().min(2, "Name is required").max(120),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(20),
  country: optionalText(80),
  notes: optionalText(2000),
});
export type WarehouseFormInput = z.input<typeof warehouseFormSchema>;
export type WarehouseFormValues = z.output<typeof warehouseFormSchema>;

const part = optionalText(20);

export const locationFormSchema = z
  .object({
    /** Optional explicit label; otherwise built from zone-rack-shelf-bin. */
    label: optionalText(40),
    zone: part,
    rack: part,
    shelf: part,
    bin: part,
    notes: optionalText(500),
  })
  .transform((v) => {
    const parts = [v.zone, v.rack, v.shelf, v.bin].filter((p): p is string => !!p);
    const label = (v.label ?? parts.join("-")).toUpperCase();
    return { ...v, label };
  })
  .refine((v) => v.label.length >= 1, { path: ["label"], message: "Enter a label or at least one of zone, rack, shelf, bin" })
  .refine((v) => /^[A-Z0-9][A-Z0-9._ -]*$/.test(v.label), { path: ["label"], message: "Label may contain letters, numbers, spaces, dots, underscores and hyphens" });

export type LocationFormInput = z.input<typeof locationFormSchema>;
export type LocationFormValues = z.output<typeof locationFormSchema>;

// ---------------------------------------------------------------------------
// Location hierarchy (D-069): Warehouse → ZONE → RACK → SHELF → BIN. Each node is a Location row;
// its label is the path of codes joined by "-" (e.g. "A-01-01-A01"), so the existing per-warehouse
// label uniqueness doubles as "no duplicate code among siblings".
// ---------------------------------------------------------------------------

export const NODE_TYPES = ["ZONE", "RACK", "SHELF", "BIN"] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export const NODE_LABEL: Record<NodeType | "AREA", string> = { AREA: "Area", ZONE: "Zone", RACK: "Rack", SHELF: "Shelf", BIN: "Bin" };
/** Parent level required for each node type (null = directly under the warehouse). */
export const NODE_PARENT: Record<NodeType, NodeType | null> = { ZONE: null, RACK: "ZONE", SHELF: "RACK", BIN: "SHELF" };
export const NODE_CHILD: Record<NodeType, NodeType | null> = { ZONE: "RACK", RACK: "SHELF", SHELF: "BIN", BIN: null };
/** Column of `Location` that holds a node's own code. */
export const NODE_COLUMN: Record<NodeType, "zone" | "rack" | "shelf" | "bin"> = { ZONE: "zone", RACK: "rack", SHELF: "shelf", BIN: "bin" };

export const locationNodeSchema = z.object({
  type: z.enum(NODE_TYPES),
  /** Required unless type is ZONE. */
  parentId: z.string().trim().nullable().optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Code is required")
    .max(20, "Code must be 20 characters or fewer")
    .regex(/^[A-Z0-9][A-Z0-9._ ]*$/, "Use letters, numbers, spaces, dots and underscores (no hyphens — they separate levels)"),
  notes: optionalText(500),
});
export type LocationNodeInput = z.input<typeof locationNodeSchema>;
export type LocationNodeValues = z.output<typeof locationNodeSchema>;

/** Readable path for any location row, e.g. "Zone A / Rack 01 / Shelf 01 / Bin A01" (AREA rows → label). */
export function locationPath(loc: { label: string; type?: string | null; zone?: string | null; rack?: string | null; shelf?: string | null; bin?: string | null }): string {
  if (!loc.type || loc.type === "AREA") return loc.label;
  const parts = [loc.zone && `Zone ${loc.zone}`, loc.rack && `Rack ${loc.rack}`, loc.shelf && `Shelf ${loc.shelf}`, loc.bin && `Bin ${loc.bin}`].filter(Boolean);
  return parts.length ? parts.join(" / ") : loc.label;
}
