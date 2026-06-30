package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"
)

// EdgeExtension / EdgeTrunk / CDRRow mirror the central-side contract.
//
// CENTRAL-SIDE CONTRACT (endpoints on the Go API, authenticated by the device
// bearer token + X-Device-Id header — the id travels in the header, not the path):
//   GET  /api/g/edge/health             -> 200 when reachable
//   GET  /api/g/edge/extensions         -> EdgeExtension[]  (in data)
//   GET  /api/g/edge/trunk              -> EdgeTrunk | 404
//   POST /api/g/edge/cdr   {rows:[...]}  -> ack
//   POST /api/g/edge/voicemail (multipart) -> ack

type EdgeExtension struct {
	Extension      string `json:"extension"`
	Password       string `json:"password,omitempty"`
	Name           string `json:"name,omitempty"`
	VMPassword     string `json:"vmPassword,omitempty"`
	CallerIDNumber string `json:"callerIdNumber,omitempty"`
}

type EdgeTrunk struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Realm    string `json:"realm"`
	Proxy    string `json:"proxy"`
	Register *bool  `json:"register,omitempty"`
}

type CDRRow struct {
	Raw            string `json:"raw"`
	CallerIDName   string `json:"callerIdName,omitempty"`
	CallerIDNumber string `json:"callerIdNumber,omitempty"`
	Destination    string `json:"destination,omitempty"`
	StartStamp     string `json:"startStamp,omitempty"`
	EndStamp       string `json:"endStamp,omitempty"`
	Duration       int    `json:"duration,omitempty"`
	Billsec        int    `json:"billsec,omitempty"`
	HangupCause    string `json:"hangupCause,omitempty"`
	UUID           string `json:"uuid,omitempty"`
}

type Central struct {
	cfg    Config
	client *http.Client
}

func newCentral(cfg Config) *Central {
	return &Central{cfg: cfg, client: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Central) do(ctx context.Context, method, path string, body io.Reader, contentType string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.cfg.CentralAPIBase+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.DeviceToken)
	req.Header.Set("X-Device-Id", c.cfg.DeviceID)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return c.client.Do(req)
}

// unwrap handles the Go envelope {success,message,data} — decoding `data` when
// present, otherwise the whole body.
func unwrap(b []byte, target any) error {
	var envel struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(b, &envel); err == nil && len(envel.Data) > 0 {
		return json.Unmarshal(envel.Data, target)
	}
	return json.Unmarshal(b, target)
}

func (c *Central) Ping() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	resp, err := c.do(ctx, http.MethodGet, "/api/g/edge/health", nil, "")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

func (c *Central) GetExtensions() ([]EdgeExtension, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	resp, err := c.do(ctx, http.MethodGet, "/api/g/edge/extensions", nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("extensions HTTP %d", resp.StatusCode)
	}
	b, _ := io.ReadAll(resp.Body)
	var out []EdgeExtension
	if err := unwrap(b, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Central) GetTrunk() (*EdgeTrunk, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	resp, err := c.do(ctx, http.MethodGet, "/api/g/edge/trunk", nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("trunk HTTP %d", resp.StatusCode)
	}
	b, _ := io.ReadAll(resp.Body)
	var t EdgeTrunk
	if err := unwrap(b, &t); err != nil {
		return nil, err
	}
	return &t, nil
}

func (c *Central) PostCDR(rows []CDRRow) error {
	body, _ := json.Marshal(map[string]any{"rows": rows})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	resp, err := c.do(ctx, http.MethodPost, "/api/g/edge/cdr", bytes.NewReader(body), "application/json")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("cdr HTTP %d", resp.StatusCode)
	}
	return nil
}

func (c *Central) UploadVoicemail(name string, data []byte) error {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", name)
	if err != nil {
		return err
	}
	if _, err := fw.Write(data); err != nil {
		return err
	}
	w.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	resp, err := c.do(ctx, http.MethodPost, "/api/g/edge/voicemail", &buf, w.FormDataContentType())
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("voicemail HTTP %d", resp.StatusCode)
	}
	return nil
}
