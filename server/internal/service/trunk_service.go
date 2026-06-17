package service

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/models"
	"github.com/enjoys-in/enjoys-voice/api/internal/repository"
	"gorm.io/gorm"
)

type trunkService struct {
	repo repository.TrunkRepository
}

func NewTrunkService(repo repository.TrunkRepository) TrunkService {
	return &trunkService{repo: repo}
}

func (s *trunkService) List(ctx context.Context) ([]models.TrunkResponse, error) {
	trunks, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.TrunkResponse, 0, len(trunks))
	for i := range trunks {
		out = append(out, trunks[i].ToResponse())
	}
	return out, nil
}

func (s *trunkService) Get(ctx context.Context, id uint) (*models.TrunkResponse, error) {
	trunk, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTrunkNotFound
		}
		return nil, err
	}
	resp := trunk.ToResponse()
	return &resp, nil
}

func (s *trunkService) Create(ctx context.Context, input *TrunkInput) (*models.TrunkResponse, error) {
	trunk := &models.Trunk{Port: 5060, Transport: "udp", Enabled: true}
	applyTrunkInput(trunk, input)
	if strings.TrimSpace(trunk.Name) == "" || strings.TrimSpace(trunk.Host) == "" {
		return nil, ErrTrunkInvalid
	}
	normalizeTrunk(trunk)
	if err := s.repo.Create(ctx, trunk); err != nil {
		return nil, err
	}
	resp := trunk.ToResponse()
	return &resp, nil
}

func (s *trunkService) Update(ctx context.Context, id uint, input *TrunkInput) (*models.TrunkResponse, error) {
	trunk, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTrunkNotFound
		}
		return nil, err
	}
	applyTrunkInput(trunk, input)
	if strings.TrimSpace(trunk.Name) == "" || strings.TrimSpace(trunk.Host) == "" {
		return nil, ErrTrunkInvalid
	}
	normalizeTrunk(trunk)
	if err := s.repo.Update(ctx, trunk); err != nil {
		return nil, err
	}
	resp := trunk.ToResponse()
	return &resp, nil
}

func (s *trunkService) Delete(ctx context.Context, id uint) error {
	if _, err := s.repo.Get(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrTrunkNotFound
		}
		return err
	}
	return s.repo.Delete(ctx, id)
}

func (s *trunkService) Test(ctx context.Context, id uint) (*TrunkTestResult, error) {
	trunk, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTrunkNotFound
		}
		return nil, err
	}
	result := sipOptionsPing(trunk.Host, trunk.Port, trunk.Transport, 5*time.Second)
	status := "unreachable"
	if result.OK {
		status = "ok"
	}
	// Best-effort: a probe shouldn't fail the request if the status write does.
	_ = s.repo.SetStatus(ctx, id, status, time.Now())
	return result, nil
}

// applyTrunkInput copies the non-nil fields of input onto trunk (partial update).
// Password is only overwritten when a non-empty value is supplied, so editing a
// trunk without re-entering the secret keeps the stored one.
func applyTrunkInput(t *models.Trunk, in *TrunkInput) {
	if in == nil {
		return
	}
	if in.Name != nil {
		t.Name = strings.TrimSpace(*in.Name)
	}
	if in.Host != nil {
		t.Host = strings.TrimSpace(*in.Host)
	}
	if in.Port != nil {
		t.Port = *in.Port
	}
	if in.Transport != nil {
		t.Transport = strings.ToLower(strings.TrimSpace(*in.Transport))
	}
	if in.Username != nil {
		t.Username = strings.TrimSpace(*in.Username)
	}
	if in.Password != nil && *in.Password != "" {
		t.Password = *in.Password
	}
	if in.CallerNumber != nil {
		t.CallerNumber = strings.TrimSpace(*in.CallerNumber)
	}
	if in.Prefix != nil {
		t.Prefix = strings.TrimSpace(*in.Prefix)
	}
	if in.Codecs != nil {
		t.Codecs = strings.TrimSpace(*in.Codecs)
	}
	if in.Enabled != nil {
		t.Enabled = *in.Enabled
	}
}

// normalizeTrunk clamps the transport and port to valid values after a merge.
func normalizeTrunk(t *models.Trunk) {
	switch t.Transport {
	case "udp", "tcp", "tls":
	default:
		t.Transport = "udp"
	}
	if t.Port <= 0 || t.Port > 65535 {
		t.Port = 5060
	}
}

// sipOptionsPing sends a single SIP OPTIONS request to host:port over the given
// transport and waits up to timeout for any SIP response. It is a lightweight
// reachability probe (not a full SIP stack): any "SIP/2.0 ..." status line back
// — even a 4xx — proves the far end is a live SIP endpoint.
func sipOptionsPing(host string, port int, transport string, timeout time.Duration) *TrunkTestResult {
	if port <= 0 {
		port = 5060
	}
	transport = strings.ToLower(strings.TrimSpace(transport))
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	start := time.Now()

	var conn net.Conn
	var err error
	switch transport {
	case "tls":
		conn, err = tls.DialWithDialer(&net.Dialer{Timeout: timeout}, "tcp", addr, &tls.Config{InsecureSkipVerify: true})
	case "tcp":
		conn, err = net.DialTimeout("tcp", addr, timeout)
	default: // udp
		conn, err = net.DialTimeout("udp", addr, timeout)
	}
	if err != nil {
		return &TrunkTestResult{OK: false, Error: err.Error()}
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))

	localHost, localPort := splitHostPort(conn.LocalAddr().String())
	viaTransport := strings.ToUpper(transport)
	if viaTransport == "" {
		viaTransport = "UDP"
	}
	msg := strings.Join([]string{
		fmt.Sprintf("OPTIONS sip:%s:%d SIP/2.0", host, port),
		fmt.Sprintf("Via: SIP/2.0/%s %s:%s;branch=z9hG4bK%s;rport", viaTransport, localHost, localPort, randHex(8)),
		"Max-Forwards: 70",
		fmt.Sprintf("From: <sip:probe@%s>;tag=%s", localHost, randHex(6)),
		fmt.Sprintf("To: <sip:%s:%d>", host, port),
		fmt.Sprintf("Call-ID: %s@%s", randHex(12), localHost),
		"CSeq: 1 OPTIONS",
		fmt.Sprintf("Contact: <sip:probe@%s:%s>", localHost, localPort),
		"User-Agent: enjoys-voice-probe",
		"Accept: application/sdp",
		"Content-Length: 0",
		"", "",
	}, "\r\n")

	if _, err := conn.Write([]byte(msg)); err != nil {
		return &TrunkTestResult{OK: false, Error: err.Error()}
	}

	buf := make([]byte, 2048)
	n, err := conn.Read(buf)
	if err != nil {
		return &TrunkTestResult{OK: false, Error: "no SIP response: " + err.Error()}
	}
	latency := time.Since(start).Milliseconds()
	statusLine := firstLine(string(buf[:n]))
	if strings.HasPrefix(statusLine, "SIP/2.0") {
		return &TrunkTestResult{OK: true, LatencyMs: latency, Response: statusLine}
	}
	return &TrunkTestResult{OK: false, LatencyMs: latency, Response: statusLine, Error: "unexpected response"}
}

func splitHostPort(addr string) (host, port string) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil || host == "" {
		return "127.0.0.1", "5060"
	}
	return host, port
}

func firstLine(s string) string {
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return strings.TrimSpace(s)
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
