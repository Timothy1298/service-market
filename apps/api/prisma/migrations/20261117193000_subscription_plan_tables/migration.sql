-- The SubscriptionPlan and SubscriptionPlanAudit models were added to the
-- Prisma schema after the initial subscription migration and had no DDL.
-- Create only the missing configuration/audit tables; subscription and payment
-- records are left untouched.
CREATE TABLE IF NOT EXISTS "SubscriptionPlan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "price" DECIMAL(65,30) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "durationMonths" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPlan_code_key"
  ON "SubscriptionPlan"("code");

CREATE TABLE IF NOT EXISTS "SubscriptionPlanAudit" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "oldPrice" DECIMAL(65,30) NOT NULL,
  "newPrice" DECIMAL(65,30) NOT NULL,
  "currency" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionPlanAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SubscriptionPlanAudit_planId_createdAt_idx"
  ON "SubscriptionPlanAudit"("planId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionPlanAudit_planId_fkey') THEN
    ALTER TABLE "SubscriptionPlanAudit"
      ADD CONSTRAINT "SubscriptionPlanAudit_planId_fkey"
      FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionPlanAudit_userId_fkey') THEN
    ALTER TABLE "SubscriptionPlanAudit"
      ADD CONSTRAINT "SubscriptionPlanAudit_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
