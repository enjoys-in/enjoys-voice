// CallNet edge sync agent (native static binary; no Docker, no runtime).
//
// Every SYNC_INTERVAL, IF provisioned AND central is reachable:
//  1. pull the extension roster   -> write FS directory  -> reloadxml
//  2. pull the trunk credentials  -> write gateway        -> sofia rescan
//  3. ship new CDR rows up         (store-and-forward by byte offset)
//  4. upload new voicemail files   (store-and-forward by filename)
//
// If central is unreachable the loop is a no-op: FreeSWITCH keeps serving the
// site locally and CDR/voicemail accumulate until the WAN returns.
package main

import (
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	cfg := loadConfig()
	logf("starting (central=%s device=%s)", cfg.CentralAPIBase, orUnset(cfg.DeviceID))
	_ = os.MkdirAll(cfg.StateDir, 0o755)
	state := loadState(cfg.StateDir)
	central := newCentral(cfg)

	var esl *ESL
	ensureESL := func() *ESL {
		if esl != nil {
			return esl
		}
		c, err := dialESL(cfg.ESLHost, cfg.ESLPort, cfg.ESLPassword, 5*time.Second)
		if err != nil {
			logf("ESL connect failed: %v", err)
			return nil
		}
		esl = c
		logf("ESL connected to FreeSWITCH")
		return esl
	}
	fsAPI := func(cmd string) {
		c := ensureESL()
		if c == nil {
			return
		}
		if _, err := c.API(cmd); err != nil {
			logf("ESL api failed (%s): %v", cmd, err)
			c.Close()
			esl = nil // force reconnect next time
		}
	}

	ensureESL()
	for {
		tick(cfg, central, &state, fsAPI)
		time.Sleep(cfg.SyncInterval)
	}
}

func tick(cfg Config, central *Central, state *State, fsAPI func(string)) {
	if !cfg.Provisioned() {
		logf("not provisioned (DEVICE_ID/DEVICE_TOKEN unset) — serving locally only")
		return
	}
	if !central.Ping() {
		logf("central unreachable — FreeSWITCH serves locally; CDR/voicemail buffered")
		return
	}
	if err := syncExtensions(cfg, central, fsAPI); err != nil {
		logf("extensions sync error: %v", err)
	}
	if err := syncTrunk(cfg, central, fsAPI); err != nil {
		logf("trunk sync error: %v", err)
	}
	if err := flushCDR(cfg, central, state); err != nil {
		logf("cdr sync error: %v", err)
	}
	if err := flushVoicemail(cfg, central, state); err != nil {
		logf("voicemail sync error: %v", err)
	}
}

func syncExtensions(cfg Config, central *Central, fsAPI func(string)) error {
	exts, err := central.GetExtensions()
	if err != nil {
		return err
	}
	changed, err := writeUsers(cfg.FSDirectoryDir, exts)
	if err != nil {
		return err
	}
	if changed {
		logf("directory updated (%d users) -> reloadxml", len(exts))
		fsAPI("reloadxml")
	}
	return nil
}

func syncTrunk(cfg Config, central *Central, fsAPI func(string)) error {
	t, err := central.GetTrunk()
	if err != nil || t == nil {
		return err
	}
	changed, err := writeTrunk(cfg.FSTrunkDir, *t)
	if err != nil {
		return err
	}
	if changed {
		logf("trunk updated -> sofia profile external rescan")
		fsAPI("sofia profile external rescan")
	}
	return nil
}

func flushCDR(cfg Config, central *Central, state *State) error {
	info, err := os.Stat(cfg.CDRCSVPath)
	if err != nil {
		return nil // no CDRs written yet
	}
	if info.Size() < state.CDROffset {
		state.CDROffset = 0 // rotated / truncated
	}
	if info.Size() == state.CDROffset {
		return nil
	}
	f, err := os.Open(cfg.CDRCSVPath)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Seek(state.CDROffset, io.SeekStart); err != nil {
		return err
	}
	buf := make([]byte, info.Size()-state.CDROffset)
	n, _ := io.ReadFull(f, buf)

	var rows []CDRRow
	for _, l := range strings.Split(string(buf[:n]), "\n") {
		if strings.TrimSpace(l) != "" {
			rows = append(rows, parseCDRLine(l))
		}
	}
	if len(rows) > 0 {
		if err := central.PostCDR(rows); err != nil {
			return err
		}
		logf("shipped %d CDR row(s)", len(rows))
	}
	state.CDROffset = info.Size()
	return saveState(cfg.StateDir, *state)
}

func flushVoicemail(cfg Config, central *Central, state *State) error {
	seen := make(map[string]bool, len(state.UploadedVoicemail))
	for _, p := range state.UploadedVoicemail {
		seen[p] = true
	}
	saved := false

	_ = filepath.WalkDir(cfg.VoicemailDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(d.Name()), ".wav") {
			return nil
		}
		rel, _ := filepath.Rel(cfg.VoicemailDir, path)
		if seen[rel] {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		name := strings.NewReplacer("\\", "_", "/", "_").Replace(rel)
		if err := central.UploadVoicemail(name, data); err != nil {
			logf("voicemail upload failed (%s): %v", rel, err)
			return nil
		}
		state.UploadedVoicemail = append(state.UploadedVoicemail, rel)
		seen[rel] = true
		saved = true
		logf("uploaded voicemail %s", rel)
		return nil
	})

	if saved {
		if len(state.UploadedVoicemail) > 5000 {
			state.UploadedVoicemail = state.UploadedVoicemail[len(state.UploadedVoicemail)-5000:]
		}
		return saveState(cfg.StateDir, *state)
	}
	return nil
}

func logf(format string, a ...any) { log.Printf("[edge-agent] "+format, a...) }

func orUnset(s string) string {
	if s == "" {
		return "<unprovisioned>"
	}
	return s
}
