import { test } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { errorHandler } from "./errorHandler";
import { AppError } from "../utils/AppError";

function makeFakeRequest(requestId: string | undefined): Request {
  return { requestId } as unknown as Request;
}

interface FakeResponseState {
  statusCode: number | null;
  body: unknown;
}

function makeFakeResponse(): { res: Response; state: FakeResponseState } {
  const state: FakeResponseState = { statusCode: null, body: undefined };
  const res = {
    status: (code: number) => {
      state.statusCode = code;
      return res;
    },
    json: (body: unknown) => {
      state.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

const noopNext = (() => {}) as NextFunction;

test("errorHandler: an AppError keeps its existing status/body contract, and the response never carries a requestId field", () => {
  const req = makeFakeRequest("req-1");
  const { res, state } = makeFakeResponse();

  errorHandler(new AppError(404, "Project not found"), req, res, noopNext);

  assert.equal(state.statusCode, 404);
  assert.deepEqual(state.body, { status: "error", message: "Project not found" });
});

test("errorHandler: an AppError with details preserves the existing details field in the response, unchanged", () => {
  const req = makeFakeRequest("req-2");
  const { res, state } = makeFakeResponse();

  errorHandler(new AppError(400, "Validation failed", { title: ["Required"] }), req, res, noopNext);

  assert.equal(state.statusCode, 400);
  assert.deepEqual(state.body, {
    status: "error",
    message: "Validation failed",
    details: { title: ["Required"] },
  });
});

test("errorHandler: an AppError's server-side log includes the request id alongside the existing status/message", (t) => {
  const req = makeFakeRequest("req-3");
  const { res } = makeFakeResponse();
  const logCalls: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logCalls.push(args);
  });

  errorHandler(new AppError(409, "This proposal is no longer pending"), req, res, noopNext);

  assert.equal(logCalls.length, 1);
  const [line] = logCalls[0];
  assert.equal(typeof line, "string");
  assert.ok((line as string).includes("[409] This proposal is no longer pending"));
  assert.ok((line as string).includes("req-3"));
});

test("errorHandler: an unexpected (non-AppError) error returns the existing generic 500 contract, never the real message or a stack trace", () => {
  const req = makeFakeRequest("req-4");
  const { res, state } = makeFakeResponse();

  errorHandler(new Error("column \"foo\" does not exist"), req, res, noopNext);

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, { status: "error", message: "Internal server error" });
  const serialized = JSON.stringify(state.body);
  assert.equal(serialized.includes("foo"), false);
  assert.equal(serialized.includes("Error"), false);
});

test("errorHandler: an unexpected error's server-side log includes the request id and the full raw error, unchanged", (t) => {
  const req = makeFakeRequest("req-5");
  const { res } = makeFakeResponse();
  const logCalls: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logCalls.push(args);
  });
  const realError = new Error("unexpected failure");

  errorHandler(realError, req, res, noopNext);

  assert.equal(logCalls.length, 1);
  const [prefix, loggedErr] = logCalls[0];
  assert.equal(typeof prefix, "string");
  assert.ok((prefix as string).includes("req-5"));
  assert.equal(loggedErr, realError, "the exact original error object must still be logged, unmodified");
});

test("errorHandler: falls back to 'unknown' in the log (never throws) if req.requestId is somehow unset", (t) => {
  const req = makeFakeRequest(undefined);
  const { res, state } = makeFakeResponse();
  const logCalls: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    logCalls.push(args);
  });

  errorHandler(new AppError(500, "Something went wrong"), req, res, noopNext);

  assert.equal(state.statusCode, 500);
  const [line] = logCalls[0];
  assert.ok((line as string).includes("requestId=unknown"));
});
