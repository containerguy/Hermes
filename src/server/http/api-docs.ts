import type { Express, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveOpenApiSpecPath(): string {
  const candidates = [
    path.join(process.cwd(), "dist-server/openapi/hermes-api.yaml"),
    path.join(__dirname, "../openapi/hermes-api.yaml")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("[Hermes] OpenAPI spec not found (expected dist-server/openapi/hermes-api.yaml or src/server/openapi/hermes-api.yaml)");
}

const SWAGGER_UI_VERSION = "5.11.0";

function docsCsp() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "img-src 'self' data: https://unpkg.com",
    "font-src 'self' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "script-src 'self' https://unpkg.com",
    "connect-src 'self'"
  ].join("; ");
}

export function mountApiDocs(app: Express) {
  app.get("/api/openapi.yaml", (_request: Request, response: Response) => {
    try {
      const specPath = resolveOpenApiSpecPath();
      response.type("application/yaml");
      response.send(fs.readFileSync(specPath, "utf8"));
    } catch (error) {
      console.error("[Hermes] OpenAPI file error", error);
      response.status(500).type("text/plain").send("OpenAPI specification unavailable");
    }
  });

  app.get("/api/docs", (_request: Request, response: Response) => {
    response.setHeader("Content-Security-Policy", docsCsp());
    response.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hermes API docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css" crossorigin="anonymous" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js" crossorigin="anonymous"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/openapi.yaml",
      dom_id: "#swagger-ui",
      deepLinking: true,
      persistAuthorization: true
    });
  </script>
</body>
</html>`);
  });
}
