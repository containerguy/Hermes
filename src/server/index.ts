import { createHermesApp } from "./app";
import { readEnv, warnAboutLegacyEnv } from "./env";

warnAboutLegacyEnv();

const port = Number(readEnv("PORT") ?? "3000");
const host = readEnv("HOST") ?? "0.0.0.0";
const { app, close } = await createHermesApp();

const server = app.listen(port, host, () => {
  console.log(`Matchdesk listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    close()
      .catch((error) => {
        console.error("[Matchdesk] Shutdown persistence failed", error);
      })
      .finally(() => {
        process.exit(0);
      });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
