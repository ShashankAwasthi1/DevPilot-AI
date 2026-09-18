import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_LIMITS } from "../ai/limits";
import { escapeLikePattern } from "./document-retrieval.service";

// --- escapeLikePattern (pure function) -------------------------------------

test("escapeLikePattern: escapes %, _, and \\ so a literal search term is never treated as a wildcard/escape character", () => {
  assert.equal(escapeLikePattern("50%"), "50\\%");
  assert.equal(escapeLikePattern("a_b"), "a\\_b");
  assert.equal(escapeLikePattern("back\\slash"), "back\\\\slash");
  assert.equal(escapeLikePattern("100%_off\\now"), "100\\%\\_off\\\\now");
});

test("escapeLikePattern: leaves ordinary text completely unchanged", () => {
  assert.equal(escapeLikePattern("how do I authenticate?"), "how do I authenticate?");
  assert.equal(escapeLikePattern(""), "");
});

// --- The lexical query wired into retrieveRelevantChunks -------------------

// "./document-retrieval.service" is only ever evaluated once per resolved
// specifier - a unique query string per test forces a fresh module
// instance, so each test's own mocks actually take effect.
let importCounter = 0;
function importFreshService() {
  return import(`./document-retrieval.service?test=${importCounter++}`) as Promise<
    typeof import("./document-retrieval.service")
  >;
}

function mockModules(
  t: import("node:test").TestContext,
  options: {
    lexicalRows?: unknown[];
    onLexicalQuery?: (strings: TemplateStringsArray, values: unknown[]) => void;
  } = {},
) {
  const lexicalRows = options.lexicalRows ?? [];

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { archivedAt: null }, role: "OWNER" }),
    },
  });
  t.mock.module("../ai", {
    namedExports: {
      getEmbeddingProvider: () => ({
        name: "fake",
        dimensions: 384,
        embed: async () => [Array.from({ length: 384 }, () => 0.1)],
      }),
    },
  });
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings.join("").includes("ILIKE")) {
            options.onLexicalQuery?.(strings, values);
            return lexicalRows;
          }
          return []; // no vector candidates for these lexical-focused tests
        },
      },
    },
  });
}

test("retrieveRelevantChunks: the lexical query is issued against document_chunks, joined to documents for metadata", async (t) => {
  let capturedStrings: TemplateStringsArray | undefined;
  mockModules(t, { onLexicalQuery: (strings) => (capturedStrings = strings) });

  const { retrieveRelevantChunks } = await importFreshService();
  await retrieveRelevantChunks("u1", "project-a", "authentication", 5);

  const sql = capturedStrings!.join("");
  assert.match(sql, /FROM\s+document_chunks\s+dc/);
  assert.match(sql, /JOIN\s+documents\s+d\s+ON\s+d\.id\s*=\s*dc\."documentId"/);
});

test("retrieveRelevantChunks: the lexical query is scoped by projectId, as a bound parameter, never inlined into the SQL text", async (t) => {
  let capturedStrings: TemplateStringsArray | undefined;
  let capturedValues: unknown[] = [];
  mockModules(t, {
    onLexicalQuery: (strings, values) => {
      capturedStrings = strings;
      capturedValues = values;
    },
  });

  const { retrieveRelevantChunks } = await importFreshService();
  await retrieveRelevantChunks("u1", "project-a", "authentication", 5);

  assert.match(capturedStrings!.join(""), /WHERE\s+dc\."projectId"\s*=/);
  assert.ok(capturedValues.includes("project-a"), "projectId must be a bound parameter");
  assert.equal(
    capturedStrings!.join("").includes("project-a"),
    false,
    "projectId must never appear inlined in the fixed SQL text",
  );
});

test("retrieveRelevantChunks: the lexical candidate limit is exactly AI_LIMITS.SEARCH_CANDIDATE_LIMIT (20)", async (t) => {
  let capturedValues: unknown[] = [];
  mockModules(t, { onLexicalQuery: (_strings, values) => (capturedValues = values) });

  const { retrieveRelevantChunks } = await importFreshService();
  // A limit far larger than 20 must still never widen the lexical LIMIT.
  await retrieveRelevantChunks("u1", "project-a", "authentication", AI_LIMITS.SEARCH_CANDIDATE_LIMIT + 30);

  assert.ok(capturedValues.includes(AI_LIMITS.SEARCH_CANDIDATE_LIMIT));
  assert.ok(!capturedValues.includes(AI_LIMITS.SEARCH_CANDIDATE_LIMIT + 30));
});

test("retrieveRelevantChunks: the lexical query pattern is the escaped user query wrapped in %...%, bound as a parameter", async (t) => {
  let capturedStrings: TemplateStringsArray | undefined;
  let capturedValues: unknown[] = [];
  mockModules(t, {
    onLexicalQuery: (strings, values) => {
      capturedStrings = strings;
      capturedValues = values;
    },
  });

  const { retrieveRelevantChunks } = await importFreshService();
  const rawQuery = "50% off_deals\\now";
  await retrieveRelevantChunks("u1", "project-a", rawQuery, 5);

  // Built the same way escapeLikePattern does, without duplicating its
  // regex directly (also covered as its own pure unit test above).
  const manuallyEscaped = rawQuery.replace(/[\\%_]/g, "\\$&");
  const expectedPattern = `%${manuallyEscaped}%`;

  assert.ok(capturedValues.includes(expectedPattern), "the bound pattern must be the escaped query wrapped in %...%");
  assert.equal(
    capturedStrings!.join("").includes(rawQuery),
    false,
    "the raw, unescaped user query must never be interpolated into the SQL text",
  );
});

test("retrieveRelevantChunks: explicit ILIKE ... ESCAPE '\\' is present in the lexical SQL text", async (t) => {
  let capturedStrings: TemplateStringsArray | undefined;
  mockModules(t, { onLexicalQuery: (strings) => (capturedStrings = strings) });

  const { retrieveRelevantChunks } = await importFreshService();
  await retrieveRelevantChunks("u1", "project-a", "authentication", 5);

  const sql = capturedStrings!.join("");
  assert.match(sql, /dc\.content\s+ILIKE/);
  assert.match(sql, /ESCAPE\s+'\\'/, "the SQL text must specify ESCAPE '\\' explicitly");
});

test("retrieveRelevantChunks: a lexical-only result (no vector match) receives the neutral distance placeholder of 1", async (t) => {
  mockModules(t, {
    lexicalRows: [
      {
        documentId: "doc-1",
        documentTitle: "Runbook",
        chunkId: "chunk-lex-1",
        chunkIndex: 0,
        content: "restart the service with systemctl restart api",
      },
    ],
  });

  const { retrieveRelevantChunks } = await importFreshService();
  const results = await retrieveRelevantChunks("u1", "project-a", "systemctl restart", 5);

  assert.equal(results.length, 1);
  assert.equal(results[0].chunkId, "chunk-lex-1");
  assert.equal(results[0].distance, 1, "a lexical-only chunk must carry the neutral distance placeholder, 1");
});

test("retrieveRelevantChunks: cross-project isolation holds for the lexical query too - a match scoped to another project is never returned", async (t) => {
  const capturedProjectIds: unknown[] = [];

  t.mock.module("./project.service", {
    namedExports: {
      getProjectAccess: async () => ({ project: { archivedAt: null }, role: "OWNER" }),
    },
  });
  t.mock.module("../ai", {
    namedExports: {
      getEmbeddingProvider: () => ({
        name: "fake",
        dimensions: 384,
        embed: async () => [Array.from({ length: 384 }, () => 0.1)],
      }),
    },
  });
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings.join("").includes("ILIKE")) {
            capturedProjectIds.push(values[0]);
            // A faithful mock would only ever return rows matching the
            // bound projectId - simulated here by simply never returning
            // a row for "other-project", proving the caller's own
            // projectId (never a different one) is what's bound.
            return [];
          }
          return [];
        },
      },
    },
  });

  const { retrieveRelevantChunks } = await importFreshService();
  await retrieveRelevantChunks("u1", "my-project", "shared keyword", 5);

  assert.deepEqual(capturedProjectIds, ["my-project"]);
});
