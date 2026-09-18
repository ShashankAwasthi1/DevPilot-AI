import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError";

function mockCommonModules(
  t: import("node:test").TestContext,
  options: {
    existingDocument?: Record<string, unknown>;
    updateDataCapture?: { value?: Record<string, unknown> };
    recordActivityCalls?: unknown[];
    indexDocumentCalls?: string[];
  } = {},
) {
  const existingDocument =
    options.existingDocument ??
    ({
      id: "doc-1",
      projectId: "project-1",
      authorId: "user-1",
      title: "Original title",
      content: "Original content",
      archivedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    } as Record<string, unknown>);

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { archivedAt: null }, role: "OWNER" }),
      assertRole: () => {},
    },
  });
  t.mock.module("./activity.service", {
    namedExports: {
      recordActivity: async (_tx: unknown, args: unknown) => {
        options.recordActivityCalls?.push(args);
      },
    },
  });
  t.mock.module("./document-indexing.service", {
    namedExports: {
      indexDocument: async (documentId: string) => {
        options.indexDocumentCalls?.push(documentId);
      },
      deleteChunksForDocument: async () => {},
    },
  });
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        document: {
          findFirst: async () => existingDocument,
        },
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            document: {
              update: async ({ data }: { data: Record<string, unknown> }) => {
                if (options.updateDataCapture) options.updateDataCapture.value = data;
                return { ...existingDocument, ...data, updatedAt: new Date() };
              },
            },
          }),
      },
    },
  });
}

// "./document.service" is only ever evaluated once per resolved specifier
// - a later t.mock.module call does not retroactively change the
// bindings a module already captured on its first import. A unique query
// string per test forces a fresh module instance, so each test's own
// mocks actually take effect.
let importCounter = 0;
function importFreshService() {
  return import(`./document.service?test=${importCounter++}`) as Promise<typeof import("./document.service")>;
}

test("updateDocument sets indexStatus PENDING in the same transaction that saves the new content, alongside the updated fields", async (t) => {
  const updateDataCapture: { value?: Record<string, unknown> } = {};
  const indexDocumentCalls: string[] = [];
  mockCommonModules(t, { updateDataCapture, indexDocumentCalls, recordActivityCalls: [] });

  const { updateDocument } = await importFreshService();

  const result = await updateDocument("user-1", "project-1", "doc-1", { title: "New title" });

  // Phase 26: PENDING is set in the exact same data object as the actual
  // field change - never a second write - and the caller's own fields
  // (only `title` here) are preserved untouched alongside it.
  assert.deepEqual(updateDataCapture.value, { title: "New title", indexStatus: "PENDING" });

  // indexAfterCommit runs against the just-updated document's id, after
  // the transaction (which set PENDING) has already committed.
  assert.equal(indexDocumentCalls.length, 1);
  assert.equal(indexDocumentCalls[0], "doc-1");

  assert.equal(result.title, "New title");
  // Phase 26 Step 6: the update endpoint's own response (a DocumentDto)
  // also exposes indexStatus, read straight off the just-updated row.
  assert.equal(result.indexStatus, "PENDING");
});

test("updateDocument: an update that changes only content still sets indexStatus PENDING (any content/title change invalidates existing chunks)", async (t) => {
  const updateDataCapture: { value?: Record<string, unknown> } = {};
  mockCommonModules(t, { updateDataCapture, indexDocumentCalls: [], recordActivityCalls: [] });

  const { updateDocument } = await importFreshService();

  await updateDocument("user-1", "project-1", "doc-1", { content: "New content" });

  assert.deepEqual(updateDataCapture.value, { content: "New content", indexStatus: "PENDING" });
});

test("updateDocument: updating an already-archived document is still rejected with 409, before any transaction/indexStatus write - existing stale-write protection is unchanged", async (t) => {
  const updateDataCapture: { value?: Record<string, unknown> } = {};
  const indexDocumentCalls: string[] = [];
  mockCommonModules(t, {
    existingDocument: {
      id: "doc-1",
      projectId: "project-1",
      authorId: "user-1",
      title: "Original title",
      content: "Original content",
      archivedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    updateDataCapture,
    indexDocumentCalls,
    recordActivityCalls: [],
  });

  const { updateDocument } = await importFreshService();

  await assert.rejects(
    () => updateDocument("user-1", "project-1", "doc-1", { title: "New title" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.message, "Cannot update an archived document");
      return true;
    },
  );

  // Rejected before ever opening the transaction - no field, and
  // certainly no indexStatus, was ever written.
  assert.equal(updateDataCapture.value, undefined);
  assert.equal(indexDocumentCalls.length, 0);
});
