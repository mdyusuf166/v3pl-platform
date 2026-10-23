import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AffiliateForm } from "@/components/affiliates/affiliate-form";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/server/auth/guards";

export const metadata: Metadata = { title: "New salesman" };

export default async function NewAffiliatePage() {
  await requireRole("ADMIN");
  return (
    <>
      <div>
        <Link href="/admin/affiliates" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Salesmen
        </Link>
      </div>
      <PageHeader title="New salesman" description="Create the partner first; assign vendors / SKUs and add their sign-in user on the next screen." />
      <AffiliateForm mode="create" />
    </>
  );
}
