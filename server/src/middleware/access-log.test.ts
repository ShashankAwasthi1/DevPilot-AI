import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { accessLog } from "./access-log";

// Phase 24 Step 2. accessLog listens for the real Node "finish" event
// rather than wrapping res.json/res.end, so a fake response here is a
// plain EventEmitter with the handful of properties accessLog actually
// reads (statusCode) plus an `emit("finish")` call standing in for Express
// completing the real response - no timers, no real HTTP server needed for
// these isolated unit tests (see access-log.app.test.ts / app.test.ts for
// the full-stack version through a real server).

function makeFakeRequest(overrides: Partial<Request> = {}): Request {
  return {
    requestId: "req-1",
    method: "GET",
    path: "/api/v1/test",
    ...overrides,
  } as unknown as Request;
}

function makeFakeResponse(statusCode = 200): Response {
  const res = new EventEmitter() as unknown as Response & EventEmitter;
  (res as unknown as { statusCode: number }).statusCode = statusCode;
  return res;
}

function captureLogs(t: import("node:test").TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

test("accessLog: logs exactly once, on the response's finish event, with requestId/method/path/status/durationMs", (t) => {
  const lines = captureLogs(t);
  const req = makeFakeRequest({ requestId: "req-abc", method: "GET", path: "/api/v1/health" } as Partial<Request>);
  const res = makeFakeResponse(200) as unknown as Response & EventEmitter;

  accessLog(req, res, () => {});
  assert.equal(lines.length, 0, "must not log before the response actually finishes");

  res.emit("finish");

  assert.equal(lines.length, 1, "must log exactly once");
  const line = lines[0];
  assert.match(line, /requestId=req-abc\b/);
  assert.match(line, /method=GET\b/);
  assert.match(line, /path=\/api\/v1\/health\b/);
  assert.match(line, /status=200\b/);
  assert.match(line, /durationMs=\d+\b/);
});

test("accessLog: a 404 response still produces exactly one log line, with status=404 and the same request id set on the request", (t) => {
  const lines = captureLogs(t);
  const req = makeFakeRequest({ requestId: "req-404", method: "GET", path: "/api/v1/does-not-exist" } as Partial<Request>);
  const res = makeFakeResponse(404) as unknown as Response & EventEmitter;

  accessLog(req, res, () => {});
  res.emit("finish");

  assert.equal(lines.length, 1);
  assert.match(lines[0], /requestId=req-404\b/);
  assert.match(lines[0], /status=404\b/);
});

test("accessLog: uses req.path (query-string-free) - never logs a query string even if present on the original URL", (t) => {
  const lines = captureLogs(t);
  // req.path is already query-string-free by the time Express populates it
  // (the query string lives on req.query/req.originalUrl instead) - this
  // fake request models that real Express behavior directly, and also
  // carries a decoy originalUrl/query to prove accessLog never reads them.
  const req = makeFakeRequest({
    requestId: "req-q",
    method: "GET",
    path: "/api/v1/test",
    originalUrl: "/api/v1/test?secret=should-not-appear",
    query: { secret: "should-not-appear" },
  } as unknown as Partial<Request>);
  const res = makeFakeResponse(200) as unknown as Response & EventEmitter;

  accessLog(req, res, () => {});
  res.emit("finish");

  assert.equal(lines.length, 1);
  assert.match(lines[0], /path=\/api\/v1\/test\b/);
  assert.equal(lines[0].includes("secret=should-not-appear"), false);
  assert.equal(lines[0].includes("?"), false, "no query-string delimiter should ever appear in the log");
});

test("accessLog: never logs request body, cookies, Authorization, or arbitrary header values, even when present on the request", (t) => {
  const lines = captureLogs(t);
  const req = makeFakeRequest({
    requestId: "req-sensitive",
    method: "POST",
    path: "/api/v1/auth/login",
    body: { email: "user@example.com", password: "super-secret-password" },
    cookies: { devpilot_session: "abcdef0123456789" },
    headers: {
      authorization: "Bearer abcdef0123456789",
      "x-api-key": "sk-should-not-appear",
      cookie: "devpilot_session=abcdef0123456789",
    },
  } as unknown as Partial<Request>);
  const res = makeFakeResponse(200) as unknown as Response & EventEmitter;

  accessLog(req, res, () => {});
  res.emit("finish");

  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.equal(line.includes("super-secret-password"), false);
  assert.equal(line.includes("abcdef0123456789"), false);
  assert.equal(line.includes("Bearer"), false);
  assert.equal(line.includes("sk-should-not-appear"), false);
  assert.equal(line.includes("user@example.com"), false);
  assert.equal(line.includes("devpilot_session"), false);
});

test("accessLog: never touches res.status/res.json/response headers or otherwise mutates the response - it only reads res.statusCode after the fact", (t) => {
  captureLogs(t);
  const req = makeFakeRequest();
  const res = makeFakeResponse(200) as unknown as Response & EventEmitter;
  const originalStatusCode = res.statusCode;

  let nextCalled = false;
  accessLog(req, res, () => {
    nextCalled = true;
  });

  assert.ok(nextCalled, "next() must be called synchronously so the real handler chain proceeds unaffected");
  assert.equal(res.statusCode, originalStatusCode, "accessLog must not change the response before it finishes");
});

test("accessLog: two separate requests each log their own, correct, distinct request id", (t) => {
  const lines = captureLogs(t);
  const reqA = makeFakeRequest({ requestId: "req-A", path: "/api/v1/a" } as Partial<Request>);
  const reqB = makeFakeRequest({ requestId: "req-B", path: "/api/v1/b" } as Partial<Request>);
  const resA = makeFakeResponse(200) as unknown as Response & EventEmitter;
  const resB = makeFakeResponse(201) as unknown as Response & EventEmitter;

  accessLog(reqA, resA, () => {});
  accessLog(reqB, resB, () => {});
  resB.emit("finish");
  resA.emit("finish");

  assert.equal(lines.length, 2);
  const lineForA = lines.find((l) => l.includes("path=/api/v1/a"));
  const lineForB = lines.find((l) => l.includes("path=/api/v1/b"));
  assert.match(lineForA!, /requestId=req-A\b/);
  assert.match(lineForA!, /status=200\b/);
  assert.match(lineForB!, /requestId=req-B\b/);
  assert.match(lineForB!, /status=201\b/);
});
