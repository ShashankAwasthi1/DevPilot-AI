import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredPublicEnv } from "./env";

// Phase 27 Step 6: getRequiredPublicEnv had no tests before this step.
// process.env.NODE_ENV is saved/restored around every test that changes it,
// so this file never leaks its value into any other test file/process.

// process.env.NODE_ENV is typed read-only in this Next.js version (see
// AGENTS.md's warning that this Next.js has breaking changes from what
// training data assumes) - a mutable view of the same underlying object
// is required to actually change it for the duration of one test.
const mutableEnv = process.env as Record<string, string | undefined>;

function withNodeEnv<T>(value: string | undefined, fn: () => T): T {
  const original = mutableEnv.NODE_ENV;
  if (value === undefined) {
    delete mutableEnv.NODE_ENV;
  } else {
    mutableEnv.NODE_ENV = value;
  }
  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete mutableEnv.NODE_ENV;
    } else {
      mutableEnv.NODE_ENV = original;
    }
  }
}

test("production + missing variable: throws a clear, actionable error naming the variable", () => {
  withNodeEnv("production", () => {
    assert.throws(
      () => getRequiredPublicEnv(undefined, "NEXT_PUBLIC_API_URL", "http://localhost:8080/api/v1"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /NEXT_PUBLIC_API_URL/);
        assert.match(err.message, /required in production/);
        // Must not create a misleading impression that a later env change
        // (without rebuilding) would fix it - the message must say so.
        assert.match(err.message, /next build/);
        assert.match(err.message, /rebuild/);
        return true;
      },
    );
  });
});

test("production + empty-string variable: also throws (empty is treated as missing, not a valid value)", () => {
  withNodeEnv("production", () => {
    assert.throws(() => getRequiredPublicEnv("", "NEXT_PUBLIC_API_URL", "http://localhost:8080/api/v1"));
  });
});

test("production + variable present: returns the configured value, never the development fallback", () => {
  withNodeEnv("production", () => {
    const result = getRequiredPublicEnv(
      "https://api.example.com/api/v1",
      "NEXT_PUBLIC_API_URL",
      "http://localhost:8080/api/v1",
    );

    assert.equal(result, "https://api.example.com/api/v1");
  });
});

test("development + missing variable: returns the development fallback", () => {
  withNodeEnv("development", () => {
    const result = getRequiredPublicEnv(undefined, "NEXT_PUBLIC_API_URL", "http://localhost:8080/api/v1");

    assert.equal(result, "http://localhost:8080/api/v1");
  });
});

test("development + variable present: returns the configured value, not the fallback", () => {
  withNodeEnv("development", () => {
    const result = getRequiredPublicEnv(
      "http://localhost:9999/api/v1",
      "NEXT_PUBLIC_API_URL",
      "http://localhost:8080/api/v1",
    );

    assert.equal(result, "http://localhost:9999/api/v1");
  });
});

test("NODE_ENV unset (neither development nor production): treated the same as development - returns the fallback", () => {
  withNodeEnv(undefined, () => {
    const result = getRequiredPublicEnv(undefined, "NEXT_PUBLIC_API_URL", "http://localhost:8080/api/v1");

    assert.equal(result, "http://localhost:8080/api/v1");
  });
});

// --- NEXT_PUBLIC_SITE_URL coverage (same generic helper, per the second call site) ---

test("NEXT_PUBLIC_SITE_URL: production + missing throws, naming SITE_URL specifically", () => {
  withNodeEnv("production", () => {
    assert.throws(
      () => getRequiredPublicEnv(undefined, "NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /NEXT_PUBLIC_SITE_URL/);
        return true;
      },
    );
  });
});

test("NEXT_PUBLIC_SITE_URL: development + missing returns the localhost:3000 fallback", () => {
  withNodeEnv("development", () => {
    const result = getRequiredPublicEnv(undefined, "NEXT_PUBLIC_SITE_URL", "http://localhost:3000");

    assert.equal(result, "http://localhost:3000");
  });
});

test("NEXT_PUBLIC_SITE_URL: production + variable present returns the configured value", () => {
  withNodeEnv("production", () => {
    const result = getRequiredPublicEnv("https://devpilot.example.com", "NEXT_PUBLIC_SITE_URL", "http://localhost:3000");

    assert.equal(result, "https://devpilot.example.com");
  });
});
