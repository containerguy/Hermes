# hermes-game-agent (Prototyp)

Kleines Windows-Programm, das erkennt, welches Spiel auf dem PC gerade läuft. Meldet an Hermes (`POST /api/presence/game`), wenn dort im Adminbereich „Spielt gerade“ aktiviert ist. Getestet am 3.11.2026 auf einem Windows-PC mit Steam, Epic, Ubisoft, EA und Battle.net.

## Wie erkannt wird

1. **Steam:** `HKCU\Software\Valve\Steam\RunningAppID` (App-ID des laufenden Spiels, 0 = keins). Spielname aus `appmanifest_*.acf`.
2. **Installationsordner der Launcher:** Läuft ein Prozess aus dem Ordner eines installierten Spiels, gilt das Spiel als gestartet.
   - Steam: `libraryfolders.vdf` + `appmanifest_*.acf`
   - Epic: `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item` (JSON)
   - GOG: `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id>`
   - Ubisoft Connect: `HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs\<id>`
   - EA app, Battle.net: Uninstall-Einträge in der Registry nach Publisher
3. **Bekannte Exe-Namen** (`-known liste.json`), z. B. für portable Spiele oder den Hermes-Spielekatalog.

Launcher, Overlays, Crash-Handler und Anti-Cheat-Dienste werden ignoriert. Prozesse werden nur mit `PROCESS_QUERY_LIMITED_INFORMATION` geöffnet (kein Speicherzugriff, keine Injection), das verträgt sich mit Anti-Cheat.

## Datenschutz

An Hermes gehen nur Titel, Launcher und ggf. Steam-App-ID der erkannten Spiele. Nie die Prozessliste, nie der Rechnername, nie die Liste installierter Spiele. `-v` zeigt die gefundenen installierten Spiele nur lokal an. Beim Beenden mit Strg+C löscht der Agent seinen Eintrag sofort, sonst verschwindet er nach zwei Minuten.

## Bauen und starten

```sh
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o hermes-game-agent.exe .
go test ./...        # Erkennungslogik, läuft auf jedem OS
```

```
hermes-game-agent.exe -v                     # einmal erkennen, JSON ausgeben
hermes-game-agent.exe -interval 30s          # alle 30 s
hermes-game-agent.exe -server https://hermes.example -token <API-Token> -interval 30s
```
