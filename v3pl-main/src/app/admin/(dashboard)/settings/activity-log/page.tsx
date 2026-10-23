import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { NativeSelect } from "@/components/common/native-select";
import { Pagination } from "@/components/common/pagination";
import { SearchFilterBar } from "@/components/common/search-filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { ActivityLogTable } from "@/components/settings/activity-log-table";
import { requireRole } from "@/server/auth/guards";
import { auditEntityTypes, listAuditLog } from "@/server/services/audit";

export const metadata: Metadata = { title: "Activity Log" };

const BASE = "/admin/settings/activity-log";

/** Read-only view of the append-only audit log. ADMIN only; nothing here can edit or delete a record. */
export default async function ActivityLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim() || undefined;
  const entityType = one(sp.entityType) || undefined;
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const [result, types] = await Promise.all([listAuditLog({ q, entityType, page }), auditEntityTypes()]);

  const hrefFor = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (entityType) u.set("entityType", entityType);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return `${BASE}${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <div>
        <Link href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Settings
        </Link>
      </div>
      <PageHeader title="Activity Log" description="Who did what across V3PL, newest first. Read-only: entries are recorded by the platform and cannot be edited or removed." />
      <SearchFilterBar q={q} placeholder="Search action, user or record id…">
        <NativeSelect name="entityType" defaultValue={entityType ?? ""} aria-label="Area" className="w-48">
          <option value="">All areas</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
      </SearchFilterBar>
      <ActivityLogTable rows={result.items} />
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={hrefFor} />
    </>
  );
}
