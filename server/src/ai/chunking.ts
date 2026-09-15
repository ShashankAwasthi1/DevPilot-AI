import { AI_LIMITS } from "./limits";

// Deterministic, dependency-free document chunking for RAG indexing. Pure
// function of `content` only - no I/O, no randomness, no environment
// access - so the same document always produces the same chunks, which is
// required for idempotent re-indexing (see document-index.service.ts, a
// later Phase 14 step).
//
// Algorithm: split on paragraph breaks, then greedily pack consecutive
// paragraphs into a chunk until the next one would exceed MAX_CHUNK_CHARS.
// When a chunk is full, the next one starts with the last
// CHUNK_OVERLAP_CHARS of the previous chunk, so a sentence split across a
// boundary still has surrounding context on both sides. A single paragraph
// larger than MAX_CHUNK_CHARS on its own is hard-split using the same
// overlap strategy. The document title is never included here - only
// `content` is chunked.
const PARAGRAPH_SPLIT = /\n\s*\n/;

export function chunkDocument(content: string): string[] {
  const trimmed = content.trim();
  if (trimmed.length === 0) return [];

  const paragraphs = trimmed
    .split(PARAGRAPH_SPLIT)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > AI_LIMITS.MAX_CHUNK_CHARS) {
      if (current.length > 0) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...hardSplit(paragraph));
      continue;
    }

    if (current.length === 0) {
      current = paragraph;
      continue;
    }

    const candidate = `${current}\n\n${paragraph}`;
    if (candidate.length <= AI_LIMITS.MAX_CHUNK_CHARS) {
      current = candidate;
    } else {
      chunks.push(current);
      // Seed the next chunk with overlap from the one just closed. Not
      // applied when the previous chunk came from a hard split (current is
      // reset to "" in that branch above) - a hard-split fragment is a raw
      // mid-paragraph cut, not a paragraph-aligned unit, so mixing it into
      // an unrelated following paragraph would be more confusing than
      // useful.
      const overlap = takeOverlapSuffix(current, AI_LIMITS.CHUNK_OVERLAP_CHARS);
      current = overlap.length > 0 ? `${overlap}\n\n${paragraph}` : paragraph;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  if (chunks.length > AI_LIMITS.MAX_CHUNKS_PER_DOCUMENT) {
    console.warn(
      `chunkDocument: document produced ${chunks.length} chunks, truncating to ${AI_LIMITS.MAX_CHUNKS_PER_DOCUMENT}`,
    );
    return chunks.slice(0, AI_LIMITS.MAX_CHUNKS_PER_DOCUMENT);
  }

  return chunks;
}

// Hard-splits text with no usable paragraph breaks into MAX_CHUNK_CHARS
// pieces, carrying the same CHUNK_OVERLAP_CHARS overlap between
// consecutive pieces.
function hardSplit(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = adjustForSurrogatePair(text, Math.min(start + AI_LIMITS.MAX_CHUNK_CHARS, text.length));
    pieces.push(text.slice(start, end));

    if (end >= text.length) break;

    const nextStart = adjustForSurrogatePair(text, end - AI_LIMITS.CHUNK_OVERLAP_CHARS);
    // Guard against zero/negative progress (only possible if
    // CHUNK_OVERLAP_CHARS were misconfigured to be >= MAX_CHUNK_CHARS).
    start = nextStart > start ? nextStart : end;
  }

  return pieces;
}

// The last (approximately) `maxChars` characters of `text`, never starting
// in the middle of a surrogate pair.
function takeOverlapSuffix(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const start = adjustForSurrogatePair(text, text.length - maxChars);
  return text.slice(start);
}

// If slicing at `index` would fall between a UTF-16 surrogate pair (a high
// surrogate immediately followed by its low surrogate - e.g. most emoji),
// shift forward by one code unit so the pair stays together. Used for both
// chunk-end and chunk-start boundaries, since a slice boundary either way
// is the same gap position in the string.
function adjustForSurrogatePair(text: string, index: number): number {
  if (index <= 0 || index >= text.length) return index;
  const before = text.charCodeAt(index - 1);
  const isHighSurrogate = before >= 0xd800 && before <= 0xdbff;
  return isHighSurrogate ? index + 1 : index;
}
