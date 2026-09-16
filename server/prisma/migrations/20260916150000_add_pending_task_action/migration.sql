-- CreateEnum
CREATE TYPE "PendingTaskActionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "pending_task_actions" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proposedInput" JSONB NOT NULL,
    "status" "PendingTaskActionStatus" NOT NULL DEFAULT 'PENDING',
    "resultTaskId" TEXT,
    "resultError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "pending_task_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_task_actions_userId_projectId_idx" ON "pending_task_actions"("userId", "projectId");

-- CreateIndex
CREATE INDEX "pending_task_actions_conversationId_idx" ON "pending_task_actions"("conversationId");

-- CreateIndex
CREATE INDEX "pending_task_actions_status_expiresAt_idx" ON "pending_task_actions"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "pending_task_actions" ADD CONSTRAINT "pending_task_actions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_task_actions" ADD CONSTRAINT "pending_task_actions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_task_actions" ADD CONSTRAINT "pending_task_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
