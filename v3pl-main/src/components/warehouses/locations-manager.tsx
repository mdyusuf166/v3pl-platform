"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronRight, Loader2, MoreHorizontal, Pencil, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormField } from "@/components/common/form-field";
import { formatInt } from "@/lib/format";
import { NODE_CHILD, NODE_LABEL, locationFormSchema, locationNodeSchema, locationPath, type LocationFormInput, type LocationNodeInput, type NodeType } from "@/lib/validation/warehouses";
import { createLocationAction, createLocationNodeAction, deleteLocationAction, setDefaultLocationAction, setLocationActiveAction, updateLocationAction, updateLocationNodeAction } from "@/server/actions/warehouses";

export type LocationRow = { id: string; label: string; type: "AREA" | NodeType; parentId: string | null; zone: string | null; rack: string | null; shelf: string | null; bin: string | null; isDefault: boolean; isActive: boolean; notes: string | null };

type Props = {
  warehouseId: string;
  warehouseName: string;
  locations: LocationRow[];
  /** Units on hand per location id (storage rows only; containers roll up here). */
  stock: Record<string, number>;
  canEdit: boolean;
  /** Hierarchy nodes and deletes are ADMIN-only. */
  isAdmin: boolean;
  warehouseActive: boolean;
  /** Per location: reasons it cannot be hard-deleted (D-054). */
  locationBlockers?: Record<string, string[]>;
};

const EMPTY_AREA: LocationFormInput = { label: "", zone: "", rack: "", shelf: "", bin: "", notes: "" };
const STORAGE = new Set(["AREA", "BIN"]);

type NodeDialog = { mode: "new"; type: NodeType; parent: LocationRow | null } | { mode: "edit"; row: LocationRow };

/** Warehouse → Zone → Rack → Shelf → Bin tree (D-069) plus legacy flat areas; stock is only ever placed at bins / areas. */
export function LocationsManager({ warehouseId, warehouseName, locations, stock, canEdit, isAdmin, warehouseActive, locationBlockers = {} }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [areaDialog, setAreaDialog] = useState<LocationRow | null | "new">(null);
  const [nodeDialog, setNodeDialog] = useState<NodeDialog | null>(null);

  const areaForm = useForm<LocationFormInput>({ resolver: zodResolver(locationFormSchema), defaultValues: EMPTY_AREA });
  const nodeForm = useForm<LocationNodeInput>({ resolver: zodResolver(locationNodeSchema), defaultValues: { type: "ZONE", parentId: null, code: "", notes: "" } });

  const { childrenOf, rollup } = useMemo(() => {
    const childrenOf = new Map<string | null, LocationRow[]>();
    for (const l of locations) {
      const key = l.type === "AREA" ? "AREA" : l.parentId;
      const list = childrenOf.get(key) ?? [];
      list.push(l);
      childrenOf.set(key, list);
    }
    for (const list of childrenOf.values()) list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    const rollup = new Map<string, { units: number; storage: number }>();
    const sum = (l: LocationRow): { units: number; storage: number } => {
      const kids = childrenOf.get(l.id) ?? [];
      const acc = { units: stock[l.id] ?? 0, storage: STORAGE.has(l.type) ? 1 : 0 };
      for (const k of kids) {
        const s = sum(k);
        acc.units += s.units;
        acc.storage += s.storage;
      }
      rollup.set(l.id, acc);
      return acc;
    };
    for (const l of locations) if (l.type === "ZONE" || l.type === "AREA") sum(l);
    return { childrenOf, rollup };
  }, [locations, stock]);

  const zones = childrenOf.get(null) ?? [];
  const areas = childrenOf.get("AREA") ?? [];

  function toggle(id: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Failed");
      else {
        toast.success(success);
        router.refresh();
      }
    });
  }

  // ---- flat area dialog (legacy locations)
  function openArea(row: LocationRow | "new") {
    areaForm.reset(row === "new" ? EMPTY_AREA : { label: row.label, zone: row.zone ?? "", rack: row.rack ?? "", shelf: row.shelf ?? "", bin: row.bin ?? "", notes: row.notes ?? "" });
    setAreaDialog(row);
  }
  function onAreaSubmit(values: LocationFormInput) {
    startTransition(async () => {
      const res = areaDialog === "new" ? await createLocationAction(warehouseId, values) : await updateLocationAction((areaDialog as LocationRow).id, warehouseId, values);
      if (!res.ok) {
        for (const [field, message] of Object.entries(res.fieldErrors ?? {})) areaForm.setError(field as keyof LocationFormInput, { message });
        if (!res.fieldErrors) toast.error(res.error);
        return;
      }
      toast.success(areaDialog === "new" ? "Area added" : "Area updated");
      setAreaDialog(null);
      router.refresh();
    });
  }

  // ---- hierarchy node dialog
  function openNode(d: NodeDialog) {
    if (d.mode === "new") nodeForm.reset({ type: d.type, parentId: d.parent?.id ?? null, code: "", notes: "" });
    else nodeForm.reset({ type: d.row.type as NodeType, parentId: d.row.parentId, code: ownCode(d.row), notes: d.row.notes ?? "" });
    setNodeDialog(d);
  }
  function onNodeSubmit(values: LocationNodeInput) {
    if (!nodeDialog) return;
    startTransition(async () => {
      const res = nodeDialog.mode === "new" ? await createLocationNodeAction(warehouseId, values) : await updateLocationNodeAction(nodeDialog.row.id, warehouseId, values);
      if (!res.ok) {
        for (const [field, message] of Object.entries(res.fieldErrors ?? {})) nodeForm.setError(field as keyof LocationNodeInput, { message });
        if (!res.fieldErrors) toast.error(res.error);
        else if (res.fieldErrors.parentId) toast.error(res.fieldErrors.parentId);
        return;
      }
      toast.success(nodeDialog.mode === "new" ? `${NODE_LABEL[values.type as NodeType]} added` : "Location updated");
      setNodeDialog(null);
      router.refresh();
    });
  }

  const areaErrors = areaForm.formState.errors;
  const nodeErrors = nodeForm.formState.errors;
  const regArea = (name: keyof LocationFormInput) => ({ id: `loc-${name}`, "aria-invalid": !!areaErrors[name], disabled: pending, ...areaForm.register(name) });
  const dialogType = nodeDialog?.mode === "new" ? nodeDialog.type : nodeDialog?.mode === "edit" ? (nodeDialog.row.type as NodeType) : "ZONE";
  const dialogParent = nodeDialog?.mode === "new" ? nodeDialog.parent : nodeDialog?.mode === "edit" ? locations.find((l) => l.id === nodeDialog.row.parentId) ?? null : null;

  function renderRow(l: LocationRow, depth: number): React.ReactNode {
    const kids = childrenOf.get(l.id) ?? [];
    const open = !collapsed.has(l.id);
    const agg = rollup.get(l.id) ?? { units: stock[l.id] ?? 0, storage: 1 };
    const childType = l.type === "AREA" ? null : NODE_CHILD[l.type];
    const blockers = locationBlockers[l.id] ?? [];
    return (
      <>
        <TableRow key={l.id} className={l.isActive ? "" : "opacity-60"} data-location-type={l.type} data-depth={depth}>
          <TableCell>
            <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 1.25}rem` }}>
              {kids.length > 0 ? (
                <button type="button" onClick={() => toggle(l.id)} className="rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label={open ? "Collapse" : "Expand"}>
                  {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
              ) : (
                <span className="inline-block size-5" />
              )}
              <Badge variant="outline" className="w-12 justify-center text-[10px] uppercase">
                {NODE_LABEL[l.type]}
              </Badge>
              <span className="font-medium">{l.type === "AREA" ? l.label : ownCode(l)}</span>
              {l.isDefault && (
                <Badge variant="secondary" className="ml-1 gap-1">
                  <Star className="size-3" /> default
                </Badge>
              )}
            </div>
          </TableCell>
          <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell" title={`${warehouseName} / ${locationPath(l)}`}>
            {l.label}
          </TableCell>
          <TableCell className="hidden text-right tabular-nums lg:table-cell">
            {kids.length > 0 ? (
              <span className="text-muted-foreground">
                {kids.length} {childType ? `${NODE_LABEL[childType].toLowerCase()}${kids.length === 1 ? "" : "s"}` : ""}
                {agg.storage !== kids.length ? ` · ${agg.storage} bin${agg.storage === 1 ? "" : "s"}` : ""}
              </span>
            ) : STORAGE.has(l.type) ? (
              <span className="text-muted-foreground">storage</span>
            ) : (
              <span className="text-amber-700">empty</span>
            )}
          </TableCell>
          <TableCell className="text-right tabular-nums">{agg.units ? formatInt(agg.units) : <span className="text-muted-foreground">—</span>}</TableCell>
          <TableCell>
            <Badge variant="outline">{l.isActive ? "Active" : "Inactive"}</Badge>
          </TableCell>
          {canEdit && (
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${l.label}`} />}>
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {isAdmin && childType && l.isActive && warehouseActive && (
                    <DropdownMenuItem onClick={() => openNode({ mode: "new", type: childType, parent: l })}>
                      <Plus /> Add {NODE_LABEL[childType].toLowerCase()}
                    </DropdownMenuItem>
                  )}
                  {(l.type === "AREA" || isAdmin) && (
                    <DropdownMenuItem onClick={() => (l.type === "AREA" ? openArea(l) : openNode({ mode: "edit", row: l }))}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                  )}
                  {!l.isDefault && l.isActive && STORAGE.has(l.type) && (
                    <DropdownMenuItem onClick={() => run(() => setDefaultLocationAction(l.id, warehouseId), `${l.label} is now the default`)}>
                      <Star /> Make default
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {l.isActive ? (
                    <DropdownMenuItem disabled={l.isDefault} variant="destructive" onClick={() => run(() => setLocationActiveAction(l.id, warehouseId, false), `${l.label} deactivated`)}>
                      Deactivate{kids.length ? " (with contents)" : ""}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => run(() => setLocationActiveAction(l.id, warehouseId, true), `${l.label} reactivated`)}>Reactivate</DropdownMenuItem>
                  )}
                  {isAdmin && (
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={l.isDefault}
                      onClick={() => {
                        if (blockers.length) {
                          toast.error(`${l.label} cannot be deleted: ${blockers.join("; ")}.`);
                          return;
                        }
                        if (window.confirm(`Delete ${NODE_LABEL[l.type].toLowerCase()} ${l.label}? Nothing references it, so no history is lost.`)) run(() => deleteLocationAction(l.id, warehouseId), `${l.label} deleted`);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          )}
        </TableRow>
        {open && kids.map((k) => renderRow(k, depth + 1))}
      </>
    );
  }

  return (
    <div className="space-y-3" data-slot="locations-manager">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Locations</h2>
          <p className="text-sm text-muted-foreground">
            {warehouseName} → zone → rack → shelf → bin. Stock is only ever placed at a bin or a flat area; MAIN is the fallback.
          </p>
        </div>
        {canEdit && warehouseActive && (
          <div className="flex gap-2">
            {isAdmin && (
              <Button onClick={() => openNode({ mode: "new", type: "ZONE", parent: null })}>
                <Plus /> Add zone
              </Button>
            )}
            <Button variant="outline" onClick={() => openArea("new")}>
              <Plus /> Add flat area
            </Button>
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead className="hidden md:table-cell">Label / path</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Contains</TableHead>
              <TableHead className="text-right">Units on hand</TableHead>
              <TableHead>Status</TableHead>
              {canEdit && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {zones.length === 0 && (
              <TableRow>
                <TableCell colSpan={canEdit ? 6 : 5} className="text-sm text-muted-foreground">
                  No zones yet. {isAdmin && warehouseActive ? "Add a zone, then racks, shelves and bins inside it." : ""}
                </TableCell>
              </TableRow>
            )}
            {zones.map((z) => renderRow(z, 0))}
            {areas.length > 0 && (
              <TableRow className="bg-muted/40">
                <TableCell colSpan={canEdit ? 6 : 5} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Flat areas (no hierarchy)
                </TableCell>
              </TableRow>
            )}
            {areas.map((a) => renderRow(a, 0))}
          </TableBody>
        </Table>
      </div>

      {/* Hierarchy node: parent is fixed by where the user clicked, shown read-only. */}
      <Dialog open={nodeDialog !== null} onOpenChange={(o) => !o && setNodeDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={nodeForm.handleSubmit(onNodeSubmit)} noValidate className="space-y-4" data-slot="location-node-form">
            <DialogHeader>
              <DialogTitle>
                {nodeDialog?.mode === "edit" ? `Edit ${NODE_LABEL[dialogType].toLowerCase()}` : `Add ${NODE_LABEL[dialogType].toLowerCase()}`}
              </DialogTitle>
              <DialogDescription>
                Under: <span className="font-medium text-foreground">{warehouseName}{dialogParent ? ` / ${locationPath(dialogParent)}` : ""}</span>
                {nodeDialog?.mode === "edit" ? " — renaming the code updates the labels of everything inside it; the parent never changes." : ""}
              </DialogDescription>
            </DialogHeader>
            <input type="hidden" {...nodeForm.register("type")} />
            <input type="hidden" {...nodeForm.register("parentId")} />
            <FormField id="node-code" label={`${NODE_LABEL[dialogType]} code`} error={nodeErrors.code?.message ?? nodeErrors.parentId?.message}>
              <Input id="node-code" {...nodeForm.register("code")} placeholder={{ ZONE: "A", RACK: "01", SHELF: "01", BIN: "A01" }[dialogType]} className="uppercase" disabled={pending} aria-invalid={!!nodeErrors.code} autoFocus />
            </FormField>
            <FormField id="node-notes" label="Notes" error={nodeErrors.notes?.message}>
              <Input id="node-notes" {...nodeForm.register("notes")} disabled={pending} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setNodeDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {nodeDialog?.mode === "edit" ? "Save" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Legacy flat area (label built from free-text parts). */}
      <Dialog open={areaDialog !== null} onOpenChange={(o) => !o && setAreaDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={areaForm.handleSubmit(onAreaSubmit)} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle>{areaDialog === "new" ? "Add flat area" : "Edit flat area"}</DialogTitle>
              <DialogDescription>A storage location outside the zone / rack / shelf / bin tree. Fill in the parts you use; the label is built from them unless you set it explicitly.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-4">
              <FormField id="loc-zone" label="Zone" error={areaErrors.zone?.message}>
                <Input {...regArea("zone")} placeholder="A" />
              </FormField>
              <FormField id="loc-rack" label="Rack" error={areaErrors.rack?.message}>
                <Input {...regArea("rack")} placeholder="01" />
              </FormField>
              <FormField id="loc-shelf" label="Shelf" error={areaErrors.shelf?.message}>
                <Input {...regArea("shelf")} placeholder="3" />
              </FormField>
              <FormField id="loc-bin" label="Bin" error={areaErrors.bin?.message}>
                <Input {...regArea("bin")} placeholder="B2" />
              </FormField>
              <FormField id="loc-label" label="Label (optional override)" error={areaErrors.label?.message} className="sm:col-span-2">
                <Input {...regArea("label")} placeholder="A-01-3-B2" className="uppercase" />
              </FormField>
              <FormField id="loc-notes" label="Notes" error={areaErrors.notes?.message} className="sm:col-span-2">
                <Input {...regArea("notes")} />
              </FormField>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setAreaDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {areaDialog === "new" ? "Add" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ownCode(l: LocationRow) {
  return (l.type === "ZONE" ? l.zone : l.type === "RACK" ? l.rack : l.type === "SHELF" ? l.shelf : l.type === "BIN" ? l.bin : l.label) ?? l.label;
}
