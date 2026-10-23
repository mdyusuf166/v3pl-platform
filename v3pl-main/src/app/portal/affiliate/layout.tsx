import { PortalShell } from "@/components/layout/portal-shell";
import { SupportButton } from "@/components/layout/support-button";
import { supportDestination } from "@/lib/validation/support";
import { getSupportSettings } from "@/server/services/support-settings";
import { ROLE_LABELS } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { requireAffiliate } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

/** Affiliate portal (D-070). Scope is always the session's affiliate; nothing here reads an id from the URL. */
export default async function AffiliatePortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAffiliate();
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: user.affiliateId },
    select: { name: true },
  });
  const support = supportDestination(await getSupportSettings());
  return (
    <>
      <PortalShell
        user={{
          name: user.name,
          email: user.email,
          roleLabel: ROLE_LABELS[user.role],
        }}
        homeHref="/portal/affiliate"
        portalName={affiliate?.name ?? "Salesman Portal"}
        nav={[
          { label: "Overview", href: "/portal/affiliate" },
          { label: "My products", href: "/portal/affiliate/products" },
          { label: "My orders", href: "/portal/affiliate/orders" },
          { label: "My customers", href: "/portal/affiliate/customers" },
          { label: "My earnings", href: "/portal/affiliate/earnings" },
        ]}
      >
        {children}
      </PortalShell>
      <SupportButton destination={support} />
    </>
  );
}
