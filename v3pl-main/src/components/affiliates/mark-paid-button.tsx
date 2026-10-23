"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { formatMoney } from "@/lib/format";
import { markCommissionsPaidAction } from "@/server/actions/affiliates";

/** Admin: mark every currently EARNED commission of this affiliate as PAID with a payment reference (D-070). */
export function MarkPaidButton({ affiliateId, earnedIds, earnedTotal, currency = "USD" }: { affiliateId: string; earnedIds: string[]; earnedTotal: number; currency?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  if (earnedIds.length === 0) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-slot="mark-paid">
        <BadgeCheck /> Mark {earnedIds.length} earned as paid ({formatMoney(earnedTotal, currency)})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record commission payment</DialogTitle>
            <DialogDescription>
              Marks {earnedIds.length} earned commission{earnedIds.length === 1 ? "" : "s"} totalling {formatMoney(earnedTotal, currency)} as paid. This is a record only — no money moves and nothing is written to vendor / 3PL finance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <FormField id="mp-ref" label="Payment reference">
              <Input id="mp-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. bank transfer id" disabled={pending} />
            </FormField>
            <FormField id="mp-notes" label="Notes">
              <Input id="mp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={pending} />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await markCommissionsPaidAction(affiliateId, { commissionIds: earnedIds, reference, notes });
                  if (!res.ok) toast.error(res.error);
                  else {
                    toast.success(`${res.data.count} commission${res.data.count === 1 ? "" : "s"} marked paid (${formatMoney(res.data.total, currency)})`);
                    setOpen(false);
                    router.refresh();
                  }
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />} Mark as paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
