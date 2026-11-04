import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CSRF_HEADER } from "../auth/csrf";
import { post, startPizzaTestEnv, type PizzaTestEnv } from "./pizza-test-helpers";

let env: PizzaTestEnv;
const secret = "kiosk-test-secret-ok";

beforeEach(async () => {
  env = await startPizzaTestEnv();
  await env.admin.agent
    .put("/api/admin/settings")
    .set(CSRF_HEADER, env.admin.csrf)
    .send({ kioskStreamEnabled: true, kioskStreamPath: "stream", kioskStreamSecret: secret })
    .expect(200);
}, 30_000);

afterEach(async () => {
  await env.close();
});

async function runningEvent(name: string, visibility: "public" | "private" = "public") {
  const id = (await post(env.admin, "/api/main-events", { name, visibility }).expect(201)).body.mainEvent.id as string;
  await post(env.admin, `/api/main-events/${id}/start`).expect(200);
  return id;
}

function round(gameTitle: string, mainEventId: string | null) {
  return post(env.admin, "/api/events", {
    gameTitle,
    startMode: "scheduled",
    startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    minPlayers: 2,
    maxPlayers: 8,
    mainEventId
  }).expect(201);
}

function kiosk(query = "") {
  return env.admin.agent.get(`/api/kiosk/events?id=${secret}${query}`).expect(200);
}

describe("Kiosk pro Event", () => {
  it("lists all running public events for grouping, without private ones", async () => {
    const lan = await runningEvent("LAN Herbst");
    const secretCup = await runningEvent("Geheim", "private");
    await round("Quake", lan);
    await round("Poker", secretCup);
    await round("Schach", null);

    const body = (await kiosk()).body;
    expect(body.mainEvent).toBeNull();
    expect(body.mainEvents.map((entry: { name: string }) => entry.name)).toEqual(["LAN Herbst"]);
    expect(body.events.map((event: { gameTitle: string }) => event.gameTitle).sort()).toEqual(["Quake", "Schach"]);
    expect(body.events.find((event: { gameTitle: string }) => event.gameTitle === "Quake").mainEventName).toBe("LAN Herbst");
  });

  it("shows only one event from the URL or the setting", async () => {
    const lan = await runningEvent("LAN Herbst");
    const cup = await runningEvent("Turnier");
    await round("Quake", lan);
    await round("Rocket League", cup);
    await round("Schach", null);

    const viaUrl = (await kiosk(`&event=${cup}`)).body;
    expect(viaUrl.mainEvent).toMatchObject({ id: cup, name: "Turnier" });
    expect(viaUrl.events.map((event: { gameTitle: string }) => event.gameTitle)).toEqual(["Rocket League"]);

    await env.admin.agent
      .put("/api/admin/settings")
      .set(CSRF_HEADER, env.admin.csrf)
      .send({ kioskMainEventId: lan })
      .expect(200);
    const viaSetting = (await kiosk()).body;
    expect(viaSetting.events.map((event: { gameTitle: string }) => event.gameTitle)).toEqual(["Quake"]);
    // Die URL hat Vorrang vor der Einstellung.
    expect((await kiosk(`&event=${cup}`)).body.mainEvent.id).toBe(cup);
  });
});
