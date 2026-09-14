import { Notification, NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";

export interface NotificationDto {
  id: string;
  type: NotificationType;
  metadata: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}

function toNotificationDto(notification: Notification): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    metadata: notification.metadata,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  metadata: Prisma.InputJsonValue;
}

// Accepts either the regular Prisma client or an interactive-transaction
// client, so a service performing some mutation can write the notification
// in the exact same transaction as the mutation itself - mirrors
// activity.service.ts's recordActivity.
type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

// The only place a Notification row is ever created. There is no API
// endpoint that lets a client create one directly - this is called
// exclusively from other services as a side effect of something they
// already authorized.
export async function createNotification(
  client: PrismaClientOrTx,
  input: CreateNotificationInput,
): Promise<void> {
  await client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      metadata: input.metadata,
    },
  });
}

interface ListNotificationsOptions {
  cursor?: string;
  limit: number;
  unreadOnly: boolean;
}

interface ListNotificationsResult {
  notifications: NotificationDto[];
  unreadCount: number;
  nextCursor: string | null;
}

export async function listNotificationsForUser(
  userId: string,
  options: ListNotificationsOptions,
): Promise<ListNotificationsResult> {
  // Every query below is scoped to userId - a client can only ever see or
  // count its own notifications, never another user's.
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(options.unreadOnly ? { readAt: null } : {}),
  };

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return {
    notifications: page.map(toNotificationDto),
    unreadCount,
    nextCursor,
  };
}

export async function markNotificationAsRead(
  userId: string,
  notificationId: string,
): Promise<NotificationDto> {
  // A single query that both enforces ownership and performs the update -
  // there is no separate "check access, then act" step that could be
  // skipped or raced. Zero rows affected means "not found or not yours",
  // and those two cases must be indistinguishable to the caller.
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });

  if (result.count === 0) {
    throw new AppError(404, "Notification not found");
  }

  // Safe to fetch by bare id now - the updateMany above already proved this
  // exact id belongs to userId within this same request.
  const notification = await prisma.notification.findUniqueOrThrow({
    where: { id: notificationId },
  });

  return toNotificationDto(notification);
}

export async function markAllNotificationsAsRead(
  userId: string,
): Promise<{ updatedCount: number }> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  return { updatedCount: result.count };
}
