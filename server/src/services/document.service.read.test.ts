import { test } from "node:test";
import assert from "node:assert/strict";

// Phase 26 Step 6: getDocumentForProject/listDocumentsForProject had no
// dedicated focused tests before this step - added here specifically to
// verify indexStatus is exposed on the read paths (get/list), the same
// way it already is on create/update/archive. Both functions are thin
// wrappers around toDocumentDto, so these tests double as regression
// coverage for the DTO mapping in general, not just this one new field.

function baseDocumentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    projectId: "project-1",
    authorId: "user-1",
    title: "Runbook",
    content: "Restart the service with systemctl restart api.",
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    indexStatus: "READY",
    ...overrides,
  };
}

function mockModules(
  t: import("node:test").TestContext,
  options: { document?: Record<string, unknown>; documents?: Record<string, unknown>[] } = {},
) {
  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { archivedAt: null }, role: "MEMBER" }),
    },
  });
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        document: {
          findFirst: async () => options.document ?? null,
          findMany: async () => options.documents ?? [],
        },
      },
    },
  });
}

let importCounter = 0;
function importFreshService() {
  return import(`./document.service?test=${importCounter++}`) as Promise<typeof import("./document.service")>;
}

// --- getDocumentForProject --------------------------------------------

for (const status of ["PENDING", "READY", "FAILED"] as const) {
  test(`getDocumentForProject: a document with indexStatus ${status} returns indexStatus: "${status}"`, async (t) => {
    mockModules(t, { document: baseDocumentRow({ indexStatus: status }) });

    const { getDocumentForProject } = await importFreshService();
    const result = await getDocumentForProject("user-1", "project-1", "doc-1");

    assert.equal(result.indexStatus, status);
  });
}

test("getDocumentForProject: every other existing field is preserved unchanged alongside the new indexStatus field", async (t) => {
  mockModules(t, { document: baseDocumentRow() });

  const { getDocumentForProject } = await importFreshService();
  const result = await getDocumentForProject("user-1", "project-1", "doc-1");

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
  assert.equal(result.id, "doc-1");
  assert.equal(result.projectId, "project-1");
  assert.equal(result.authorId, "user-1");
  assert.equal(result.title, "Runbook");
  assert.equal(result.content, "Restart the service with systemctl restart api.");
  assert.equal(result.archivedAt, null);
});

// --- listDocumentsForProject --------------------------------------------

test("listDocumentsForProject: each document in the list response exposes its own indexStatus", async (t) => {
  mockModules(t, {
    documents: [
      baseDocumentRow({ id: "doc-1", indexStatus: "READY" }),
      baseDocumentRow({ id: "doc-2", indexStatus: "PENDING" }),
      baseDocumentRow({ id: "doc-3", indexStatus: "FAILED" }),
    ],
  });

  const { listDocumentsForProject } = await importFreshService();
  const result = await listDocumentsForProject("user-1", "project-1", { limit: 20 });

  assert.deepEqual(
    result.documents.map((doc) => ({ id: doc.id, indexStatus: doc.indexStatus })),
    [
      { id: "doc-1", indexStatus: "READY" },
      { id: "doc-2", indexStatus: "PENDING" },
      { id: "doc-3", indexStatus: "FAILED" },
    ],
  );
});

test("listDocumentsForProject: the list envelope shape (documents/nextCursor) is unchanged", async (t) => {
  mockModules(t, { documents: [baseDocumentRow()] });

  const { listDocumentsForProject } = await importFreshService();
  const result = await listDocumentsForProject("user-1", "project-1", { limit: 20 });

  assert.deepEqual(Object.keys(result).sort(), ["documents", "nextCursor"]);
  assert.equal(result.nextCursor, null);
});
