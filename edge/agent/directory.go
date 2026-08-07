package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var extRe = regexp.MustCompile(`^\d{2,8}$`)

var xmlReplacer = strings.NewReplacer(
	"&", "&amp;",
	"<", "&lt;",
	">", "&gt;",
	`"`, "&quot;",
)

func xmlEsc(s string) string { return xmlReplacer.Replace(s) }

func userXML(e EdgeExtension) string {
	pw := "$${default_password}"
	if e.Password != "" {
		pw = xmlEsc(e.Password)
	}
	vm := e.VMPassword
	if vm == "" {
		vm = e.Extension
	}
	cid := e.CallerIDNumber
	if cid == "" {
		cid = e.Extension
	}
	name := e.Name
	if name == "" {
		name = "Extension " + e.Extension
	}
	return "<include>\n" +
		"  <user id=\"" + xmlEsc(e.Extension) + "\">\n" +
		"    <params>\n" +
		"      <param name=\"password\" value=\"" + pw + "\"/>\n" +
		"      <param name=\"vm-password\" value=\"" + xmlEsc(vm) + "\"/>\n" +
		"    </params>\n" +
		"    <variables>\n" +
		"      <variable name=\"user_context\" value=\"default\"/>\n" +
		"      <variable name=\"effective_caller_id_name\" value=\"" + xmlEsc(name) + "\"/>\n" +
		"      <variable name=\"effective_caller_id_number\" value=\"" + xmlEsc(cid) + "\"/>\n" +
		"      <variable name=\"outbound_caller_id_number\" value=\"" + xmlEsc(cid) + "\"/>\n" +
		"    </variables>\n" +
		"  </user>\n" +
		"</include>\n"
}

// writeUsers writes synced users into the FS directory. Returns true on change.
func writeUsers(dir string, exts []EdgeExtension) (bool, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return false, err
	}
	changed := false
	valid := make(map[string]bool)

	for _, e := range exts {
		if !extRe.MatchString(e.Extension) {
			continue
		}
		name := e.Extension + ".xml"
		valid[name] = true
		target := filepath.Join(dir, name)
		next := userXML(e)
		prev, _ := os.ReadFile(target)
		if string(prev) != next {
			if err := os.WriteFile(target, []byte(next), 0o644); err != nil {
				return changed, err
			}
			changed = true
		}
	}

	// Drop users central no longer lists — only when it actually returned some,
	// so a transient empty response can't wipe the site.
	if len(exts) > 0 {
		entries, _ := os.ReadDir(dir)
		for _, ent := range entries {
			n := ent.Name()
			if strings.HasSuffix(n, ".xml") && !valid[n] {
				os.Remove(filepath.Join(dir, n))
				changed = true
			}
		}
	}
	return changed, nil
}

func trunkXML(t EdgeTrunk) string {
	reg := "true"
	if t.Register != nil && !*t.Register {
		reg = "false"
	}
	return "<include>\n" +
		"  <gateway name=\"callnet_trunk\">\n" +
		"    <param name=\"username\" value=\"" + xmlEsc(t.Username) + "\"/>\n" +
		"    <param name=\"password\" value=\"" + xmlEsc(t.Password) + "\"/>\n" +
		"    <param name=\"realm\" value=\"" + xmlEsc(t.Realm) + "\"/>\n" +
		"    <param name=\"proxy\" value=\"" + xmlEsc(t.Proxy) + "\"/>\n" +
		"    <param name=\"register\" value=\"" + reg + "\"/>\n" +
		"    <param name=\"caller-id-in-from\" value=\"true\"/>\n" +
		"    <param name=\"expire-seconds\" value=\"600\"/>\n" +
		"    <param name=\"retry-seconds\" value=\"30\"/>\n" +
		"  </gateway>\n" +
		"</include>\n"
}

// writeTrunk writes the local trunk gateway. Returns true on change.
func writeTrunk(dir string, t EdgeTrunk) (bool, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return false, err
	}
	target := filepath.Join(dir, "callnet_trunk.xml")
	next := trunkXML(t)
	prev, _ := os.ReadFile(target)
	if string(prev) == next {
		return false, nil
	}
	if err := os.WriteFile(target, []byte(next), 0o644); err != nil {
		return false, err
	}
	return true, nil
}
