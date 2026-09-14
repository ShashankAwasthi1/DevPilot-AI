import { Comment } from "@prisma/client";
import { prisma } from "../config/prisma";
import { assertRole } from "./project.service";
import { recordActivity } from "./activity.service";
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
  const { projectId, role } = await getTaskAccess(taskId, userId);
  assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

  // The comment and the activity record describing it must never diverge -
  // one succeeds and the other silently fails - so both writes happen in a
  // single transaction.
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

    return created;
  });

  return toCommentDto(comment);
}
