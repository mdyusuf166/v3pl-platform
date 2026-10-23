"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmImportAction, discardImportAction } from "@/server/actions/imports";

/** Confirm / discard a previewed import. `noun` is "order" or "product". */
export function ImportConfirm({ jobId, validCount, noun = "order", label }: { jobId: string; validCount: number; noun?: "order" | "product" | "line"; /** Overrides the button text (e.g. "Book receipt of 120 units"). */ label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await discardImportAction(jobId);
            if (!res.ok) toast.error(res.error);
            else {
              toast.success("Import discarded");
              router.push("/admin/imports");
            }
          })
        }
      >
        Discard
      </Button>
      <Button
        disabled={pending || validCount === 0}
        onClick={() =>
          startTransition(async () => {
            const res = await confirmImportAction(jobId);
            if (!res.ok) toast.error(res.error);
            else {
              const parts = [noun === "line" ? `Receipt booked: ${res.data.created} line(s)` : `${res.data.created} ${noun}(s) created`];
              if (res.data.updated) parts.push(`${res.data.updated} updated`);
              if (res.data.failed) parts.push(`${res.data.failed} failed`);
              if (res.data.duplicates) parts.push(`${res.data.duplicates} duplicate(s) skipped`);
              toast.success(parts.join(", "));
              router.refresh();
            }
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />}
        {label ?? `Import ${validCount} ${noun}${validCount === 1 ? "" : "s"}`}
      </Button>
    </div>
  );
}
