-- DropIndex
DROP INDEX "conversations_projectId_userId_updatedAt_id_idx";

-- CreateIndex
CREATE INDEX "conversations_projectId_userId_createdAt_id_idx" ON "conversations"("projectId", "userId", "createdAt", "id");
