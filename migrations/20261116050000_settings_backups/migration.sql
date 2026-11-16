-- CreateTable
CREATE TABLE "settings_backups" (
    "id" TEXT NOT NULL,
    "ownerBackendUrl" TEXT NOT NULL,
    "ownerAccountId" TEXT NOT NULL,
    "formatVersion" INTEGER NOT NULL,
    "payload" TEXT NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "timelineCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settings_backups_ownerBackendUrl_ownerAccountId_createdAt_idx" ON "settings_backups"("ownerBackendUrl", "ownerAccountId", "createdAt");
