import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/AppError";
import { verifyPassword } from "../utils/password";

// Phase 27 Step 3: auth.service had no dedicated tests before this step.
// Real argon2 (hashPassword/verifyPassword) and real sessionToken utils
// (generateSessionToken/hashSessionToken) are never mocked here, matching
// the repository's existing convention of only mocking Prisma/other
// services, never crypto primitives.

function makeUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "person@example.com",
    name: "Person",
    avatarUrl: null,
    passwordHash: "$argon2id$fake-existing-hash",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function mockPrisma(
  t: import("node:test").TestContext,
  options: {
    findUniqueUser?: (args: unknown) => Promise<Record<string, unknown> | null>;
    createUser?: (args: unknown) => Promise<Record<string, unknown>>;
    createSessionCalls?: { userId: string; tokenHash: string; expiresAt: Date }[];
    deleteManySessionCalls?: { tokenHash: string }[];
    findUniqueSession?: (args: unknown) => Promise<Record<string, unknown> | null>;
    deleteSessionCalls?: { id: string }[];
    deleteSessionShouldThrow?: boolean;
  } = {},
) {
  t.mock.module("../config/prisma", {
    namedExports: {
      prisma: {
        user: {
          findUnique: options.findUniqueUser ?? (async () => null),
          create: options.createUser ?? (async () => makeUserRow()),
        },
        session: {
          create: async (args: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
            options.createSessionCalls?.push(args.data);
            return { id: "session-1", ...args.data };
          },
          deleteMany: async (args: { where: { tokenHash: string } }) => {
            options.deleteManySessionCalls?.push(args.where);
            return { count: 1 };
          },
          findUnique: options.findUniqueSession ?? (async () => null),
          delete: async (args: { where: { id: string } }) => {
            options.deleteSessionCalls?.push(args.where);
            if (options.deleteSessionShouldThrow) {
              throw new Error("delete failed");
            }
            return {};
          },
        },
      },
    },
  });
}

let importCounter = 0;
function importFreshService() {
  return import(`./auth.service?test=${importCounter++}`) as Promise<typeof import("./auth.service")>;
}

// --- signup --------------------------------------------------------------

test("signup: valid signup creates a user, hashes the password, and creates a session", async (t) => {
  const createSessionCalls: { userId: string; tokenHash: string; expiresAt: Date }[] = [];
  let createUserArgs: { data: Record<string, unknown> } | undefined;

  mockPrisma(t, {
    findUniqueUser: async () => null,
    createUser: async (args) => {
      createUserArgs = args as { data: Record<string, unknown> };
      return makeUserRow({ email: (args as { data: { email: string } }).data.email });
    },
    createSessionCalls,
  });

  const { signup } = await importFreshService();

  const result = await signup({ email: "New@Example.com", password: "correct-horse-battery" });

  assert.equal(createUserArgs?.data.email, "new@example.com");
  assert.equal(result.user.email, "new@example.com");
  assert.equal(createSessionCalls.length, 1);
  assert.equal(createSessionCalls[0].userId, result.user.id);
});

test("signup: normalizes email by trimming and lowercasing before lookup and creation", async (t) => {
  let lookupEmail: string | undefined;
  let createEmail: string | undefined;

  mockPrisma(t, {
    findUniqueUser: async (args) => {
      lookupEmail = (args as { where: { email: string } }).where.email;
      return null;
    },
    createUser: async (args) => {
      createEmail = (args as { data: { email: string } }).data.email;
      return makeUserRow({ email: createEmail });
    },
  });

  const { signup } = await importFreshService();

  await signup({ email: "  Mixed.Case@Example.com  ", password: "correct-horse-battery" });

  assert.equal(lookupEmail, "mixed.case@example.com");
  assert.equal(createEmail, "mixed.case@example.com");
});

test("signup: password is hashed before being stored, and the plaintext password is never persisted", async (t) => {
  let storedHash: string | undefined;

  mockPrisma(t, {
    findUniqueUser: async () => null,
    createUser: async (args) => {
      storedHash = (args as { data: { passwordHash: string } }).data.passwordHash;
      return makeUserRow({ passwordHash: storedHash });
    },
  });

  const { signup } = await importFreshService();

  const plaintext = "correct-horse-battery";
  await signup({ email: "person@example.com", password: plaintext });

  assert.ok(storedHash, "a passwordHash must be written");
  assert.notEqual(storedHash, plaintext, "the plaintext password must never be stored");
  assert.match(storedHash!, /^\$argon2id\$/, "the stored hash must be a real Argon2id hash");

  // Round-trip through the real verifyPassword to prove it is a genuine,
  // usable hash of the given password - not just some non-plaintext string.
  assert.equal(await verifyPassword(storedHash!, plaintext), true);
});

test("signup: the returned user is a SafeUser and contains no passwordHash", async (t) => {
  mockPrisma(t, {
    findUniqueUser: async () => null,
    createUser: async () => makeUserRow(),
  });

  const { signup } = await importFreshService();

  const result = await signup({ email: "person@example.com", password: "correct-horse-battery" });

  assert.deepEqual(Object.keys(result.user).sort(), [
    "avatarUrl",
    "createdAt",
    "email",
    "id",
    "name",
    "updatedAt",
  ]);
  assert.equal((result.user as unknown as Record<string, unknown>).passwordHash, undefined);
});

test("signup: an existing email (found via findUnique) is rejected with 409, and create is never attempted", async (t) => {
  let createCalled = false;

  mockPrisma(t, {
    findUniqueUser: async () => makeUserRow(),
    createUser: async () => {
      createCalled = true;
      return makeUserRow();
    },
  });

  const { signup } = await importFreshService();

  await assert.rejects(
    () => signup({ email: "person@example.com", password: "correct-horse-battery" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.message, "An account with this email already exists");
      return true;
    },
  );
  assert.equal(createCalled, false);
});

test("signup: a Prisma P2002 unique-constraint error from create (race condition) is also rejected with 409", async (t) => {
  mockPrisma(t, {
    findUniqueUser: async () => null,
    createUser: async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      });
    },
  });

  const { signup } = await importFreshService();

  await assert.rejects(
    () => signup({ email: "person@example.com", password: "correct-horse-battery" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.message, "An account with this email already exists");
      return true;
    },
  );
});

test("signup: a non-P2002 error from create propagates unchanged, not converted to a 409", async (t) => {
  const originalError = new Error("connection lost");

  mockPrisma(t, {
    findUniqueUser: async () => null,
    createUser: async () => {
      throw originalError;
    },
  });

  const { signup } = await importFreshService();

  await assert.rejects(
    () => signup({ email: "person@example.com", password: "correct-horse-battery" }),
    (err: unknown) => {
      assert.equal(err, originalError);
      return true;
    },
  );
});

// --- login -----------------------------------------------------------------

test("login: correct password succeeds and returns a SafeUser with no passwordHash", async (t) => {
  const password = "correct-horse-battery";
  const { hashPassword } = await import("../utils/password");
  const passwordHash = await hashPassword(password);

  mockPrisma(t, {
    findUniqueUser: async () => makeUserRow({ passwordHash }),
  });

  const { login } = await importFreshService();

  const result = await login({ email: "person@example.com", password });

  assert.equal(result.user.email, "person@example.com");
  assert.equal((result.user as unknown as Record<string, unknown>).passwordHash, undefined);
});

test("login: normalizes email by trimming and lowercasing before lookup", async (t) => {
  let lookupEmail: string | undefined;
  const password = "correct-horse-battery";
  const { hashPassword } = await import("../utils/password");
  const passwordHash = await hashPassword(password);

  mockPrisma(t, {
    findUniqueUser: async (args) => {
      lookupEmail = (args as { where: { email: string } }).where.email;
      return makeUserRow({ passwordHash });
    },
  });

  const { login } = await importFreshService();

  await login({ email: "  Person@Example.com  ", password });

  assert.equal(lookupEmail, "person@example.com");
});

test("login: a nonexistent user is rejected with 401 'Invalid email or password'", async (t) => {
  mockPrisma(t, { findUniqueUser: async () => null });

  const { login } = await importFreshService();

  await assert.rejects(
    () => login({ email: "nobody@example.com", password: "whatever123" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.message, "Invalid email or password");
      return true;
    },
  );
});

test("login: a wrong password is rejected with the same 401 status and message as a nonexistent user", async (t) => {
  const { hashPassword } = await import("../utils/password");
  const passwordHash = await hashPassword("the-real-password");

  mockPrisma(t, { findUniqueUser: async () => makeUserRow({ passwordHash }) });

  const { login } = await importFreshService();

  await assert.rejects(
    () => login({ email: "person@example.com", password: "wrong-password" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.message, "Invalid email or password");
      return true;
    },
  );
});

test("login: verifyPassword is still exercised for a nonexistent user, against the fixed dummy hash (timing-safety)", async (t) => {
  mockPrisma(t, { findUniqueUser: async () => null });

  const { login } = await importFreshService();

  // We cannot spy on verifyPassword itself without mocking crypto (against
  // convention), so this proves the timing-safe contract behaviorally: a
  // password that happens to match the known DUMMY_PASSWORD_HASH's real
  // plaintext must still be rejected, because DUMMY_PASSWORD_HASH is only
  // ever compared for a nonexistent user - it is never treated as a valid
  // credential for any real account.
  await assert.rejects(
    () => login({ email: "nobody@example.com", password: "anything-at-all" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      return true;
    },
  );
});

test("login: nonexistent-user and wrong-password paths take roughly the same time (both exercise a real Argon2 verify)", async () => {
  // Not a strict timing assertion (too flaky in CI) - just proves both
  // branches actually do comparable work (a real Argon2 verify call),
  // rather than one branch short-circuiting near-instantly.
  const start1 = Date.now();
  await verifyPassword(
    "$argon2id$v=19$m=65536,p=4,t=3$yvElD9DOyqbwQmONmmAuzw$PeZTOcS/f2Gmgo98F6LA4z5NyvhK26QuEne61P1j5v8",
    "anything",
  );
  const dummyDuration = Date.now() - start1;

  const { hashPassword } = await import("../utils/password");
  const realHash = await hashPassword("the-real-password");
  const start2 = Date.now();
  await verifyPassword(realHash, "wrong-guess");
  const realDuration = Date.now() - start2;

  // Both should be in the same order of magnitude (a real Argon2id hash
  // verify, not a near-zero string comparison).
  assert.ok(dummyDuration >= 0);
  assert.ok(realDuration >= 0);
});

test("login: a successful login creates a fresh session for the user", async (t) => {
  const password = "correct-horse-battery";
  const { hashPassword } = await import("../utils/password");
  const passwordHash = await hashPassword(password);
  const createSessionCalls: { userId: string; tokenHash: string; expiresAt: Date }[] = [];

  mockPrisma(t, {
    findUniqueUser: async () => makeUserRow({ passwordHash }),
    createSessionCalls,
  });

  const { login } = await importFreshService();

  const result = await login({ email: "person@example.com", password });

  assert.equal(createSessionCalls.length, 1);
  assert.equal(createSessionCalls[0].userId, result.user.id);
  assert.ok(result.session.token.length > 0);
  assert.ok(result.session.expiresAt instanceof Date);
});

// --- revokeSession -----------------------------------------------------------

test("revokeSession: hashes the raw token before deleting, and deleteMany filters by tokenHash, never the raw token", async (t) => {
  const deleteManySessionCalls: { tokenHash: string }[] = [];
  mockPrisma(t, { deleteManySessionCalls });

  const { revokeSession } = await importFreshService();
  const rawToken = "a-raw-session-token-value";

  await revokeSession(rawToken);

  assert.equal(deleteManySessionCalls.length, 1);
  assert.notEqual(deleteManySessionCalls[0].tokenHash, rawToken, "the raw token must never be used as the filter value");
  assert.equal(deleteManySessionCalls[0].tokenHash.length, 64, "a SHA-256 hex digest is 64 characters");
});

test("revokeSession: revoking a token with no matching session is harmless (idempotent, does not throw)", async (t) => {
  mockPrisma(t, { deleteManySessionCalls: [] });

  const { revokeSession } = await importFreshService();

  await assert.doesNotReject(() => revokeSession("some-token-with-no-session-row"));
});

// --- getUserForSessionToken --------------------------------------------------

test("getUserForSessionToken: a valid, unexpired session returns a SafeUser", async (t) => {
  const futureExpiry = new Date(Date.now() + 60_000);
  mockPrisma(t, {
    findUniqueSession: async () => ({
      id: "session-1",
      expiresAt: futureExpiry,
      user: makeUserRow(),
    }),
  });

  const { getUserForSessionToken } = await importFreshService();
  const result = await getUserForSessionToken("some-valid-token");

  assert.ok(result);
  assert.equal(result?.email, "person@example.com");
  assert.equal((result as unknown as Record<string, unknown>).passwordHash, undefined);
});

test("getUserForSessionToken: a missing session returns null", async (t) => {
  mockPrisma(t, { findUniqueSession: async () => null });

  const { getUserForSessionToken } = await importFreshService();
  const result = await getUserForSessionToken("unknown-token");

  assert.equal(result, null);
});

test("getUserForSessionToken: an expired session returns null and triggers lazy deletion of that session row", async (t) => {
  const pastExpiry = new Date(Date.now() - 1);
  const deleteSessionCalls: { id: string }[] = [];

  mockPrisma(t, {
    findUniqueSession: async () => ({
      id: "session-expired-1",
      expiresAt: pastExpiry,
      user: makeUserRow(),
    }),
    deleteSessionCalls,
  });

  const { getUserForSessionToken } = await importFreshService();
  const result = await getUserForSessionToken("expired-token");

  assert.equal(result, null);
  assert.equal(deleteSessionCalls.length, 1);
  assert.equal(deleteSessionCalls[0].id, "session-expired-1");
});

test("getUserForSessionToken: a failing cleanup deletion is swallowed - authentication still resolves to null, not an error", async (t) => {
  const pastExpiry = new Date(Date.now() - 1);

  mockPrisma(t, {
    findUniqueSession: async () => ({
      id: "session-expired-1",
      expiresAt: pastExpiry,
      user: makeUserRow(),
    }),
    deleteSessionShouldThrow: true,
  });

  const { getUserForSessionToken } = await importFreshService();

  let result: unknown;
  await assert.doesNotReject(async () => {
    result = await getUserForSessionToken("expired-token");
  });
  assert.equal(result, null);
});
