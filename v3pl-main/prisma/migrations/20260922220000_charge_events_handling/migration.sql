-- CreateEnum
CREATE TYPE "ChargeEvent" AS ENUM ('SHIPMENT', 'RECEIVING', 'RETURN', 'RESTOCK', 'DAMAGE', 'MISSING', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "HandlingCategory" AS ENUM ('SMALL', 'MEDIUM', 'HIGH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChargeType" ADD VALUE 'RECEIVING';
ALTER TYPE "ChargeType" ADD VALUE 'RETURN_HANDLING';
ALTER TYPE "ChargeType" ADD VALUE 'RESTOCKING';
ALTER TYPE "ChargeType" ADD VALUE 'DAMAGE_HANDLING';
ALTER TYPE "ChargeType" ADD VALUE 'MISSING_HANDLING';
ALTER TYPE "ChargeType" ADD VALUE 'ADJUSTMENT';

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "event" "ChargeEvent" NOT NULL DEFAULT 'SHIPMENT',
ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "ChargeRule" ADD COLUMN     "event" "ChargeEvent" NOT NULL DEFAULT 'SHIPMENT',
ADD COLUMN     "handlingCategory" "HandlingCategory";

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "handlingCategory" "HandlingCategory" NOT NULL DEFAULT 'MEDIUM';
