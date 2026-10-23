import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil, ShoppingCart, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { SendEmailDialog } from "@/components/common/send-email-dialog";
import { StatusBadge } from "@/components/common/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { AffiliateAssignments } from "@/components/affiliates/affiliate-assignments";
import { commissionRuleLabel as ruleLabel } from "@/lib/validation/affiliates";
import { CommissionsTable } from "@/components/affiliates/commissions-table";
import { EarningsTiles } from "@/components/affiliates/earnings-tiles";
import { MarkPaidButton } from "@/components/affiliates/mark-paid-button";
import { OrdersTable } from "@/components/orders/orders-table";
import { CreateUserDialog } from "@/components/users/create-user-dialog";
import { formatDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/guards";
import { affiliateEarnings, affiliateOrders, getAffiliate, listCommissions } from "@/server/services/affiliates";
import { listOwnerOptions } from "@/server/services/owners";
import { prisma } from "@/lib/prisma";

export default async function AffiliateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  const a = await getAffiliate(id);
  if (!a) notFound();
  const [earnings, orders, commissions, vendors, clients, earned] = await Promise.all([
    affiliateEarnings(a.id),
    affiliateOrders(a.id, { pageSize: 10 }),
    listCommissions({ affiliateId: a.id, pageSize: 25 }),
    listOwnerOptions("VENDOR"),
    listOwnerOptions("THREEPL_CLIENT"),
    prisma.affiliateCommission.findMany({ where: { affiliateId: a.id, status: "EARNED" }, select: { id: true, amount: true } }),
  ]);
  const defaultRule = ruleLabel(a.commissionType, a.commissionValue?.toString() ?? null) ?? "none";

  return (
    <>
      <div>
        <Link href="/admin/affiliates" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Salesmen
        </Link>
      </div>
      <PageHeader
        title={a.name}
        description={`Salesman · ${a.code}${a.email ? ` · ${a.email}` : ""}${a.phone ? ` · ${a.phone}` : ""}`}
        actions={
          <>
            <StatusBadge status={a.status} className="mr-2" />
            <SendEmailDialog kind="AFFILIATE" id={a.id} accountName={a.name} email={a.email} />
            <Button variant="outline" render={<Link href={`/admin/affiliates/${a.id}/edit`} />}>
              <Pencil /> Edit
            </Button>
          </>
        }
      />

      <EarningsTiles e={earnings} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Default commission</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-lg font-semibold">{defaultRule}</p>
            <p className="text-muted-foreground">Applies to every sale unless a SKU has its own rule. Recorded commissions never change when this changes.</p>
            {a.notes && <p className="mt-3 whitespace-pre-line border-t pt-3">{a.notes}</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Sign-in users</CardTitle>
              <p className="text-sm text-muted-foreground">People who sign in at /user and see only this salesman&apos;s sales, customers and commissions.</p>
            </div>
            {a.status === "ACTIVE" && <CreateUserDialog mode="affiliate" affiliateId={a.id} affiliateName={a.name} />}
          </CardHeader>
          <CardContent>
            {a.users.length === 0 ? (
              <EmptyState icon={Users} title="No users yet" description="Add a user so this salesman can sign in and place orders." />
            ) : (
              <ul className="divide-y text-sm" data-slot="affiliate-users">
                {a.users.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                        {u.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {u.lastLoginAt ? `last sign-in ${formatDateTime(u.lastLoginAt)}` : "never signed in"}
                      <Badge variant="outline">{u.status}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <AffiliateAssignments
        affiliateId={a.id}
        owners={[...vendors.map((o) => ({ id: o.id, code: o.code, businessName: o.businessName, type: "VENDOR" as const })), ...clients.map((o) => ({ id: o.id, code: o.code, businessName: o.businessName, type: "THREEPL_CLIENT" as const }))]}
        assignedOwnerIds={a.owners.map((o) => o.ownerId)}
        variants={a.variants.map((v) => ({ variantId: v.variantId, sku: v.variant.sku, name: v.variant.name, price: v.variant.price?.toString() ?? "0", currency: v.variant.currency, productId: v.variant.product.id, productName: v.variant.product.name, ownerName: v.variant.product.owner.businessName, commissionType: v.commissionType, commissionValue: v.commissionValue?.toString() ?? null, archived: v.variant.status !== "ACTIVE" || v.variant.product.status !== "ACTIVE" }))}
        defaultRule={defaultRule}
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Sales ({orders.total})</h2>
          <p className="text-sm text-muted-foreground">Orders placed by this salesman, newest first.</p>
        </div>
        {orders.items.length === 0 ? <EmptyState icon={ShoppingCart} title="No sales yet" description="Orders the salesman submits from their portal appear here." /> : <OrdersTable rows={orders.items} basePath="/admin/orders" scoped={false} showLines />}
      </section>

      <section className="space-y-3" data-slot="affiliate-commissions">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Commissions ({commissions.total})</h2>
            <p className="text-sm text-muted-foreground">Snapshots per order line. Pending until the order ships, earned afterwards, cancelled with the order, paid when you record the payment.</p>
          </div>
          <MarkPaidButton affiliateId={a.id} earnedIds={earned.map((e) => e.id)} earnedTotal={earned.reduce((s, e) => s + Number(e.amount), 0)} />
        </div>
        <CommissionsTable rows={commissions.items} orderHref={(oid) => `/admin/orders/${oid}`} />
      </section>
    </>
  );
}
