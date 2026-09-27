import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { accessLog } from "./middleware/access-log";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";
import { requestId } from "./middleware/request-id";
import routes from "./routes";

const app = express();

// Removes the "X-Powered-By: Express" response header - a small,
// zero-dependency framework-fingerprinting reduction (Express sets this
// by default on every response otherwise).
app.disable("x-powered-by");

// Mounted before everything else (helmet, cors, body-parsing, routes) so
// every response this app ever sends - success, 404, or error - carries an
// X-Request-ID header, and every downstream handler (notFoundHandler,
// errorHandler, any route) can read req.requestId.
app.use(requestId);

// Mounted immediately after requestId, before helmet/cors/body-parsing/
// routes, so every request - success, 404, or error alike - gets exactly
// one access-log line, and that line can always read the request ID the
// middleware above just set.
app.use(accessLog);

// The deployment target is a single Node process behind exactly one
// reverse-proxy hop (Render/Fly/Railway-style platform, per
// docs/adr/0001-separate-express-backend.md) - "1" tells Express to trust
// the X-Forwarded-* headers set by that one hop only, so req.ip resolves to
// the real client address (not the proxy's) rather than "true", which would
// trust an arbitrary, attacker-controllable chain of forwarded-for values.
// This also makes req.secure (and therefore the `secure` cookie flag logic
// in config/auth.ts) reflect the original client connection correctly when
// TLS is terminated at the proxy.
app.set("trust proxy", 1);

// Helmet's own defaults (CSP, HSTS, X-Content-Type-Options,
// X-Frame-Options, Referrer-Policy, etc.) - this is a pure JSON API with
// no HTML views of its own, so there's nothing here for a custom CSP to
// meaningfully restrict; the default policy is already a strict "same
// origin only, no inline/external anything" baseline that costs nothing
// to keep. Mounted first, before CORS/body-parsing/routes, so every
// response (including error responses) carries these headers.
app.use(helmet());

// credentials: true + a specific origin (not "*") is required for the
// browser to send/accept the session cookie cross-origin.
app.use(cors({ origin: env.corsOrigin, credentials: true }));
// Explicit limit rather than the implicit default - the largest single
// field any Zod schema accepts is document content at 50,000 characters
// (validation/document.validation.ts), well under 1mb even accounting for
// multi-byte UTF-8 and the rest of a typical request body.
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/api/v1", routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
