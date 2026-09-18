import { test } from "node:test";
import assert from "node:assert/strict";
import { createShutdownHandler } from "./shutdown";

// Phase 27 Step 8: createShutdownHandler is the extracted, testable
// decision/orchestration logic behind registerGracefulShutdown - tests
// here use fake server/disconnect/exit dependencies exclusively, so no
// test ever attaches a real SIGTERM/SIGINT listener to the test process
// or calls the real process.exit().

function captureLogs() {
  const logs: unknown[][] = [];
  const errors: unknown[][] = [];
  return {
    log: (...args: unknown[]) => logs.push(args),
    logError: (...args: unknown[]) => errors.push(args),
    logs,
    errors,
  };
}

test("createShutdownHandler: on a signal, closes the server, then disconnects, then exits(0) on success", async () => {
  let closeCallback: ((err?: Error) => void) | undefined;
  const closeCalls: number[] = [];
  let disconnectCalls = 0;
  const exitCalls: number[] = [];
  const { log, logError, logs } = captureLogs();

  const shutdown = createShutdownHandler({
    server: {
      close: (cb?: (err?: Error) => void) => {
        closeCalls.push(1);
        closeCallback = cb;
      },
    },
    disconnect: async () => {
      disconnectCalls++;
    },
    exit: (code: number) => exitCalls.push(code),
    log,
    logError,
  });

  shutdown("SIGTERM");

  assert.equal(closeCalls.length, 1, "server.close must be called synchronously on receiving the signal");
  assert.equal(disconnectCalls, 0, "disconnect must not run before server.close's callback fires");
  assert.equal(exitCalls.length, 0, "exit must not run before the sequence completes");
  assert.ok(logs.some((args) => String(args[0]).includes("SIGTERM")));

  // Simulate server.close() finishing (all connections drained).
  closeCallback?.();
  // Let the disconnect().finally() microtask settle.
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(disconnectCalls, 1);
  assert.deepEqual(exitCalls, [0]);
});

test("createShutdownHandler: server.close finishing with an error still disconnects, then exits(1)", async () => {
  let closeCallback: ((err?: Error) => void) | undefined;
  let disconnectCalls = 0;
  const exitCalls: number[] = [];

  const shutdown = createShutdownHandler({
    server: {
      close: (cb?: (err?: Error) => void) => {
        closeCallback = cb;
      },
    },
    disconnect: async () => {
      disconnectCalls++;
    },
    exit: (code: number) => exitCalls.push(code),
  });

  shutdown("SIGTERM");
  closeCallback?.(new Error("close failed"));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(disconnectCalls, 1, "disconnect must still run even if closing the server itself errored");
  assert.deepEqual(exitCalls, [1]);
});

test("createShutdownHandler: a disconnect failure is caught and still exits, never leaving the process hanging", async () => {
  let closeCallback: ((err?: Error) => void) | undefined;
  const exitCalls: number[] = [];

  const shutdown = createShutdownHandler({
    server: {
      close: (cb?: (err?: Error) => void) => {
        closeCallback = cb;
      },
    },
    disconnect: async () => {
      throw new Error("prisma disconnect failed");
    },
    exit: (code: number) => exitCalls.push(code),
  });

  shutdown("SIGTERM");
  closeCallback?.();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(exitCalls, [0], "a disconnect failure alone (server.close succeeded) still exits cleanly");
});

test("createShutdownHandler: a second signal while shutdown is already in progress is a no-op - close/disconnect/exit each run at most once", async () => {
  let closeCallback: ((err?: Error) => void) | undefined;
  const closeCalls: number[] = [];
  let disconnectCalls = 0;
  const exitCalls: number[] = [];

  const shutdown = createShutdownHandler({
    server: {
      close: (cb?: (err?: Error) => void) => {
        closeCalls.push(1);
        closeCallback = cb;
      },
    },
    disconnect: async () => {
      disconnectCalls++;
    },
    exit: (code: number) => exitCalls.push(code),
  });

  shutdown("SIGTERM");
  shutdown("SIGTERM"); // repeated signal, same kind
  shutdown("SIGINT"); // repeated signal, different kind - still a no-op

  assert.equal(closeCalls.length, 1, "server.close must never run twice, regardless of how many signals arrive");

  closeCallback?.();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(disconnectCalls, 1, "disconnect must never run twice");
  assert.deepEqual(exitCalls, [0], "exit must never run twice");
});

test("createShutdownHandler: a permanently hanging server.close is force-exited after the configured timeout, without ever disconnecting", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  let disconnectCalls = 0;
  const exitCalls: number[] = [];
  const { logError, errors } = captureLogs();

  const shutdown = createShutdownHandler({
    server: {
      // Never calls back - simulates a permanently hanging
      // request/SSE connection blocking server.close() forever.
      close: () => {},
    },
    disconnect: async () => {
      disconnectCalls++;
    },
    exit: (code: number) => exitCalls.push(code),
    forceExitMs: 10_000,
    logError,
  });

  shutdown("SIGTERM");

  assert.equal(exitCalls.length, 0, "must not force-exit before the timeout elapses");

  t.mock.timers.tick(10_000);

  assert.deepEqual(exitCalls, [1], "the force-exit timer must fire exactly once, exiting with a failure code");
  assert.equal(disconnectCalls, 0, "a forced exit never got the chance to run the normal disconnect step");
  assert.ok(errors.some((args) => String(args[0]).toLowerCase().includes("forcing exit")));
});

test("createShutdownHandler: a server.close that completes before the force-exit timer clears the timer (no forced exit fires afterward)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  let closeCallback: ((err?: Error) => void) | undefined;
  const exitCalls: number[] = [];

  const shutdown = createShutdownHandler({
    server: {
      close: (cb?: (err?: Error) => void) => {
        closeCallback = cb;
      },
    },
    disconnect: async () => {},
    exit: (code: number) => exitCalls.push(code),
    forceExitMs: 10_000,
  });

  shutdown("SIGTERM");
  closeCallback?.();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(exitCalls, [0]);

  // Advancing time well past the force-exit window must not trigger a
  // second, forced exit call - the timer was cleared once the normal
  // sequence completed.
  t.mock.timers.tick(20_000);

  assert.deepEqual(exitCalls, [0], "the cleared force-exit timer must never fire after a clean shutdown");
});
