import type { IncomingMessage } from "node:http";
import express, { type Request } from "express";

/** Nur unter diesem Präfix wird der rohe Body behalten (Modul-Routen, z. B. Webhook-Signaturen). */
const RAW_BODY_PREFIX = "/api/m/";

const rawBodies = new WeakMap<IncomingMessage, Buffer>();

function keepsRawBody(request: IncomingMessage & { originalUrl?: string }) {
  const url = request.originalUrl ?? request.url ?? "";
  // Express vergleicht Pfade ohne Groß-/Kleinschreibung; hier genauso.
  return url.toLowerCase().startsWith(RAW_BODY_PREFIX);
}

/**
 * JSON-Parser des Kerns (Limit 1 MB). Für Pfade unter /api/m/ merkt er sich zusätzlich den rohen
 * Body, damit Module Signaturen über die unveränderten Bytes prüfen können.
 */
export function createJsonBodyParser() {
  return express.json({
    limit: "1mb",
    verify: (request, _response, buffer) => {
      if (keepsRawBody(request)) rawBodies.set(request, Buffer.from(buffer));
    }
  });
}

/** Roher JSON-Body der Anfrage; nur unter /api/m/ gesetzt, sonst undefined. */
export function getRawBody(request: Request | IncomingMessage): Buffer | undefined {
  return rawBodies.get(request);
}
