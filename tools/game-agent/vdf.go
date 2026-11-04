package main

import (
	"regexp"
	"strings"
)

// Minimal readers for Steam's KeyValues text files. Enough for
// libraryfolders.vdf ("path") and appmanifest_*.acf ("appid", "name", "installdir").

var kvLine = regexp.MustCompile(`^\s*"([^"]+)"\s+"((?:[^"\\]|\\.)*)"\s*$`)

func unescapeVDF(s string) string {
	return strings.ReplaceAll(s, `\\`, `\`)
}

// VDFValues returns all key/value pairs on single lines, in order.
func VDFValues(text string) [][2]string {
	var out [][2]string
	for _, line := range strings.Split(text, "\n") {
		m := kvLine.FindStringSubmatch(strings.TrimRight(line, "\r"))
		if m != nil {
			out = append(out, [2]string{strings.ToLower(m[1]), unescapeVDF(m[2])})
		}
	}
	return out
}

// SteamLibraryPaths reads every "path" entry of libraryfolders.vdf.
func SteamLibraryPaths(libraryfolders string) []string {
	var out []string
	for _, kv := range VDFValues(libraryfolders) {
		if kv[0] == "path" {
			out = append(out, kv[1])
		}
	}
	return out
}

// SteamManifest returns appid, name and installdir of an appmanifest file.
func SteamManifest(acf string) (appID, name, installDir string) {
	for _, kv := range VDFValues(acf) {
		switch kv[0] {
		case "appid":
			if appID == "" {
				appID = kv[1]
			}
		case "name":
			if name == "" {
				name = kv[1]
			}
		case "installdir":
			if installDir == "" {
				installDir = kv[1]
			}
		}
	}
	return
}
