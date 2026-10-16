# CS 1.6: Bots mit YaPB nachrüsten

Ziel: Auf der AMP-Instanz **CS1601** (Target `retro`) sollen Bots verfügbar sein. So lassen sich Runden auch mit wenigen Leuten spielen, und Lücken werden gefüllt, bis Menschen nachkommen. Gesteuert wird über die Hermes-Konsole: Server-Bereich → Konsole → Vorlage „Bots (YaPB)“.

## Entscheidung: YaPB 4.4.957

| Option | Bewertung |
|---|---|
| **YaPB** (Nachfolger von POD-Bot) | **gewählt.** Aktiv gepflegt. Läuft als Standalone-DLL oder als Metamod-Plugin, ohne ReHLDS. Das Linux-Paket bringt Wegpunkte für alle 47 Standard-Maps mit, braucht im LAN also kein Internet. Bots werden per RCON/Konsole gesteuert (`yb …`), das passt zu Hermes. |
| ZBot (CS:CZ-Bots über ReGameDLL_CS) | verworfen. Dafür müsste die Spiel-DLL durch ReGameDLL ersetzt werden, und auf fremden Maps sind Nav-Dateien nötig. Das ist mehr Eingriff, als für LAN-Bots nötig ist. |
| POD-Bot mm | veraltet und wird nicht mehr gepflegt. |

Paket: `yapb-4.4.957-linux.tar.xz`, SHA-256 `8c095ac89b9b2ccc70a66a71d608e1a570b5268c57c6083ced8c06161533a4b1`. Die Prüfsumme wurde am 2026-10-16 in der Cloud-Session ermittelt. Zum Release gibt es keine `.asc`-Signatur (404), deshalb prüft das Skript fest gegen diesen Hash. Inhalt des Pakets: `addons/yapb/bin/yapb.so`, `conf/`, `data/graph/*.graph` (47 Maps).

## Was `install.sh` tut

```bash
./install.sh <cstrike-verzeichnis> --check       # nur Zustand anzeigen
./install.sh <cstrike-verzeichnis> --dry-run     # zeigen, was passieren würde
./install.sh <cstrike-verzeichnis>               # installieren (idempotent)
./install.sh <cstrike-verzeichnis> --relink      # nach einem AMP-Update: nur wieder einhängen, ohne Download
./install.sh <cstrike-verzeichnis> --uninstall   # entfernen, Originale zurück
```

- Erkennt **Metamod** daran, dass `liblist.gam` auf Metamod zeigt.
  - Mit Metamod: trägt `linux addons/yapb/bin/yapb.so` in `addons/metamod/plugins.ini` ein.
  - Ohne Metamod (**Standalone**): setzt `gamedll_linux` in `liblist.gam` auf YaPB. YaPB lädt die originale `dlls/cs.so` dann selbst.
- Sichert `liblist.gam` und `plugins.ini` als `*.hermes-yapb-bak`. `--uninstall` stellt sie wieder her.
- Binary und Wegpunkte werden bei jedem Lauf aktualisiert. `conf/` wird nur beim ersten Mal angelegt, eigene Anpassungen bleiben also erhalten.
- Setzt die Rechte unter `addons/yapb` auf `u+rwX,go+rX`. Das Paket bringt `data/{logs,pwf,train}` ohne x-Bit mit, dann kann YaPB dort nicht schreiben.
- Legt `conf/lang/de_names.cfg` aus diesem Verzeichnis an, falls sie fehlt: familientaugliche Bot-Namen statt der Liste aus `en_names.cfg`. YaPB nimmt sie bei `yb_language de`.
- LAN-Voreinstellungen in `addons/yapb/conf/yapb.cfg`:

  | Einstellung | Wirkung |
  |---|---|
  | `yb_quota 0` | Keine Bots, solange niemand welche anfordert. Ohne diese Zeile kämen 9 Bots automatisch. |
  | `yb_quota_mode fill` | Die Quote füllt auf N Spieler auf. |
  | `yb_autovacate 1`, `yb_kick_after_player_connect 1` | Bots machen Platz, sobald ein Mensch joint. |
  | `yb_difficulty 2` | Schwierigkeit „Normal“. |
  | `yb_language de` | Menü und Chat auf Deutsch. |
  | `yb_graph_url ""`, `yb_graph_url_upload ""`, `yb_graph_auto_collect_db 0` | Kein Download oder Upload von Wegpunkten ins Internet. |
- Server ohne Internet: Paket vorher holen und mit `YAPB_TARBALL=/pfad/yapb-4.4.957-linux.tar.xz ./install.sh …` übergeben.
- Getestet in der Cloud-Session gegen nachgebaute `cstrike`-Verzeichnisse:
  - Standalone und Metamod
  - Wiederholung, also idempotent
  - Uninstall
  - falsche Prüfsumme

  **Nicht** getestet wurde gegen einen echten HLDS.

## Stand auf CS1601 (Bestandsaufnahme 2026-10-16)

- Pfad auf `retro` (Host): `/home/amp/.ampdata/instances/CS1601/counter-strike/90/cstrike`, im AMP-Container `/AMP/counter-strike/90/cstrike`.
- Kein `addons/`-Verzeichnis, also weder Metamod noch AMX Mod X noch ReHLDS. Daher **Standalone**: `liblist.gam` zeigt nach der Installation auf YaPB.
- AMP startet `hlds_linux` als **32-Bit**-Prozess (`-game cstrike … +maxplayers 24`). Internet über das Host-Netz ist vorhanden, `YAPB_TARBALL` ist also nicht nötig.

> **Achtung beim 64-Bit-Server:** Seit dem Update zum 25-jährigen Jubiläum liegen auch `dlls/cs_amd64.so` und `linux64/` bei. YaPB gibt es nur als 32-Bit-Binary. Wird die Instanz auf den 64-Bit-Server umgestellt, lädt `liblist.gam` eine unpassende Bibliothek, und der Server startet nicht. In diesem Fall vorher `install.sh … --uninstall` ausführen.

## Nach einem AMP-Update

Ein Update in AMP (SteamCMD mit `validate`) setzt `liblist.gam` auf das Original zurück. YaPB bleibt zwar unter `addons/yapb` liegen, wird aber nicht mehr geladen. In der Hermes-Konsole antwortet `yb version` dann mit „Unknown command“.

**Sofort:** Instanz stoppen, `./install.sh <pfad> --relink`, Instanz starten. Das dauert eine Sekunde und braucht kein Internet.

**Dauerhaft:** eine zusätzliche Update-Stufe in AMP, die nach SteamCMD `--relink` ausführt. Im LAN getestet am 2026-10-16 auf CS1601: Nach SteamCMD `validate` hängt die Stufe YaPB wieder ein, `yb version` antwortet.

1. Skript und Namensliste in die Instanz legen (`amp:amp`, `install.sh` ausführbar):
   - Host: `/home/amp/.ampdata/instances/CS1601/hermes-yapb/`
   - Container: `/AMP/hermes-yapb/`
2. Instanz mit `ampinstmgr stop CS1601` stoppen und `GenericModule.kvp` sichern.
3. In `GenericModule.kvp` die einzeilige JSON-Liste unter `App.UpdateSources` um einen Eintrag ergänzen. AMP erwartet numerische Werte:
   - `UpdateSourcePlatform` 2 = Linux
   - `UpdateSource` 8 = Executable
   - `UpdateSourceArch` 3

   Pfade sind relativ zum Instanzverzeichnis:

   ```json
   {"UpdateStageName":"YaPB wieder einhaengen (Hermes)","UpdateStageDescription":null,"UpdateSourcePlatform":2,"UpdateSource":8,"UpdateSourceArch":3,"UpdateSourceData":"/bin/bash","UpdateSourceArgs":"./hermes-yapb/install.sh ./counter-strike/90/cstrike --relink","UpdateSourceVersion":null,"UpdateSourceExtra":null,"UpdateSourceTarget":null,"UnzipUpdateSource":false,"OverwriteExistingFiles":false,"ForceDownloadPlatform":0,"UpdateSourceConditionSetting":null,"UpdateSourceConditionValue":null,"DeleteAfterExtract":false,"RunInBackground":false,"SkipOnFailure":false,"ProcessToolOutput":false,"OneShot":false}
   ```

4. Instanz starten und in AMP „Update“ auslösen. `--check` zeigt danach „zeigt auf YaPB“.

Die Stufe übersteht das Zurückschreiben der kvp beim Stoppen. Ob „Fetch latest configs“ bzw. ein Template-Update die Liste überschreibt, ist nicht geprüft. Die Instanz stammt aus `CubeCoders-AMPTemplates`, ein Überschreiben ist also wahrscheinlich. Dann bleibt `--relink` der Handgriff. Rückweg: die gesicherte kvp bei gestoppter Instanz zurückkopieren.

**Update nur bei gestopptem Spiel:**
- Ein `Core/UpdateApplication` bei laufendem Spiel lässt den `hlds_linux` verwaist weiterlaufen. Er hält Port 27015, und der folgende Start scheitert mit „Address already in use“.
- Hermes bietet „Update“ deshalb nur an, wenn AMP das Spiel als gestoppt meldet (`Stopped` oder `Failed`). Sonst antwortet es mit `409 amp_update_erst_stoppen`.

## Hermes

**Bots per Bedienelement:** In der Event-Karte gibt es ab manager unter Server den Knopf „Bots“, für CS 1.6 mit YaPB und für CS2. Dort lassen sich Anzahl, Stufe (leicht/normal/schwer/Experte) und Team (automatisch/T/CT) wählen:

| Aktion | CS 1.6 (YaPB) | CS2 |
|---|---|---|
| Hinzufügen | ggf. `mp_limitteams 0`, `mp_autoteambalance 0`; `yb_quota_mode fill`, `yb_quota <Menschen+Bots>`, `yb add <1–4> 0 <1\|2\|5>` × N | ggf. Teamlimit aus wie links; `bot_quota_mode fill`, `bot_quota <Menschen+Bots>`, `bot_difficulty <0–3>`, `bot_add[_t\|_ct]` × N |
| Auffüllen auf N | `yb_quota_mode fill`, `yb_difficulty`, `yb_quota N` | `bot_quota_mode fill`, `bot_difficulty`, `bot_quota N`. Bots kommen erst, wenn ein Mensch joint (`bot_join_after_player`). |
| Stufe für alle ändern | `yb_difficulty <1–4>`, wirkt sofort auf vorhandene Bots (LAN-Test F2) | `bot_quota 0`, `bot_kick`, `bot_difficulty`, `bot_quota_mode fill`, `bot_quota <Menschen>`, `bot_add` × Bots, weil `bot_difficulty` nur für neue Bots gilt |
| Alle entfernen | `yb_quota 0`, `yb kickall` | `bot_quota 0`, `bot_kick` |
| Bots zählen | `yb list` → „N bots“, `status` → „players : N active“ (Menschen + Bots) | `status` → „players : H humans, B bots“ |

**Alle Aktionen laufen im Quotenmodus `fill`**, denn nur dort machen Bots Platz, sobald Menschen joinen. Das hat der LAN-Test mit René gezeigt: Im Modus `normal` blieben die Bots, `yb_autovacate` griff nicht.

„Hinzufügen“ setzt die Quote deshalb erst auf den aktuellen Stand (Menschen + Bots). Jedes `yb add` bzw. `bot_add` erhöht sie um eins und bringt genau diesen Bot mit Stufe und Team.

Die Zahlen liest Hermes aus der Konsolenantwort, weil AMP Bots nicht als Spieler zählt. Ohne Antwort lehnt Hermes „Hinzufügen“ mit `409 botzahl_unbekannt` ab, statt zu raten.

Mit festem Team (T/CT) schaltet Hermes Teamlimit und Teamausgleich ab, sonst lehnt das Spiel mit „Team is stacked“ ab.

Den Ablauf macht Hermes serverseitig über `POST /api/integrations/amp/instances/:bindingId/bots`, die Botzahl kommt über `GET …/bots`:
- Die Befehle werden einzeln gesendet.
- Es gilt das Rate-Limit `amp_control`.
- Das Audit-Log schreibt `amp.bots_<aktion>`.

**Konsolenvorlagen:**

Die Konsolenvorlage „Bots (YaPB)“ für CS 1.6 steht in `src/client/gameservers/command-presets.ts`. Sie enthält:
- auffüllen auf 10,
- einen Bot hinzufügen, gezielt zu T oder CT,
- einen Bot entfernen,
- alle Bots entfernen (`yb_quota 0; yb kickall`; sonst füllt die Quote sofort wieder auf),
- Schwierigkeit leicht, normal oder schwer,
- `yb list` und `yb version`.

Die Befehle gehen wie die übrigen CS-1.6-Befehle per RCON an den Server.

GoldSrc-RCON über AMP trennt `;` nicht selbst. Ohne Aufteilung setzte `yb_quota_mode fill; yb_quota 10` nur `yb_quota_mode` auf `fill;`.

Deshalb teilt Hermes Eingaben für CS 1.6, CS 2 und CoD4 an `;` auf und sendet die Teile einzeln nacheinander:
- `;` in Anführungszeichen bleibt stehen.
- Höchstens 8 Teile pro Eingabe.
- Ein Eintrag im Audit-Log pro Eingabe.

Für Minecraft und Factorio bleibt die Zeile ganz, weil `;` dort zum Befehl gehört.

## Aufgabenteilung

Die Cloud-Session macht alles, was ohne LAN geht: Recherche, Skript, Hermes-Vorlagen, Doku. Die lokale Session übernimmt **nur** die Schritte, die das LAN brauchen.

### Lokale Session: LAN-Schritte

Es gelten die üblichen Regeln: nichts mergen, keine Instanz mit Spielern anfassen, Zugangsdaten nie ausgeben. Vor dem Eingriff prüfen, dass CS1601 0 Spieler hat.

1. **Bestand:**
   - `cstrike`-Verzeichnis von CS1601 auf `retro` finden: `find /home/amp/.ampdata/instances/CS1601 -name liblist.gam -path '*cstrike*'`
   - Dann `./install.sh <pfad> --check`. Das zeigt Lademodus, Metamod ja/nein und die `gamedll_linux`-Zeile.
2. **Installieren:**
   1. CS1601 in AMP stoppen.
   2. `./install.sh <pfad> --dry-run`, dann `./install.sh <pfad>` als `amp` oder als root.
   3. Ausgabe festhalten.
3. **Funktionstest:**
   1. CS1601 starten.
   2. In der Hermes-Konsole (Test-Instanz oder Produktion, nur lesend): `yb version` muss eine Version liefern.
   3. Auf `de_dust2`: „Mit Bots auffüllen auf 10“ → `yb list` zeigt Bots.
   4. Mit einem echten Client joinen: Ein Bot macht Platz.
   5. „Alle Bots entfernen“ → keine Bots mehr.
   6. Kurz prüfen, ob die Bots laufen und schießen, also ob die Wegpunkte geladen werden.
4. **AMP-Update:**
   1. In AMP „Update“ für CS1601 auslösen.
   2. Danach `./install.sh <pfad> --check`: Zeigt `liblist.gam` bzw. `plugins.ini` noch auf YaPB?
   3. Falls nein: Das ist ein Befund. Lösung wäre, nach jedem Update `install.sh` erneut laufen zu lassen; das Skript ist idempotent.
5. **Zustand danach:** Bots installiert lassen, aber `yb_quota 0`, also keine Bots, bis jemand welche anfordert. Entfernen über `--uninstall`.

Ergebnis bitte als Kommentar am PR, pro Punkt **bestanden**, **fehlgeschlagen** oder **nicht geprüft**, mit relevanten Konsolenausgaben.
