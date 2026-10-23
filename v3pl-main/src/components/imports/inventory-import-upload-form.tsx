"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/common/native-select";
import { previewInventoryImportAction } from "@/server/actions/imports";

type Warehouse = { id: string; code: string; name: string };
type Owner = { id: string; code: string; businessName: string };

/** Stock CSV → one receipt via the existing receiving flow (INV-IMP): upload, preview, confirm. ADMIN / WAREHOUSE. */
export function InventoryImportUploadForm({ warehouses, owners }: { warehouses: Warehouse[]; owners: Owner[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await previewInventoryImportAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("File read — review the preview");
      router.push(`/admin/imports/${res.data.jobId}`);
    });
  }

  return (
    <Card id="inventory">
      <CardHeader>
        <CardTitle>Import stock from CSV</CardTitle>
        <CardDescription>
          Columns: <code>SKU</code>, <code>Quantity</code> (required); <code>Location</code>, <code>Barcode</code> (optional). Exact SKU match only; a blank SKU may match by barcode. Every SKU must belong to the chosen owner. A blank Location receives into the warehouse&apos;s default location; otherwise it must be an active bin or area in that warehouse. Up to 500 rows. The whole file is booked as one receipt — nothing is imported if any row fails.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="inventory-file">CSV file</Label>
            <Input id="inventory-file" name="file" type="file" accept=".csv,text/csv" required disabled={pending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-ownerId">Owner of the stock</Label>
            <NativeSelect id="inv-ownerId" name="ownerId" required disabled={pending} defaultValue={owners.length === 1 ? owners[0].id : ""}>
              <option value="">Choose a vendor / 3PL client</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.businessName} ({o.code})
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-warehouseId">Receive into warehouse</Label>
            <NativeSelect id="inv-warehouseId" name="warehouseId" required disabled={pending} defaultValue={warehouses.length === 1 ? warehouses[0].id : ""}>
              <option value="">Choose a warehouse</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="inv-reference">Receipt reference (optional)</Label>
            <Input id="inv-reference" name="reference" maxLength={80} placeholder="e.g. Opening stock 2026-09" disabled={pending} />
          </div>
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Upload />}
              {pending ? "Reading file…" : "Upload and preview"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
