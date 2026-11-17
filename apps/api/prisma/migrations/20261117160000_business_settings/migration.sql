ALTER TABLE "Business"
  ADD COLUMN "tradingName" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "businessType" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "alternativePhone" TEXT,
  ADD COLUMN "town" TEXT,
  ADD COLUMN "county" TEXT,
  ADD COLUMN "country" TEXT DEFAULT 'Kenya',
  ADD COLUMN "postalAddress" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "User" ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}'::jsonb;
