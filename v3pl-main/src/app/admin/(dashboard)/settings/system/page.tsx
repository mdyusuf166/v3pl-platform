import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SystemStatusCard } from "@/components/settings/system-status";
import { requireRole } from "@/server/auth/guards";

export const metadata: Metadata = { title: "System" };

export default async function SystemSettingsPage() {
  await requireRole("ADMIN");
  return (
    <>
      <div>
        <Link href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Settings
        </Link>
      </div>
      <PageHeader title="System" description="Deployment health for this V3PL instance." />
      <div className="grid gap-4 md:grid-cols-2">
        <SystemStatusCard />
      </div>
    </>
  );
}
