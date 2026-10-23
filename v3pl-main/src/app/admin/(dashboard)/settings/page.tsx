import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Activity, ChevronRight, FileText, LifeBuoy, Receipt, ScrollText, Store } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { requireRole } from "@/server/auth/guards";
import { storeCounters } from "@/server/services/shopify/stores";
import { listChargeRules } from "@/server/services/charges";
import { getSupportSettings } from "@/server/services/support-settings";
import { SUPPORT_METHOD_LABELS, supportDestination } from "@/lib/validation/support";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireRole("ADMIN");
  const shopify = await storeCounters().catch(() => ({ total: 0, connected: 0, attention: 0 }));
  const rules = await listChargeRules();
  const support = await getSupportSettings();
  const activeRules = rules.filter((r) => r.active).length;

  return (
    <>
      <PageHeader title="Settings" description="Platform configuration and connected sales channels." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/admin/settings/shopify" className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <Card className="h-full transition-[transform,box-shadow,--tw-ring-color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:shadow-sm group-hover:ring-primary/40 group-focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
            <CardContent className="flex items-start gap-4 pt-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Store className="size-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">Shopify Stores</p>
                <p className="text-sm text-muted-foreground">
                  {shopify.total === 0
                    ? "Connect the first store"
                    : `${shopify.connected} of ${shopify.total} connected${shopify.attention ? ` · ${shopify.attention} need attention` : ""}`}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/settings/charges" className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <Card className="h-full transition-[transform,box-shadow,--tw-ring-color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:shadow-sm group-hover:ring-primary/40 group-focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
            <CardContent className="flex items-start gap-4 pt-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Receipt className="size-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">Operational Charges</p>
                <p className="text-sm text-muted-foreground">{rules.length === 0 ? "Define picking, packing, shipping and other charge rules" : `${activeRules} active of ${rules.length} rule${rules.length === 1 ? "" : "s"}`}</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/settings/system" className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <Card className="h-full transition-[transform,box-shadow,--tw-ring-color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:shadow-sm group-hover:ring-primary/40 group-focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
            <CardContent className="flex items-start gap-4 pt-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Activity className="size-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">System</p>
                <p className="text-sm text-muted-foreground">Database, authentication and runtime status</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/settings/support" className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <Card className="h-full transition-[transform,box-shadow,--tw-ring-color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:shadow-sm group-hover:ring-primary/40 group-focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
            <CardContent className="flex items-start gap-4 pt-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <LifeBuoy className="size-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">Support</p>
                <p className="text-sm text-muted-foreground">{support.enabled && supportDestination(support) ? `${SUPPORT_METHOD_LABELS[support.method]} · shown on partner and staff portals` : "Help button hidden — configure e-mail or WhatsApp"}</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/settings/pages" className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <Card className="h-full transition-[transform,box-shadow,--tw-ring-color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:shadow-sm group-hover:ring-primary/40 group-focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
            <CardContent className="flex items-start gap-4 pt-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="size-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">Privacy page</p>
                <p className="text-sm text-muted-foreground">Public Privacy text and contact section shown before sign-in</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/settings/activity-log" className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <Card className="h-full transition-[transform,box-shadow,--tw-ring-color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:shadow-sm group-hover:ring-primary/40 group-focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
            <CardContent className="flex items-start gap-4 pt-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ScrollText className="size-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">Activity Log</p>
                <p className="text-sm text-muted-foreground">Who did what across V3PL, newest first</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/settings/danger-zone" className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          <Card className="h-full ring-destructive/30 transition-[transform,box-shadow,--tw-ring-color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:shadow-sm group-hover:ring-destructive/60 group-focus-visible:ring-destructive/60 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
            <CardContent className="flex items-start gap-4 pt-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <AlertTriangle className="size-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">Danger Zone</p>
                <p className="text-sm text-muted-foreground">Hard reset: remove all business and test data</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </>
  );
}
