// hermes-game-agent: prototype that detects which game is running on a
// Windows PC and (optionally) reports it to Hermes.
//
// Privacy: only matched games are reported, never the process list.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

type Report struct {
	Host     string      `json:"host"`
	Time     time.Time   `json:"time"`
	Playing  []Detection `json:"playing"`
	Launcher []string    `json:"launchersFound"`
}

func main() {
	interval := flag.Duration("interval", 0, "repeat every interval (e.g. 30s); 0 = run once")
	server := flag.String("server", "", "Hermes base URL to POST reports to (prototype endpoint /api/presence/game)")
	token := flag.String("token", os.Getenv("HERMES_TOKEN"), "Hermes API token (or env HERMES_TOKEN)")
	knownFile := flag.String("known", "", "optional JSON file [{\"exe\":\"factorio.exe\",\"title\":\"Factorio\"}]")
	verbose := flag.Bool("v", false, "also print installed games found per launcher (local only, never sent)")
	flag.Parse()

	var known []KnownExe
	if *knownFile != "" {
		b, err := os.ReadFile(*knownFile)
		if err == nil {
			err = json.Unmarshal(b, &known)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "known list:", err)
			os.Exit(2)
		}
	}

	if *server != "" && *interval > 0 {
		// Ctrl+C or window closed: remove the entry in Hermes instead of waiting for it to expire.
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
		go func() {
			<-stop
			if err := clearPresence(*server, *token); err != nil {
				fmt.Fprintln(os.Stderr, "clear:", err)
			}
			os.Exit(0)
		}()
	}

	for {
		installed, launchers := InstalledGames()
		if *verbose {
			for _, g := range installed {
				fmt.Fprintf(os.Stderr, "installed [%s] %s -> %s\n", g.Launcher, g.Title, g.Dir)
			}
		}
		appID, steamNames := SteamRunningAppID(), map[string]string{}
		for _, g := range installed {
			if g.Launcher == "steam" {
				steamNames[g.AppID] = g.Title
			}
		}
		procs, err := Processes()
		if err != nil {
			fmt.Fprintln(os.Stderr, "process list:", err)
		}
		host, _ := os.Hostname()
		r := Report{Host: host, Time: time.Now().UTC(), Playing: Detect(procs, installed, known, appID, steamNames), Launcher: launchers}
		if r.Playing == nil {
			r.Playing = []Detection{}
		}
		out, _ := json.MarshalIndent(r, "", "  ")
		fmt.Println(string(out))

		if *server != "" {
			if err := post(*server, *token, r); err != nil {
				fmt.Fprintln(os.Stderr, "post:", err)
			}
		}
		if *interval <= 0 {
			return
		}
		time.Sleep(*interval)
	}
}

// post sends only the detected games to Hermes: no host name, no launcher
// list, no exe names.
func post(server, token string, r Report) error {
	type game struct {
		Title    string `json:"title"`
		Launcher string `json:"launcher"`
		AppID    string `json:"appId,omitempty"`
	}
	playing := make([]game, 0, len(r.Playing))
	for _, d := range r.Playing {
		playing = append(playing, game{Title: d.Title, Launcher: d.Launcher, AppID: d.AppID})
	}
	body, _ := json.Marshal(map[string]any{"playing": playing})
	return send(server, token, http.MethodPost, body)
}

// clearPresence removes this user's entry right away (agent stops).
func clearPresence(server, token string) error {
	return send(server, token, http.MethodDelete, nil)
}

func send(server, token, method string, body []byte) error {
	req, err := http.NewRequest(method, strings.TrimRight(server, "/")+"/api/presence/game", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	c := http.Client{Timeout: 10 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}
