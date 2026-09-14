import { Comment } from "@prisma/client";
import { prisma } from "../config/prisma";
import { assertRole } from "./project.service";
import { recordActivity } from "./activity.service";
import { createNotification } from "./notification.service";
import { getTaskAccess } from "./task.service";
import type { CreateCommentInput } from "../validation/comment.validation";

export interface CommentDto {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

function toCommentDto(comment: Comment): CommentDto {
  return {
    id: comment.id,
    taskId: comment.taskId,
    authorId: comment.authorId,
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

export async function listCommentsForTask(
  userId: string,
  taskId: string,
): Promise<CommentDto[]> {
  // Any role with access to the task's project may view its comments.
  await getTaskAccess(taskId, userId);

  const comments = await prisma.comment.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
  });

  return comments.map(toCommentDto);
}

export async function createComment(
  userId: string,
  taskId: string,
  input: CreateCommentInput,
): Promise<CommentDto> {
  const { task, projectId, role } = await getTaskAccess(taskId, userId);
  assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

  // The comment, the activity record, and the assignee's notification must
  // never diverge - any one succeeding while another silently fails would
  // leave inconsistent state - so all three writes happen in a single
  // transaction.
  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: {
        taskId,
        authorId: userId,
        body: input.body,
      },
    });

    await recordActivity(tx, {
      projectId,
      taskId,
      actorId: userId,
      type: "COMMENT_CREATED",
      metadata: { commentId: created.id },
    });

    // Notify the task's assignee, if any - but never notify someone of
    // their own comment.
    if (task.assigneeId && task.assigneeId !== userId) {
      await createNotification(tx, {
        userId: task.assigneeId,
        type: "TASK_COMMENT_CREATED",
        metadata: {
          taskId,
          commentId: created.id,
          projectId,
          actorId: userId,
        },
      });
    }

    return created;
  });

  return toCommentDto(comment);
}
