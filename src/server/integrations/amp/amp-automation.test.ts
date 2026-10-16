import { describe, expect, it, vi, type Mock } from "vitest";
import {
  GAME_START_FOLLOW_UP_TIMEOUT_MS,
  createAutomationState,
  runAutomationTick,
  type AutomationDeps,
  type AutomationEvent,
  type AutomationState
} from "./amp-automation";
import type { ServerStatus } from "./amp-status";

function serverStatus(overrides: Partial<ServerStatus> = {}): ServerStatus {
  return {
    bindingId: "b-mc",
    ampInstanceId: "inst-mc",
    ampInstanceName: "Minecraft01",
    instanceRunning: false,
    running: false,
    appState: "Stopped",
    game: "Minecraft",
    players: null,
    maxPlayers: null,
    host: "minecraft.lan",
    connectIp: "192.168.9.10",
    port: 25565,
    connectScheme: "minecraft",
    updatedAt: "2026-10-16T10:00:00.000Z",
    error: null,
    ...overrides
  };
}

type Harness = {
  deps: AutomationDeps;
  events: AutomationEvent[];
  statuses: Map<string, ServerStatus>;
  settings: AutomationDeps["settings"];
  clock: { now: number };
  start: Mock<(bindingId: string, opts?: { followUp?: boolean }) => Promise<void>>;
  stop: Mock<(bindingId: string) => Promise<void>>;
  pushRunning: Mock<(eventId: string, gameTitle: string) => Promise<void>>;
  logError: Mock<(message: string, error: unknown) => void>;
  /** Bindungen mit freigeschaltetem Leerlauf-Stopp (Standard in den Tests: alle). */
  autoStopIds: string[] | null;
};

function harness(settings: Partial<AutomationDeps["settings"]> = {}): Harness {
  const h = {
    events: [] as AutomationEvent[],
    statuses: new Map<string, ServerStatus>(),
    settings: { ampAutoStartOnReady: true, ampAutoStopIdleMinutes: 0, ...settings },
    clock: { now: Date.parse("2026-10-16T10:00:00.000Z") },
    start: vi.fn(async (_bindingId: string, _opts?: { followUp?: boolean }) => undefined),
    stop: vi.fn(async (_bindingId: string) => undefined),
    pushRunning: vi.fn(async (_eventId: string, _gameTitle: string) => undefined),
    logError: vi.fn((_message: string, _error: unknown) => undefined),
    autoStopIds: null
  } as Harness;
  // Deps lesen immer den aktuellen Stand von `h` (Tests ersetzen `h.events`).
  h.deps = {
    now: () => new Date(h.clock.now),
    listActiveEvents: () => h.events,
    getStatus: (id) => h.statuses.get(id) ?? null,
    listStatuses: () => [...h.statuses.values()],
    autoStopBindingIds: () => h.autoStopIds ?? [...h.statuses.keys()],
    start: h.start,
    stop: h.stop,
    pushRunning: h.pushRunning,
    settings: h.settings,
    logError: h.logError
  };
  return h;
}

function event(overrides: Partial<AutomationEvent> = {}): AutomationEvent {
  return { id: "e1", status: "ready", serverBindingId: "b-mc", gameTitle: "Minecraft", ...overrides };
}

/** Erster Tick nach Prozessstart ohne aktive Events (Basis), danach normaler Betrieb. */
async function initialized(h: Harness): Promise<AutomationState> {
  const saved = h.events;
  h.events = [];
  const state = await runAutomationTick(h.deps, createAutomationState());
  h.events = saved;
  return state;
}

async function ticks(h: Harness, state: AutomationState, count: number) {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    next = await runAutomationTick(h.deps, next);
  }
  return next;
}

describe("AMP automation tick", () => {
  it("auto-starts a ready event's server at most once, even after a manual stop", async () => {
    const h = harness();
    let state = await initialized(h);
    h.statuses.set("b-mc", serverStatus());
    h.events = [event({ status: "open" })];
    state = await ticks(h, state, 2);
    expect(h.start).not.toHaveBeenCalled();

    h.events = [event({ status: "ready" })];
    state = await ticks(h, state, 3);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.start).toHaveBeenCalledWith("b-mc");

    // Server lief, Manager stoppt ihn bewusst: kein erneuter Start, auch wenn das Event läuft.
    h.statuses.set("b-mc", serverStatus({ running: true, appState: "Ready", players: 2 }));
    state = await ticks(h, state, 1);
    h.statuses.set("b-mc", serverStatus({ appState: "Stopped" }));
    h.events = [event({ status: "running" })];
    await ticks(h, state, 3);
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it("does nothing when auto-start is disabled", async () => {
    const h = harness({ ampAutoStartOnReady: false });
    const state = await initialized(h);
    h.statuses.set("b-mc", serverStatus());
    h.events = [event()];
    await ticks(h, state, 3);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.stop).not.toHaveBeenCalled();
  });

  it("does not start a running/sleeping server, waits out transitional states and unknown status", async () => {
    const h = harness();
    let state = await initialized(h);
    h.events = [event({ id: "sleep", serverBindingId: "b-sleep" }), event({ id: "boot", serverBindingId: "b-boot" })];
    h.statuses.set(
      "b-sleep",
      serverStatus({ bindingId: "b-sleep", running: true, instanceRunning: true, appState: "Sleeping" })
    );
    h.statuses.set("b-boot", serverStatus({ bindingId: "b-boot", appState: "Starting", instanceRunning: true }));
    state = await ticks(h, state, 2);
    expect(h.start).not.toHaveBeenCalled();

    // AMP nicht erreichbar: Zustand unbekannt -> kein Start
    h.statuses.set("b-boot", serverStatus({ bindingId: "b-boot", error: "amp_http_fehler" }));
    state = await ticks(h, state, 1);
    expect(h.start).not.toHaveBeenCalled();

    // Start ist hängengeblieben -> Stopped -> genau ein Start
    h.statuses.set("b-boot", serverStatus({ bindingId: "b-boot", appState: "Stopped" }));
    await ticks(h, state, 2);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.start).toHaveBeenCalledWith("b-boot");
  });

  it("starts a shared binding once for several ready events", async () => {
    const h = harness();
    const state = await initialized(h);
    h.statuses.set("b-mc", serverStatus());
    h.events = [event({ id: "e1" }), event({ id: "e2" })];
    await ticks(h, state, 2);
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it("pushes 'server running' once per event, including sleeping servers", async () => {
    const h = harness({ ampAutoStartOnReady: false });
    let state = await initialized(h);
    h.events = [event({ id: "e1", status: "open" })];
    h.statuses.set("b-mc", serverStatus());
    state = await ticks(h, state, 2);
    expect(h.pushRunning).not.toHaveBeenCalled();

    h.statuses.set("b-mc", serverStatus({ running: true, appState: "Sleeping" }));
    state = await ticks(h, state, 3);
    expect(h.pushRunning).toHaveBeenCalledTimes(1);
    expect(h.pushRunning).toHaveBeenCalledWith("e1", "Minecraft");

    // Server geht aus und wieder an: kein zweiter Push für dasselbe Event
    h.statuses.set("b-mc", serverStatus());
    state = await ticks(h, state, 1);
    h.statuses.set("b-mc", serverStatus({ running: true, appState: "Ready" }));
    state = await ticks(h, state, 2);
    expect(h.pushRunning).toHaveBeenCalledTimes(1);

    // Neues Event auf bereits laufendem Server bekommt seinen Push
    h.events = [...h.events, event({ id: "e2", status: "open" })];
    await ticks(h, state, 2);
    expect(h.pushRunning).toHaveBeenCalledTimes(2);
    expect(h.pushRunning).toHaveBeenLastCalledWith("e2", "Minecraft");
  });

  it("first tick after a restart only records the current state (no push, no start)", async () => {
    const h = harness();
    h.events = [
      event({ id: "running-server", serverBindingId: "b-run" }),
      event({ id: "stopped-server", serverBindingId: "b-stop" }),
      event({ id: "open-event", status: "open", serverBindingId: "b-open" })
    ];
    h.statuses.set("b-run", serverStatus({ bindingId: "b-run", running: true, appState: "Ready" }));
    h.statuses.set("b-stop", serverStatus({ bindingId: "b-stop" }));
    h.statuses.set("b-open", serverStatus({ bindingId: "b-open" }));

    let state = await ticks(h, createAutomationState(), 3);
    expect(h.pushRunning).not.toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();

    // Server eines schon bekannten Events geht später an -> Push
    h.statuses.set("b-stop", serverStatus({ bindingId: "b-stop", running: true, appState: "Ready" }));
    state = await ticks(h, state, 1);
    expect(h.pushRunning).toHaveBeenCalledWith("stopped-server", "Minecraft");

    // Event, das beim Neustart noch offen war, wird später bereit -> Auto-Start greift
    h.events = h.events.map((e) => (e.id === "open-event" ? { ...e, status: "ready" as const } : e));
    await ticks(h, state, 1);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.start).toHaveBeenCalledWith("b-open");
  });

  it("stops after N idle minutes with 0 players, never with an active event, and null players reset the timer", async () => {
    const h = harness({ ampAutoStartOnReady: false, ampAutoStopIdleMinutes: 10 });
    let state = await initialized(h);
    h.statuses.set("b-mc", serverStatus({ running: true, instanceRunning: true, appState: "Ready", players: 0 }));

    // aktives Event auf der Bindung: nie stoppen
    h.events = [event({ status: "open" })];
    for (let i = 0; i < 30; i += 1) {
      h.clock.now += 60_000;
      state = await ticks(h, state, 1);
    }
    expect(h.stop).not.toHaveBeenCalled();

    // Event archiviert -> Leerlauf beginnt jetzt
    h.events = [];
    state = await ticks(h, state, 1);
    h.clock.now += 9 * 60_000;
    state = await ticks(h, state, 1);
    expect(h.stop).not.toHaveBeenCalled();

    // Metrik fehlt kurz (players null) -> Leerlauf beginnt neu
    h.statuses.set("b-mc", serverStatus({ running: true, appState: "Ready", players: null }));
    h.clock.now += 60_000;
    state = await ticks(h, state, 1);
    h.statuses.set("b-mc", serverStatus({ running: true, appState: "Ready", players: 0 }));
    state = await ticks(h, state, 1);
    h.clock.now += 9 * 60_000;
    state = await ticks(h, state, 1);
    expect(h.stop).not.toHaveBeenCalled();

    // Spieler kommt und geht -> wieder neu
    h.statuses.set("b-mc", serverStatus({ running: true, appState: "Ready", players: 1 }));
    state = await ticks(h, state, 1);
    h.statuses.set("b-mc", serverStatus({ running: true, appState: "Ready", players: 0 }));
    state = await ticks(h, state, 1);
    h.clock.now += 10 * 60_000;
    state = await ticks(h, state, 1);
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.stop).toHaveBeenCalledWith("b-mc");
  });

  it("never stops when idle-stop is off", async () => {
    const h = harness({ ampAutoStartOnReady: false, ampAutoStopIdleMinutes: 0 });
    let state = await initialized(h);
    h.statuses.set("b-mc", serverStatus({ running: true, appState: "Ready", players: 0 }));
    for (let i = 0; i < 5; i += 1) {
      h.clock.now += 60 * 60_000;
      state = await ticks(h, state, 1);
    }
    expect(h.stop).not.toHaveBeenCalled();
  });

  it("keeps going when an action fails", async () => {
    const h = harness({ ampAutoStopIdleMinutes: 1 });
    let state = await initialized(h);
    h.start.mockRejectedValueOnce(new Error("amp_http_fehler"));
    h.events = [
      event({ id: "e-start", serverBindingId: "b-mc" }),
      event({ id: "e-push", status: "open", serverBindingId: "b-cs" })
    ];
    h.statuses.set("b-mc", serverStatus());
    h.statuses.set("b-cs", serverStatus({ bindingId: "b-cs", ampInstanceName: "Counter-Strike201" }));
    h.statuses.set(
      "b-idle",
      serverStatus({ bindingId: "b-idle", ampInstanceName: "Soldat01", running: true, appState: "Ready", players: 0 })
    );
    state = await ticks(h, state, 1);
    h.statuses.set(
      "b-cs",
      serverStatus({ bindingId: "b-cs", ampInstanceName: "Counter-Strike201", running: true, appState: "Ready" })
    );
    h.clock.now += 60_000;
    state = await ticks(h, state, 1);

    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.logError).toHaveBeenCalledWith(expect.stringContaining("Minecraft01"), expect.any(Error));
    expect(h.pushRunning).toHaveBeenCalledWith("e-push", "Minecraft");
    expect(h.stop).toHaveBeenCalledWith("b-idle");
    // einmal pro Event: kein zweiter Startversuch nach dem Fehler
    await ticks(h, state, 2);
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  describe("follow-up start after StartInstance", () => {
    const booting = () => serverStatus({ instanceRunning: false, appState: "Stopped" });

    it("starts the game once more as soon as the booted instance is reachable", async () => {
      const h = harness();
      let state = await initialized(h);
      h.events = [event()];
      h.statuses.set("b-mc", booting());
      state = await ticks(h, state, 1);
      expect(h.start).toHaveBeenCalledTimes(1);
      expect(h.start).toHaveBeenLastCalledWith("b-mc");

      // Instanz bootet noch bzw. AMP meldet Zwischenzustand -> warten
      h.clock.now += 30_000;
      state = await ticks(h, state, 1);
      h.statuses.set("b-mc", serverStatus({ instanceRunning: true, appState: "PreStart" }));
      h.clock.now += 30_000;
      state = await ticks(h, state, 1);
      expect(h.start).toHaveBeenCalledTimes(1);

      // Instanz läuft, Spiel steht -> genau ein Nachstart
      h.statuses.set("b-mc", serverStatus({ instanceRunning: true, appState: "Stopped" }));
      h.clock.now += 30_000;
      state = await ticks(h, state, 3);
      expect(h.start).toHaveBeenCalledTimes(2);
      expect(h.start).toHaveBeenLastCalledWith("b-mc", { followUp: true });
      expect(state.pendingGameStart).toEqual({});
    });

    it("skips the follow-up when AMP starts the game by itself", async () => {
      const h = harness();
      let state = await initialized(h);
      h.events = [event()];
      h.statuses.set("b-mc", booting());
      state = await ticks(h, state, 1);
      h.statuses.set("b-mc", serverStatus({ instanceRunning: true, running: true, appState: "Ready" }));
      state = await ticks(h, state, 1);
      h.statuses.set("b-mc", serverStatus({ instanceRunning: true, appState: "Stopped" }));
      await ticks(h, state, 2);
      expect(h.start).toHaveBeenCalledTimes(1);
    });

    it("gives up after the timeout, without an active event, or when auto-start is switched off", async () => {
      // Timeout
      const h = harness();
      let state = await initialized(h);
      h.events = [event()];
      h.statuses.set("b-mc", booting());
      state = await ticks(h, state, 1);
      h.clock.now += GAME_START_FOLLOW_UP_TIMEOUT_MS + 1;
      state = await ticks(h, state, 1);
      expect(h.logError).toHaveBeenCalledWith(expect.stringContaining("nicht gestartet"), expect.any(Error));
      h.statuses.set("b-mc", serverStatus({ instanceRunning: true, appState: "Stopped" }));
      await ticks(h, state, 2);
      expect(h.start).toHaveBeenCalledTimes(1);

      // Event archiviert, bevor die Instanz oben ist
      const h2 = harness();
      let state2 = await initialized(h2);
      h2.events = [event()];
      h2.statuses.set("b-mc", booting());
      state2 = await ticks(h2, state2, 1);
      h2.events = [];
      state2 = await ticks(h2, state2, 1);
      h2.statuses.set("b-mc", serverStatus({ instanceRunning: true, appState: "Stopped" }));
      h2.events = [event({ id: "e-later", status: "open" })];
      await ticks(h2, state2, 2);
      expect(h2.start).toHaveBeenCalledTimes(1);

      // Admin schaltet Auto-Start ab
      const h3 = harness();
      let state3 = await initialized(h3);
      h3.events = [event()];
      h3.statuses.set("b-mc", booting());
      state3 = await ticks(h3, state3, 1);
      h3.settings.ampAutoStartOnReady = false;
      h3.statuses.set("b-mc", serverStatus({ instanceRunning: true, appState: "Stopped" }));
      await ticks(h3, state3, 2);
      expect(h3.start).toHaveBeenCalledTimes(1);
    });

    it("does not schedule a follow-up when the instance was already running", async () => {
      const h = harness();
      let state = await initialized(h);
      h.events = [event()];
      h.statuses.set("b-mc", serverStatus({ instanceRunning: true, appState: "Stopped" }));
      state = await ticks(h, state, 3);
      expect(h.start).toHaveBeenCalledTimes(1);
      expect(state.pendingGameStart).toEqual({});
    });
  });

  it("never idle-stops a binding without auto-stop opt-in (AMP may not count players)", async () => {
    const h = harness({ ampAutoStartOnReady: false, ampAutoStopIdleMinutes: 1 });
    h.autoStopIds = ["b-cs"];
    let state = await initialized(h);
    // UT2004: UserJoinRegex leer -> AMP meldet immer 0 Spieler, auch mitten im Spiel
    h.statuses.set(
      "b-ut",
      serverStatus({ bindingId: "b-ut", ampInstanceName: "UT200401", running: true, appState: "Ready", players: 0 })
    );
    h.statuses.set(
      "b-cs",
      serverStatus({ bindingId: "b-cs", ampInstanceName: "Counter-Strike201", running: true, appState: "Ready", players: 0 })
    );
    for (let i = 0; i < 3; i += 1) {
      h.clock.now += 60_000;
      state = await ticks(h, state, 1);
    }
    // CS2 (mit Freischaltung) nach 1 min gestoppt, UT2004 nie
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.stop).toHaveBeenCalledWith("b-cs");
    expect(state.idleSince["b-ut"]).toBeUndefined();
  });
});

