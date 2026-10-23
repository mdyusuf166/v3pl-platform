import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AffiliateForm } from "@/components/affiliates/affiliate-form";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/server/auth/guards";
import { getAffiliate } from "@/server/services/affiliates";

export const metadata: Metadata = { title: "Edit salesman" };

export default async function EditAffiliatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  const a = await getAffiliate(id);
  if (!a) notFound();
  return (
    <>
      <div>
        <Link href={`/admin/affiliates/${a.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> {a.name}
        </Link>
      </div>
      <PageHeader title={`Edit ${a.name}`} description="Changing the default commission affects new orders only; recorded commissions keep their snapshot." />
      <AffiliateForm mode="edit" id={a.id} initial={{ code: a.code, name: a.name, email: a.email ?? "", phone: a.phone ?? "", status: a.status, commissionType: a.commissionType ?? "", commissionValue: a.commissionValue?.toString() ?? "", notes: a.notes ?? "" }} />
    </>
  );
}
