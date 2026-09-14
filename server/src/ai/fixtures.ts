// Shared test-only helpers for tool-loop.*.test.ts. Not a *.test.ts file
// itself, so the test runner never tries to execute it as a suite.
import type { AIProvider, StreamEvent, StreamTurnParams } from "./provider";

export interface RecordedCall {
  params: StreamTurnParams;
}

// A fake AIProvider whose events per round are supplied by `scriptFor`,
// keyed by 0-based call index. Records every call's params so a test can
// assert what `tools`/`messages` were actually sent to the "model".
export function makeScriptedProvider(scriptFor: (callIndex: number) => StreamEvent[]): {
  provider: AIProvider;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let callIndex = 0;

  const provider: AIProvider = {
    name: "fake",
    async *streamTurn(params: StreamTurnParams) {
      calls.push({ params });
      const events = scriptFor(callIndex);
      callIndex++;
      for (const event of events) {
        yield event;
      }
    },
  };

  return { provider, calls };
}
