import { test } from "node:test";
import assert from "node:assert/strict";

test("createDocument sets indexStatus PENDING in the same transaction that creates the document, and preserves the existing create/index/response behavior", async (t) => {
  let createDataCapture: Record<string, unknown> | undefined;
  let recordActivityCalledWith: unknown;
  let indexDocumentCalledWith: string | undefined;

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { archivedAt: null }, role: "OWNER" }),
      assertRole: () => {},
    },
  });
  t.mock.module("./activity.service", {
    namedExports: {
      recordActivity: async (_tx: unknown, args: unknown) => {
        recordActivityCalledWith = args;
      },
    },
  });
  t.mock.module("./document-indexing.service", {
    namedExports: {
      indexDocument: async (documentId: string) => {
        indexDocumentCalledWith = documentId;
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
              create: async ({ data }: { data: Record<string, unknown> }) => {
                createDataCapture = data;
                return {
                  id: "doc-new",
                  projectId: data.projectId,
                  authorId: data.authorId,
                  title: data.title,
                  content: data.content,
                  archivedAt: null,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  // Echoes back exactly what was written, the same way
                  // Prisma's own create() returns the persisted row.
                  indexStatus: data.indexStatus,
                };
              },
            },
          }),
      },
    },
  });

  const { createDocument } = await import("./document.service");

  const result = await createDocument("user-1", "project-1", { title: "Title", content: "Content" });

  // Phase 26: PENDING is set explicitly inside document.create()'s own
  // data object - not left to rely on the column's default - alongside
  // every field the create path already wrote.
  assert.equal(createDataCapture?.indexStatus, "PENDING");
  assert.equal(createDataCapture?.projectId, "project-1");
  assert.equal(createDataCapture?.authorId, "user-1");
  assert.equal(createDataCapture?.title, "Title");
  assert.equal(createDataCapture?.content, "Content");

  // Existing behavior is unaffected: an Activity row is still recorded,
  // indexAfterCommit still runs (against the new document's real id) once
  // the transaction has committed, and every pre-existing DocumentDto
  // field is still present. Phase 26 Step 6: the response also now
  // exposes indexStatus - read straight off the created row, matching
  // exactly what was just written (PENDING), never recalculated.
  assert.ok(recordActivityCalledWith);
  assert.equal(indexDocumentCalledWith, "doc-new");
  assert.equal(result.id, "doc-new");
  assert.equal(result.indexStatus, "PENDING");
  assert.deepEqual(Object.keys(result).sort(), [
    "archivedAt",
    "authorId",
    "content",
    "createdAt",
    "id",
    "indexStatus",
    "projectId",
    "title",
    "updatedAt",
  ]);
});
