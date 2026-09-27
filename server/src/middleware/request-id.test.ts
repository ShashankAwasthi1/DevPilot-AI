import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { requestId } from "./request-id";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeFakeResponse(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
      return res;
    },
  } as unknown as Response;
  return { res, headers };
}

function makeFakeRequest(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

test("requestId: generates a UUID-format id and sets it on req.requestId", () => {
  const req = makeFakeRequest();
  const { res } = makeFakeResponse();
  let nextCalled = false;

  requestId(req, res, () => {
    nextCalled = true;
  });

  assert.ok(req.requestId, "req.requestId must be set");
  assert.match(req.requestId!, UUID_PATTERN);
  assert.ok(nextCalled, "next() must be called");
});

test("requestId: sets the X-Request-ID response header to the same value as req.requestId", () => {
  const req = makeFakeRequest();
  const { res, headers } = makeFakeResponse();

  requestId(req, res, () => {});

  assert.equal(headers["X-Request-ID"], req.requestId);
  assert.match(headers["X-Request-ID"], UUID_PATTERN);
});

test("requestId: two separate requests receive different ids", () => {
  const { res: resA } = makeFakeResponse();
  const { res: resB } = makeFakeResponse();
  const reqA = makeFakeRequest();
  const reqB = makeFakeRequest();

  requestId(reqA, resA, () => {});
  requestId(reqB, resB, () => {});

  assert.notEqual(reqA.requestId, reqB.requestId);
});

test("requestId: never trusts or echoes a client-supplied X-Request-ID header - always generates its own", () => {
  const req = makeFakeRequest({ "x-request-id": "attacker-supplied-value" });
  const { res, headers } = makeFakeResponse();

  requestId(req, res, () => {});

  assert.notEqual(req.requestId, "attacker-supplied-value");
  assert.notEqual(headers["X-Request-ID"], "attacker-supplied-value");
  assert.match(req.requestId!, UUID_PATTERN);
});

test("requestId: calls next() with no arguments (never forwards an error)", () => {
  const req = makeFakeRequest();
  const { res } = makeFakeResponse();
  const nextArgs: unknown[] = [];

  requestId(req, res, (...args: unknown[]) => {
    nextArgs.push(...args);
  });

  assert.deepEqual(nextArgs, []);
});
