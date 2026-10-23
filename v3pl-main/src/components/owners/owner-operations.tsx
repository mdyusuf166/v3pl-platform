import Link from "next/link";
import { ArrowRight, Boxes, Package, ShoppingCart } from "lucide-react";
import type { OwnerType } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { OrdersTable } from "@/components/orders/orders-table";
import { formatInt } from "@/lib/format";
import { OWNER_TYPE_META } from "@/lib/validation/owners";
import { listStock, stockTotals } from "@/server/services/inventory";
import { listOrders } from "@/server/services/orders";
import { inventorySummary, listProducts } from "@/server/services/products";

const PREVIEW = 10;

/**
 * Admin vendor / 3PL client detail: that owner's products, stock and orders. Every query is scoped
 * server-side to `ownerId` through the existing owner-aware services (`listProducts`, `listStock`,
 * `stockTotals`, `listOrders` with `scopeOwnerId`) — nothing is fetched globally and filtered in the UI.
 * Each section previews the newest rows and links to the full admin list pre-filtered to this owner.
 */
export async function OwnerOperations({ ownerId, type }: { ownerId: string; type: OwnerType }) {
  const label = OWNER_TYPE_META[type].singular.toLowerCase();
  const [products, stock, totals, orders] = await Promise.all([
    listProducts({ ownerId, status: "ALL", pageSize: PREVIEW }),
    listStock({ ownerId }),
    stockTotals(ownerId),
    listOrders({ scopeOwnerId: ownerId, pageSize: PREVIEW }),
  ]);
  const stockRows = stock.items.slice(0, PREVIEW);

  return (
    <div className="space-y-8" data-slot="owner-operations">
      <Section title="Products" count={products.total} href={`/admin/products?ownerId=${ownerId}&status=ALL`} description={`Products and SKUs owned by this ${label}.`}>
        {products.items.length === 0 ? (
          <EmptyState icon={Package} title="No products yet" description={`Add a product for this ${label} or import a product CSV.`} />
        ) : (
          <div className="overflow-hidden rounded-lg border" data-slot="owner-products">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKUs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Inventory</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.items.map((p) => {
                  const inv = inventorySummary(p.variants);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={`/admin/products/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        {p.options.length > 0 && <div className="text-xs text-muted-foreground">{p.options.join(" / ")}</div>}
                      </TableCell>
                      <TableCell className="max-w-72 font-mono text-xs">
                        <span className="block truncate" title={p.variants.map((v) => v.sku).join(", ")}>
                          {p.variants.map((v) => v.sku).join(", ")}
                        </span>
                        {p.variants.length > 1 && <span className="font-sans text-muted-foreground">{p.variants.length} variants</span>}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {inv.onHand === 0 && inv.reserved === 0 ? (
                          <span className="text-muted-foreground">No stock</span>
                        ) : (
                          <>
                            <span className={inv.available > 0 ? "" : "text-amber-700"}>{formatInt(inv.available)} available</span>
                            <div className="text-xs text-muted-foreground">
                              {formatInt(inv.onHand)} on hand{inv.reserved ? ` · ${formatInt(inv.reserved)} reserved` : ""}
                            </div>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="Inventory" count={stock.total} href={`/admin/inventory?ownerId=${ownerId}`} description="Stock per SKU and warehouse. Available = on hand − reserved.">
        <div className="grid gap-4 sm:grid-cols-3" data-slot="owner-stock-totals">
          {[
            { label: "Units on hand", value: totals.onHand },
            { label: "Reserved", value: totals.reserved },
            { label: "Available", value: totals.available },
          ].map((t) => (
            <Card key={t.label}>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t.label}</p>
                <p className="text-2xl font-semibold tabular-nums">{formatInt(t.value)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        {stockRows.length === 0 ? (
          <EmptyState icon={Boxes} title="No stock yet" description={`Nothing has been received for this ${label}.`} />
        ) : (
          <div className="overflow-x-auto rounded-lg border" data-slot="owner-inventory">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockRows.map((r) => {
                  const available = r.onHand - r.reserved;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link href={`/admin/products/${r.variant.product.id}`} className="font-mono text-xs hover:underline">
                          {r.variant.sku}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-64 truncate">{r.variant.product.name}</div>
                        {r.variant.name && <div className="text-xs text-muted-foreground">{r.variant.name}</div>}
                      </TableCell>
                      <TableCell>{r.warehouse.code}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(r.onHand)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatInt(r.reserved)}</TableCell>
                      <TableCell className={`text-right font-medium tabular-nums ${available <= 5 ? "text-amber-700" : ""}`}>{formatInt(available)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="Orders" count={orders.total} href={`/admin/orders?ownerId=${ownerId}`} description={`Orders containing this ${label}'s SKUs — only its own lines are listed; open the order for the full picture.`}>
        {orders.items.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="No orders yet" description={`Orders for this ${label}'s SKUs will appear here.`} />
        ) : (
          <div data-slot="owner-orders">
            <OrdersTable rows={orders.items} basePath="/admin/orders" scoped showLines />
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, count, href, description, children }: { title: string; count: number; href: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            {title} <span className="text-base font-normal text-muted-foreground tabular-nums">({formatInt(count)})</span>
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" size="sm" render={<Link href={href} />}>
          View all <ArrowRight />
        </Button>
      </div>
      {children}
    </section>
  );
}
