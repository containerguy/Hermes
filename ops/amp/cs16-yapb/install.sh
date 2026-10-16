#!/usr/bin/env bash
# YaPB-Bots für eine CS-1.6-Instanz (HLDS, Linux) installieren, prüfen oder entfernen.
#
#   install.sh <cstrike-verzeichnis> [--dry-run]      installieren (idempotent)
#   install.sh <cstrike-verzeichnis> --check          nur Zustand anzeigen
#   install.sh <cstrike-verzeichnis> --relink         nur liblist.gam/plugins.ini wieder auf YaPB
#                                                     (nach einem AMP-Update; ohne Download)
#   install.sh <cstrike-verzeichnis> --uninstall      Bots entfernen, Originale zurück
#
# Vorher die Instanz in AMP stoppen. Läuft als Besitzer der Instanzdateien (z. B. `amp`) oder als
# root; Dateien bekommen den Besitzer des cstrike-Verzeichnisses.
#
# Paket: optional mit YAPB_TARBALL=/pfad/yapb-<version>-linux.tar.xz vorab herunterladen
# (Server ohne Internet); sonst lädt das Skript von GitHub. Die Prüfsumme wird immer geprüft.
set -euo pipefail

YAPB_VERSION="4.4.957"
YAPB_SHA256="8c095ac89b9b2ccc70a66a71d608e1a570b5268c57c6083ced8c06161533a4b1"
YAPB_URL="https://github.com/yapb/yapb/releases/download/${YAPB_VERSION}/yapb-${YAPB_VERSION}-linux.tar.xz"
YAPB_SO="addons/yapb/bin/yapb.so"
BACKUP_SUFFIX=".hermes-yapb-bak"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

[[ $# -ge 1 ]] || usage
CSTRIKE="${1%/}"
MODE="${2:-install}"
DRY_RUN=0
case "$MODE" in
  install) ;;
  --dry-run) MODE="install"; DRY_RUN=1 ;;
  --check) MODE="check" ;;
  --relink) MODE="relink" ;;
  --uninstall) MODE="uninstall" ;;
  *) usage ;;
esac

log() { printf '[cs16-yapb] %s\n' "$*"; }
run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '[cs16-yapb] (dry-run) %s\n' "$*"
  else
    "$@"
  fi
}

LIBLIST="$CSTRIKE/liblist.gam"
PLUGINS="$CSTRIKE/addons/metamod/plugins.ini"
CFG="$CSTRIKE/addons/yapb/conf/yapb.cfg"

[[ -f "$LIBLIST" ]] || { log "Fehler: $LIBLIST fehlt – ist das das cstrike-Verzeichnis?"; exit 1; }
[[ -f "$CSTRIKE/dlls/cs.so" ]] || { log "Fehler: $CSTRIKE/dlls/cs.so fehlt – kein CS-1.6-Linux-Server?"; exit 1; }

OWNER="$(stat -c '%u:%g' "$CSTRIKE")"
GAMEDLL="$(sed -n 's/^[[:space:]]*gamedll_linux[[:space:]]*"\([^"]*\)".*/\1/p' "$LIBLIST" | head -n1)"
WORK=""
cleanup() { [[ -n "$WORK" ]] && rm -rf "$WORK"; return 0; }
trap cleanup EXIT

# Metamod erkannt, wenn liblist.gam auf Metamod zeigt (Metamod-R oder klassisches Metamod).
if [[ "$GAMEDLL" == *metamod* ]]; then
  LOADER="metamod"
else
  LOADER="standalone"
fi

read_gamedll() {
  sed -n 's/^[[:space:]]*gamedll_linux[[:space:]]*"\([^"]*\)".*/\1/p' "$LIBLIST" | head -n1
}

status() {
  GAMEDLL="$(read_gamedll)"
  log "cstrike:        $CSTRIKE"
  log "gamedll_linux:  ${GAMEDLL:-<nicht gesetzt>}"
  log "Lademodus:      $LOADER"
  if [[ -f "$CSTRIKE/$YAPB_SO" ]]; then
    log "YaPB-Binary:    vorhanden"
  else
    log "YaPB-Binary:    fehlt"
  fi
  if [[ "$LOADER" == "metamod" ]]; then
    if [[ -f "$PLUGINS" ]] && grep -qE "^[[:space:]]*linux[[:space:]]+$YAPB_SO" "$PLUGINS"; then
      log "plugins.ini:    YaPB eingetragen"
    else
      log "plugins.ini:    YaPB NICHT eingetragen"
    fi
  else
    if [[ "$GAMEDLL" == "$YAPB_SO" ]]; then
      log "liblist.gam:    zeigt auf YaPB"
    else
      log "liblist.gam:    zeigt NICHT auf YaPB"
    fi
  fi
  if [[ -f "$CFG" ]]; then
    log "yb_quota:       $(sed -n 's/^yb_quota "\(.*\)"/\1/p' "$CFG")"
  fi
  local graphs
  graphs=$(find "$CSTRIKE/addons/yapb/data/graph" -name '*.graph' 2>/dev/null | wc -l)
  log "Graph-Dateien:  $graphs"
}

set_cvar() {
  # set_cvar <name> <wert> – ersetzt eine vorhandene Zeile `name "…"` in yapb.cfg oder hängt sie an.
  local name="$1" value="$2"
  if grep -qE "^$name " "$CFG"; then
    run sed -i "s|^$name .*|$name \"$value\"|" "$CFG"
  else
    if [[ $DRY_RUN -eq 1 ]]; then
      log "(dry-run) echo '$name \"$value\"' >> $CFG"
    else
      printf '%s "%s"\n' "$name" "$value" >>"$CFG"
    fi
  fi
}

install() {
  local tarball
  WORK="$(mktemp -d)"

  if [[ -n "${YAPB_TARBALL:-}" ]]; then
    tarball="$YAPB_TARBALL"
    log "Paket aus YAPB_TARBALL: $tarball"
  else
    tarball="$WORK/yapb.tar.xz"
    log "Lade $YAPB_URL"
    curl -fsSL --retry 3 -o "$tarball" "$YAPB_URL"
  fi
  echo "$YAPB_SHA256  $tarball" | sha256sum -c --quiet - || { log "Fehler: Prüfsumme stimmt nicht"; exit 1; }
  log "Prüfsumme OK (YaPB $YAPB_VERSION)"

  tar -xJf "$tarball" -C "$WORK"

  # Binary und Graphen immer aktualisieren; Konfiguration nur beim ersten Mal, damit Anpassungen bleiben.
  run mkdir -p "$CSTRIKE/addons/yapb"
  run cp -a "$WORK/addons/yapb/bin" "$WORK/addons/yapb/data" "$CSTRIKE/addons/yapb/"
  if [[ -d "$CSTRIKE/addons/yapb/conf" ]]; then
    log "conf/ existiert schon – bleibt unverändert"
  else
    run cp -a "$WORK/addons/yapb/conf" "$CSTRIKE/addons/yapb/"
    if [[ $DRY_RUN -eq 0 ]]; then
      # LAN-Voreinstellungen: keine Bots ohne Auftrag, kein Graph-Download/-Upload ins Internet,
      # Bots machen Platz, sobald Menschen joinen, Menü und Chat auf Deutsch.
      set_cvar yb_quota 0
      set_cvar yb_quota_mode fill
      set_cvar yb_autovacate 1
      set_cvar yb_kick_after_player_connect 1
      set_cvar yb_difficulty 2
      set_cvar yb_language de
      set_cvar yb_graph_url ""
      set_cvar yb_graph_url_upload ""
      set_cvar yb_graph_auto_collect_db 0
    else
      log "(dry-run) LAN-Voreinstellungen in yapb.cfg setzen (yb_quota 0, fill, autovacate, de, keine Graph-Uploads)"
    fi
  fi

  # Familientaugliche Bot-Namen (yb_language de); eine vorhandene Liste bleibt unangetastet.
  if [[ -f "$CSTRIKE/addons/yapb/conf/lang/de_names.cfg" ]]; then
    log "conf/lang/de_names.cfg existiert schon – bleibt unverändert"
  else
    run cp "$SCRIPT_DIR/de_names.cfg" "$CSTRIKE/addons/yapb/conf/lang/de_names.cfg"
    log "Bot-Namen: conf/lang/de_names.cfg angelegt"
  fi

  link
  fix_permissions
  log "Fertig. Instanz in AMP starten, dann in der Konsole: yb version"
}

# YaPB in den Ladeweg eintragen (idempotent). Ein AMP-Update (SteamCMD validate) setzt liblist.gam zurück.
link() {
  if [[ "$LOADER" == "metamod" ]]; then
    [[ -f "$PLUGINS" ]] || { log "Fehler: Metamod erkannt, aber $PLUGINS fehlt"; exit 1; }
    if grep -qE "^[[:space:]]*linux[[:space:]]+$YAPB_SO" "$PLUGINS"; then
      log "plugins.ini enthält YaPB schon"
    else
      [[ -f "$PLUGINS$BACKUP_SUFFIX" ]] || run cp -a "$PLUGINS" "$PLUGINS$BACKUP_SUFFIX"
      if [[ $DRY_RUN -eq 1 ]]; then
        log "(dry-run) echo 'linux $YAPB_SO' >> $PLUGINS"
      else
        printf 'linux %s\n' "$YAPB_SO" >>"$PLUGINS"
      fi
      log "YaPB in plugins.ini eingetragen"
    fi
  else
    if [[ "$GAMEDLL" == "$YAPB_SO" ]]; then
      log "liblist.gam zeigt schon auf YaPB"
    else
      [[ -f "$LIBLIST$BACKUP_SUFFIX" ]] || run cp -a "$LIBLIST" "$LIBLIST$BACKUP_SUFFIX"
      run sed -i "s|^\([[:space:]]*gamedll_linux[[:space:]]*\)\"[^\"]*\"|\1\"$YAPB_SO\"|" "$LIBLIST"
      log "liblist.gam: gamedll_linux -> $YAPB_SO (Original in liblist.gam$BACKUP_SUFFIX)"
    fi
  fi
}

fix_permissions() {
  run chown -R "$OWNER" "$CSTRIKE/addons/yapb"
  # Das Paket bringt data/{logs,pwf,train} ohne x-Bit mit; YaPB kann dort sonst nicht schreiben (LAN-Test CS1601).
  run chmod -R u+rwX,go+rX "$CSTRIKE/addons/yapb"
}

relink() {
  [[ -f "$CSTRIKE/$YAPB_SO" ]] || { log "Fehler: $YAPB_SO fehlt – erst installieren"; exit 1; }
  link
  fix_permissions
}

uninstall() {
  if [[ -f "$LIBLIST$BACKUP_SUFFIX" ]]; then
    run cp -a "$LIBLIST$BACKUP_SUFFIX" "$LIBLIST"
    run rm -f "$LIBLIST$BACKUP_SUFFIX"
    log "liblist.gam wiederhergestellt"
  fi
  if [[ -f "$PLUGINS" ]] && grep -qE "^[[:space:]]*linux[[:space:]]+$YAPB_SO" "$PLUGINS"; then
    run sed -i "\|^[[:space:]]*linux[[:space:]]\+$YAPB_SO|d" "$PLUGINS"
    run rm -f "$PLUGINS$BACKUP_SUFFIX"
    log "YaPB aus plugins.ini entfernt"
  fi
  run rm -rf "$CSTRIKE/addons/yapb"
  log "addons/yapb entfernt"
}

case "$MODE" in
  check) status ;;
  install) install; status ;;
  relink) relink; status ;;
  uninstall) uninstall; status ;;
esac
