import { test } from "node:test";
import assert from "node:assert/strict";

test("archiveDocument deletes the document's chunks in the same transaction", async (t) => {
  let deleteChunksCalledWith: string | undefined;

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
              update: async ({ data }: { data: { archivedAt: Date } }) => ({
                id: "doc-1",
                projectId: "project-1",
                authorId: "user-1",
                title: "Title",
                content: "Content",
                archivedAt: data.archivedAt,
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
            },
          }),
      },
    },
  });

  const { archiveDocument } = await import("./document.service");
  await archiveDocument("user-1", "project-1", "doc-1");

  assert.equal(deleteChunksCalledWith, "doc-1");
});
