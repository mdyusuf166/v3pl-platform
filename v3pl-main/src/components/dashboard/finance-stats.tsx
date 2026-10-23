import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { StatTile } from "@/components/dashboard/stat-tile";
import { formatMoney } from "@/lib/format";
import { allOwnerBalances } from "@/server/services/finance";

/** Admin dashboard: operational totals across all owners (payable to owners vs receivable from owners). */
export async function FinanceStats() {
  const { totals, rows } = await allOwnerBalances();
  const open = rows.filter((r) => r.payable.gt(0) || r.receivable.gt(0)).length;
  const tiles = [
    { label: "Payable to owners", value: formatMoney(totals.payable), icon: ArrowUpRight, hint: "3PL product value + vendor payables, minus payments made" },
    { label: "Receivable from owners", value: formatMoney(totals.receivable), icon: ArrowDownLeft, hint: "Operational charges minus payments received (not netted against payables)" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-slot="finance-stats">
      {tiles.map((t, i) => (
        <StatTile key={t.label} index={i} label={t.label} display={t.value} href="/admin/finance" icon={<t.icon className="size-5" />} hint={`${t.hint} · ${open} owner${open === 1 ? "" : "s"} with an outstanding balance`} />
      ))}
    </div>
  );
}
