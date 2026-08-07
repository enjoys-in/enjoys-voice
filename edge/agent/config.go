package main

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the agent's runtime configuration, read once from the environment
// (systemd EnvironmentFile). Every value has an appliance-friendly default so
// the binary runs even before it is provisioned (it simply no-ops until then).
type Config struct {
	CentralAPIBase string
	DeviceID       string
	DeviceToken    string
	SiteDomain     string
	ESLHost        string
	ESLPort        string
	ESLPassword    string
	FSDirectoryDir string
	FSTrunkDir     string
	CDRCSVPath     string
	VoicemailDir   string
	StateDir       string
	SyncInterval   time.Duration
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func loadConfig() Config {
	secs := 30
	if v, err := strconv.Atoi(os.Getenv("SYNC_INTERVAL_SECS")); err == nil && v > 0 {
		secs = v
	}
	return Config{
		CentralAPIBase: strings.TrimRight(env("CENTRAL_API_BASE", "https://voice.enjoys.in"), "/"),
		DeviceID:       env("DEVICE_ID", ""),
		DeviceToken:    env("DEVICE_TOKEN", ""),
		SiteDomain:     env("SITE_DOMAIN", "callnet.local"),
		ESLHost:        env("FS_ESL_HOST", "127.0.0.1"),
		ESLPort:        env("FS_ESL_PORT", "8021"),
		ESLPassword:    env("FS_ESL_PASSWORD", "JambonzR0ck$"),
		FSDirectoryDir: env("FS_DIRECTORY_DIR", "/etc/freeswitch/directory/default"),
		FSTrunkDir:     env("FS_TRUNK_DIR", "/etc/freeswitch/sip_profiles/external"),
		CDRCSVPath:     env("CDR_CSV_PATH", "/var/log/freeswitch/cdr-csv/Master.csv"),
		VoicemailDir:   env("VOICEMAIL_DIR", "/var/lib/freeswitch/storage/voicemail"),
		StateDir:       env("STATE_DIR", "/var/lib/callnet-edge"),
		SyncInterval:   time.Duration(secs) * time.Second,
	}
}

// Provisioned reports whether the box has an identity to talk to central.
func (c Config) Provisioned() bool {
	return c.DeviceID != "" && c.DeviceToken != ""
}
