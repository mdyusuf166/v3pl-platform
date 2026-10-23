import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/orders/order-detail";
import { requireAffiliate } from "@/server/auth/guards";
import { affiliateOrder } from "@/server/services/affiliates";

export default async function AffiliateOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAffiliate();
  const { id } = await params;
  // Scope is the session affiliate: an order placed by anyone else is a 404, never a forbidden hint.
  const order = await affiliateOrder(user.affiliateId, id);
  if (!order) notFound();
  return <OrderDetail order={order} scoped canManage={false} canOperate={false} backHref="/portal/affiliate/orders" backLabel="My orders" warehouses={[]} locationsByWarehouse={{}} pickable={[]} />;
}
