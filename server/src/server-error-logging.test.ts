import { test } from "node:test";
import assert from "node:assert/strict";
import { registerServerErrorLogging } from "./server-error-logging";

// Phase 27 Step 8: registerServerErrorLogging had no tests before this
// step. A fake server (just an event emitter surface) and injected
// exit/logError let this run without ever calling the real process.exit()
// or attaching a listener to a real HTTP server.

function makeFakeServer(): { server: { on: (event: string, cb: (err: NodeJS.ErrnoException) => void) => void }; emit: (err: NodeJS.ErrnoException) => void } {
  let handler: ((err: NodeJS.ErrnoException) => void) | undefined;
  return {
    server: {
      on: (event: string, cb: (err: NodeJS.ErrnoException) => void) => {
        if (event === "error") handler = cb;
      },
    },
    emit: (err: NodeJS.ErrnoException) => handler?.(err),
  };
}

test("registerServerErrorLogging: an EADDRINUSE error logs a safe, specific message and exits(1)", () => {
  const { server, emit } = makeFakeServer();
  const exitCalls: number[] = [];
  const errors: unknown[][] = [];

  registerServerErrorLogging(server, {
    exit: (code) => exitCalls.push(code),
    logError: (...args) => errors.push(args),
  });

  const err = Object.assign(new Error("listen EADDRINUSE: address already in use :::8080"), {
    code: "EADDRINUSE",
  }) as NodeJS.ErrnoException;
  emit(err);

  assert.deepEqual(exitCalls, [1], "a port-in-use error must still fail startup, never leave the process running");
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /port is already in use/i);
  // The raw Node error message (which includes the bind address) must
  // never be the thing logged for this specific, well-known case - only
  // the fixed, safe line above.
  assert.equal(String(errors[0]).includes("EADDRINUSE"), false);
});

test("registerServerErrorLogging: any other server error logs a generic message plus the error's own text, and exits(1)", () => {
  const { server, emit } = makeFakeServer();
  const exitCalls: number[] = [];
  const errors: unknown[][] = [];

  registerServerErrorLogging(server, {
    exit: (code) => exitCalls.push(code),
    logError: (...args) => errors.push(args),
  });

  const err = Object.assign(new Error("some other socket error"), { code: "EOTHER" }) as NodeJS.ErrnoException;
  emit(err);

  assert.deepEqual(exitCalls, [1], "a fatal startup error must never be swallowed - the process still fails");
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /startup failed/i);
});

test("registerServerErrorLogging: never exposes a stack trace or the raw error object - only fixed text plus .message", () => {
  const { server, emit } = makeFakeServer();
  const errors: unknown[][] = [];

  registerServerErrorLogging(server, {
    exit: () => {},
    logError: (...args) => errors.push(args),
  });

  const err = Object.assign(new Error("boom"), { code: "EOTHER" }) as NodeJS.ErrnoException;
  emit(err);

  assert.equal(errors.length, 1);
  for (const arg of errors[0]) {
    assert.equal(arg instanceof Error, false, "the raw Error object must never be passed to the logger");
  }
});
