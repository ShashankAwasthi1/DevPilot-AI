import { env } from "../config/env";
import { warmUpEmbeddingModel } from "./local-embedding-provider";

// Optional, best-effort embedding-model warm-up, meant to be called once at
// server startup (see server.ts) - gated behind EMBEDDING_MODEL_WARMUP so
// warmUpEmbeddingModel() is never even called unless explicitly enabled,
// keeping local `npm run dev` restarts fast by default. Deliberately
// fire-and-forget (returns void, not a Promise the caller must await):
// server startup must never wait on this before accepting connections, and
// a failure here must never crash the process or block startup - the model
// still loads lazily on first real use either way, via the same
// warmUpEmbeddingModel()/loadPipeline() this reuses (see
// local-embedding-provider.ts). Only fixed, generic messages are ever
// logged - never the underlying error object, which could carry
// filesystem paths or provider-internal detail.
export function runEmbeddingModelWarmUp(): void {
  if (!env.embeddingModelWarmupEnabled) return;

  console.log("Starting embedding model warm-up...");
  warmUpEmbeddingModel()
    .then(() => {
      console.log("Embedding model warm-up complete.");
    })
    .catch(() => {
      console.error("Embedding model warm-up failed; the model will load lazily on first use instead.");
    });
}
