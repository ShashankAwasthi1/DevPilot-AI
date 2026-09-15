import { test } from "node:test";
import assert from "node:assert/strict";

const SAME_UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");

test("indexDocument: chunks content, embeds all chunks, and stores matching chunk rows with correct charCount", async (t) => {
  // Two paragraphs, forced into two separate chunks (each on its own,
  // well under MAX_CHUNK_CHARS combined would still fit in one chunk - use
  // content large enough to force two chunks deterministically).
  const paragraphA = "Alpha ".repeat(250); // ~1500 chars
  const paragraphB = "Beta ".repeat(250); // ~1250 chars
  const content = `${paragraphA}\n\n${paragraphB}`;

  const document = {
    id: "doc-1",
    projectId: "project-1",
    content,
    updatedAt: SAME_UPDATED_AT,
  };

  const insertedRows: { values: unknown[] }[] = [];
  const deleteManyCalls: unknown[] = [];
  let embedCalledWith: string[][] = [];

  const fakeTx = {
    document: {
      findUnique: async () => ({ updatedAt: SAME_UPDATED_AT }),
    },
    documentChunk: {
      deleteMany: async (args: unknown) => {
        deleteManyCalls.push(args);
        return { count: 0 };
      },
    },
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      insertedRows.push({ values });
      return 1;
    },
  };

  const fakePrisma = {
    document: {
      findUnique: async () => document,
    },
    documentChunk: {
      deleteMany: async (args: unknown) => {
        deleteManyCalls.push(args);
        return { count: 0 };
      },
    },
    $transaction: async (callback: (tx: typeof fakeTx) => Promise<void>) => callback(fakeTx),
  };

  t.mock.module("../config/prisma", { namedExports: { prisma: fakePrisma } });
  t.mock.module("../ai", {
    namedExports: {
      getEmbeddingProvider: () => ({
        name: "fake",
        dimensions: 1536,
        embed: async (texts: string[]) => {
          embedCalledWith.push(texts);
          return texts.map((_, i) => Array.from({ length: 1536 }, () => i + 1));
        },
      }),
    },
  });

  const { indexDocument } = await import("./document-indexing.service");
  await indexDocument("doc-1");

  // Chunked into (at least) two pieces, and all chunks embedded in one
  // batch call (well under EMBEDDING_BATCH_SIZE).
  assert.equal(embedCalledWith.length, 1);
  const chunks = embedCalledWith[0];
  assert.ok(chunks.length >= 2, `expected at least 2 chunks, got ${chunks.length}`);

  // One insert per chunk, in the same order, with matching charCount.
  assert.equal(insertedRows.length, chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    const values = insertedRows[i].values;
    // Insert order: id, documentId, projectId, chunkIndex, content, charCount, vectorLiteral
    const [, documentId, projectId, chunkIndex, insertedContent, charCount] = values;
    assert.equal(documentId, "doc-1");
    assert.equal(projectId, "project-1");
    assert.equal(chunkIndex, i);
    assert.equal(insertedContent, chunks[i]);
    assert.equal(charCount, chunks[i].length, "charCount must equal the chunk's actual content length");
  }

  // Old chunks are deleted (inside the transaction) before the new ones
  // are inserted.
  assert.equal(deleteManyCalls.length, 1);
  assert.deepEqual(deleteManyCalls[0], { where: { documentId: "doc-1" } });
});
