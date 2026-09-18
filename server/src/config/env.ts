import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 8080,
  nodeEnv: process.env.NODE_ENV || "development",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  // Where @xenova/transformers caches downloaded model weights. Its own
  // default (<package-install-dir>/.cache) lives inside node_modules, so a
  // fresh `npm install` (a typical redeploy) wipes it - this must live
  // outside node_modules so it can persist across restarts, and in
  // production should point at a mounted, persistent volume/disk (the
  // platform must actually provide one; this only decides the path).
  // "EMBEDDING_MODEL_CACHE_DIR", never the Python-only HF_HOME/
  // TRANSFORMERS_CACHE conventions, which this JS library does not read.
  embeddingModelCacheDir:
    process.env.EMBEDDING_MODEL_CACHE_DIR || path.join(process.cwd(), ".cache", "transformers-model"),
  // Optional startup warm-up (see ai/embedding-warmup.ts) - off by default
  // so local `npm run dev` restarts stay fast; only "true" enables it.
  embeddingModelWarmupEnabled: process.env.EMBEDDING_MODEL_WARMUP === "true",
};
