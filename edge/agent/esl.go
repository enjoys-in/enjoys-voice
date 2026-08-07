package main

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ESL is a minimal FreeSWITCH inbound event-socket client (stdlib only).
// We only need a request/response `api` channel for:
//   - reloadxml                     (after writing directory users)
//   - sofia profile external rescan (after rewriting the trunk gateway)
type ESL struct {
	conn net.Conn
	r    *bufio.Reader
	mu   sync.Mutex
}

func dialESL(host, port, password string, timeout time.Duration) (*ESL, error) {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), timeout)
	if err != nil {
		return nil, err
	}
	e := &ESL{conn: conn, r: bufio.NewReader(conn)}

	hdr, _, err := e.readEvent()
	if err != nil {
		conn.Close()
		return nil, err
	}
	if hdr["Content-Type"] != "auth/request" {
		conn.Close()
		return nil, fmt.Errorf("unexpected ESL greeting: %q", hdr["Content-Type"])
	}
	if _, err := fmt.Fprintf(conn, "auth %s\n\n", password); err != nil {
		conn.Close()
		return nil, err
	}
	hdr, _, err = e.readEvent()
	if err != nil {
		conn.Close()
		return nil, err
	}
	if !strings.HasPrefix(hdr["Reply-Text"], "+OK") {
		conn.Close()
		return nil, fmt.Errorf("ESL auth failed: %s", hdr["Reply-Text"])
	}
	return e, nil
}

// readEvent reads one header block plus an optional Content-Length body.
func (e *ESL) readEvent() (map[string]string, string, error) {
	headers := make(map[string]string)
	for {
		line, err := e.r.ReadString('\n')
		if err != nil {
			return nil, "", err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if i := strings.Index(line, ":"); i > 0 {
			headers[strings.TrimSpace(line[:i])] = strings.TrimSpace(line[i+1:])
		}
	}
	body := ""
	if cl := headers["Content-Length"]; cl != "" {
		if n, err := strconv.Atoi(cl); err == nil && n > 0 {
			buf := make([]byte, n)
			if _, err := io.ReadFull(e.r, buf); err != nil {
				return nil, "", err
			}
			body = string(buf)
		}
	}
	return headers, body, nil
}

// API runs `api <cmd>` and returns the response body.
func (e *ESL) API(cmd string) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if _, err := fmt.Fprintf(e.conn, "api %s\n\n", cmd); err != nil {
		return "", err
	}
	for {
		hdr, body, err := e.readEvent()
		if err != nil {
			return "", err
		}
		switch hdr["Content-Type"] {
		case "api/response":
			return strings.TrimSpace(body), nil
		case "command/reply":
			return strings.TrimSpace(hdr["Reply-Text"]), nil
		}
		// ignore any other event frames
	}
}

func (e *ESL) Close() {
	if e.conn != nil {
		e.conn.Close()
	}
}
