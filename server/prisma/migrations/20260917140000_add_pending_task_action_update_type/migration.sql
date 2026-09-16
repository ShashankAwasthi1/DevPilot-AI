-- CreateEnum
CREATE TYPE "PendingTaskActionType" AS ENUM ('CREATE_TASK', 'UPDATE_TASK');

-- AlterTable
ALTER TABLE "pending_task_actions" ADD COLUMN "actionType" "PendingTaskActionType" NOT NULL DEFAULT 'CREATE_TASK';
ALTER TABLE "pending_task_actions" ADD COLUMN "taskId" TEXT;

-- CreateIndex
CREATE INDEX "pending_task_actions_taskId_idx" ON "pending_task_actions"("taskId");

-- AddForeignKey
ALTER TABLE "pending_task_actions" ADD CONSTRAINT "pending_task_actions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
