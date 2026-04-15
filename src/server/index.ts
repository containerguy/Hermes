import { createHermesApp } from "./app";

const port = Number(process.env.HERMES_PORT ?? "3000");
const host = process.env.HERMES_HOST ?? "0.0.0.0";
const { app, close } = await createHermesApp();

const server = app.listen(port, host, () => {
  console.log(`Hermes listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    close()
      .catch((error) => {
        console.error("[Hermes] Shutdown persistence failed", error);
      })
      .finally(() => {
        process.exit(0);
      });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
