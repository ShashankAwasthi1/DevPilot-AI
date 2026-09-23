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

  res.status(200).json({
    status: "ok",
    data: {
      opensslVersion: getOpensslVersion(),
      prismaEngineFiles: getPrismaEngineFiles(),
      ldconfigSslEntries: getLdconfigSslEntries(),
      databaseUrl: databaseUrlMeta,
      databaseUrlUnpooled: databaseUrlUnpooledMeta,
      tlsProbe,
    },
  });
}
