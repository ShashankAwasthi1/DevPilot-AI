// Framework-independent interface every embedding-backed feature depends
// on - no controller/service imports a specific embedding provider's HTTP
// details directly, only this interface. Deliberately separate from
// AIProvider (chat/generation, see provider.ts): embeddings and text
// generation are different capabilities, and this project's Claude
// provider remains responsible only for generation, never embeddings.
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;

  // One embedding vector per input text, in the same order as `texts`.
  // Implementations must reject (throw) rather than return a
  // partial/malformed result if the provider's response doesn't match the
  // expected shape (wrong count, wrong dimension, non-finite values).
  embed(texts: string[]): Promise<number[][]>;
}
