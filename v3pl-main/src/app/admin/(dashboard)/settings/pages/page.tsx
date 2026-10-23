import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ContactSettingsForm } from "@/components/settings/contact-settings-form";
import { PublicPageForm } from "@/components/settings/public-page-form";
import { requireRole } from "@/server/auth/guards";
import { getContactSettings, getPublicPage } from "@/server/services/public-pages";

export const metadata: Metadata = { title: "Privacy page" };

export default async function PublicPagesSettingsPage() {
  await requireRole("ADMIN");
  const [page, contact] = await Promise.all([getPublicPage("privacy"), getContactSettings()]);
  return (
    <>
      <div>
        <Link href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Settings
        </Link>
      </div>
      <PageHeader title="Privacy page" description="The public Privacy page shown to visitors before they sign in, and the contact section at its foot. Saving publishes immediately." />
      <div className="grid gap-6">
        <PublicPageForm slug="privacy" initial={{ title: page.title, content: page.content }} customised={page.customised} />
        <ContactSettingsForm initial={contact} />
      </div>
    </>
  );
}
