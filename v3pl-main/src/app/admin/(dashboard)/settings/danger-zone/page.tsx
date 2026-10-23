import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { DangerZone } from "@/components/settings/danger-zone";
import { requireRole } from "@/server/auth/guards";
import { PLATFORM_RESET_PHRASE, RESET_GROUPS } from "@/server/services/platform-reset";

export const metadata: Metadata = { title: "Danger Zone" };

export default async function DangerZonePage() {
  const admin = await requireRole("ADMIN");
  return (
    <>
      <div>
        <Link href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Settings
        </Link>
      </div>
      <PageHeader title="Danger Zone" description="Irreversible platform-wide actions. Admin only." />
      <DangerZone adminEmail={admin.email} phrase={PLATFORM_RESET_PHRASE} scope={RESET_GROUPS} />
    </>
  );
}
