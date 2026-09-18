import { test } from "node:test";
import assert from "node:assert/strict";

test("archiveDocument deletes the document's chunks and sets indexStatus READY in the same transaction", async (t) => {
  let deleteChunksCalledWith: string | undefined;
  let updateDataCapture: { archivedAt: Date; indexStatus: string } | undefined;

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
      indexDocument: async () => {},
      deleteChunksForDocument: async (_tx: unknown, documentId: string) => {
        deleteChunksCalledWith = documentId;
      },
    },
  });
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        document: {
          findFirst: async () => ({
            id: "doc-1",
            projectId: "project-1",
            authorId: "user-1",
            title: "Title",
            content: "Content",
            archivedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        },
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            document: {
              update: async ({ data }: { data: { archivedAt: Date; indexStatus: string } }) => {
                updateDataCapture = data;
                return {
                  id: "doc-1",
                  projectId: "project-1",
                  authorId: "user-1",
                  title: "Title",
                  content: "Content",
                  archivedAt: data.archivedAt,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  // Echoes back exactly what was written, the same way
                  // Prisma's own update() returns the persisted row.
                  indexStatus: data.indexStatus,
                };
              },
            },
          }),
      },
    },
  });

  const { archiveDocument } = await import("./document.service");
  const result = await archiveDocument("user-1", "project-1", "doc-1");

  assert.equal(deleteChunksCalledWith, "doc-1");
  // Phase 26 Step 3: READY (zero chunks = no indexing work remaining),
  // never a separate ARCHIVED status, set in the exact same
  // tx.document.update() call that saves archivedAt - not a second write.
  assert.equal(updateDataCapture?.indexStatus, "READY");
  assert.ok(updateDataCapture?.archivedAt instanceof Date);
  // Phase 26 Step 6: the archive endpoint's own response (a DocumentDto)
  // also exposes indexStatus, read straight off the just-updated row.
  assert.equal(result.indexStatus, "READY");
});
