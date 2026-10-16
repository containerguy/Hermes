/**
 * Befehlsvorlagen für die Server-Konsole (Phase 15): typische Eingriffe während einer LAN —
 * Map wechseln, Modus ändern, Bots, Runde neu starten. Eine Vorlage füllt nur das Eingabefeld;
 * gesendet wird erst mit „Senden“, damit Platzhalter wie `<name>` angepasst werden können.
 *
 * Konsolenweg je Spiel laut AMP-Template (CubeCoders/AMPTemplates) und Test gegen amp-ctl
 * am 2026-10-16: CS2/CS 1.6/Factorio über RCON (antworten), Minecraft über das native Modul,
 * CoD4/Soldat über STDIN (ohne sichtbare Rückmeldung bzw. nicht geprüft), UT2004 nimmt
 * auf der Konsole nichts an → WebAdmin.
 */

type Text = { de: string; en: string };

export type CommandPreset = { label: Text; command: string; note?: Text };
export type CommandGroup = { label: Text; presets: CommandPreset[] };

export type GameCommandSet = {
  key: string;
  name: string;
  /** ok = Konsole antwortet; untested = Befehle gehen raus, Rückmeldung nicht geprüft; none = Konsole nimmt nichts an */
  console: "ok" | "untested" | "none";
  hint?: Text;
  /** Port der Web-Administration, falls die Konsole nicht reicht. */
  webAdminPort?: number;
  groups: CommandGroup[];
};

const t = (de: string, en: string = de): Text => ({ de, en });
const p = (label: Text, command: string, note?: Text): CommandPreset => ({ label, command, note });
const maps = (command: (map: string) => string, list: [string, string][]): CommandPreset[] =>
  list.map(([map, name]) => p(t(name), command(map)));

const cs2: GameCommandSet = {
  key: "cs2",
  name: "Counter-Strike 2",
  console: "ok",
  groups: [
    {
      label: t("Info"),
      presets: [p(t("Status & Spielerliste", "Status & player list"), "status")]
    },
    {
      label: t("Map wechseln", "Change map"),
      presets: maps((m) => `changelevel ${m}`, [
        ["de_dust2", "Dust II"],
        ["de_mirage", "Mirage"],
        ["de_inferno", "Inferno"],
        ["de_nuke", "Nuke"],
        ["de_ancient", "Ancient"],
        ["de_anubis", "Anubis"],
        ["de_overpass", "Overpass"],
        ["de_vertigo", "Vertigo"],
        ["cs_office", "Office"],
        ["cs_italy", "Italy"]
      ])
    },
    {
      label: t("Spielmodus (lädt die Map neu)", "Game mode (reloads the map)"),
      presets: [
        p(t("Casual"), "game_type 0; game_mode 0; changelevel de_dust2"),
        p(t("Competitive 5v5"), "game_type 0; game_mode 1; changelevel de_dust2"),
        p(t("Wingman 2v2"), "game_type 0; game_mode 2; changelevel de_inferno"),
        p(t("Arms Race"), "game_type 1; game_mode 0; changelevel de_dust2"),
        p(t("Deathmatch"), "game_type 1; game_mode 2; changelevel de_dust2")
      ].map((preset) => ({ ...preset, note: t("Map am Ende anpassen.", "Adjust the map at the end.") }))
    },
    {
      label: t("Runde", "Round"),
      presets: [
        p(t("Spiel neu starten", "Restart game"), "mp_restartgame 1"),
        p(t("Aufwärmphase beenden", "End warmup"), "mp_warmup_end"),
        p(t("Match pausieren", "Pause match"), "mp_pause_match"),
        p(t("Pause aufheben", "Unpause match"), "mp_unpause_match"),
        p(t("Maximal 24 Runden", "Max 24 rounds"), "mp_maxrounds 24"),
        p(t("Startgeld 16000", "Start money 16000"), "mp_startmoney 16000"),
        p(t("Teamwechsel frei (kein Ausgleich)", "Free team switching"), "mp_autoteambalance 0; mp_limitteams 0")
      ]
    },
    {
      label: t("Bots"),
      presets: [
        p(t("Bot zu CT", "Bot to CT"), "bot_add_ct"),
        p(t("Bot zu T", "Bot to T"), "bot_add_t"),
        p(t("Mit Bots auf 10 auffüllen", "Fill up to 10 with bots"), "bot_quota_mode fill; bot_quota 10"),
        p(t("Bot-Stärke (0 leicht – 3 Experte)", "Bot difficulty (0 easy – 3 expert)"), "bot_difficulty 2"),
        p(t("Alle Bots entfernen", "Remove all bots"), "bot_kick")
      ]
    },
    {
      label: t("Spieler & Chat", "Players & chat"),
      presets: [
        p(t("Nachricht an alle", "Message to all"), "say <text>"),
        p(t("Spieler kicken", "Kick player"), "kick <name>")
      ]
    }
  ]
};

const cs16: GameCommandSet = {
  key: "cs16",
  name: "Counter-Strike 1.6",
  console: "ok",
  hint: t(
    "CS 1.6 hat ohne Zusatz-Mod (z. B. PodBot) keine Bots.",
    "CS 1.6 has no bots without an add-on (e.g. PodBot)."
  ),
  groups: [
    { label: t("Info"), presets: [p(t("Status & Spielerliste", "Status & player list"), "status")] },
    {
      label: t("Map wechseln", "Change map"),
      presets: maps((m) => `changelevel ${m}`, [
        ["de_dust2", "de_dust2"],
        ["de_dust", "de_dust"],
        ["de_inferno", "de_inferno"],
        ["de_nuke", "de_nuke"],
        ["de_train", "de_train"],
        ["de_aztec", "de_aztec"],
        ["de_cbble", "de_cbble"],
        ["cs_office", "cs_office"],
        ["cs_italy", "cs_italy"],
        ["cs_assault", "cs_assault"]
      ])
    },
    {
      label: t("Runde", "Round"),
      presets: [
        p(t("Runde neu starten", "Restart round"), "sv_restart 1"),
        p(t("Zeitlimit 20 Minuten", "Time limit 20 minutes"), "mp_timelimit 20"),
        p(t("Rundenzeit 3 Minuten", "Round time 3 minutes"), "mp_roundtime 3"),
        p(t("Startgeld 16000", "Start money 16000"), "mp_startmoney 16000"),
        p(t("Friendly Fire an", "Friendly fire on"), "mp_friendlyfire 1"),
        p(t("Friendly Fire aus", "Friendly fire off"), "mp_friendlyfire 0"),
        p(t("Teamwechsel frei (kein Ausgleich)", "Free team switching"), "mp_autoteambalance 0; mp_limitteams 0")
      ]
    },
    {
      label: t("Spieler & Chat", "Players & chat"),
      presets: [
        p(t("Nachricht an alle", "Message to all"), "say <text>"),
        p(t("Spieler kicken", "Kick player"), 'kick "<name>"')
      ]
    }
  ]
};

const cod4: GameCommandSet = {
  key: "cod4",
  name: "Call of Duty 4",
  console: "untested",
  hint: t(
    "Konsole läuft über STDIN — Ausgabe kann fehlen, Wirkung im Spiel prüfen. Vanilla-CoD4 hat keine Bots.",
    "Console goes through STDIN — output may be missing, check the effect in game. Vanilla CoD4 has no bots."
  ),
  groups: [
    { label: t("Info"), presets: [p(t("Status & Spielerliste", "Status & player list"), "status")] },
    {
      label: t("Map wechseln", "Change map"),
      presets: [
        p(t("Nächste Map der Rotation", "Next map in rotation"), "map_rotate"),
        ...maps((m) => `map ${m}`, [
          ["mp_crash", "Crash"],
          ["mp_backlot", "Backlot"],
          ["mp_crossfire", "Crossfire"],
          ["mp_strike", "Strike"],
          ["mp_vacant", "Vacant"],
          ["mp_citystreets", "District"],
          ["mp_overgrown", "Overgrown"],
          ["mp_bog", "Bog"],
          ["mp_shipment", "Shipment"],
          ["mp_showdown", "Showdown"],
          ["mp_pipeline", "Pipeline"],
          ["mp_convoy", "Ambush"],
          ["mp_cargoship", "Wet Work"],
          ["mp_killhouse", "Killhouse"]
        ])
      ]
    },
    {
      label: t("Spielmodus (startet die Map neu)", "Game mode (restarts the map)"),
      presets: [
        p(t("Team Deathmatch"), "g_gametype war; map_restart"),
        p(t("Free for All"), "g_gametype dm; map_restart"),
        p(t("Search & Destroy"), "g_gametype sd; map_restart"),
        p(t("Domination"), "g_gametype dom; map_restart"),
        p(t("Headquarters"), "g_gametype koth; map_restart"),
        p(t("Sabotage"), "g_gametype sab; map_restart"),
        p(t("Hardcore an", "Hardcore on"), "scr_hardcore 1; map_restart"),
        p(t("Hardcore aus", "Hardcore off"), "scr_hardcore 0; map_restart")
      ]
    },
    {
      label: t("Runde", "Round"),
      presets: [
        p(t("Runde schnell neu starten", "Fast restart round"), "fast_restart"),
        p(t("TDM: Zeitlimit 15 Minuten", "TDM: time limit 15 minutes"), "scr_war_timelimit 15"),
        p(t("TDM: kein Punktelimit", "TDM: no score limit"), "scr_war_scorelimit 0")
      ]
    },
    {
      label: t("Spieler & Chat", "Players & chat"),
      presets: [
        p(t("Nachricht an alle", "Message to all"), "say <text>"),
        p(t("Spieler kicken (Nummer aus status)", "Kick player (number from status)"), "clientkick <nr>")
      ]
    }
  ]
};

const minecraft: GameCommandSet = {
  key: "minecraft",
  name: "Minecraft",
  console: "ok",
  groups: [
    { label: t("Info"), presets: [p(t("Wer ist online?", "Who is online?"), "list")] },
    {
      label: t("Welt", "World"),
      presets: [
        p(t("Tag", "Day"), "time set day"),
        p(t("Nacht", "Night"), "time set night"),
        p(t("Wetter klar", "Clear weather"), "weather clear"),
        p(t("Schwierigkeit friedlich", "Difficulty peaceful"), "difficulty peaceful"),
        p(t("Schwierigkeit normal", "Difficulty normal"), "difficulty normal"),
        p(t("Schwierigkeit schwer", "Difficulty hard"), "difficulty hard"),
        p(t("Welt speichern", "Save world"), "save-all")
      ]
    },
    {
      label: t("Spieler", "Players"),
      presets: [
        p(t("Kreativmodus für Spieler", "Creative mode for player"), "gamemode creative <name>"),
        p(t("Überlebensmodus für Spieler", "Survival mode for player"), "gamemode survival <name>"),
        p(t("Spieler zu Spieler teleportieren", "Teleport player to player"), "tp <name> <ziel>"),
        p(t("Admin-Rechte geben", "Give operator"), "op <name>"),
        p(t("Admin-Rechte entziehen", "Remove operator"), "deop <name>"),
        p(t("Auf die Whitelist", "Add to whitelist"), "whitelist add <name>"),
        p(t("Spieler kicken", "Kick player"), "kick <name>")
      ]
    },
    { label: t("Chat"), presets: [p(t("Nachricht an alle", "Message to all"), "say <text>")] }
  ]
};

const factorio: GameCommandSet = {
  key: "factorio",
  name: "Factorio",
  console: "ok",
  groups: [
    {
      label: t("Info"),
      presets: [
        p(t("Spielerliste", "Player list"), "/players"),
        p(t("Admins", "Admins"), "/admins"),
        p(t("Spielzeit", "Play time"), "/time"),
        p(t("Evolution der Beißer", "Biter evolution"), "/evolution")
      ]
    },
    {
      label: t("Server"),
      presets: [
        p(t("Spielstand speichern", "Save game"), "/server-save"),
        p(t("Nachricht an alle (einfach Text senden)", "Message to all (plain text)"), "<text>")
      ]
    },
    {
      label: t("Spieler", "Players"),
      presets: [
        p(t("Zum Admin machen", "Promote to admin"), "/promote <name>"),
        p(t("Admin entziehen", "Demote admin"), "/demote <name>"),
        p(t("Spieler kicken", "Kick player"), "/kick <name> <grund>")
      ]
    },
    {
      label: t("Lua (deaktiviert Erfolge!)", "Lua (disables achievements!)"),
      presets: [
        p(t("Spieltempo doppelt", "Double game speed"), "/c game.speed = 2"),
        p(t("Spieltempo normal", "Normal game speed"), "/c game.speed = 1"),
        p(
          t("Karte um den Start aufdecken", "Reveal map around spawn"),
          "/c game.forces.player.chart(game.surfaces[1], {{-512, -512}, {512, 512}})"
        )
      ].map((preset) => ({
        ...preset,
        note: t("Lua-Befehle schalten Steam-Erfolge für diesen Spielstand ab.", "Lua commands disable Steam achievements for this save.")
      }))
    }
  ]
};

const soldat: GameCommandSet = {
  key: "soldat",
  name: "Soldat",
  console: "untested",
  hint: t(
    "Konsole läuft über STDIN und gibt keine Rückmeldung — Wirkung im Spiel prüfen. Alternativ im Spiel mit /adminlog <passwort>.",
    "Console goes through STDIN without feedback — check the effect in game. Alternatively in game with /adminlog <password>."
  ),
  groups: [
    {
      label: t("Map wechseln", "Change map"),
      presets: [
        p(t("Nächste Map", "Next map"), "/nextmap"),
        p(t("Map neu starten", "Restart map"), "/restart"),
        ...maps((m) => `/map ${m}`, [
          ["ctf_Ash", "ctf_Ash"],
          ["ctf_Run", "ctf_Run"],
          ["ctf_Laos", "ctf_Laos"],
          ["Arena", "Arena (DM)"],
          ["Bunker", "Bunker (DM)"]
        ])
      ]
    },
    {
      label: t("Bots"),
      presets: [
        p(t("Bot zu Team Alpha", "Bot to team Alpha"), "/addbot1 Kruger"),
        p(t("Bot zu Team Bravo", "Bot to team Bravo"), "/addbot2 Dutch"),
        p(t("Bot (Deathmatch)", "Bot (deathmatch)"), "/addbot Sniper"),
        p(t("Bot/Spieler kicken", "Kick bot/player"), "/kick <name>")
      ]
    },
    {
      label: t("Spiel", "Game"),
      presets: [p(t("Pause"), "/pause"), p(t("Weiter", "Resume"), "/unpause")]
    }
  ]
};

const ut2004: GameCommandSet = {
  key: "ut2004",
  name: "Unreal Tournament 2004",
  console: "none",
  hint: t(
    "Die UT2004-Serverkonsole nimmt keine Befehle an. Map, Spielmodus, Bots und Mutatoren über das WebAdmin (Admin-Passwort). Im Spiel geht auch: Konsole öffnen, adminlogin <passwort>, dann z. B. admin servertravel DM-Rankin?game=XGame.xDeathMatch",
    "The UT2004 server console does not accept commands. Use WebAdmin (admin password) for map, game mode, bots and mutators. In game: open the console, adminlogin <password>, then e.g. admin servertravel DM-Rankin?game=XGame.xDeathMatch"
  ),
  webAdminPort: 8888,
  groups: []
};

const SETS: { match: RegExp; set: GameCommandSet }[] = [
  { match: /counter.?strike.?2|\bcs2\b/, set: cs2 },
  { match: /counter.?strike.?1\.?6|\bcs.?1\.?6\b/, set: cs16 },
  { match: /call of duty.?4|\bcod.?4\b/, set: cod4 },
  { match: /minecraft/, set: minecraft },
  { match: /factorio/, set: factorio },
  { match: /soldat/, set: soldat },
  { match: /unreal tournament.?2004|\but.?2004\b|\but2k4\b/, set: ut2004 }
];

/** Vorlagen zum Spiel laut AMP (ModuleDisplayName/Modul); null, wenn das Spiel unbekannt ist. */
export function commandSetForGame(game: string | null | undefined): GameCommandSet | null {
  if (!game) return null;
  const normalized = game.toLowerCase();
  return SETS.find((entry) => entry.match.test(normalized))?.set ?? null;
}

export function localize(text: Text, locale: string): string {
  return locale.startsWith("en") ? text.en : text.de;
}

/** Erster Platzhalter `<…>` im Befehl, damit die UI ihn zum Überschreiben markieren kann. */
export function firstPlaceholder(command: string): { start: number; end: number } | null {
  const match = /<[^<>]+>/.exec(command);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
