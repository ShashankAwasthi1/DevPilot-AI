"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

// How often to re-check a still-PENDING document while indexing might be
// in progress in the background - conservative for a SaaS UI (nobody
// needs sub-second freshness here), short enough that a badge doesn't look
// stuck for long after indexing actually finishes.
const PENDING_POLL_INTERVAL_MS = 3000;

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

  // `loading` is read from inside the interval callback below, which
  // closes over whatever `loading` was when the interval was created -
  // a ref keeps it current across renders without recreating the interval
  // on every loading change (that would just be a second, redundant way
  // to gate polling on top of the check inside the callback itself).
  const loadingRef = useRef(loading);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // Freshness for the indexing-status badges (doc-list.tsx/
  // doc-details-sheet.tsx): a document just created/edited starts PENDING
  // and only ever becomes READY/FAILED once backend indexing finishes in
  // the background - with no push mechanism, the only way to observe that
  // transition is to refetch. Reuses `refresh()` (the exact same
  // refreshKey-bump `useApiData` already reacts to) rather than a second,
  // competing fetch path - so this automatically refetches from whichever
  // endpoint (list or search) and query is currently active, the same way
  // a manual refresh/create/update/archive already does.
  const hasPendingDocument = data?.some((doc) => doc.indexStatus === "PENDING") ?? false;

  useEffect(() => {
    if (!hasPendingDocument) return;

    const interval = setInterval(() => {
      // Skip a tick rather than queue up a second overlapping request if
      // the previous refresh (or the initial load) hasn't resolved yet.
      if (!loadingRef.current) refresh();
    }, PENDING_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
    // Re-runs whenever `hasPendingDocument` flips - starting the interval
    // the moment a PENDING document first appears, and (via this effect's
    // own cleanup) stopping it the moment none remain, with no separate
    // "should I still be polling" check needed inside the callback.
  }, [hasPendingDocument, refresh]);

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
