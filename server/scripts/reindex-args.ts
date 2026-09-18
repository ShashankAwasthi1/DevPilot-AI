export const VALID_INDEX_STATUSES = ["FAILED", "PENDING", "READY"] as const;
export type ReindexStatusFilter = (typeof VALID_INDEX_STATUSES)[number];

export interface ReindexArgs {
  status?: ReindexStatusFilter;
  projectId?: string;
}

export type ParseReindexArgsResult = { ok: true; args: ReindexArgs } | { ok: false; error: string };

// Pure, dependency-free CLI argument parsing for reindex-documents.ts -
// kept in its own module (no Prisma/indexDocument import) specifically so
// it can be unit tested without a database. Recognizes exactly two flags,
// `--status=<FAILED|PENDING|READY>` and `--project=<id>`, in any order,
// combinable; anything else (an unknown flag, an unsupported status
// value, or an empty --project value) is a hard parse failure - the
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
    } else {
      return {
        ok: false,
        error: `Unrecognized argument "${arg}". Supported: --status=<FAILED|PENDING|READY>, --project=<id>.`,
      };
    }
  }

  return { ok: true, args };
}
