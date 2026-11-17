DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentTransactionStatus') THEN
    CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReportFrequency') THEN
    CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "InvoiceMpesaAttempt" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "recordedById" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "checkoutRequestId" TEXT,
  "merchantRequestId" TEXT,
  "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "mpesaReceipt" TEXT,
  "failureReason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "callbackAt" TIMESTAMP(3),
  "paymentId" TEXT,
  CONSTRAINT "InvoiceMpesaAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceMpesaAttempt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InvoiceMpesaAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InvoiceMpesaAttempt_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InvoiceMpesaAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceMpesaAttempt_checkoutRequestId_key" ON "InvoiceMpesaAttempt"("checkoutRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceMpesaAttempt_idempotencyKey_key" ON "InvoiceMpesaAttempt"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceMpesaAttempt_mpesaReceipt_key" ON "InvoiceMpesaAttempt"("mpesaReceipt");
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceMpesaAttempt_paymentId_key" ON "InvoiceMpesaAttempt"("paymentId");
CREATE INDEX IF NOT EXISTS "InvoiceMpesaAttempt_businessId_requestedAt_idx" ON "InvoiceMpesaAttempt"("businessId", "requestedAt");
CREATE INDEX IF NOT EXISTS "InvoiceMpesaAttempt_invoiceId_status_idx" ON "InvoiceMpesaAttempt"("invoiceId", "status");

CREATE TABLE IF NOT EXISTS "SavedReport" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "filters" JSONB NOT NULL,
  "frequency" "ReportFrequency",
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "lastResult" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavedReport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SavedReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SavedReport_businessId_createdAt_idx" ON "SavedReport"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "SavedReport_enabled_nextRunAt_idx" ON "SavedReport"("enabled", "nextRunAt");
