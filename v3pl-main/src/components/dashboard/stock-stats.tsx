import { AlertTriangle, Boxes, Lock, PackageCheck } from "lucide-react";
import { StatTile } from "@/components/dashboard/stat-tile";
import { stockTotals } from "@/server/services/inventory";

/** Dashboard inventory tiles (spec §54): total, available, reserved, low stock. */
export async function StockStats() {
  const totals = await stockTotals();
  const tiles = [
    { label: "Units on hand", value: totals.onHand, href: "/admin/inventory", icon: Boxes },
    { label: "Available", value: totals.available, href: "/admin/inventory", icon: PackageCheck },
    { label: "Reserved", value: totals.reserved, href: "/admin/inventory", icon: Lock },
    { label: "Low stock (≤ 5)", value: totals.lowStock, href: "/admin/inventory?lowStock=1", icon: AlertTriangle },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t, i) => (
        <StatTile key={t.label} index={i} label={t.label} value={t.value} href={t.href} icon={<t.icon className="size-5" />} />
      ))}
    </div>
  );
}
