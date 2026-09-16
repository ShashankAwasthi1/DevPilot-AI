import { api } from "./api";
import type { DocumentItem } from "./types";

// Request-side shapes, kept here rather than in types.ts - unlike the
// interface there, these aren't mirrors of a server response DTO, they're
// what a caller may send. Mirrors server/src/validation/document.validation.ts's
// createDocumentSchema/updateDocumentSchema; projectId/authorId are
// deliberately absent from both, since the server never accepts them from
// the request body either.
export interface CreateDocumentInput {
  title: string;
  content: string;
}

export interface UpdateDocumentInput {
  title?: string;
  content?: string;
}

// GET /projects/:projectId/documents - returns the full DocumentDto for
// every row (there is no smaller list-only shape for documents, unlike
// tasks). No cursor support yet on this client - only the bounded
// `limit`, matching how listTasks/listProjectMembers keep the first
// integration simple.
export function listDocuments(projectId: string, limit?: number): Promise<DocumentItem[]> {
  const query = limit !== undefined ? `?${new URLSearchParams({ limit: String(limit) })}` : "";
  return api
    .get<{ documents: DocumentItem[]; nextCursor: string | null }>(`/projects/${projectId}/documents${query}`)
    .then((result) => result.documents);
}

// GET /projects/:projectId/documents/search?q= - server-side title/content
// search (see server/src/services/document.service.ts's
// searchDocumentsInProject), capped server-side at 20 results. Distinct
// from listDocuments rather than a shared function with an optional query,
// since the two hit different endpoints with different response shapes
// (this one has no nextCursor).
export function searchDocuments(projectId: string, query: string): Promise<DocumentItem[]> {
  const search = new URLSearchParams({ q: query });
  return api
    .get<{ documents: DocumentItem[] }>(`/projects/${projectId}/documents/search?${search}`)
    .then((result) => result.documents);
}

export function createDocument(projectId: string, input: CreateDocumentInput): Promise<DocumentItem> {
  return api
    .post<{ document: DocumentItem }>(`/projects/${projectId}/documents`, input)
    .then((result) => result.document);
}

export function updateDocument(
  projectId: string,
  documentId: string,
  input: UpdateDocumentInput,
): Promise<DocumentItem> {
  return api
    .patch<{ document: DocumentItem }>(`/projects/${projectId}/documents/${documentId}`, input)
    .then((result) => result.document);
}

// The backend archives rather than hard-deletes (see
// server/src/services/document.service.ts's archiveDocument) - this
// returns the now-archived DocumentDto, matching the server's own
// response shape, rather than void.
export function archiveDocument(projectId: string, documentId: string): Promise<DocumentItem> {
  return api
    .delete<{ document: DocumentItem }>(`/projects/${projectId}/documents/${documentId}`)
    .then((result) => result.document);
}
