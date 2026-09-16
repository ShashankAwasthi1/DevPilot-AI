import type { EmbeddingProvider } from "./embedding-provider";

// Runs fully locally via ONNX Runtime (no network call at inference time,
// no API key, no per-request cost) - replaces the removed
// OpenAIEmbeddingProvider so RAG works without a paid API. Model weights
// are downloaded from Hugging Face on first use and cached on disk by
// @xenova/transformers itself; nothing else in this file touches the
// network.
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const DIMENSIONS = 384;

// The feature-extraction pipeline this model needs, typed narrowly to only
// what this file calls - the real type comes from @xenova/transformers,
// which ships its own types, but importing its full surface just for this
// shape isn't necessary.
type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: ArrayLike<number>; dims: number[] }>;

// Lazily created and cached at module scope - loaded once per process
// (first embed() call, from whichever request happens to trigger it
// first), then reused for every subsequent call. Never re-created per
// request. A single in-flight promise (not just a resolved value) is
// cached so concurrent first calls await the same load instead of
// triggering the download/init twice.
let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function loadPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = import("@xenova/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", MODEL_NAME) as unknown as Promise<FeatureExtractionPipeline>,
    );
  }
  return pipelinePromise;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local-all-MiniLM-L6-v2";
  readonly dimensions = DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const extractor = await loadPipeline();

    let output: { data: ArrayLike<number>; dims: number[] };
    try {
      output = await extractor(texts, { pooling: "mean", normalize: true });
    } catch {
      // Never surface the underlying error object here - keep the message
      // fixed and generic, same convention as the provider this replaces.
      throw new Error("Could not run the local embedding model.");
    }

    // With pooling applied, the pipeline returns one flat Float32Array
    // covering all inputs back-to-back: dims = [texts.length, DIMENSIONS].
    const [count, rowDimensions] = output.dims;
    if (count !== texts.length) {
      throw new Error(
        `Embedding provider returned ${count} embeddings for ${texts.length} inputs.`,
      );
    }
    if (rowDimensions !== DIMENSIONS) {
      throw new Error(
        `Embedding provider returned ${rowDimensions} dimensions, expected ${DIMENSIONS}.`,
      );
    }

    const flat = output.data;
    const results: number[][] = [];
    for (let row = 0; row < count; row++) {
      const vector: number[] = new Array(DIMENSIONS);
      for (let col = 0; col < DIMENSIONS; col++) {
        const value = flat[row * DIMENSIONS + col];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error(`Embedding at position ${row} contained a non-finite value.`);
        }
        vector[col] = value;
      }
      results.push(vector);
    }
    return results;
  }
}
