"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormField } from "@/components/common/form-field";
import { VariantPicker, type PickedVariant } from "@/components/inventory/variant-picker";
import { NativeSelect } from "@/components/common/native-select";
import { formatMoney } from "@/lib/format";
import { COMMISSION_TYPE_LABELS, VARIANT_COMMISSION_TYPES, assignVariantSchema, commissionRuleLabel, type AssignVariantInput, type AssignVariantValues } from "@/lib/validation/affiliates";
import { assignVariantAction, setAffiliateOwnersAction, unassignVariantAction } from "@/server/actions/affiliates";

export type OwnerOption = { id: string; code: string; businessName: string; type: "VENDOR" | "THREEPL_CLIENT" };
export type AssignedVariantRow = { variantId: string; sku: string; name: string | null; price: string; currency: string; productId: string; productName: string; ownerName: string; commissionType: string | null; commissionValue: string | null; archived: boolean };

type Props = { affiliateId: string; owners: OwnerOption[]; assignedOwnerIds: string[]; variants: AssignedVariantRow[]; defaultRule: string };

const ruleLabel = commissionRuleLabel;

/** Admin: assigned vendors / 3PL clients (checkboxes) and explicitly assigned SKUs with optional product rules (D-070). */
export function AffiliateAssignments({ affiliateId, owners, assignedOwnerIds, variants, defaultRule }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set(assignedOwnerIds));
  const dirty = selected.size !== assignedOwnerIds.length || assignedOwnerIds.some((id) => !selected.has(id));
  const form = useForm<AssignVariantInput, unknown, AssignVariantValues>({ resolver: zodResolver(assignVariantSchema), defaultValues: { sku: "", commissionType: "", commissionValue: "" } });
  const { errors } = form.formState;
  const type = form.watch("commissionType");
  const [pickedVariant, setPickedVariant] = useState<PickedVariant | null>(null);

  function saveOwners() {
    startTransition(async () => {
      const res = await setAffiliateOwnersAction(affiliateId, { ownerIds: [...selected] });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Assigned vendors / 3PL clients saved");
      router.refresh();
    });
  }

  function addSku() {
    const values = form.getValues();
    startTransition(async () => {
      const res = await assignVariantAction(affiliateId, values);
      if (!res.ok) {
        for (const [f, m] of Object.entries(res.fieldErrors ?? {})) form.setError(f as keyof AssignVariantInput, { message: m });
        if (!res.fieldErrors) toast.error(res.error);
        return;
      }
      toast.success(`SKU ${String(values.sku).toUpperCase()} assigned`);
      form.reset({ sku: "", commissionType: "", commissionValue: "" });
      setPickedVariant(null);
      router.refresh();
    });
  }

  function remove(v: AssignedVariantRow) {
    if (!window.confirm(`Unassign ${v.sku}? Existing orders and commissions are kept; the salesman can no longer sell it.`)) return;
    startTransition(async () => {
      const res = await unassignVariantAction(affiliateId, v.variantId);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`${v.sku} unassigned`);
        router.refresh();
      }
    });
  }

  const vendors = owners.filter((o) => o.type === "VENDOR");
  const clients = owners.filter((o) => o.type === "THREEPL_CLIENT");
  const group = (title: string, list: OwnerOption[]) =>
    list.length > 0 && (
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {list.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border"
                disabled={pending}
                checked={selected.has(o.id)}
                onChange={(e) =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(o.id);
                    else n.delete(o.id);
                    return n;
                  })
                }
              />
              {o.businessName} <span className="text-muted-foreground">· {o.code}</span>
            </label>
          ))}
        </div>
      </div>
    );

  return (
    <div className="grid gap-6 lg:grid-cols-3" data-slot="affiliate-assignments">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assigned vendors &amp; 3PL clients</CardTitle>
          <CardDescription>Only products of these businesses can be assigned below. Assigning a business does not expose its whole catalogue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {owners.length === 0 && <p className="text-sm text-muted-foreground">No active vendors or 3PL clients yet.</p>}
          {group("Vendors", vendors)}
          {group("3PL clients", clients)}
          <Button size="sm" onClick={saveOwners} disabled={pending || !dirty}>
            {pending && <Loader2 className="animate-spin" />} Save assignments
          </Button>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Assigned products ({variants.length})</CardTitle>
          <CardDescription>The salesman can sell exactly these SKUs. Default rule: {defaultRule}. A product rule overrides it for that SKU.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            onSubmit={form.handleSubmit(addSku)}
            noValidate
            className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
            data-slot="assign-sku-form"
          >
            <FormField id="as-sku" label="Product / SKU" error={errors.sku?.message}>
              <input type="hidden" {...form.register("sku")} />
              <VariantPicker
                id="as-sku"
                value={pickedVariant}
                disabled={pending}
                invalid={!!errors.sku}
                onChange={(v) => {
                  setPickedVariant(v);
                  form.setValue("sku", v?.sku ?? "", { shouldDirty: true });
                  if (v) form.clearErrors("sku");
                }}
              />
            </FormField>
            <FormField id="as-type" label="Product rule (optional)" error={errors.commissionType?.message}>
              <NativeSelect id="as-type" {...form.register("commissionType")} disabled={pending}>
                <option value="">Use default rule</option>
                {VARIANT_COMMISSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {COMMISSION_TYPE_LABELS[t].label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="as-value" label="Value" error={errors.commissionValue?.message}>
              <Input id="as-value" {...form.register("commissionValue")} inputMode="decimal" placeholder={type === "PERCENTAGE_OF_SALE" ? "10" : "3.00"} disabled={pending || !type} />
            </FormField>
            <Button type="submit" disabled={pending}>
              <Plus /> Assign
            </Button>
          </form>
          {variants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products assigned yet — the salesman cannot sell anything until you add SKUs.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="hidden md:table-cell">Owner</TableHead>
                    <TableHead className="text-right">Retail</TableHead>
                    <TableHead>Commission</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variants.map((v) => (
                    <TableRow key={v.variantId} className={v.archived ? "opacity-60" : ""}>
                      <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                      <TableCell>
                        <Link href={`/admin/products/${v.productId}`} className="hover:underline">
                          {v.productName}
                        </Link>
                        {v.name && <div className="text-xs text-muted-foreground">{v.name}</div>}
                        {v.archived && <Badge variant="outline" className="ml-1">archived</Badge>}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{v.ownerName}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(v.price, v.currency)}</TableCell>
                      <TableCell className="text-sm">{ruleLabel(v.commissionType, v.commissionValue, v.currency) ?? <span className="text-muted-foreground">default</span>}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon-sm" aria-label={`Unassign ${v.sku}`} disabled={pending} onClick={() => remove(v)}>
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
