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

// A fake AIProvider whose streamTurn() never resolves on its own - it
// optionally yields one text event, then waits until its (internal)
// AbortSignal fires and rejects with an AbortError, exactly like the real
// Anthropic SDK does when its signal aborts mid-request (see
// tool-loop.abort-midstream.test.ts). Used only for agent-runner timeout
// tests, where a real timer must actually elapse while a provider call is
// still "in flight".
export function makeHangingProvider(options?: { textBeforeHang?: string }): {
  provider: AIProvider;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];

  const provider: AIProvider = {
    name: "fake-hanging",
    async *streamTurn(params: StreamTurnParams) {
      calls.push({ params });
      if (options?.textBeforeHang) {
        yield { type: "text", text: options.textBeforeHang };
      }
      await new Promise<never>((_resolve, reject) => {
        params.signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    },
  };

  return { provider, calls };
}
