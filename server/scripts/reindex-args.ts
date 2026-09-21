export const VALID_INDEX_STATUSES = ["FAILED", "PENDING", "READY"] as const;
export type ReindexStatusFilter = (typeof VALID_INDEX_STATUSES)[number];

export interface ReindexArgs {
  status?: ReindexStatusFilter;
  projectId?: string;
  // Minutes since a document's last update, past which a still-PENDING
  // document is considered abandoned (e.g. the process that was indexing
  // it crashed before it could finish) rather than "genuinely still being
  // indexed right now" - see reindex-documents.ts. Only ever meaningful
  // combined with --status=PENDING (enforced below), so this is never
  // used to retry a READY/FAILED document by age.
  staleAfterMinutes?: number;
}

export type ParseReindexArgsResult = { ok: true; args: ReindexArgs } | { ok: false; error: string };

// Pure, dependency-free CLI argument parsing for reindex-documents.ts -
// kept in its own module (no Prisma/indexDocument import) specifically so
// it can be unit tested without a database. Recognizes three flags,
// `--status=<FAILED|PENDING|READY>`, `--project=<id>`, and
// `--stale-after-minutes=<n>`, in any order, combinable (subject to the
// cross-field check below); anything else (an unknown flag, an
// unsupported status value, an empty --project value, or a non-positive/
// non-numeric --stale-after-minutes value) is a hard parse failure - the
// caller (reindex-documents.ts) must never touch the database when this
// returns { ok: false }.
export function parseReindexArgs(argv: string[]): ParseReindexArgsResult {
  const args: ReindexArgs = {};

  for (const arg of argv) {
    if (arg.startsWith("--status=")) {
      const value = arg.slice("--status=".length);
      if (!(VALID_INDEX_STATUSES as readonly string[]).includes(value)) {
        return {
          ok: false,
          error: `Invalid --status value "${value}". Must be one of: ${VALID_INDEX_STATUSES.join(", ")}.`,
        };
      }
      args.status = value as ReindexStatusFilter;
    } else if (arg.startsWith("--project=")) {
      const value = arg.slice("--project=".length);
      if (value.length === 0) {
        return { ok: false, error: "Invalid --project value: must not be empty." };
      }
      args.projectId = value;
    } else if (arg.startsWith("--stale-after-minutes=")) {
      const value = arg.slice("--stale-after-minutes=".length);
      const minutes = Number(value);
      // Number("") is 0, not NaN, and Number(" ") is also 0 - explicitly
      // excluded by the <= 0 check below alongside genuine zero/negative/
      // non-numeric input, so every one of those is rejected the same way.
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return {
          ok: false,
          error: `Invalid --stale-after-minutes value "${value}": must be a finite positive number of minutes.`,
        };
      }
      args.staleAfterMinutes = minutes;
    } else {
      return {
        ok: false,
        error:
          `Unrecognized argument "${arg}". Supported: --status=<FAILED|PENDING|READY>, ` +
          "--project=<id>, --stale-after-minutes=<n>.",
      };
    }
  }

  // The stale-age filter only makes sense as a way to recover documents
  // stuck PENDING after a crash (see reindex-documents.ts) - applying it
  // to READY/FAILED, or to every status at once, isn't what it's for and
  // would be silently meaningless rather than doing what its name implies,
  // so this is rejected explicitly instead of quietly ignored.
  if (args.staleAfterMinutes !== undefined && args.status !== "PENDING") {
    return {
      ok: false,
      error: "--stale-after-minutes requires --status=PENDING - it is only for recovering documents stuck PENDING after a crash.",
    };
  }

  return { ok: true, args };
}

// Pure - computes the exact cutoff Date a stale-PENDING sweep should use.
// `now` is injectable (defaults to the real current time for actual runs)
// specifically so this can be unit tested deterministically, the same
// dependency-free way as parseReindexArgs above - no fake timers, no
// Prisma, no mocking needed to test exact boundary behavior.
export function computeStaleCutoff(staleAfterMinutes: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - staleAfterMinutes * 60_000);
}
