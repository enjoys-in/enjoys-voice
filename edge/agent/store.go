package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// State is durable agent progress for store-and-forward; persisted as JSON so
// it survives restarts and WAN outages.
type State struct {
	CDROffset         int64    `json:"cdrOffset"`
	UploadedVoicemail []string `json:"uploadedVoicemail"`
}

func stateFile(dir string) string { return filepath.Join(dir, "agent-state.json") }

func loadState(dir string) State {
	var s State
	if b, err := os.ReadFile(stateFile(dir)); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

func saveState(dir string, s State) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, _ := json.Marshal(s)
	return os.WriteFile(stateFile(dir), b, 0o644)
}
