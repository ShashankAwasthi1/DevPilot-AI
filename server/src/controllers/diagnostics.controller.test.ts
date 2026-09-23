import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { makeFakeJsonResponse } from "./test-helpers";
import { getDiagnostics } from "./diagnostics.controller";

// TEMPORARY - see diagnostics.controller.ts's own top-of-file comment.
// Delete this test file alongside the controller/route once the Prisma/
// Render/Neon TLS investigation concludes.

function makeFakeDiagRequest(headers: Record<string, string | undefined>): Request {
  return {
    method: "GET",
    originalUrl: "/api/v1/_diag",
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

// Every test restores both env vars afterward so this file never leaks
// state into any other test in the suite (they all run in one process).
function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("getDiagnostics: DIAGNOSTICS_TOKEN unset returns 404, identical to an unknown route", async () => {
  await withEnv({ DIAGNOSTICS_TOKEN: undefined }, async () => {
    const req = makeFakeDiagRequest({ "x-diag-token": "anything" });
    const { res, state } = makeFakeJsonResponse();

    await getDiagnostics(req, res);

    assert.equal(state.statusCode, 404);
    assert.deepEqual(state.body, {
      status: "error",
      message: "Route not found: GET /api/v1/_diag",
    });
  });
});

test("getDiagnostics: missing x-diag-token header returns 404 even when DIAGNOSTICS_TOKEN is set", async () => {
  await withEnv({ DIAGNOSTICS_TOKEN: "correct-token" }, async () => {
    const req = makeFakeDiagRequest({});
    const { res, state } = makeFakeJsonResponse();

    await getDiagnostics(req, res);

    assert.equal(state.statusCode, 404);
  });
});

test("getDiagnostics: wrong x-diag-token value returns 404", async () => {
  await withEnv({ DIAGNOSTICS_TOKEN: "correct-token" }, async () => {
    const req = makeFakeDiagRequest({ "x-diag-token": "wrong-token" });
    const { res, state } = makeFakeJsonResponse();

    await getDiagnostics(req, res);

    assert.equal(state.statusCode, 404);
  });
});

test("getDiagnostics: a token of a different length than expected also returns 404 (never a crash from timingSafeEqual)", async () => {
  await withEnv({ DIAGNOSTICS_TOKEN: "correct-token" }, async () => {
    const req = makeFakeDiagRequest({ "x-diag-token": "short" });
    const { res, state } = makeFakeJsonResponse();

    await getDiagnostics(req, res);

    assert.equal(state.statusCode, 404);
  });
});

test("getDiagnostics: correct token returns 200 with a safe diagnostic payload, never the password, username, or full connection string", async (t) => {
  // Mocked so this test never depends on real Neon-adapter/network
  // behavior - it exercises safeConnectionMeta's sanitization, not the
  // Prisma probes' own success/failure handling (covered separately
  // below).
  mockPrismaClient(t, async () => [{ "?column?": 1 }]);

  const secretPassword = "sUp3rSecretPassw0rd!";
  await withEnv(
    {
      DIAGNOSTICS_TOKEN: "correct-token",
      // localhost:1 fails fast (ECONNREFUSED on loopback, no DNS lookup) so
      // this test never depends on outbound network access or waits out the
      // probe's 5s timeout - kept even though the Prisma probes themselves
      // are mocked above, since probeTls (Node's own tls.connect probe)
      // still runs for real against this same host/port.
      DATABASE_URL: `postgresql://dbuser:${secretPassword}@localhost:1/devpilot?sslmode=require&channel_binding=require`,
      DATABASE_URL_UNPOOLED: `postgresql://dbuser:${secretPassword}@localhost:1/devpilot?sslmode=require`,
    },
    async () => {
      const req = makeFakeDiagRequest({ "x-diag-token": "correct-token" });
      const { res, state } = makeFakeJsonResponse();

      await getDiagnostics(req, res);

      assert.equal(state.statusCode, 200);

      const serialized = JSON.stringify(state.body);
      assert.equal(serialized.includes(secretPassword), false);
      assert.equal(serialized.includes("dbuser"), false);
      assert.equal(serialized.includes("devpilot"), false);
      assert.equal(serialized.includes("postgresql://"), false);

      const data = (state.body as { data: Record<string, unknown> }).data;
      const databaseUrl = data.databaseUrl as Record<string, unknown>;
      assert.equal(databaseUrl.hostname, "localhost");
      assert.equal(databaseUrl.port, "1");
      assert.deepEqual([...(databaseUrl.queryParamNames as string[])].sort(), ["channel_binding", "sslmode"]);
      assert.equal(databaseUrl.sslmode, "require");
      assert.equal(databaseUrl.channelBinding, "require");

      const databaseUrlUnpooled = data.databaseUrlUnpooled as Record<string, unknown>;
      assert.equal(databaseUrlUnpooled.hostname, "localhost");
      assert.deepEqual([...(databaseUrlUnpooled.queryParamNames as string[])], ["sslmode"]);
    },
  );
});

// Fake Prisma error classes mirroring the real @prisma/client shapes
// closely enough for classifyPrismaError's `instanceof` checks and field
// reads (errorCode / code) to behave identically to production.
class FakePrismaClientInitializationError extends Error {
  errorCode?: string;
  constructor(message: string, errorCode?: string) {
    super(message);
    this.name = "PrismaClientInitializationError";
    this.errorCode = errorCode;
  }
}

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
    this.code = code;
  }
}

class FakePrismaClientRustPanicError extends Error {}
class FakePrismaClientUnknownRequestError extends Error {}

// `handler` receives the exact connection string the diagnostic passed to
// `new PrismaNeon({ connectionString })`, threaded through the fake
// adapter's `.connectionString` field into `new PrismaClient({ adapter })`
// - this is what lets a single mock distinguish the pooled call
// (DATABASE_URL) from the unpooled call (DATABASE_URL_UNPOOLED) and answer
// each one differently, proving prismaPooledProbe/prismaUnpooledProbe are
// genuinely two separate, independently-configured Prisma clients rather
// than one probe's result reused twice. Mocks the full adapter chain
// (`@prisma/client`, `@prisma/adapter-neon`, `@neondatabase/serverless`,
// `ws`) so no test in this file ever opens a real network connection or
// depends on a real WebSocket implementation.
function mockPrismaClient(
  t: import("node:test").TestContext,
  handler: (url: string | undefined) => Promise<unknown>,
) {
  class FakePrismaNeon {
    connectionString: string | undefined;
    constructor(config?: { connectionString?: string }) {
      this.connectionString = config?.connectionString;
    }
  }

  class FakePrismaClient {
    private url: string | undefined;
    constructor(options?: { adapter?: FakePrismaNeon }) {
      this.url = options?.adapter?.connectionString;
    }
    $queryRaw() {
      return handler(this.url);
    }
    async $disconnect() {}
  }

  t.mock.module("@prisma/client", {
    namedExports: {
      PrismaClient: FakePrismaClient,
      Prisma: {
        PrismaClientInitializationError: FakePrismaClientInitializationError,
        PrismaClientKnownRequestError: FakePrismaClientKnownRequestError,
        PrismaClientRustPanicError: FakePrismaClientRustPanicError,
        PrismaClientUnknownRequestError: FakePrismaClientUnknownRequestError,
      },
    },
  });

  t.mock.module("@prisma/adapter-neon", {
    namedExports: { PrismaNeon: FakePrismaNeon },
  });

  t.mock.module("@neondatabase/serverless", {
    // A plain settable property is enough - probePrismaDatasource only
    // ever assigns to it, nothing in this test file reads it back.
    namedExports: { neonConfig: { webSocketConstructor: undefined } },
  });

  t.mock.module("ws", {
    defaultExport: class FakeWebSocket {},
  });
}

test("getDiagnostics: prismaPooledProbe and prismaUnpooledProbe each report success independently, from genuinely separate PrismaClient instances configured with their own Neon adapter connection string", async (t) => {
  const urlsSeen: (string | undefined)[] = [];
  mockPrismaClient(t, async (url) => {
    urlsSeen.push(url);
    return [{ "?column?": 1 }];
  });

  await withEnv(
    {
      DIAGNOSTICS_TOKEN: "correct-token",
      DATABASE_URL: "postgresql://dbuser:secret-pooled@ep-pooled.neon.tech/devpilot?sslmode=require",
      DATABASE_URL_UNPOOLED: "postgresql://dbuser:secret-direct@ep-direct.neon.tech/devpilot?sslmode=require",
    },
    async () => {
      const req = makeFakeDiagRequest({ "x-diag-token": "correct-token" });
      const { res, state } = makeFakeJsonResponse();

      await getDiagnostics(req, res);

      const data = (state.body as { data: Record<string, unknown> }).data;
      assert.deepEqual(data.prismaPooledProbe, { attempted: true, success: true });
      assert.deepEqual(data.prismaUnpooledProbe, { attempted: true, success: true });
      // Each probe really was constructed with its own connection string,
      // not the same one reused for both.
      assert.deepEqual(urlsSeen, [
        "postgresql://dbuser:secret-pooled@ep-pooled.neon.tech/devpilot?sslmode=require",
        "postgresql://dbuser:secret-direct@ep-direct.neon.tech/devpilot?sslmode=require",
      ]);
    },
  );
});

test("getDiagnostics: prismaPooledProbe can fail while prismaUnpooledProbe succeeds, reported separately - isolating a pooler-specific failure", async (t) => {
  mockPrismaClient(t, async (url) => {
    if (url?.includes("ep-pooled")) {
      throw new FakePrismaClientInitializationError(
        "Error opening a TLS connection: OpenSSL error",
        "P1011",
      );
    }
    return [{ "?column?": 1 }];
  });

  await withEnv(
    {
      DIAGNOSTICS_TOKEN: "correct-token",
      DATABASE_URL: "postgresql://dbuser:secret-pooled@ep-pooled.neon.tech/devpilot?sslmode=require",
      DATABASE_URL_UNPOOLED: "postgresql://dbuser:secret-direct@ep-direct.neon.tech/devpilot?sslmode=require",
    },
    async () => {
      const req = makeFakeDiagRequest({ "x-diag-token": "correct-token" });
      const { res, state } = makeFakeJsonResponse();

      await getDiagnostics(req, res);

      const data = (state.body as { data: Record<string, unknown> }).data;
      const pooled = data.prismaPooledProbe as Record<string, unknown>;
      const unpooled = data.prismaUnpooledProbe as Record<string, unknown>;

      assert.equal(pooled.success, false);
      assert.equal(pooled.errorType, "PrismaClientInitializationError");
      assert.equal(pooled.errorCode, "P1011");
      assert.deepEqual(unpooled, { attempted: true, success: true });
    },
  );
});

test("getDiagnostics: a sanitized Prisma failure never leaks the embedded connection string or password, for either probe", async (t) => {
  const pooledPassword = "pooled-Secret-1";
  const unpooledPassword = "direct-Secret-2";
  mockPrismaClient(t, async (url) => {
    const isPooled = url?.includes("ep-pooled");
    throw new FakePrismaClientInitializationError(
      `Error opening a TLS connection: OpenSSL error querying postgresql://dbuser:${
        isPooled ? pooledPassword : unpooledPassword
      }@${isPooled ? "ep-pooled" : "ep-direct"}.neon.tech/devpilot?sslmode=require`,
      "P1011",
    );
  });

  await withEnv(
    {
      DIAGNOSTICS_TOKEN: "correct-token",
      DATABASE_URL: `postgresql://dbuser:${pooledPassword}@ep-pooled.neon.tech/devpilot?sslmode=require`,
      DATABASE_URL_UNPOOLED: `postgresql://dbuser:${unpooledPassword}@ep-direct.neon.tech/devpilot?sslmode=require`,
    },
    async () => {
      const req = makeFakeDiagRequest({ "x-diag-token": "correct-token" });
      const { res, state } = makeFakeJsonResponse();

      await getDiagnostics(req, res);

      const data = (state.body as { data: Record<string, unknown> }).data;
      const pooled = data.prismaPooledProbe as Record<string, unknown>;
      const unpooled = data.prismaUnpooledProbe as Record<string, unknown>;

      assert.equal(pooled.errorType, "PrismaClientInitializationError");
      assert.equal(pooled.errorCode, "P1011");
      assert.equal((pooled.message as string).includes("Error opening a TLS connection"), true);
      assert.equal(unpooled.errorType, "PrismaClientInitializationError");

      const serialized = JSON.stringify(state.body);
      assert.equal(serialized.includes(pooledPassword), false);
      assert.equal(serialized.includes(unpooledPassword), false);
      assert.equal(serialized.includes("postgresql://"), false);
      assert.equal(serialized.includes("dbuser"), false);
      assert.equal(serialized.includes("devpilot"), false);
    },
  );
});

test("getDiagnostics: existing token protection is unaffected by the pooled/unpooled probes - wrong token still returns 404 without instantiating Prisma at all", async (t) => {
  let called = false;
  mockPrismaClient(t, async () => {
    called = true;
    return [{ "?column?": 1 }];
  });

  await withEnv(
    {
      DIAGNOSTICS_TOKEN: "correct-token",
      DATABASE_URL: "postgresql://dbuser:secret@ep-pooled.neon.tech/devpilot",
      DATABASE_URL_UNPOOLED: "postgresql://dbuser:secret@ep-direct.neon.tech/devpilot",
    },
    async () => {
      const req = makeFakeDiagRequest({ "x-diag-token": "wrong-token" });
      const { res, state } = makeFakeJsonResponse();

      await getDiagnostics(req, res);

      assert.equal(state.statusCode, 404);
      assert.equal(called, false);
    },
  );
});

test("getDiagnostics: DATABASE_URL/DATABASE_URL_UNPOOLED unset means both Prisma probes report attempted: false, with no other section skipped", async (t) => {
  // Mocked so this test never depends on real Prisma engine
  // loading/validation behavior - it exercises the "absent env var" branch
  // of probePrismaDatasource, not its error-handling branch (covered
  // separately above).
  mockPrismaClient(t, async () => [{ "?column?": 1 }]);

  await withEnv(
    { DIAGNOSTICS_TOKEN: "correct-token", DATABASE_URL: undefined, DATABASE_URL_UNPOOLED: undefined },
    async () => {
      const req = makeFakeDiagRequest({ "x-diag-token": "correct-token" });
      const { res, state } = makeFakeJsonResponse();

      await getDiagnostics(req, res);

      assert.equal(state.statusCode, 200);
      const data = (state.body as { data: Record<string, unknown> }).data;
      assert.deepEqual(data.databaseUrl, { present: false });
      assert.deepEqual(data.databaseUrlUnpooled, { present: false });
      assert.deepEqual(data.tlsProbe, { attempted: false });
      assert.deepEqual(data.prismaPooledProbe, { attempted: false });
      assert.deepEqual(data.prismaUnpooledProbe, { attempted: false });
      // The OS-level probes still run and report something (available or
      // not) - both env vars being absent never short-circuits the rest of
      // the response.
      assert.equal(typeof (data.opensslVersion as Record<string, unknown>).available, "boolean");
      assert.equal(typeof (data.prismaEngineFiles as Record<string, unknown>).available, "boolean");
    },
  );
});
