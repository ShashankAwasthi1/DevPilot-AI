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

test("getDiagnostics: correct token returns 200 with a safe diagnostic payload, never the password, username, or full connection string", async () => {
  const secretPassword = "sUp3rSecretPassw0rd!";
  await withEnv(
    {
      DIAGNOSTICS_TOKEN: "correct-token",
      // localhost:1 fails fast (ECONNREFUSED on loopback, no DNS lookup) so
      // this test never depends on outbound network access or waits out the
      // probe's 5s timeout.
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

test("getDiagnostics: DATABASE_URL unset is reported as absent, not as an error, and no other section is skipped", async () => {
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
      // The OS-level probes still run and report something (available or
      // not) - DATABASE_URL being absent never short-circuits the rest of
      // the response.
      assert.equal(typeof (data.opensslVersion as Record<string, unknown>).available, "boolean");
      assert.equal(typeof (data.prismaEngineFiles as Record<string, unknown>).available, "boolean");
    },
  );
});
