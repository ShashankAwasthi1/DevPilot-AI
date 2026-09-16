"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateDocSheet } from "@/components/docs/create-doc-sheet";
import { DocList } from "@/components/docs/doc-list";
import { DocSearchInput } from "@/components/docs/doc-search-input";
import { api } from "@/lib/api";
import { useApiData } from "@/lib/use-api-data";
import { useDocuments } from "@/lib/use-documents";
import type { SafeUser } from "@/lib/types";

// How long to wait after the user stops typing before the search endpoint
// is actually called - short enough to feel responsive, long enough to
// avoid a request per keystroke. Plain setTimeout, no new dependency.
const SEARCH_DEBOUNCE_MS = 300;

// New alongside the existing /projects/[id] (tasks) and
// /projects/[id]/chat routes, which are left entirely untouched. Auth
// handling mirrors both of those exactly (same useApiData("/auth/me") +
// redirect pattern) since this page needs the identical guard.
export default function ProjectDocsPage() {
  // useParams() rather than use(props.params) - see the identical
  // comment in the sibling tasks/chat pages for why (client-safe, never
  // suspends mid client-side transition).
  const projectId = useParams<{ id: string }>().id;
  const router = useRouter();

  const { data: user, loading: authLoading, error: authError } = useApiData(
    () => api.get<{ user: SafeUser }>("/auth/me").then((res) => res.user),
    [],
  );

  useEffect(() => {
    if (!authLoading && authError) {
      router.replace("/login");
    }
  }, [authLoading, authError, router]);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const { documents, loading, error, refresh, createDocument, updateDocument, archiveDocument } = useDocuments(
    projectId,
    { query: debouncedSearch },
  );

  if (authLoading || authError || !user) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <Button variant="ghost" size="sm" className="w-fit gap-1.5" asChild>
          <Link href={`/projects/${projectId}`}>
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to tasks
          </Link>
        </Button>
      </div>

      <section aria-labelledby="docs-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 id="docs-heading" className="text-lg font-semibold text-foreground">
            Documents
          </h1>
          <CreateDocSheet onCreate={createDocument} />
        </div>

        <DocSearchInput value={searchInput} onChange={setSearchInput} />

        <DocList
          documents={documents}
          loading={loading}
          error={error}
          onRetry={refresh}
          onUpdate={updateDocument}
          onArchive={archiveDocument}
          searchQuery={debouncedSearch.trim()}
        />
      </section>
    </main>
  );
}
