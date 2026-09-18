// A minimal, structurally-compatible shape rather than Pick<Server, "on">
// - http.Server#on is typed with EventEmitter's overloaded, chainable
// signature (returning `this`), which a plain test fake has no reason to
// replicate; any object whose on() takes this one event/listener shape
// (the real Server included) satisfies this.
interface ErrorEmittingServer {
  on: (event: "error", listener: (err: NodeJS.ErrnoException) => void) => unknown;
}

export interface ServerErrorLoggingOptions {
  exit?: (code: number) => void;
  logError?: (...args: unknown[]) => void;
}

// Adding a listener for the HTTP server's "error" event suppresses
// Node's own default behavior (throwing, which would otherwise crash the
// process anyway) - so this must still call exit() itself. A startup
// failure (most commonly EADDRINUSE, the configured port already being in
// use) must still fail the process rather than leaving it running as if
// nothing happened; only the log message changes, from an opaque uncaught
// exception to a clear, safe, operational line. Never logs the raw error
// object - only a fixed message plus the error's own `.message` (Node's
// own EADDRINUSE/EACCES errors carry no secrets, only the port/address).
export function registerServerErrorLogging(server: ErrorEmittingServer, options: ServerErrorLoggingOptions = {}): void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const logError = options.logError ?? console.error;

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logError("Startup failed: the configured port is already in use.");
    } else {
      logError("Startup failed: HTTP server error.", err.message);
    }

    exit(1);
  });
}
