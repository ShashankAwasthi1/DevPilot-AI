import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Prisma's native Rust query engine fails to open a TLS connection to Neon
// on Render's runtime (PrismaClientInitializationError: "Error opening a
// TLS connection: OpenSSL error") - confirmed, via the temporary
// diagnostics route, to affect BOTH the pooled and direct Neon endpoints,
// with a bare Node `tls.connect()` to the same host succeeding fine. That
// isolates the fault to the native engine's own OpenSSL-linked TLS/
// connection handling, not the network path, the certificate, or Neon
// itself. `@prisma/adapter-neon` replaces that transport entirely: Prisma's
// query *execution* still runs as normal, but the actual database
// connection is opened by `@neondatabase/serverless` (a WebSocket-based
// driver with its own, independent TLS stack), sidestepping the broken
// engine-level TLS path altogether. `binaryTargets` in schema.prisma is
// left as-is (harmless, and the CLI/`prisma migrate` path is unaffected by
// any of this - see db-migrate.yml, which never goes through this file).

// `@neondatabase/serverless`'s Pool speaks Postgres over a WebSocket.
// Browsers and edge runtimes (Vercel Edge, Cloudflare Workers) already
// have a global `WebSocket`; a plain Node.js process (this Express server,
// on Render) does not, so a WebSocket implementation must be supplied
// explicitly - `ws` is the driver's own documented choice for this exact
// case. Setting it once, globally, before any Pool is constructed.
// `useSecureWebSocket` is NOT touched here - it defaults to `true` (wss://,
// TLS-secured), and nothing in this file weakens or overrides that.
neonConfig.webSocketConstructor = ws;

function createPrismaClient(): PrismaClient {
  // `connectionString` here is intentionally `DATABASE_URL` (Neon's pooled
  // endpoint) - the same runtime connection string the app has always
  // used. `DATABASE_URL_UNPOOLED` remains exclusively a Prisma CLI/
  // migration concern (schema.prisma's `directUrl`) and is not read here.
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// A hot-reloading dev server (tsx watch) would otherwise create a new
// PrismaClient - and a new Neon Pool/WebSocket connection - on every file
// save. Caching the instance on `globalThis` survives module reloads in
// dev while staying a plain singleton in production. `??` only evaluates
// createPrismaClient() when `globalThis.__prisma` is unset, so this never
// constructs a second pool/client while a cached one already exists.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
