import { test } from "node:test";
import assert from "node:assert/strict";
import { neonConfig } from "@neondatabase/serverless";
import WebSocketImpl from "ws";

// Phase 18: config/prisma.ts now builds its PrismaClient via
// `@prisma/adapter-neon` + `@neondatabase/serverless` instead of Prisma's
// native engine (which fails to open a TLS connection to Neon on Render -
// see diagnostics.controller.ts). These tests exercise the REAL
// `@prisma/client`/`@prisma/adapter-neon`/`@neondatabase/serverless`/`ws`
// modules rather than mocking them: config/prisma.ts imports all four
// statically (a synchronous singleton every other service relies on being
// immediately usable at import time - it cannot use the dynamic-import-
// for-testability trick anthropic.provider.ts/diagnostics.controller.ts
// use, since this project compiles to CommonJS, where top-level await
// isn't available to defer a static import), so `t.mock.module` cannot
// intercept them here (it only intercepts a specifier's first resolution,
// and a static import is resolved during module linking, before any
// per-test mock registration can run).
//
// This is safe to do against the real modules because neither
// `new PrismaNeon(config)` nor `new PrismaClient({ adapter })` opens a
// network connection or WebSocket eagerly - Prisma's driver-adapter model
// defers the actual `pool.connect()` call until the first real query, so
// these tests never touch the network, regardless of whether DATABASE_URL
// points at a real database.

let importCounter = 0;
function importFreshPrismaConfig() {
  return import(`./prisma?test=${importCounter++}`) as Promise<typeof import("./prisma")>;
}

// Every test restores process.env and globalThis.__prisma afterward so
// this file never leaks state into any other test sharing this process.
async function withPrismaEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
) {
  const previousEnv: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previousEnv[key] = process.env[key];
  const previousGlobal = globalThis.__prisma;
  globalThis.__prisma = undefined;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.__prisma = previousGlobal;
  }
}

test("config/prisma: importing constructs a usable PrismaClient without opening a real connection, given only a syntactically valid DATABASE_URL", async () => {
  await withPrismaEnv(
    { NODE_ENV: "test", DATABASE_URL: "postgresql://user:pass@ep-pooled.neon.tech/devpilot" },
    async () => {
      const { prisma } = await importFreshPrismaConfig();

      assert.ok(prisma);
      assert.equal(typeof prisma.$disconnect, "function");
      assert.equal(typeof prisma.$queryRaw, "function");
      assert.equal(typeof prisma.$transaction, "function");

      await prisma.$disconnect();
    },
  );
});

test("config/prisma: sets neonConfig.webSocketConstructor to the real `ws` implementation for this Node runtime", async () => {
  await withPrismaEnv(
    { NODE_ENV: "test", DATABASE_URL: "postgresql://user:pass@ep-pooled.neon.tech/devpilot" },
    async () => {
      const { prisma } = await importFreshPrismaConfig();

      assert.equal(neonConfig.webSocketConstructor, WebSocketImpl);

      await prisma.$disconnect();
    },
  );
});

test("config/prisma: outside production, the client is cached on globalThis.__prisma so a hot reload never constructs a second client", async () => {
  await withPrismaEnv(
    { NODE_ENV: "development", DATABASE_URL: "postgresql://user:pass@ep-pooled.neon.tech/devpilot" },
    async () => {
      const first = await importFreshPrismaConfig();
      assert.ok(globalThis.__prisma);
      assert.equal(globalThis.__prisma, first.prisma);

      // A second fresh import of the module (simulating tsx watch's module
      // reload) must reuse the cached globalThis.__prisma rather than
      // constructing a new client.
      const second = await importFreshPrismaConfig();
      assert.equal(second.prisma, first.prisma);
      assert.equal(second.prisma, globalThis.__prisma);

      await first.prisma.$disconnect();
    },
  );
});

test("config/prisma: in production, the client is constructed correctly but is not cached onto globalThis", async () => {
  await withPrismaEnv(
    { NODE_ENV: "production", DATABASE_URL: "postgresql://user:pass@ep-pooled.neon.tech/devpilot" },
    async () => {
      const { prisma } = await importFreshPrismaConfig();

      assert.ok(prisma);
      assert.equal(globalThis.__prisma, undefined);

      await prisma.$disconnect();
    },
  );
});
