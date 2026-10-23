import type { Metadata } from "next";
import { Package } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { Pagination } from "@/components/common/pagination";
import { SearchFilterBar } from "@/components/common/search-filter-bar";
import { PageHeader } from "@/components/layout/page-header";
import { formatInt, formatMoney } from "@/lib/format";
import { commissionRuleLabel as ruleLabel } from "@/lib/validation/affiliates";
import { requireAffiliate } from "@/server/auth/guards";
import { listAssignedProducts } from "@/server/services/affiliates";

export const metadata: Metadata = { title: "My products" };

export default async function AffiliateProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAffiliate();
  const sp = await searchParams;
  const q = typeof sp.q === "string" && sp.q ? sp.q : undefined;
  const page = Number(sp.page) || 1;
  const result = await listAssignedProducts(user.affiliateId, { q, page });
  const hrefFor = (p: number) => `/portal/affiliate/products${q ? `?q=${encodeURIComponent(q)}${p > 1 ? `&page=${p}` : ""}` : p > 1 ? `?page=${p}` : ""}`;
  return (
    <>
      <PageHeader title="My products" description="The products you are allowed to sell, their current retail price, available stock and the commission you earn on each." />
      <SearchFilterBar q={q} placeholder="Search SKU or product…" />
      {result.items.length === 0 ? (
        <EmptyState icon={Package} title={q ? "No products match" : "No products assigned yet"} description={q ? "Try a different search." : "The V3PL team assigns the products you can sell."} />
      ) : (
        <div className="overflow-x-auto rounded-lg border" data-slot="affiliate-products">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="hidden md:table-cell">Vendor / client</TableHead>
                <TableHead className="text-right">Retail price</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Your commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                  <TableCell>
                    {v.product.name}
                    {v.name && <div className="text-xs text-muted-foreground">{v.name}</div>}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{v.product.owner.businessName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(v.price, v.currency)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${v.available <= 0 ? "text-amber-700" : ""}`}>{formatInt(v.available)}</TableCell>
                  <TableCell className="text-sm">{v.rule ? ruleLabel(v.rule.type, v.rule.value, v.currency) : <span className="text-muted-foreground">none</span>}</TableCell>
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
