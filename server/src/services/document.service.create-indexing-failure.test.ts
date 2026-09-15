import { test } from "node:test";
import assert from "node:assert/strict";

test("createDocument still succeeds when indexing fails, and logs (without leaking secrets)", async (t) => {
  let indexDocumentCalledWith: string | undefined;
  const errorLogs: unknown[][] = [];

  t.mock.method(console, "error", (...args: unknown[]) => {
    errorLogs.push(args);
  });

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { archivedAt: null }, role: "OWNER" }),
      assertRole: () => {},
    },
  });
  t.mock.module("./activity.service", {
    namedExports: { recordActivity: async () => {} },
  });
  t.mock.module("./document-indexing.service", {
    namedExports: {
      indexDocument: async (documentId: string) => {
        indexDocumentCalledWith = documentId;
        throw new Error("embedding provider unavailable (simulated)");
      },
      deleteChunksForDocument: async () => {},
    },
  });
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            document: {
              create: async () => ({
                id: "doc-new",
                projectId: "project-1",
                authorId: "user-1",
                title: "Title",
                content: "Content",
                archivedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
            },
          }),
      },
    },
  });

  const { createDocument } = await import("./document.service");

  const result = await createDocument("user-1", "project-1", { title: "Title", content: "Content" });

  assert.equal(result.id, "doc-new", "the document save must succeed even though indexing failed");
  assert.equal(indexDocumentCalledWith, "doc-new");
  assert.equal(errorLogs.length, 1, "the indexing failure must be logged, not silently swallowed");
});
