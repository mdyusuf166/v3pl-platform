import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/common/native-select";
import { Pagination } from "@/components/common/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { CommissionsTable } from "@/components/affiliates/commissions-table";
import { EarningsTiles } from "@/components/affiliates/earnings-tiles";
import { COMMISSION_STATUS_LABELS } from "@/lib/validation/affiliates";
import { requireAffiliate } from "@/server/auth/guards";
import { affiliateEarnings, listCommissions } from "@/server/services/affiliates";

export const metadata: Metadata = { title: "My earnings" };

const STATUSES = ["ALL", "PENDING", "EARNED", "PAID", "CANCELLED"] as const;

export default async function AffiliateEarningsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAffiliate();
  const sp = await searchParams;
  const status = (STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status : "ALL") as (typeof STATUSES)[number];
  const page = Number(sp.page) || 1;
  const [earnings, commissions] = await Promise.all([affiliateEarnings(user.affiliateId), listCommissions({ affiliateId: user.affiliateId, status, page })]);
  const hrefFor = (p: number) => `/portal/affiliate/earnings?status=${status}${p > 1 ? `&page=${p}` : ""}`;
  return (
    <>
      <PageHeader title="My earnings" description="Commission per sale, with the rule that applied when the order was placed. Pending until the order ships, earned afterwards, paid when V3PL records the payment." />
      <EarningsTiles e={earnings} />
      <form method="get" className="flex items-center gap-2">
        <NativeSelect name="status" defaultValue={status} className="w-40" aria-label="Status">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All statuses" : COMMISSION_STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="secondary" size="sm">
          Apply
        </Button>
      </form>
      <CommissionsTable rows={commissions.items} orderHref={(oid) => `/portal/affiliate/orders/${oid}`} />
      <Pagination page={commissions.page} pageCount={commissions.pageCount} total={commissions.total} pageSize={commissions.pageSize} hrefFor={hrefFor} />
    </>
  );
}
