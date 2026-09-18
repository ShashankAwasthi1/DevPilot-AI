import type { Server } from "node:http";
import { prisma } from "./config/prisma";

const SHUTDOWN_TIMEOUT_MS = 10_000;

// A minimal, structurally-compatible shape rather than Pick<Server,
// "close"> - http.Server#close is typed to return `this` (for chaining),
// which a plain test fake has no reason to replicate; any object whose
// close() takes the same callback shape (the real Server included)
// satisfies this.
interface CloseableServer {
  close: (callback?: (err?: Error) => void) => unknown;
}

export interface ShutdownDependencies {
  server: CloseableServer;
  disconnect: () => Promise<unknown>;
  exit: (code: number) => void;
  forceExitMs?: number;
  log?: (...args: unknown[]) => void;
  logError?: (...args: unknown[]) => void;
}

// The actual shutdown decision/orchestration, factored out of
// registerGracefulShutdown below so it can be unit-tested with fake
// server/disconnect/exit dependencies - same "small testable function,
// thin real-world wrapper" split as ai/embedding-warmup.ts.
//
// Sequence on a received signal: stop accepting new connections
// (server.close, which also lets already-open requests/connections drain
// naturally), then disconnect Prisma, then exit(0). A repeated signal
// while shutdown is already in progress is a no-op - `shuttingDown` is
// checked and set synchronously before anything else runs, so
// server.close()/disconnect() can never be invoked twice even if SIGTERM
// arrives twice in a row. A bounded force-exit timer guards against a
// permanently hanging request/SSE connection blocking server.close()'s
// callback forever - it never calls process.exit() before the normal
// sequence has had a chance to complete on its own; it only fires if that
// normal sequence hasn't finished within forceExitMs.
export function createShutdownHandler(deps: ShutdownDependencies): (signal: string) => void {
  const { server, disconnect, exit, forceExitMs = SHUTDOWN_TIMEOUT_MS, log = console.log, logError = console.error } = deps;
  let shuttingDown = false;

  return function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;

    log(`${signal} received - shutting down gracefully...`);

    const forceExitTimer = setTimeout(() => {
      logError(`Graceful shutdown did not complete within ${forceExitMs}ms - forcing exit.`);
      exit(1);
    }, forceExitMs);

    server.close((err) => {
      clearTimeout(forceExitTimer);

      if (err) {
        logError("Error while closing the HTTP server:", err instanceof Error ? err.message : err);
      }

      disconnect()
        .catch((disconnectErr: unknown) => {
          logError(
            "Error while disconnecting from the database:",
            disconnectErr instanceof Error ? disconnectErr.message : disconnectErr,
          );
        })
        .finally(() => {
          exit(err ? 1 : 0);
        });
    });
  };
}

// The real-world wrapper: wires the handler above to the actual process
// signals, the real Prisma singleton, and the real process.exit. Never
// called from tests directly - tests exercise createShutdownHandler with
// injected fakes instead, so a test run never risks attaching a real
// SIGTERM/SIGINT listener to the test process itself or actually calling
// process.exit().
export function registerGracefulShutdown(server: Server): void {
  const shutdown = createShutdownHandler({
    server,
    disconnect: () => prisma.$disconnect(),
    exit: (code) => process.exit(code),
  });

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
