import { getEmbeddingConfig } from "../config/embedding";
import type { EmbeddingProvider } from "./embedding-provider";

// Plain fetch, not the openai SDK - the embeddings endpoint is one simple
// JSON POST/response, and pulling in a full SDK (whose surface area is
// almost entirely chat/assistants/fine-tuning we'd never use) is
// unnecessary weight for this one call, matching this project's existing
// "no unnecessary dependencies" pattern (see anthropic.provider.ts's own
// choice to use the official SDK only where streaming/tool-calling made a
// hand-rolled client genuinely harder, which doesn't apply here).
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;

// Only the fields we actually read, typed as `unknown` where the value is
// untrusted until validated below - never assumed to match this shape just
// because the HTTP call returned 2xx.
interface OpenAIEmbeddingItem {
  embedding: unknown;
  index: unknown;
}

interface OpenAIEmbeddingsResponse {
  data: unknown;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai-text-embedding-3-small";
  readonly dimensions = DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const config = getEmbeddingConfig();

    let response: Response;
    try {
      response = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: MODEL, input: texts }),
      });
    } catch {
      // Never surface the underlying network error object here - keep the
      // message fixed and generic rather than risk echoing request
      // details.
      throw new Error("Could not reach the embedding provider.");
    }

    if (!response.ok) {
      const bodyText = await safeReadBody(response, config.openaiApiKey);
      throw new Error(`Embedding provider returned ${response.status}: ${bodyText}`);
    }

    const parsed = (await response.json().catch(() => null)) as OpenAIEmbeddingsResponse | null;
    if (!parsed || !Array.isArray(parsed.data)) {
      throw new Error("Embedding provider returned an unexpected response shape.");
    }

    if (parsed.data.length !== texts.length) {
      throw new Error(
        `Embedding provider returned ${parsed.data.length} embeddings for ${texts.length} inputs.`,
      );
    }

    // The API is documented to return items in input order, but each item
    // also carries its own `index` - sort by it defensively rather than
    // trusting array order alone, so a provider quirk can never silently
    // scramble which embedding belongs to which input text.
    const items = parsed.data as OpenAIEmbeddingItem[];
    const sorted = [...items].sort((a, b) => toIndex(a.index) - toIndex(b.index));

    return sorted.map((item, position) => validateEmbedding(item.embedding, position, DIMENSIONS));
  }
}

function toIndex(value: unknown): number {
  return typeof value === "number" ? value : Number.MAX_SAFE_INTEGER;
}

function validateEmbedding(value: unknown, position: number, expectedDimensions: number): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`Embedding at position ${position} was not an array.`);
  }
  if (value.length !== expectedDimensions) {
    throw new Error(
      `Embedding at position ${position} had ${value.length} dimensions, expected ${expectedDimensions}.`,
    );
  }
  for (const n of value) {
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new Error(`Embedding at position ${position} contained a non-finite value.`);
    }
  }
  return value as number[];
}

// Reads the response body defensively for use in an error message: bounded
// length, never throws, and the API key is redacted from it even though a
// well-behaved provider would never echo it back - a deliberate
// defense-in-depth guarantee rather than an assumption about provider
// behavior.
async function safeReadBody(response: Response, apiKeyToRedact: string): Promise<string> {
  try {
    const text = await response.text();
    const redacted = text.split(apiKeyToRedact).join("[redacted]");
    return redacted.slice(0, 500);
  } catch {
    return "(no response body)";
  }
}
