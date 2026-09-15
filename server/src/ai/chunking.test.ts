import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument } from "./chunking";
import { AI_LIMITS } from "./limits";

// Pure function, no I/O - no module mocking needed anywhere in this file.

test("empty string returns no chunks", () => {
  assert.deepEqual(chunkDocument(""), []);
});

test("whitespace-only document returns no chunks", () => {
  assert.deepEqual(chunkDocument("   \n\n\t  \n  "), []);
});

test("one short paragraph becomes a single chunk", () => {
  const chunks = chunkDocument("Just one short paragraph.");
  assert.deepEqual(chunks, ["Just one short paragraph."]);
});

test("multiple paragraphs that fit together stay in one chunk", () => {
  const content = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
  const chunks = chunkDocument(content);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], content);
});

test("multiple paragraphs requiring multiple chunks split correctly", () => {
  const p1 = "1".repeat(700);
  const p2 = "2".repeat(700);
  const p3 = "3".repeat(100);
  const chunks = chunkDocument(`${p1}\n\n${p2}\n\n${p3}`);

  // p1 alone in chunk 0 (p1+p2 combined would be 1402, over the 1200 cap).
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], p1);

  // chunk 1 is seeded with the last CHUNK_OVERLAP_CHARS of chunk 0, then p2
  // and p3 both fit after that (150 + 2 + 700 + 2 + 100 = 954).
  const expectedOverlap = p1.slice(-AI_LIMITS.CHUNK_OVERLAP_CHARS);
  assert.equal(chunks[1], `${expectedOverlap}\n\n${p2}\n\n${p3}`);
  assert.equal(chunks[1].length, 954);
});

test("paragraphs combining to exactly MAX_CHUNK_CHARS stay in one chunk", () => {
  const pA = "A".repeat(600);
  const pB = "B".repeat(598); // 600 + 2 (\n\n) + 598 = 1200 exactly
  const chunks = chunkDocument(`${pA}\n\n${pB}`);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, AI_LIMITS.MAX_CHUNK_CHARS);
});

test("one character past MAX_CHUNK_CHARS forces a second chunk", () => {
  const pA = "A".repeat(600);
  const pB = "B".repeat(599); // 600 + 2 + 599 = 1201, one over the cap
  const chunks = chunkDocument(`${pA}\n\n${pB}`);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], pA);
  assert.equal(chunks[0].length, 600);

  // chunk 1 = overlap(last 150 of pA, which is all "A") + "\n\n" + pB
  assert.equal(chunks[1].length, AI_LIMITS.CHUNK_OVERLAP_CHARS + 2 + pB.length);
  assert.ok(chunks[1].startsWith("A".repeat(AI_LIMITS.CHUNK_OVERLAP_CHARS)));
  assert.ok(chunks[1].endsWith(pB));
});

test("a single paragraph larger than MAX_CHUNK_CHARS is hard-split with overlap", () => {
  const big = "X".repeat(1400);
  const chunks = chunkDocument(big);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, AI_LIMITS.MAX_CHUNK_CHARS);
  // Second piece starts at (first end - overlap) and runs to the end:
  // 1400 - (1200 - 150) = 350.
  assert.equal(chunks[1].length, 350);

  // The overlap region (last 150 chars of chunk 0) must equal the first
  // 150 chars of chunk 1 - content is uniform "X" here, so this mainly
  // confirms the arithmetic, not the text itself.
  assert.equal(chunks[0].slice(-AI_LIMITS.CHUNK_OVERLAP_CHARS), chunks[1].slice(0, AI_LIMITS.CHUNK_OVERLAP_CHARS));

  // No information lost: concatenating unique halves reconstructs the
  // original length range.
  assert.equal(chunks[0].length + chunks[1].length - AI_LIMITS.CHUNK_OVERLAP_CHARS, big.length);
});

test("Unicode content is chunked without corruption", () => {
  const content = "Héllo wörld — this is a paragraph with accénts and an em dash.\n\n日本語のテキストも問題なく扱えます。これは二番目の段落です。";
  const chunks = chunkDocument(content);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], content);
});

test("never splits a UTF-16 surrogate pair (emoji) in the middle", () => {
  const prefix = "A".repeat(1199); // boundary would naively land mid-emoji
  const emoji = "\u{1F600}"; // high+low surrogate pair
  const suffix = "B".repeat(300);
  const content = prefix + emoji + suffix;

  const chunks = chunkDocument(content);

  // The emoji must appear intact in some chunk, never as a lone surrogate.
  assert.ok(chunks.some((chunk) => chunk.includes(emoji)));

  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const code = chunk.charCodeAt(i);
      const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
      const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;
      if (isHighSurrogate) {
        assert.ok(
          i + 1 < chunk.length && chunk.charCodeAt(i + 1) >= 0xdc00 && chunk.charCodeAt(i + 1) <= 0xdfff,
          `lone high surrogate at index ${i}`,
        );
      }
      if (isLowSurrogate) {
        assert.ok(
          i > 0 && chunk.charCodeAt(i - 1) >= 0xd800 && chunk.charCodeAt(i - 1) <= 0xdbff,
          `lone low surrogate at index ${i}`,
        );
      }
    }
  }
});

test("identical input always produces identical output (deterministic)", () => {
  const content = "Para one.\n\n" + "B".repeat(1500) + "\n\nPara three with more text to pack.";
  const first = chunkDocument(content);
  const second = chunkDocument(content);
  assert.deepEqual(first, second);
});

test("caps output at MAX_CHUNKS_PER_DOCUMENT and logs a warning", (t) => {
  const paragraphs = Array.from(
    { length: 250 },
    (_, i) => `${String(i).padStart(4, "0")}${"Y".repeat(1096)}`,
  );
  const content = paragraphs.join("\n\n");

  const warnCalls: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => {
    warnCalls.push(args);
  });

  const chunks = chunkDocument(content);

  assert.equal(chunks.length, AI_LIMITS.MAX_CHUNKS_PER_DOCUMENT);
  assert.equal(warnCalls.length, 1);
  assert.match(String(warnCalls[0][0]), /250 chunks, truncating to 200/);

  // The kept chunks are the first 200, in original order - the 200th
  // (index 199) still corresponds to source paragraph 0199, seeded with
  // overlap from paragraph 0198's tail.
  assert.ok(chunks[0].includes("0000"));
  assert.ok(chunks[199].includes("0199"));
});

test("more than MAX_CHUNKS_PER_DOCUMENT chunks are truncated, not merged or dropped from the start", () => {
  const paragraphs = Array.from({ length: 210 }, (_, i) => `${i}${"Z".repeat(1150)}`);
  const content = paragraphs.join("\n\n");
  const chunks = chunkDocument(content);
  assert.equal(chunks.length, AI_LIMITS.MAX_CHUNKS_PER_DOCUMENT);
});
