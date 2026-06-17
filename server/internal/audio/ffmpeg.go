// Package audio normalizes user-uploaded sound files for telephony playback.
//
// IVR prompts are played server-side by FreeSWITCH, which expects a narrow set
// of canonical formats. Browser-uploaded audio (mp3/webm/mp4/ogg/wav of varying
// sample rates and channel counts) must therefore be transcoded to a single
// canonical WAV before FreeSWITCH can play it reliably. Transcoding is delegated
// to the ffmpeg binary (kept out of the API image; a sidecar/installed ffmpeg
// satisfies it) which is invoked with a strict timeout and argument list.
package audio

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"
)

// ErrTranscodeDisabled is returned when no ffmpeg binary is configured.
var ErrTranscodeDisabled = errors.New("audio transcoding disabled (no ffmpeg configured)")

// ErrUnsupportedFormat is returned when a file's magic bytes do not match a
// recognized audio container. Validation is by content, never the (spoofable)
// client Content-Type header.
var ErrUnsupportedFormat = errors.New("unsupported or unrecognized audio format")

// FreeSWITCH-canonical IVR target: 16 kHz (wideband), mono, signed 16-bit PCM
// WAV. This matches the prompt format FreeSWITCH plays without on-the-fly
// resampling and is the format documented for IVR uploads.
const (
	ivrSampleRate = "16000"
	ivrChannels   = "1"
	ivrCodec      = "pcm_s16le"
)

// Transcoder shells out to ffmpeg to normalize audio. The zero value is not
// usable; construct with NewTranscoder.
type Transcoder struct {
	binary  string
	timeout time.Duration
}

// NewTranscoder returns a Transcoder using the given ffmpeg binary (a name
// resolved on PATH, e.g. "ffmpeg", or an absolute path). An empty binary yields
// a transcoder whose Enabled() reports false and whose calls return
// ErrTranscodeDisabled, so callers can degrade gracefully.
func NewTranscoder(binary string) *Transcoder {
	return &Transcoder{binary: binary, timeout: 30 * time.Second}
}

// Enabled reports whether a usable ffmpeg binary is configured AND resolvable.
// It is cheap to call (a PATH lookup) and lets handlers reject IVR uploads with
// a clear 503 rather than saving an unplayable file.
func (t *Transcoder) Enabled() bool {
	if t == nil || t.binary == "" {
		return false
	}
	if _, err := exec.LookPath(t.binary); err != nil {
		return false
	}
	return true
}

// ToFreeswitchWav transcodes the file at inputPath into a 16 kHz mono PCM WAV at
// outputPath. The output file is overwritten. On any failure (ffmpeg missing,
// non-zero exit, or timeout) the partially written output is removed and a
// non-nil error is returned. ffmpeg's stderr is captured for the error message
// but is the caller's responsibility to log (never surfaced to the client).
func (t *Transcoder) ToFreeswitchWav(ctx context.Context, inputPath, outputPath string) error {
	if !t.Enabled() {
		return ErrTranscodeDisabled
	}

	ctx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()

	// Fixed, server-controlled argument vector — no shell, no interpolation of
	// untrusted strings beyond the file paths (which are server-generated).
	// -y overwrite, -nostdin so ffmpeg never blocks waiting on input, -vn drop
	// any video stream, then the canonical IVR audio params.
	cmd := exec.CommandContext(ctx, t.binary,
		"-nostdin",
		"-y",
		"-i", inputPath,
		"-vn",
		"-ar", ivrSampleRate,
		"-ac", ivrChannels,
		"-c:a", ivrCodec,
		"-f", "wav",
		outputPath,
	)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// Clean up any partial/corrupt output so a half-written file is never
		// left where FreeSWITCH could try to play it.
		_ = os.Remove(outputPath)
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("ffmpeg timed out after %s", t.timeout)
		}
		return fmt.Errorf("ffmpeg failed: %w: %s", err, truncate(stderr.String(), 500))
	}
	return nil
}

func truncate(s string, max int) string {
	s = trimSpace(s)
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}

func trimSpace(s string) string {
	// Avoid pulling in strings just for TrimSpace of ffmpeg noise.
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\n' || s[start] == '\r' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\n' || s[end-1] == '\r' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

// SniffAudio reads the leading bytes of the file and returns a short format tag
// ("wav", "ogg", "mp3", "webm", "mp4") when the content matches a known audio
// container, or ErrUnsupportedFormat otherwise. This is the authoritative
// type check — the client Content-Type header is advisory only and trivially
// spoofable, so callers must rely on this after the upload is written to disk.
func SniffAudio(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	header := make([]byte, 16)
	n, err := io.ReadFull(f, header)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
		return "", ErrUnsupportedFormat
	}
	header = header[:n]
	if len(header) < 12 {
		return "", ErrUnsupportedFormat
	}

	switch {
	// RIFF....WAVE
	case bytes.Equal(header[0:4], []byte("RIFF")) && bytes.Equal(header[8:12], []byte("WAVE")):
		return "wav", nil
	// OggS
	case bytes.Equal(header[0:4], []byte("OggS")):
		return "ogg", nil
	// EBML header → Matroska/WebM container
	case bytes.Equal(header[0:4], []byte{0x1A, 0x45, 0xDF, 0xA3}):
		return "webm", nil
	// ISO-BMFF (mp4/m4a): bytes 4..8 == "ftyp"
	case bytes.Equal(header[4:8], []byte("ftyp")):
		return "mp4", nil
	// MP3: ID3 tag or MPEG audio frame sync (0xFF 0xEx/0xFx)
	case bytes.Equal(header[0:3], []byte("ID3")):
		return "mp3", nil
	case header[0] == 0xFF && (header[1]&0xE0) == 0xE0:
		return "mp3", nil
	default:
		return "", ErrUnsupportedFormat
	}
}
