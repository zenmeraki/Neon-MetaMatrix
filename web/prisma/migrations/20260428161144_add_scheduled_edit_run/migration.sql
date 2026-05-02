-- CreateTable
CREATE TABLE "ScheduledEditRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "scheduledEditId" TEXT NOT NULL,
    "operationId" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "targetCount" INTEGER,
    "affectedCount" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledEditRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledEditRun_shop_status_idx" ON "ScheduledEditRun"("shop", "status");

-- CreateIndex
CREATE INDEX "ScheduledEditRun_scheduledEditId_idx" ON "ScheduledEditRun"("scheduledEditId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledEditRun_shop_scheduledEditId_scheduledFor_key" ON "ScheduledEditRun"("shop", "scheduledEditId", "scheduledFor");
