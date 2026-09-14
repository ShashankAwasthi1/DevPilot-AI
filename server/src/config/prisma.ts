import { PrismaClient } from "@prisma/client";

// A hot-reloading dev server (tsx watch) would otherwise create a new
// PrismaClient - and a new DB connection pool - on every file save.
// Caching the instance on `globalThis` survives module reloads in dev
// while staying a plain singleton in production.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
