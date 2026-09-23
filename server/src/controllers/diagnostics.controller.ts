import { execSync } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { connect as tlsConnect } from "node:tls";
import type { Request, Response } from "express";

// TEMPORARY - Prisma/Render/Neon TLS forensic investigation only. Not part
// of the application's normal surface: no other route, controller, or
// service references this file. Delete this controller and its route
// (diagnostics.routes.ts) once the investigation concludes - it is not
// meant to ship long-term, unlike every other route in this codebase.
//
// Purpose: Render's free tier gives no shell, and Prisma's own error
// ("Error opening a TLS connection: OpenSSL error") is too generic to
// diagnose from application logs alone. This route runs a handful of safe,
// read-only OS/network probes from inside the actual failing container so
// they can be compared against what's assumed locally - without ever
// instantiating PrismaClient (already known to fail) and without ever
// returning a secret.
//
// Gating: requires process.env.DIAGNOSTICS_TOKEN to be set AND an
// `x-diag-token` request header to match it, via a constant-time
// comparison (never `===`, which would let response-time differences leak
// how many leading characters of a guessed token were correct). A missing
// env var, missing header, or mismatched token all produce an identical
// 404 - indistinguishable from a route that doesn't exist at all (the
// same shape notFoundHandler.ts already uses), never a 403 that would
// confirm this route's existence to an unauthenticated prober.

function isAuthorized(req: Request): boolean {
  const expected = process.env.DIAGNOSTICS_TOKEN;
  if (!expected) return false;

  const supplied = req.header("x-diag-token");
  if (!supplied) return false;

  const expectedBuf = Buffer.from(expected);
  const suppliedBuf = Buffer.from(supplied);
  // timingSafeEqual throws on a length mismatch rather than returning
  // false, so unequal-length inputs must be rejected before calling it -
  // itself still a length comparison, but the token's plaintext value
  // never influences timing beyond that.
  if (expectedBuf.length !== suppliedBuf.length) return false;

  return timingSafeEqual(expectedBuf, suppliedBuf);
}

function sendNotFound(req: Request, res: Response) {
  res.status(404).json({
    status: "error",
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

// A. `openssl version` - the OS-level OpenSSL Prisma's engine dynamically
// links against. Never throws: a missing/failing `openssl` binary (e.g. a
// minimal container without the CLI installed, even if the shared library
// itself is present) reports as unavailable rather than crashing the route.
function getOpensslVersion(): { available: boolean; output?: string; error?: string } {
  try {
    const output = execSync("openssl version", { encoding: "utf8", timeout: 3000 }).trim();
    return { available: true, output };
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// B. Prisma query engine binary filenames actually present on disk right
// now, e.g. "libquery_engine-debian-openssl-3.0.x.so.node" - confirms
// exactly which binaryTargets engine Render's own `prisma generate`
// (postinstall) produced, independent of what's assumed from schema.prisma
// or from a local machine's own generate output.
function getPrismaEngineFiles(): { available: boolean; files?: string[]; error?: string } {
  try {
    const dir = path.join(process.cwd(), "node_modules", ".prisma", "client");
    const files = readdirSync(dir).filter((name) => name.endsWith(".so.node"));
    return { available: true, files };
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// C. Which libssl/libcrypto shared objects the OS's dynamic linker actually
// knows about. `ldconfig -p | grep -i ssl` exits non-zero when grep finds
// no match (not a real failure - just "nothing found"), so that case is
// reported as an empty, successful list rather than an error.
function getLdconfigSslEntries(): { available: boolean; entries?: string[]; error?: string } {
  try {
    const output = execSync("ldconfig -p | grep -i ssl", { encoding: "utf8", timeout: 3000 });
    return { available: true, entries: output.split("\n").map((line) => line.trim()).filter(Boolean) };
  } catch (err) {
    // grep's own "no lines matched" exit code (1) surfaces here as a thrown
    // error identically to a genuinely missing `ldconfig`/`grep` binary -
    // both are reported as an empty, non-error result, since neither
    // indicates this route itself malfunctioned.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Command failed")) return { available: true, entries: [] };
    return { available: false, error: message };
  }
}

// D/E. Safe, non-secret connection metadata for one DATABASE_URL-shaped env
// var: hostname, port, the NAMES of every query parameter (never their
// values, in case something unexpected ends up there), and the actual
// values of only the two specific params that are known-safe enums
// (sslmode, channel_binding) and directly relevant to this investigation.
// Never returns the username, password, database name path segment, or
// the raw string in any form.
interface SafeConnectionMeta {
  present: boolean;
  hostname?: string;
  port?: string;
  queryParamNames?: string[];
  sslmode?: string;
  channelBinding?: string;
  error?: string;
}

function safeConnectionMeta(envVarName: "DATABASE_URL" | "DATABASE_URL_UNPOOLED"): SafeConnectionMeta {
  const raw = process.env[envVarName];
  if (!raw) return { present: false };

  try {
    const url = new URL(raw);
    return {
      present: true,
      hostname: url.hostname,
      port: url.port || undefined,
      queryParamNames: [...url.searchParams.keys()],
      sslmode: url.searchParams.get("sslmode") ?? undefined,
      channelBinding: url.searchParams.get("channel_binding") ?? undefined,
    };
  } catch {
    return { present: true, error: "value is set but could not be parsed as a URL" };
  }
}

// F. A bare TLS handshake to the same host/port Prisma is failing against,
// using only Node's own built-in `tls` module - deliberately never the
// system libssl the Prisma engine binary links against, since Node ships
// and links its own OpenSSL statically. If this succeeds while Prisma
// still fails, that isolates the fault to the Prisma engine's own OpenSSL
// linkage rather than the network path, Neon's certificate, or firewalling
// - never returns the peer certificate or any credential.
interface TlsProbeResult {
  attempted: boolean;
  success?: boolean;
  protocol?: string | null;
  cipher?: string;
  error?: string;
}

function probeTls(hostname: string, port: number): Promise<TlsProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tlsConnect({ host: hostname, port, servername: hostname, timeout: 5000 });

    function finish(result: TlsProbeResult) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    }

    socket.once("secureConnect", () => {
      finish({
        attempted: true,
        success: true,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher()?.name,
      });
    });
    socket.once("error", (err) => {
      finish({ attempted: true, success: false, error: err.message });
    });
    socket.once("timeout", () => {
      finish({ attempted: true, success: false, error: "TLS connection timed out" });
    });
  });
}

// G. Real Prisma queries, isolated from the app's own singleton. Each
// PrismaClient is created and destroyed entirely within a single call to
// probePrismaDatasource below - neither ever touches, replaces, or shares a
// connection with `config/prisma.ts`'s singleton (the one the rest of the
// app, and getReadiness, actually use). Their purpose is to answer two
// questions Node's raw `tls.connect()` probe above can't: does Prisma's own
// engine (which speaks the Postgres wire protocol on top of its own TLS/
// connection handling, not just a bare TLS handshake) succeed against
// DATABASE_URL (Neon's pooled/PgBouncer endpoint, prismaPooledProbe) and,
// separately, against DATABASE_URL_UNPOOLED (Neon's direct endpoint,
// prismaUnpooledProbe) - isolating whether a failure is specific to Neon's
// pooler or affects Prisma's connection to Neon generally.
//
// Imported dynamically (never a static top-level `import { PrismaClient }
// from "@prisma/client"`) for the same reason ai/providers/anthropic.
// provider.ts's SDK import is dynamic: Node's `t.mock.module()` can only
// intercept a specifier's *first* evaluation, and "@prisma/client" is
// almost certainly already loaded for real elsewhere in this process
// (config/prisma.ts) well before this file's tests run - a static import
// here could never be mocked. A dynamic import performed at call time is
// intercepted by whatever mock is registered at that moment, regardless of
// when this controller module itself was first imported.
interface PrismaProbeResult {
  attempted: boolean;
  success?: boolean;
  errorType?: string;
  errorCode?: string;
  message?: string;
}

const PRISMA_PROBE_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Prisma probe timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Strips anything credential-shaped before an error message is ever
// returned in a response. Two layers: (1) the exact current value of
// DATABASE_URL/DATABASE_URL_UNPOOLED, in case Prisma echoes it verbatim,
// and (2) a generic postgres(ql):// URL pattern, in case a differently-
// formed or partially-transformed connection string appears instead (e.g.
// Prisma sometimes logs a normalized/re-encoded version of the original
// URL, not a byte-for-byte copy of the env var). Also capped in length -
// Prisma initialization errors can be long, and this route must never
// become a stack-trace/internal-detail leak.
const MAX_SANITIZED_MESSAGE_LENGTH = 500;

function sanitizeErrorMessage(message: string): string {
  let sanitized = message;

  for (const envVarName of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    const raw = process.env[envVarName];
    if (raw) sanitized = sanitized.split(raw).join("[redacted]");
  }

  sanitized = sanitized.replace(/postgres(?:ql)?:\/\/[^\s"')]+/gi, "postgres://[redacted]");

  if (sanitized.length > MAX_SANITIZED_MESSAGE_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_SANITIZED_MESSAGE_LENGTH)}…(truncated)`;
  }

  return sanitized;
}

// `prismaNamespace` is whatever the dynamic `import("@prisma/client")`
// above resolved to in THIS call - passed in explicitly (never imported a
// second time) so an `instanceof` check here always compares against the
// exact same class reference the thrown error was constructed from, real
// or mocked.
function classifyPrismaError(
  err: unknown,
  prismaNamespace: typeof import("@prisma/client").Prisma,
): { errorType: string; errorCode?: string; message: string } {
  const rawMessage = err instanceof Error ? err.message : String(err);
  let errorType = "UnknownError";
  let errorCode: string | undefined;

  if (err instanceof prismaNamespace.PrismaClientInitializationError) {
    errorType = "PrismaClientInitializationError";
    errorCode = err.errorCode;
  } else if (err instanceof prismaNamespace.PrismaClientKnownRequestError) {
    errorType = "PrismaClientKnownRequestError";
    errorCode = err.code;
  } else if (err instanceof prismaNamespace.PrismaClientRustPanicError) {
    errorType = "PrismaClientRustPanicError";
  } else if (err instanceof prismaNamespace.PrismaClientUnknownRequestError) {
    errorType = "PrismaClientUnknownRequestError";
  } else if (err instanceof Error) {
    errorType = err.constructor.name;
  }

  return { errorType, errorCode, message: sanitizeErrorMessage(rawMessage) };
}

// Probes ONE specific connection string through the SAME transport
// config/prisma.ts's real singleton now uses - the `@prisma/adapter-neon`
// driver adapter over `@neondatabase/serverless`, never Prisma's native
// engine's own `datasources.db.url` override (which is exactly the
// transport confirmed broken on Render against both Neon endpoints). Using
// the same adapter here is deliberate: it's what makes a pooled-vs-direct
// comparison meaningful post-migration, and it also means this probe
// doubles as a live check that the adapter transport itself is working for
// the connection string application code actually relies on. Never
// schema.prisma, never `config/prisma.ts`'s own singleton/pool - a
// completely separate PrismaClient (and Neon Pool) is created and
// destroyed here every call.
async function probePrismaDatasource(url: string | undefined): Promise<PrismaProbeResult> {
  if (!url) return { attempted: false };

  const { PrismaClient, Prisma: prismaNamespace } = await import("@prisma/client");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { neonConfig } = await import("@neondatabase/serverless");
  const { default: WebSocketImpl } = await import("ws");

  // Same as config/prisma.ts: Node has no native WebSocket global
  // compatible with what `@neondatabase/serverless`'s Pool expects, so `ws`
  // must be supplied explicitly. Idempotent to set again here even though
  // config/prisma.ts already sets it at import time elsewhere in the app -
  // this function must not assume import order or that it's the first
  // thing in the process to touch neonConfig.
  neonConfig.webSocketConstructor = WebSocketImpl;

  // Declared before the try so `finally` can still disconnect even if
  // construction itself throws - kept inside the try/catch below (never
  // called unguarded) so a synchronous construction failure (e.g. a
  // malformed connection string) is reported the same sanitized way as any
  // other probe failure, rather than rejecting this function and crashing
  // the whole diagnostic route with an unhandled 500.
  let client: InstanceType<typeof PrismaClient> | undefined;

  try {
    const adapter = new PrismaNeon({ connectionString: url });
    client = new PrismaClient({ adapter });
    await withTimeout(client.$queryRaw`SELECT 1`, PRISMA_PROBE_TIMEOUT_MS);
    return { attempted: true, success: true };
  } catch (err) {
    return { attempted: true, success: false, ...classifyPrismaError(err, prismaNamespace) };
  } finally {
    if (client) await client.$disconnect().catch(() => undefined);
  }
}

export async function getDiagnostics(req: Request, res: Response): Promise<void> {
  if (!isAuthorized(req)) {
    sendNotFound(req, res);
    return;
  }

  const databaseUrlMeta = safeConnectionMeta("DATABASE_URL");
  const databaseUrlUnpooledMeta = safeConnectionMeta("DATABASE_URL_UNPOOLED");

  let tlsProbe: TlsProbeResult = { attempted: false };
  if (databaseUrlMeta.present && databaseUrlMeta.hostname) {
    const port = databaseUrlMeta.port ? Number(databaseUrlMeta.port) : 5432;
    tlsProbe = await probeTls(databaseUrlMeta.hostname, port);
  }

  // Run sequentially, not in parallel: two concurrent temporary
  // PrismaClient instances independently opening connections is an
  // unnecessary complication for a one-off diagnostic call, and keeping
  // this simple matters more here than shaving a few seconds off a route
  // nobody but an operator ever calls.
  const prismaPooledProbe = await probePrismaDatasource(process.env.DATABASE_URL);
  const prismaUnpooledProbe = await probePrismaDatasource(process.env.DATABASE_URL_UNPOOLED);

  res.status(200).json({
    status: "ok",
    data: {
      opensslVersion: getOpensslVersion(),
      prismaEngineFiles: getPrismaEngineFiles(),
      ldconfigSslEntries: getLdconfigSslEntries(),
      databaseUrl: databaseUrlMeta,
      databaseUrlUnpooled: databaseUrlUnpooledMeta,
      tlsProbe,
      prismaPooledProbe,
      prismaUnpooledProbe,
    },
  });
}
