-- CreateTable
CREATE TABLE "query_logs" (
    "id" TEXT NOT NULL,
    "sql" TEXT NOT NULL,
    "bind" TEXT,
    "explainPlan" TEXT,
    "durationMs" INTEGER NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_logs_pkey" PRIMARY KEY ("id")
);
