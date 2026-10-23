import { AlertTriangle, ClipboardList, PackageCheck, ShoppingCart, Truck } from "lucide-react";
import { StatTile } from "@/components/dashboard/stat-tile";
import { orderCounters } from "@/server/services/orders";

/** Dashboard order tiles (spec §54): open, picking, packing, shipped today, attention. */
export async function OrderStats() {
  const c = await orderCounters();
  const tiles = [
    { label: "Open orders", value: c.open, href: "/admin/orders?status=OPEN", icon: ShoppingCart },
    { label: "Picking", value: c.picking, href: "/admin/fulfillment?tab=PICKING", icon: ClipboardList },
    { label: "Packed", value: c.packed, href: "/admin/fulfillment?tab=PACKED", icon: PackageCheck },
    { label: "Shipped today", value: c.shippedToday, href: "/admin/fulfillment?tab=SHIPPED", icon: Truck },
    { label: "Needs attention", value: c.attention, href: "/admin/orders?status=ALL&needsAttention=1", icon: AlertTriangle },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((t, i) => (
        <StatTile key={t.label} index={i} label={t.label} value={t.value} href={t.href} icon={<t.icon className="size-5" />} className={t.label === "Needs attention" && t.value > 0 ? "ring-amber-300" : undefined} />
      ))}
    </div>
  );
}
