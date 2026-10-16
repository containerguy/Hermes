import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type HermesSettings } from "../../settings";
import { ampCall, ampInstanceCall, setAmpFetchForTests } from "./amp-session";

type Call = { endpoint: string; body: Record<string, unknown> };

const settings: HermesSettings = {
  ...defaultSettings,
  ampIntegrationEnabled: true,
  ampBaseUrl: "https://amp-ctl.example.test"
};

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    text: async () => JSON.stringify(body)
  };
}

function installFetch(handler: (call: Call, index: number) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    // nicht-gierig: Proxy-Pfade enthalten ein zweites "/API/" (…/Servers/<id>/API/Core/…)
    const endpoint = String(url).replace(/^.*?\/API\//, "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const call = { endpoint, body };
    calls.push(call);
    const { status, body: responseBody } = handler(call, calls.length);
    return jsonResponse(status, responseBody);
  });
  setAmpFetchForTests(fetchMock as unknown as Parameters<typeof setAmpFetchForTests>[0]);
  return calls;
}

describe("amp-session", () => {
  beforeEach(() => {
    process.env.HERMES_AMP_USERNAME = "hermes";
    process.env.HERMES_AMP_PASSWORD = "geheim";
    delete process.env.HERMES_AMP_REMEMBER_TOKEN_FILE;
    delete process.env.HERMES_AMP_CA_FILE;
  });

  afterEach(() => {
    setAmpFetchForTests(null);
    delete process.env.HERMES_AMP_USERNAME;
    delete process.env.HERMES_AMP_PASSWORD;
  });

  it("logs in once for parallel calls and reuses the session", async () => {
    const calls = installFetch(({ endpoint }) => {
      if (endpoint === "Core/Login") {
        return { status: 200, body: { success: true, sessionID: "S1", rememberMeToken: "R1" } };
      }
      return { status: 200, body: { result: [{ InstanceID: "a" }] } };
    });

    const [a, b] = await Promise.all([
      ampCall(settings, "ADSModule/GetInstances"),
      ampCall(settings, "ADSModule/GetInstances")
    ]);

    expect(a).toEqual(b);
    expect(calls.filter((c) => c.endpoint === "Core/Login")).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ username: "hermes", password: "geheim", rememberMe: true });
    const dataCalls = calls.filter((c) => c.endpoint !== "Core/Login");
    expect(dataCalls).toHaveLength(2);
    expect(dataCalls.every((c) => c.body.SESSIONID === "S1")).toBe(true);
  });

  it("re-logs in once and retries when AMP reports the session as lost", async () => {
    let logins = 0;
    const calls = installFetch(({ endpoint }) => {
      if (endpoint === "Core/Login") {
        logins += 1;
        return { status: 200, body: { success: true, sessionID: `S${logins}` } };
      }
      const dataCallsSoFar = calls.filter((c) => c.endpoint !== "Core/Login").length;
      if (dataCallsSoFar === 1) {
        return {
          status: 200,
          body: {
            Title: "Unauthorized Access",
            Message: "You do not have permission ... requires the Session.Exists permission."
          }
        };
      }
      return { status: 200, body: { result: "ok" } };
    });

    const result = await ampCall(settings, "Core/GetStatus");

    expect(result).toEqual({ result: "ok" });
    expect(logins).toBe(2);
    const dataCalls = calls.filter((c) => c.endpoint !== "Core/Login");
    expect(dataCalls.map((c) => c.body.SESSIONID)).toEqual(["S1", "S2"]);
  });

  it("falls back to the password when the rememberMe token is rejected", async () => {
    const tokenFile = `${process.env.TMP ?? process.env.TEMP ?? "/tmp"}/hermes-amp-${Date.now()}.token`;
    const fs = await import("node:fs");
    fs.writeFileSync(tokenFile, "OLD-TOKEN\n");
    process.env.HERMES_AMP_REMEMBER_TOKEN_FILE = tokenFile;

    const calls = installFetch(({ endpoint, body }) => {
      if (endpoint === "Core/Login") {
        if (body.password === "OLD-TOKEN") {
          return { status: 200, body: { success: false, resultReason: "Token Rejected" } };
        }
        return { status: 200, body: { success: true, sessionID: "S9", rememberMeToken: "NEW-TOKEN" } };
      }
      return { status: 200, body: { result: [] } };
    });

    await ampCall(settings, "ADSModule/GetInstances");

    const logins = calls.filter((c) => c.endpoint === "Core/Login");
    expect(logins.map((c) => c.body.password)).toEqual(["OLD-TOKEN", "geheim"]);
    expect(fs.readFileSync(tokenFile, "utf8").trim()).toBe("NEW-TOKEN");
    fs.rmSync(tokenFile, { force: true });
  });

  it("logs in per instance through the controller proxy and reuses that session", async () => {
    let instanceLogins = 0;
    const calls = installFetch(({ endpoint, body }) => {
      if (endpoint === "Core/Login") {
        return { status: 200, body: { success: true, sessionID: "S1" } };
      }
      if (endpoint === "ADSModule/Servers/inst-1/API/Core/Login") {
        instanceLogins += 1;
        return { status: 200, body: { success: true, sessionID: `I${instanceLogins}` } };
      }
      if (endpoint === "ADSModule/Servers/inst-1/API/Core/GetStatus") {
        // erste Instanz-Session läuft nach dem ersten Aufruf ab
        if (body.SESSIONID === "I1" && calls.filter((c) => c.endpoint.endsWith("GetStatus")).length > 1) {
          return { status: 200, body: { Title: "Unauthorized Access", Message: "requires the Session.Exists permission" } };
        }
        return { status: 200, body: { State: 20 } };
      }
      return { status: 200, body: {} };
    });

    expect(await ampInstanceCall(settings, "inst-1", "Core/GetStatus")).toEqual({ State: 20 });
    expect(await ampInstanceCall(settings, "inst-1", "Core/GetStatus")).toEqual({ State: 20 });

    const statusCalls = calls.filter((c) => c.endpoint.endsWith("GetStatus"));
    expect(statusCalls.map((c) => c.body.SESSIONID)).toEqual(["I1", "I1", "I2"]);
    expect(instanceLogins).toBe(2);
    const instanceLogin = calls.find((c) => c.endpoint.endsWith("/API/Core/Login"));
    expect(instanceLogin?.body).toMatchObject({ username: "hermes", password: "geheim", SESSIONID: "S1" });
  });

  it("maps an unavailable instance to amp_instanz_nicht_verfuegbar", async () => {
    installFetch(({ endpoint }) => {
      if (endpoint === "Core/Login") return { status: 200, body: { success: true, sessionID: "S1" } };
      if (endpoint.endsWith("/API/Core/Login")) return { status: 200, body: { success: true, sessionID: "I1" } };
      return {
        status: 200,
        body: { Title: "Instance Unavailable", Message: "The requested instance is not available at this time." }
      };
    });
    await expect(ampInstanceCall(settings, "inst-off", "Core/GetUpdates")).rejects.toThrow(
      "amp_instanz_nicht_verfuegbar"
    );
  });

  it("fails without env credentials and never touches the network", async () => {
    delete process.env.HERMES_AMP_PASSWORD;
    const calls = installFetch(() => ({ status: 200, body: {} }));

    await expect(ampCall(settings, "ADSModule/GetInstances")).rejects.toThrow(
      "amp_zugang_erforderlich"
    );
    expect(calls).toHaveLength(0);
  });

  it("rejects when the CA file is configured but unreadable", async () => {
    process.env.HERMES_AMP_CA_FILE = "/definitely/missing/amp-ca.pem";
    const calls = installFetch(() => ({ status: 200, body: {} }));

    await expect(ampCall(settings, "ADSModule/GetInstances")).rejects.toThrow("amp_ca_ungueltig");
    expect(calls).toHaveLength(0);
  });
});
