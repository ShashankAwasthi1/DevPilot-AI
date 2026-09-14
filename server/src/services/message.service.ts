import { Message, MessageRole } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { getConversationAccess } from "./conversation.service";
import { getProjectAccess } from "./project.service";

export interface MessageDto {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
}

function toMessageDto(message: Message): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}

export async function listMessagesForConversation(
  userId: string,
  projectId: string,
  conversationId: string,
): Promise<MessageDto[]> {
  await getConversationAccess(projectId, conversationId, userId);

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return messages.map(toMessageDto);
}

// Re-validates conversation access AND that the project isn't archived.
// Reading existing history from an archived project's conversation is still
// allowed (getConversationAccess has no archivedAt check) - only starting a
// new generation is blocked. Called once at the top of the message
// controller, before any provider call is made.
export async function assertConversationWritable(
  userId: string,
  projectId: string,
  conversationId: string,
): Promise<void> {
  const { project } = await getProjectAccess(projectId, userId);
  if (project.archivedAt) {
    throw new AppError(409, "Cannot send a message in an archived project");
  }
  await getConversationAccess(projectId, conversationId, userId);
}

export async function appendMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
): Promise<MessageDto> {
  const message = await prisma.message.create({
    data: { conversationId, role, content },
  });
  return toMessageDto(message);
}

// Most recent N messages, oldest-first - the shape the AI provider expects
// for conversation history. Deterministic (createdAt, id) ordering, same
// convention as every other list in this codebase.
export async function listRecentHistory(
  conversationId: string,
  limit: number,
): Promise<MessageDto[]> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return messages.reverse().map(toMessageDto);
}
