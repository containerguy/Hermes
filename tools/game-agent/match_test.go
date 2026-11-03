package main

import "testing"

func TestDetectInstallDirAndIgnoresLaunchers(t *testing.T) {
	procs := []Process{
		{Name: "steam.exe", Path: `C:\Program Files (x86)\Steam\steam.exe`},
		{Name: "cs2.exe", Path: `D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe`},
		{Name: "FortniteClient-Win64-Shipping.exe", Path: `C:\Program Files\Epic Games\Fortnite\FortniteGame\Binaries\Win64\FortniteClient-Win64-Shipping.exe`},
		{Name: "EpicGamesLauncher.exe", Path: `C:\Program Files (x86)\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe`},
		{Name: "UnityCrashHandler64.exe", Path: `C:\Games\Valheim\UnityCrashHandler64.exe`},
		{Name: "chrome.exe", Path: `C:\Program Files\Google\Chrome\Application\chrome.exe`},
	}
	installed := []InstalledGame{
		{Title: "Counter-Strike 2", Launcher: "steam", AppID: "730", Dir: `D:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive`},
		{Title: "Fortnite", Launcher: "epic", Dir: `C:\Program Files\Epic Games\Fortnite\`},
		{Title: "Valheim", Launcher: "steam", Dir: `C:\Games\Valheim`},
	}
	got := Detect(procs, installed, nil, "0", nil)
	if len(got) != 2 || got[0].Title != "Counter-Strike 2" || got[1].Title != "Fortnite" {
		t.Fatalf("unexpected: %+v", got)
	}
	if got[1].Launcher != "epic" || got[1].Source != "install-dir" {
		t.Fatalf("unexpected fortnite detection: %+v", got[1])
	}
}

func TestDetectSteamRegistryDeduplicates(t *testing.T) {
	procs := []Process{{Name: "cs2.exe", Path: `D:\S\steamapps\common\CS\cs2.exe`}}
	installed := []InstalledGame{{Title: "Counter-Strike 2", Launcher: "steam", AppID: "730", Dir: `D:\S\steamapps\common\CS`}}
	got := Detect(procs, installed, nil, "730", map[string]string{"730": "Counter-Strike 2"})
	if len(got) != 1 || got[0].Source != "steam-registry" {
		t.Fatalf("unexpected: %+v", got)
	}
}

func TestDetectKnownExeFallbackAndPrefixSafety(t *testing.T) {
	procs := []Process{
		{Name: "factorio.exe", Path: `C:\Portable\Factorio\bin\x64\factorio.exe`},
		{Name: "tool.exe", Path: `C:\Games\Valheim2\tool.exe`}, // must not match C:\Games\Valheim
	}
	installed := []InstalledGame{{Title: "Valheim", Launcher: "steam", Dir: `C:\Games\Valheim`}}
	known := []KnownExe{{Exe: "Factorio.exe", Title: "Factorio"}}
	got := Detect(procs, installed, known, "", nil)
	if len(got) != 1 || got[0].Title != "Factorio" || got[0].Source != "exe-list" {
		t.Fatalf("unexpected: %+v", got)
	}
}

func TestSteamVDF(t *testing.T) {
	lib := `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps" { "228980" "0" }
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}`
	paths := SteamLibraryPaths(lib)
	if len(paths) != 2 || paths[0] != `C:\Program Files (x86)\Steam` || paths[1] != `D:\SteamLibrary` {
		t.Fatalf("paths: %q", paths)
	}
	acf := `"AppState"
{
	"appid"		"730"
	"name"		"Counter-Strike 2"
	"installdir"		"Counter-Strike Global Offensive"
	"UserConfig" { "name" "ignored" }
}`
	id, name, dir := SteamManifest(acf)
	if id != "730" || name != "Counter-Strike 2" || dir != "Counter-Strike Global Offensive" {
		t.Fatalf("manifest: %s %s %s", id, name, dir)
	}
}
