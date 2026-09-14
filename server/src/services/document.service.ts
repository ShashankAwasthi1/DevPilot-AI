import { Document } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { assertRole, getProjectAccess, ProjectRole } from "./project.service";
import { recordActivity } from "./activity.service";
import type { CreateDocumentInput, UpdateDocumentInput } from "../validation/document.validation";

export interface DocumentDto {
  id: string;
  projectId: string;
  authorId: string;
  title: string;
  content: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDocumentDto(document: Document): DocumentDto {
  return {
    id: document.id,
    projectId: document.projectId,
    authorId: document.authorId,
    title: document.title,
    content: document.content,
    archivedAt: document.archivedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

interface DocumentAccess {
  document: Document;
  role: ProjectRole;
}

// A document has no access rules of its own - always derived from the
// project named in the URL, exactly like task.service.ts derives task
// access from the task's project. The where clause below requires BOTH
// the document id AND the URL's projectId to match in one query, so a
// valid documentId can never be paired with an unrelated projectId to
// probe whether it exists elsewhere.
async function getDocumentAccess(
  projectId: string,
  documentId: string,
  userId: string,
): Promise<DocumentAccess> {
  const { role } = await getProjectAccess(projectId, userId);

  const document = await prisma.document.findFirst({
    where: { id: documentId, projectId },
  });

  if (!document) {
    throw new AppError(404, "Document not found");
  }

  return { document, role };
}

export async function createDocument(
  userId: string,
  projectId: string,
  input: CreateDocumentInput,
): Promise<DocumentDto> {
  const { role } = await getProjectAccess(projectId, userId);
  assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

  const document = await prisma.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        projectId,
        authorId: userId,
        title: input.title,
        content: input.content,
      },
    });

    await recordActivity(tx, {
      projectId,
      actorId: userId,
      type: "DOCUMENT_CREATED",
      metadata: { documentId: created.id, projectId, actorId: userId },
    });

    return created;
  });

  return toDocumentDto(document);
}

export async function listDocumentsForProject(
  userId: string,
  projectId: string,
  options: { cursor?: string; limit: number },
): Promise<{ documents: DocumentDto[]; nextCursor: string | null }> {
  await getProjectAccess(projectId, userId);

  const rows = await prisma.document.findMany({
    where: { projectId, archivedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return { documents: page.map(toDocumentDto), nextCursor };
}

export async function searchDocumentsInProject(
  userId: string,
  projectId: string,
  q: string,
): Promise<DocumentDto[]> {
  await getProjectAccess(projectId, userId);

  const documents = await prisma.document.findMany({
    where: {
      projectId,
      archivedAt: null,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { content: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return documents.map(toDocumentDto);
}

export async function getDocumentForProject(
  userId: string,
  projectId: string,
  documentId: string,
): Promise<DocumentDto> {
  const { document } = await getDocumentAccess(projectId, documentId, userId);
  return toDocumentDto(document);
}

export async function updateDocument(
  userId: string,
  projectId: string,
  documentId: string,
  input: UpdateDocumentInput,
): Promise<DocumentDto> {
  const { document, role } = await getDocumentAccess(projectId, documentId, userId);
  assertRole(role, ["OWNER", "ADMIN", "MEMBER"]);

  if (document.archivedAt) {
    throw new AppError(409, "Cannot update an archived document");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.document.update({
      where: { id: documentId },
      data: input,
    });

    await recordActivity(tx, {
      projectId,
      actorId: userId,
      type: "DOCUMENT_UPDATED",
      metadata: { documentId, projectId, actorId: userId },
    });

    return saved;
  });

  return toDocumentDto(updated);
}

export async function archiveDocument(
  userId: string,
  projectId: string,
  documentId: string,
): Promise<DocumentDto> {
  const { document, role } = await getDocumentAccess(projectId, documentId, userId);
  assertRole(role, ["OWNER", "ADMIN"]);

  if (document.archivedAt) {
    // Archiving an already-archived document is a no-op success, not an
    // error - DELETE should be idempotent (same convention as projects).
    return toDocumentDto(document);
  }

  const archived = await prisma.$transaction(async (tx) => {
    const saved = await tx.document.update({
      where: { id: documentId },
      data: { archivedAt: new Date() },
    });

    await recordActivity(tx, {
      projectId,
      actorId: userId,
      type: "DOCUMENT_ARCHIVED",
      metadata: { documentId, projectId, actorId: userId },
    });

    return saved;
  });

  return toDocumentDto(archived);
}
