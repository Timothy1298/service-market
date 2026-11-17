CREATE TYPE "CustomerPaymentStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED', 'REVERSED');
ALTER TABLE "Payment" ADD COLUMN "status" "CustomerPaymentStatus" NOT NULL DEFAULT 'SUCCESSFUL';
ALTER TABLE "Payment" ADD COLUMN "transactionReference" TEXT;
ALTER TABLE "Payment" ADD COLUMN "mpesaReceipt" TEXT;
ALTER TABLE "Payment" ADD COLUMN "reversedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Payment_transactionReference_key" ON "Payment"("transactionReference");
CREATE UNIQUE INDEX "Payment_mpesaReceipt_key" ON "Payment"("mpesaReceipt");
CREATE TABLE "InvoiceMpesaAttempt" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
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
  CONSTRAINT "InvoiceMpesaAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InvoiceMpesaAttempt_checkoutRequestId_key" ON "InvoiceMpesaAttempt"("checkoutRequestId");
CREATE UNIQUE INDEX "InvoiceMpesaAttempt_idempotencyKey_key" ON "InvoiceMpesaAttempt"("idempotencyKey");
CREATE UNIQUE INDEX "InvoiceMpesaAttempt_mpesaReceipt_key" ON "InvoiceMpesaAttempt"("mpesaReceipt");
CREATE UNIQUE INDEX "InvoiceMpesaAttempt_paymentId_key" ON "InvoiceMpesaAttempt"("paymentId");
CREATE INDEX "InvoiceMpesaAttempt_businessId_requestedAt_idx" ON "InvoiceMpesaAttempt"("businessId","requestedAt");
CREATE INDEX "InvoiceMpesaAttempt_invoiceId_status_idx" ON "InvoiceMpesaAttempt"("invoiceId","status");
ALTER TABLE "InvoiceMpesaAttempt" ADD COLUMN "recordedById" TEXT NOT NULL DEFAULT '';
ALTER TABLE "InvoiceMpesaAttempt" ADD CONSTRAINT "InvoiceMpesaAttempt_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
