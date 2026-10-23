import Link from "next/link";
import { Coins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { formatDateTime, formatMoney } from "@/lib/format";
import { COMMISSION_STATUS_LABELS, COMMISSION_TYPE_LABELS } from "@/lib/validation/affiliates";
import type { listCommissions } from "@/server/services/affiliates";

type Rows = Awaited<ReturnType<typeof listCommissions>>["items"];

const TONE: Record<string, string> = { PENDING: "border-amber-300 text-amber-800", EARNED: "border-emerald-300 text-emerald-800", PAID: "border-sky-300 text-sky-800", CANCELLED: "text-muted-foreground" };

/** Immutable commission snapshots (D-070): the rule and amount never change after the order; only status does. */
export function CommissionsTable({ rows, orderHref, showAffiliate = false }: { rows: Rows; orderHref: (orderId: string) => string; showAffiliate?: boolean }) {
  if (rows.length === 0) return <EmptyState icon={Coins} title="No commissions yet" description="Commissions are recorded when a salesman order is placed and become earned when it ships." />;
  return (
    <div className="overflow-x-auto rounded-lg border" data-slot="commissions-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            {showAffiliate && <TableHead>Salesman</TableHead>}
            <TableHead>Line</TableHead>
            <TableHead>Rule (snapshot)</TableHead>
            <TableHead className="text-right">Base</TableHead>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden lg:table-cell">Paid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id} data-commission-status={c.status}>
              <TableCell>
                <Link href={orderHref(c.order.id)} className="font-medium hover:underline">
                  {c.order.orderNumber}
                </Link>
                <div className="text-xs text-muted-foreground">{formatDateTime(c.order.placedAt)}</div>
              </TableCell>
              {showAffiliate && <TableCell>{c.affiliate.name}</TableCell>}
              <TableCell className="font-mono text-xs">{c.orderItem ? `${c.orderItem.sku}${c.quantity !== null ? ` × ${c.quantity}` : ""}` : <span className="font-sans text-muted-foreground">whole order</span>}</TableCell>
              <TableCell className="text-sm">
                {c.type === "PERCENTAGE_OF_SALE" ? `${Number(c.rateValue)}%` : `${formatMoney(c.rateValue, c.currency)} ${c.type === "FIXED_PER_UNIT" ? "/ unit" : "/ order"}`}
                <div className="text-xs text-muted-foreground">
                  {COMMISSION_TYPE_LABELS[c.type].label}
                  {c.ruleSource === "VARIANT" ? " · product rule" : ""}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{c.baseAmount !== null ? formatMoney(c.baseAmount, c.currency) : "—"}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatMoney(c.amount, c.currency)}</TableCell>
              <TableCell>
                <Badge variant="outline" className={TONE[c.status]}>
                  {COMMISSION_STATUS_LABELS[c.status]}
                </Badge>
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{c.paidAt ? `${formatDateTime(c.paidAt)}${c.paidReference ? ` · ${c.paidReference}` : ""}` : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
