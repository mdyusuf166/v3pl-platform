-- Business rule (D-070, hand-written; separate migration because the new enum value cannot be used in the
-- transaction that adds it): an AFFILIATE user must belong to an Affiliate and never to an Owner; every other
-- role must not reference an Affiliate. Prisma does not model CHECK constraints; keep this in sync manually.
ALTER TABLE "User" ADD CONSTRAINT "User_affiliate_role_check"
  CHECK ((("role" = 'AFFILIATE') AND ("affiliateId" IS NOT NULL))
      OR (("role" <> 'AFFILIATE') AND ("affiliateId" IS NULL)));
