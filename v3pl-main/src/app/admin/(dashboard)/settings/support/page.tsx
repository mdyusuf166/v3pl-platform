import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SupportSettingsForm } from "@/components/settings/support-settings-form";
import { requireRole } from "@/server/auth/guards";
import { getSupportSettings } from "@/server/services/support-settings";

export const metadata: Metadata = { title: "Support" };

export default async function SupportSettingsPage() {
  await requireRole("ADMIN");
  const settings = await getSupportSettings();
  return (
    <>
      <div>
        <Link href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Settings
        </Link>
      </div>
      <PageHeader title="Support" description="Where the floating Help button on partner and staff portals sends people." />
      <SupportSettingsForm initial={settings} />
    </>
  );
}
