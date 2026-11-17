ALTER TABLE "SubscriptionPlan"
  ADD COLUMN IF NOT EXISTS "limits" JSONB NOT NULL DEFAULT '{}'::jsonb;
