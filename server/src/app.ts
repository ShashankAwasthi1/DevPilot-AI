import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";
import routes from "./routes";

const app = express();

// credentials: true + a specific origin (not "*") is required for the
// browser to send/accept the session cookie cross-origin.
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/api/v1", routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
