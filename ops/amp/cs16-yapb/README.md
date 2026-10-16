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
./install.sh <cstrike-verzeichnis> --uninstall   # entfernen, Originale zurück
```

- Erkennt **Metamod** daran, dass `liblist.gam` auf Metamod zeigt.
  - Mit Metamod: trägt `linux addons/yapb/bin/yapb.so` in `addons/metamod/plugins.ini` ein.
  - Ohne Metamod (**Standalone**): setzt `gamedll_linux` in `liblist.gam` auf YaPB. YaPB lädt die originale `dlls/cs.so` dann selbst.
- Sichert `liblist.gam` und `plugins.ini` als `*.hermes-yapb-bak`. `--uninstall` stellt sie wieder her.
- Binary und Wegpunkte werden bei jedem Lauf aktualisiert. `conf/` wird nur beim ersten Mal angelegt, eigene Anpassungen bleiben also erhalten.
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

## Hermes

Die Konsolenvorlage „Bots (YaPB)“ für CS 1.6 steht in `src/client/gameservers/command-presets.ts`. Sie enthält:
- auffüllen auf 10,
- einen Bot hinzufügen, gezielt zu T oder CT,
- einen Bot entfernen,
- alle Bots entfernen (`yb_quota 0; yb kickall`; sonst füllt die Quote sofort wieder auf),
- Schwierigkeit leicht, normal oder schwer,
- `yb list` und `yb version`.

Die Befehle gehen wie die übrigen CS-1.6-Befehle per RCON an den Server.

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
