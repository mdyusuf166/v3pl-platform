import type { Metadata } from "next";
import { Contact } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { Pagination } from "@/components/common/pagination";
import { SearchFilterBar } from "@/components/common/search-filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { formatDate, formatInt } from "@/lib/format";
import { requireAffiliate } from "@/server/auth/guards";
import { affiliateCustomers } from "@/server/services/affiliates";

export const metadata: Metadata = { title: "My customers" };

export default async function AffiliateCustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAffiliate();
  const sp = await searchParams;
  const q = typeof sp.q === "string" && sp.q ? sp.q : undefined;
  const page = Number(sp.page) || 1;
  const result = await affiliateCustomers(user.affiliateId, { q, page });
  const hrefFor = (p: number) => `/portal/affiliate/customers${q ? `?q=${encodeURIComponent(q)}${p > 1 ? `&page=${p}` : ""}` : p > 1 ? `?page=${p}` : ""}`;
  return (
    <>
      <PageHeader title="My customers" description="Customers you saved from your sales or sold to." />
      <SearchFilterBar q={q} placeholder="Search name, e-mail or phone…" />
      {result.items.length === 0 ? (
        <EmptyState icon={Contact} title={q ? "No customers match" : "No customers yet"} description="Tick “Save as new customer” on a sale to build your customer list." />
      ) : (
        <div className="overflow-x-auto rounded-lg border" data-slot="affiliate-customers">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="hidden md:table-cell">Location</TableHead>
                <TableHead className="text-right">Your orders</TableHead>
                <TableHead className="hidden lg:table-cell">Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{[c.shipCity, c.shipCountry].filter(Boolean).join(", ") || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(c._count.orders)}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(c.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={hrefFor} />
    </>
  );
}
