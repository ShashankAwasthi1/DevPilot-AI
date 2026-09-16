"use client";

import { useCallback, useState } from "react";
import type { ApiError } from "./api";
import {
  archiveDocument as archiveDocumentRequest,
  createDocument as createDocumentRequest,
  listDocuments,
  searchDocuments,
  updateDocument as updateDocumentRequest,
  type CreateDocumentInput,
  type UpdateDocumentInput,
} from "./documents";
import { useApiData } from "./use-api-data";
import type { DocumentItem } from "./types";

export interface UseDocumentsOptions {
  limit?: number;
  // A trimmed, non-empty value switches the fetch to the server-side
  // search endpoint (searchDocuments) instead of the plain list endpoint -
  // caller is responsible for debouncing before passing this in (see
  // app/projects/[id]/docs/page.tsx), this hook just reacts to whatever
  // value it's given.
  query?: string;
}

export interface UseDocumentsResult {
  documents: DocumentItem[] | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => void;
  createDocument: (input: CreateDocumentInput) => Promise<DocumentItem>;
  updateDocument: (documentId: string, input: UpdateDocumentInput) => Promise<DocumentItem>;
  archiveDocument: (documentId: string) => Promise<DocumentItem>;
}

// Same refreshKey-bump-then-refetch idiom as lib/use-tasks.ts - no
// optimistic mutation, no new state-management dependency, layered
// entirely on the existing useApiData hook. Unlike tasks, the list
// endpoint already returns the full DocumentDto (title + content) for
// every row, so there is no separate cache/fetch-detail concept needed
// here - view/edit both work directly off whatever this hook already
// loaded.
export function useDocuments(projectId: string, options: UseDocumentsOptions = {}): UseDocumentsResult {
  const { limit, query } = options;
  const trimmedQuery = query?.trim() ?? "";
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useApiData(
    () => (trimmedQuery ? searchDocuments(projectId, trimmedQuery) : listDocuments(projectId, limit)),
    [projectId, limit, trimmedQuery, refreshKey],
  );

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  const createDocument = useCallback(
    async (input: CreateDocumentInput) => {
      const document = await createDocumentRequest(projectId, input);
      refresh();
      return document;
    },
    [projectId, refresh],
  );

  const updateDocument = useCallback(
    async (documentId: string, input: UpdateDocumentInput) => {
      const document = await updateDocumentRequest(projectId, documentId, input);
      refresh();
      return document;
    },
    [projectId, refresh],
  );

  const archiveDocument = useCallback(
    async (documentId: string) => {
      const document = await archiveDocumentRequest(projectId, documentId);
      refresh();
      return document;
    },
    [projectId, refresh],
  );

  return { documents: data, loading, error, refresh, createDocument, updateDocument, archiveDocument };
}
