import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";
import routes from "./routes";

const app = express();

// Removes the "X-Powered-By: Express" response header - a small,
// zero-dependency framework-fingerprinting reduction (Express sets this
// by default on every response otherwise).
app.disable("x-powered-by");

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

// credentials: true + a specific origin (not "*") is required for the
// browser to send/accept the session cookie cross-origin.
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/api/v1", routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
