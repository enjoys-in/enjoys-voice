package handler

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/enjoys-in/enjoys-voice/api/internal/audio"
	"github.com/enjoys-in/enjoys-voice/api/internal/response"
	"github.com/enjoys-in/enjoys-voice/api/internal/service"
	"github.com/gin-gonic/gin"
)

type SoundHandler struct {
	soundSvc   service.SoundService
	uploadDir  string
	ivrDir     string
	transcoder *audio.Transcoder
}

func NewSoundHandler(ss service.SoundService, uploadDir, ivrDir string, transcoder *audio.Transcoder) *SoundHandler {
	return &SoundHandler{soundSvc: ss, uploadDir: uploadDir, ivrDir: ivrDir, transcoder: transcoder}
}

// safeExtToken strips any path separators / unexpected characters from the
// extension before it is used to build a filename. The extension comes from the
// verified JWT (numeric in this system), but this is defense-in-depth so a
// generated path can never traverse directories.
func safeExtToken(ext string) string {
	return strings.Map(func(r rune) rune {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_' || r == '-' {
			return r
		}
		return '_'
	}, ext)
}

func (h *SoundHandler) Upload(c *gin.Context) {
	// Ownership: a sound is always stored for the authenticated caller. Derive
	// the extension from the verified JWT claim (set by the auth middleware),
	// never from client form input, so a user cannot upload to or overwrite
	// another extension's sounds (IDOR).
	ext := c.GetString("extension")
	if ext == "" {
		response.Unauthorized(c, "missing extension claim")
		return
	}
	soundType := c.PostForm("type") // caller_tune | ringtone | ivr
	if soundType != "caller_tune" && soundType != "ringtone" && soundType != "ivr" {
		response.BadRequest(c, "type must be 'caller_tune', 'ringtone', or 'ivr'")
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		response.BadRequest(c, "No file uploaded")
		return
	}

	// IVR prompts are played server-side by FreeSWITCH and MUST be transcoded to
	// the canonical format. Reject early with a clear status if no ffmpeg is
	// available rather than persisting an unplayable upload.
	if soundType == "ivr" && (h.transcoder == nil || !h.transcoder.Enabled()) {
		response.Error(c, 503, "IVR audio transcoding is unavailable on this server")
		return
	}

	// Max 250KB
	if file.Size > 250*1024 {
		response.BadRequest(c, "File too large (max 250KB)")
		return
	}

	// Save the raw upload first; its real type is verified from the bytes below
	// (the client Content-Type header is advisory only and trivially spoofable).
	safeExt := safeExtToken(ext)
	rawExt := filepath.Ext(file.Filename)
	rawName := fmt.Sprintf("%s_%s_%d%s", safeExt, soundType, time.Now().UnixMilli(), rawExt)
	rawPath := filepath.Join(h.uploadDir, rawName)
	if err := c.SaveUploadedFile(file, rawPath); err != nil {
		response.Internal(c, "Failed to save file")
		return
	}

	// Authoritative content check by magic bytes (RIFF/WAVE, OggS, EBML/WebM,
	// ISO-BMFF/mp4, ID3/MPEG). Anything unrecognized is discarded.
	if _, err := audio.SniffAudio(rawPath); err != nil {
		_ = os.Remove(rawPath)
		response.BadRequest(c, "Invalid file. Accepted audio: mp3, wav, ogg, webm, mp4")
		return
	}

	// Final stored path + filename. For non-IVR sounds the validated upload is
	// stored as-is (the browser fetches and resamples those itself). For IVR the
	// upload is normalized to a 16 kHz mono PCM WAV on a FreeSWITCH-readable path
	// and only the .wav is kept.
	storePath := rawPath
	storeName := rawName

	if soundType == "ivr" {
		if err := os.MkdirAll(h.ivrDir, 0o755); err != nil {
			_ = os.Remove(rawPath)
			response.Internal(c, "Failed to prepare IVR directory")
			return
		}
		storeName = fmt.Sprintf("%s_ivr_%d.wav", safeExt, time.Now().UnixMilli())
		storePath = filepath.Join(h.ivrDir, storeName)

		if err := h.transcoder.ToFreeswitchWav(c.Request.Context(), rawPath, storePath); err != nil {
			log.Printf("ivr transcode failed for %s: %v", ext, err)
			_ = os.Remove(rawPath)
			_ = os.Remove(storePath)
			response.Error(c, 502, "Failed to process IVR audio")
			return
		}
		// Only the normalized .wav is retained; drop the original upload.
		_ = os.Remove(rawPath)
	}

	sound, err := h.soundSvc.Upload(c.Request.Context(), ext, soundType, storeName, file.Filename, storePath)
	if err != nil {
		_ = os.Remove(storePath)
		response.Internal(c, "Failed to store sound record")
		return
	}

	response.Created(c, "Sound uploaded", gin.H{
		"filename": sound.Filename,
		"id":       sound.ID,
	})
}

func (h *SoundHandler) GetByExtension(c *gin.Context) {
	ext := c.Param("ext")
	sounds, err := h.soundSvc.GetByExtension(c.Request.Context(), ext)
	if err != nil {
		response.Internal(c, "Failed to fetch sounds")
		return
	}
	response.OK(c, sounds)
}

// Delete removes one of the authenticated user's custom sounds. The owning
// extension is taken from the verified JWT claim (never the client), so a user
// cannot delete another extension's sound by guessing its id (IDOR).
func (h *SoundHandler) Delete(c *gin.Context) {
	ext := c.GetString("extension")
	if ext == "" {
		response.Unauthorized(c, "missing extension claim")
		return
	}
	id, ok := parseID(c.Param("id"))
	if !ok {
		response.BadRequest(c, "Invalid sound id")
		return
	}
	if err := h.soundSvc.Delete(c.Request.Context(), id, ext); err != nil {
		response.NotFound(c, "Sound not found")
		return
	}
	response.Success(c, "Sound deleted", gin.H{"id": id})
}
