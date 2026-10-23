import type { Metadata } from "next";
import Link from "next/link";
import { BadgePercent, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { NativeSelect } from "@/components/common/native-select";
import { SearchFilterBar } from "@/components/common/search-filter-bar";
import { StatusBadge } from "@/components/common/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { formatInt } from "@/lib/format";
import { commissionRuleLabel as ruleLabel } from "@/lib/validation/affiliates";
import { requireRole } from "@/server/auth/guards";
import { listAffiliates } from "@/server/services/affiliates";

export const metadata: Metadata = { title: "Salesmen" };

export default async function AffiliatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const q = typeof sp.q === "string" && sp.q ? sp.q : undefined;
  const status = sp.status === "INACTIVE" || sp.status === "ALL" ? sp.status : "ACTIVE";
  const rows = await listAffiliates({ q, status });
  return (
    <>
      <PageHeader
        title="Salesmen"
        description="External sales partners. They sell only the products you assign and earn commissions kept separate from vendor / 3PL finance."
        actions={
          <Button render={<Link href="/admin/affiliates/new" />}>
            <Plus /> New salesman
          </Button>
        }
      />
      <SearchFilterBar q={q} placeholder="Search name, code or e-mail…">
        <NativeSelect name="status" defaultValue={status} aria-label="Status filter" className="w-36">
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="ALL">All</option>
        </NativeSelect>
      </SearchFilterBar>
      {rows.length === 0 ? (
        <EmptyState icon={BadgePercent} title={q || status !== "ACTIVE" ? "No salesmen match" : "No salesmen yet"} description="Create a salesman, assign vendors and SKUs, then add a sign-in user." />
      ) : (
        <div className="overflow-hidden rounded-lg border" data-slot="affiliates-list">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Salesman</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Default commission</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Products</TableHead>
                <TableHead className="text-right">Orders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link href={`/admin/affiliates/${a.id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {a.code}
                      {a.email ? ` · ${a.email}` : ""}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} />
                  </TableCell>
                  <TableCell className="text-sm">{ruleLabel(a.commissionType, a.commissionValue?.toString() ?? null) ?? <span className="text-muted-foreground">none</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(a._count.users)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(a._count.variants)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(a._count.orders)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
