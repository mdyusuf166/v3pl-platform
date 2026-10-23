-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('AREA', 'ZONE', 'RACK', 'SHELF', 'BIN');

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "type" "LocationType" NOT NULL DEFAULT 'AREA';

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
