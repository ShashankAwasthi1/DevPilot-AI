// Resolves a NEXT_PUBLIC_* value for one of the two call sites that need
// one (lib/api.ts, app/layout.tsx). The caller must pass the value it
// already read via a literal, static `process.env.NEXT_PUBLIC_X` member
// access - Next.js only inlines direct, static process.env expressions
// into the browser bundle at `next build` time; a dynamic lookup (e.g.
// this function doing `process.env[variableName]` itself) would never be
// inlined and would always resolve to undefined in the browser. This
// function only decides what to do with a value the call site already
// resolved - it never looks anything up itself, so it stays safe to keep
// generic without leaking any other environment variable.
//
// Production: throws a clear, actionable error if the value is missing.
// NEXT_PUBLIC_* variables are inlined into the JS bundle at build time, so
// a value set only in a running production environment (without a
// rebuild) will never reach the browser - the error says so explicitly,
// rather than implying a restart or a later env change would fix it.
//
// Development (and any NODE_ENV other than "production", e.g. "test"):
// falls back to developmentFallback, so `npm run dev` and the test suite
// both work without requiring an env file.
export function getRequiredPublicEnv(
  value: string | undefined,
  variableName: string,
  developmentFallback: string,
): string {
  if (value) return value;

  if (process.env.NODE_ENV !== "production") {
    return developmentFallback;
  }

  throw new Error(
    `${variableName} is required in production but was not set when this app was built. ` +
      `NEXT_PUBLIC_* variables are inlined into the JavaScript bundle at \`next build\` time - ` +
      `set ${variableName} in your deployment platform's build environment and rebuild; ` +
      `changing it afterward without rebuilding will not take effect.`,
  );
}
