import { Conversation } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { getProjectAccess } from "./project.service";
import type { CreateConversationInput, UpdateConversationInput } from "../validation/conversation.validation";

export interface ConversationDto {
  id: string;
  projectId: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toConversationDto(conversation: Conversation): ConversationDto {
  return {
    id: conversation.id,
    projectId: conversation.projectId,
    userId: conversation.userId,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export interface ConversationAccess {
  conversation: Conversation;
}

// A conversation belongs to exactly the (projectId, userId) pair that
// created it - never shared with other project members, regardless of
// role. Both projectId and userId are required in the same query so a
// valid conversation id can never be paired with someone else's userId (or
// an unrelated projectId) to probe or read it - same double-key idiom as
// document.service.ts's getDocumentAccess.
export async function getConversationAccess(
  projectId: string,
  conversationId: string,
  userId: string,
): Promise<ConversationAccess> {
  await getProjectAccess(projectId, userId);

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, projectId, userId },
  });

  if (!conversation) {
    throw new AppError(404, "Conversation not found");
  }

  return { conversation };
}

export async function createConversation(
  userId: string,
  projectId: string,
  input: CreateConversationInput,
): Promise<ConversationDto> {
  const { project } = await getProjectAccess(projectId, userId);

  // Archived projects: no new conversations. Existing conversations on an
  // archived project remain readable (see getConversationAccess, which has
  // no archivedAt check) - only starting something new is blocked.
  if (project.archivedAt) {
    throw new AppError(409, "Cannot start a new conversation in an archived project");
  }

  const conversation = await prisma.conversation.create({
    data: {
      projectId,
      userId,
      title: input.title,
    },
  });

  return toConversationDto(conversation);
}

export async function listConversationsForProject(
  userId: string,
  projectId: string,
  options: { cursor?: string; limit: number },
): Promise<{ conversations: ConversationDto[]; nextCursor: string | null }> {
  await getProjectAccess(projectId, userId);

  const rows = await prisma.conversation.findMany({
    where: { projectId, userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return { conversations: page.map(toConversationDto), nextCursor };
}

export async function getConversationForProject(
  userId: string,
  projectId: string,
  conversationId: string,
): Promise<ConversationDto> {
  const { conversation } = await getConversationAccess(projectId, conversationId, userId);
  return toConversationDto(conversation);
}

// Phase 16 Step 8 - renaming a conversation. getConversationAccess remains
// the sole authorization boundary: it's called first, and only its
// resolved conversation's own `id` is ever used for the write below - the
// caller's projectId/userId are never written anywhere, only used to
// authorize which single row may be touched. `data` is deliberately a
// literal `{ title }` object, never a spread of `input`, so no future
// field added to UpdateConversationInput could accidentally become
// writable here without this line itself being changed.
export async function updateConversationTitle(
  projectId: string,
  conversationId: string,
  userId: string,
  input: UpdateConversationInput,
): Promise<ConversationDto> {
  const { conversation } = await getConversationAccess(projectId, conversationId, userId);

  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { title: input.title },
  });

  return toConversationDto(updated);
}

// Phase 16 Step 8 - deleting a conversation. Same authorization boundary
// as above. A genuine hard delete - no archivedAt/soft-delete field exists
// on this model and none is added here. Message rows are removed entirely
// through the existing Conversation -> Message onDelete: Cascade relation
// (see schema.prisma) - this function never touches the Message table
// itself, so there is nothing to keep in sync if that relation ever
// changes.
export async function deleteConversation(
  projectId: string,
  conversationId: string,
  userId: string,
): Promise<void> {
  const { conversation } = await getConversationAccess(projectId, conversationId, userId);

  await prisma.conversation.delete({
    where: { id: conversation.id },
  });
}
