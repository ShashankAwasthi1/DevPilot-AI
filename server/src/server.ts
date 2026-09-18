import app from "./app";
import { runEmbeddingModelWarmUp } from "./ai/embedding-warmup";
import { env } from "./config/env";
import { registerServerErrorLogging } from "./server-error-logging";
import { registerGracefulShutdown } from "./shutdown";

const server = app.listen(env.port, () => {
  console.log(`DevPilot API listening on port ${env.port}`);
});

registerServerErrorLogging(server);
registerGracefulShutdown(server);

// Fire-and-forget - never delays accepting connections above, and a
// failure here is logged and swallowed internally (see
// ai/embedding-warmup.ts), never thrown here.
runEmbeddingModelWarmUp();
