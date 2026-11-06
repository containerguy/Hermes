import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createJsonBodyParser, getRawBody } from "./raw-body";

function createTestApp() {
  const app = express();
  app.use(createJsonBodyParser());
  app.post("/*path", (req, res) => {
    const raw = getRawBody(req);
    res.json({ body: req.body, raw: raw ? raw.toString("utf8") : null, isBuffer: Buffer.isBuffer(raw) });
  });
  app.use((error: { type?: string; status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: error.type ?? "fehler" });
  });
  return app;
}

// Bewusst ungewöhnlich serialisiert: Leerzeichen, Escapes, Reihenfolge. Genau diese Bytes braucht eine Signaturprüfung.
const RAW = '{ "b":1,"a" : "\\u00e4\\/x" }';

describe("roher Request-Body", () => {
  it("behält den Body unter /api/m/ byte-genau und parst JSON wie bisher", async () => {
    const response = await request(createTestApp())
      .post("/api/m/whatsapp/webhook")
      .set("Content-Type", "application/json")
      .send(RAW)
      .expect(200);
    expect(response.body).toEqual({ body: { b: 1, a: "ä/x" }, raw: RAW, isBuffer: true });
  });

  it("gilt auch bei anderer Groß-/Kleinschreibung, die Express ebenso routet", async () => {
    const response = await request(createTestApp()).post("/API/M/demo/x").set("Content-Type", "application/json").send(RAW).expect(200);
    expect(response.body.raw).toBe(RAW);
  });

  it("setzt außerhalb von /api/m/ keinen rohen Body, JSON-Parsing bleibt unverändert", async () => {
    for (const path of ["/api/events", "/api/modules/x", "/api/mx/demo", "/api/m", "/m/demo"]) {
      const response = await request(createTestApp()).post(path).set("Content-Type", "application/json").send(RAW).expect(200);
      expect(response.body, path).toEqual({ body: { b: 1, a: "ä/x" }, raw: null, isBuffer: false });
    }
  });

  it("behandelt Anfragen ohne JSON-Body und über 1 MB wie bisher", async () => {
    const plain = await request(createTestApp()).post("/api/m/demo/x").set("Content-Type", "text/plain").send("hallo").expect(200);
    expect(plain.body).toEqual({ raw: null, isBuffer: false });
    const big = JSON.stringify({ text: "x".repeat(1024 * 1024) });
    await request(createTestApp()).post("/api/m/demo/x").set("Content-Type", "application/json").send(big).expect(413);
    await request(createTestApp()).post("/api/events").set("Content-Type", "application/json").send(big).expect(413);
  });
});
