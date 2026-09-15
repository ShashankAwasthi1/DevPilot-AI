// Shared test-only helpers for message.controller.*.test.ts. Not a
// *.test.ts file itself, so the test runner never tries to execute it as
// a suite (same convention as ai/fixtures.ts).
import type { NextFunction, Request, Response } from "express";

export function makeFakeRequest(options: {
  projectId: string;
  conversationId: string;
  userId: string;
  body: Record<string, unknown>;
}): { req: Request; triggerClose: () => void } {
  let closeHandler: (() => void) | undefined;

  const req = {
    params: { projectId: options.projectId, id: options.conversationId },
    body: options.body,
    user: { id: options.userId },
    on: (event: string, cb: () => void) => {
      if (event === "close") closeHandler = cb;
    },
  } as unknown as Request;

  return { req, triggerClose: () => closeHandler?.() };
}

export interface FakeResponseState {
  writes: string[];
  ended: boolean;
}

export function makeFakeResponse(): { res: Response; state: FakeResponseState } {
  const state: FakeResponseState = { writes: [], ended: false };

  const res = {
    writeHead: () => res,
    flushHeaders: () => {},
    write: (chunk: string) => {
      state.writes.push(chunk);
      return true;
    },
    end: () => {
      state.ended = true;
    },
  } as unknown as Response;

  return { res, state };
}

export function throwingNext(): NextFunction {
  return ((err?: unknown) => {
    throw new Error(`next(err) should not be called on this path: ${String(err)}`);
  }) as NextFunction;
}

export function capturingNext(): { next: NextFunction; errors: unknown[] } {
  const errors: unknown[] = [];
  const next = ((err?: unknown) => {
    if (err !== undefined) errors.push(err);
  }) as NextFunction;
  return { next, errors };
}

// Builds a fresh async generator from a fixed list of events - a minimal
// stand-in for runChatTurn/runAgentTurn's real streaming behavior.
export async function* eventsFrom<T>(events: T[]): AsyncGenerator<T> {
  for (const event of events) {
    yield event;
  }
}
