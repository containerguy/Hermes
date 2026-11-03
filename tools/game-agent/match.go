package main

import (
	"path/filepath"
	"sort"
	"strings"
)

// Process is one running process as seen by the OS layer.
type Process struct {
	PID  uint32 `json:"pid"`
	Name string `json:"name"` // e.g. "cs2.exe"
	Path string `json:"path"` // full image path, may be empty if access was denied
}

// InstalledGame is a game a launcher knows about, with its install folder.
type InstalledGame struct {
	Title    string `json:"title"`
	Launcher string `json:"launcher"` // steam, epic, gog, ubisoft, ea, battlenet, other
	AppID    string `json:"appId,omitempty"`
	Dir      string `json:"dir"`
}

// KnownExe maps an executable name to a game title (from the Hermes catalog
// or a curated list). Used when no launcher install folder matches.
type KnownExe struct {
	Exe   string `json:"exe"`
	Title string `json:"title"`
}

// Detection is what the agent reports. It never contains the full process list.
type Detection struct {
	Title    string `json:"title"`
	Launcher string `json:"launcher"`
	AppID    string `json:"appId,omitempty"`
	Exe      string `json:"exe"`
	Source   string `json:"source"` // steam-registry, install-dir, exe-list
}

// Launcher clients, overlays, crash handlers and anti-cheat services live
// inside game or launcher folders but are not "playing".
var ignoredExe = map[string]bool{
	"steam.exe": true, "steamwebhelper.exe": true, "steamservice.exe": true, "gameoverlayui.exe": true,
	"epicgameslauncher.exe": true, "epicwebhelper.exe": true, "epiconlineservicesuserhelper.exe": true,
	"eadesktop.exe": true, "eabackgroundservice.exe": true, "ealocalhostsvc.exe": true, "eaconnect_microsoft.exe": true,
	"ubisoftconnect.exe": true, "upc.exe": true, "uplaywebcore.exe": true, "ubisoftgamelauncher.exe": true, "ubisoftgamelauncher64.exe": true,
	"battle.net.exe": true, "agent.exe": true, "blizzard battle.net helper.exe": true,
	"galaxyclient.exe": true, "galaxyclient helper.exe": true, "galaxycommunication.exe": true, "goggalaxynotifications.exe": true,
	"unitycrashhandler64.exe": true, "unitycrashhandler32.exe": true, "crashreportclient.exe": true, "crashpad_handler.exe": true,
	"easyanticheat.exe": true, "easyanticheat_eos.exe": true, "beservice.exe": true, "beservice_x64.exe": true,
	"vcredist_x64.exe": true, "vcredist_x86.exe": true, "dxsetup.exe": true, "dxwebsetup.exe": true,
}

func normDir(p string) string {
	p = strings.ReplaceAll(p, "/", `\`)
	p = strings.TrimRight(strings.ToLower(p), `\`)
	return p + `\`
}

func baseName(p string) string {
	p = strings.ReplaceAll(p, `\`, "/")
	return strings.ToLower(filepath.Base(p))
}

// Detect combines the three signals. steamRunningAppID is "" or "0" when no Steam game runs.
func Detect(procs []Process, installed []InstalledGame, known []KnownExe, steamRunningAppID string, steamNames map[string]string) []Detection {
	out := map[string]Detection{}
	add := func(d Detection) {
		key := strings.ToLower(d.Launcher + "|" + d.Title)
		if _, ok := out[key]; !ok {
			out[key] = d
		}
	}

	// 1) Steam tells us directly.
	if steamRunningAppID != "" && steamRunningAppID != "0" {
		title := steamNames[steamRunningAppID]
		if title == "" {
			title = "Steam App " + steamRunningAppID
		}
		add(Detection{Title: title, Launcher: "steam", AppID: steamRunningAppID, Source: "steam-registry"})
	}

	// Longest install dir first, so nested folders win.
	dirs := make([]InstalledGame, 0, len(installed))
	for _, g := range installed {
		if strings.TrimSpace(g.Dir) != "" {
			dirs = append(dirs, g)
		}
	}
	sort.Slice(dirs, func(i, j int) bool { return len(dirs[i].Dir) > len(dirs[j].Dir) })

	knownByExe := map[string]string{}
	for _, k := range known {
		knownByExe[strings.ToLower(k.Exe)] = k.Title
	}

	for _, p := range procs {
		exe := strings.ToLower(p.Name)
		if exe == "" {
			exe = baseName(p.Path)
		}
		if ignoredExe[exe] {
			continue
		}
		matched := false
		// 2) Process runs from a launcher's install folder.
		if p.Path != "" {
			pp := strings.ToLower(strings.ReplaceAll(p.Path, "/", `\`))
			for _, g := range dirs {
				if strings.HasPrefix(pp, normDir(g.Dir)) {
					add(Detection{Title: g.Title, Launcher: g.Launcher, AppID: g.AppID, Exe: exe, Source: "install-dir"})
					matched = true
					break
				}
			}
		}
		// 3) Known executable name (catalog / curated list).
		if !matched {
			if t, ok := knownByExe[exe]; ok {
				add(Detection{Title: t, Launcher: "other", Exe: exe, Source: "exe-list"})
			}
		}
	}

	res := make([]Detection, 0, len(out))
	for _, d := range out {
		res = append(res, d)
	}
	sort.Slice(res, func(i, j int) bool { return res[i].Title < res[j].Title })
	return res
}
