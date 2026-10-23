import { Card, CardContent } from "@/components/ui/card";
import { formatInt, formatMoney } from "@/lib/format";
import type { affiliateEarnings } from "@/server/services/affiliates";

type Earnings = Awaited<ReturnType<typeof affiliateEarnings>>;

/** Total sales + commission by status. Shared by the admin affiliate page and the affiliate portal (D-070). */
export function EarningsTiles({ e, currency = "USD" }: { e: Earnings; currency?: string }) {
  const tiles = [
    { label: "Orders", value: formatInt(e.orders), sub: `${formatInt(e.openOrders)} open` },
    { label: "Total sales", value: formatMoney(e.sales, currency), sub: "non-cancelled lines" },
    { label: "Commission pending", value: formatMoney(e.pending, currency), sub: `${e.counts.pending} awaiting shipment`, slot: "pending" },
    { label: "Commission earned", value: formatMoney(e.earned, currency), sub: `${e.counts.earned} ready to pay`, slot: "earned" },
    { label: "Commission paid", value: formatMoney(e.paid, currency), sub: `${e.counts.paid} paid`, slot: "paid" },
    { label: "Outstanding", value: formatMoney(e.outstanding, currency), sub: "pending + earned", slot: "outstanding" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" data-slot="earnings-tiles">
      {tiles.map((t) => (
        <Card key={t.label} data-slot={t.slot ? `earnings-${t.slot}` : undefined}>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">{t.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
            <p className="text-xs text-muted-foreground">{t.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
