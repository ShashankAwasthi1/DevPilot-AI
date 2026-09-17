-- AlterEnum
ALTER TYPE "PendingTaskActionType" ADD VALUE 'CREATE_PROJECT_PLAN';

-- AlterTable
ALTER TABLE "pending_task_actions" ADD COLUMN "resultTaskIds" TEXT[] NOT NULL DEFAULT '{}';
