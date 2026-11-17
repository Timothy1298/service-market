CREATE TYPE "NotificationCategory" AS ENUM ('GENERAL','QUOTATIONS','JOBS','INVOICES','PAYMENTS','CUSTOMERS','INVENTORY','EXPENSES','SUBSCRIPTIONS','TEAM','SECURITY','SYSTEM');
CREATE TYPE "NotificationPriority" AS ENUM ('NORMAL','IMPORTANT','URGENT');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP','EMAIL','SMS');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED','PROCESSING','SENT','DELIVERED','FAILED','CANCELLED');
CREATE TYPE "NotificationEventStatus" AS ENUM ('PENDING','PROCESSING','PROCESSED','FAILED');

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channels" JSONB NOT NULL DEFAULT '{"IN_APP":true,"EMAIL":false,"SMS":false}',
  "categories" JSONB NOT NULL DEFAULT '{}',
  "quietStart" TEXT,
  "quietEnd" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

CREATE TABLE "NotificationEvent" (
  "id" TEXT NOT NULL,
  "businessId" TEXT,
  "actorUserId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "NotificationEventStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationEvent_idempotencyKey_key" ON "NotificationEvent"("idempotencyKey");
CREATE INDEX "NotificationEvent_status_nextAttemptAt_idx" ON "NotificationEvent"("status","nextAttemptAt");
CREATE INDEX "NotificationEvent_businessId_createdAt_idx" ON "NotificationEvent"("businessId","createdAt");

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "businessId" TEXT,
  "eventId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "category" "NotificationCategory" NOT NULL,
  "eventType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "metadata" JSONB,
  "actionUrl" TEXT,
  "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
  "readAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Notification_recipientUserId_idempotencyKey_key" ON "Notification"("recipientUserId","idempotencyKey");
CREATE INDEX "Notification_recipientUserId_readAt_archivedAt_createdAt_idx" ON "Notification"("recipientUserId","readAt","archivedAt","createdAt");
CREATE INDEX "Notification_businessId_createdAt_idx" ON "Notification"("businessId","createdAt");
CREATE INDEX "Notification_eventType_createdAt_idx" ON "Notification"("eventType","createdAt");
CREATE INDEX "Notification_expiresAt_idx" ON "Notification"("expiresAt");

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "provider" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
  "providerReference" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_channel_key" ON "NotificationDelivery"("notificationId","channel");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status","nextAttemptAt");
CREATE INDEX "NotificationDelivery_notificationId_createdAt_idx" ON "NotificationDelivery"("notificationId","createdAt");
