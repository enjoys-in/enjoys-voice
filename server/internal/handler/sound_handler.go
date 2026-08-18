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

// safeSoundName derives a filesystem-safe .wav name from the user's original
// filename. It drops any directory part, strips the extension, replaces unsafe
// characters (dots included, so no ".." can survive), truncates, and re-adds
// .wav (IVR uploads are always transcoded to WAV). This keeps the stored
// playback path free of traversal sequences.
func safeSoundName(name string) string {
	stem := strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	stem = strings.Map(func(r rune) rune {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_' || r == '-' {
			return r
		}
		return '_'
	}, stem)
	if len(stem) > 60 {
		stem = stem[:60]
	}
	if stem == "" {
		stem = "audio"
	}
	return stem + ".wav"
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
		// Organize IVR prompts per-extension and per-upload so the stored path is
		// stable, human-traceable and collision-free:
		//   <ivrDir>/<ext>/<datetime>/<name>.wav
		// The same tree is bind-mounted into FreeSWITCH, which plays the prompt by
		// this path. Filename holds the sounds-root-relative playback path
		// (<ext>/<datetime>/<name>.wav) that the IVR flow references; Path holds
		// the absolute on-disk location used for cleanup on delete.
		datetime := time.Now().UTC().Format("20060102-150405.000")
		relDir := filepath.Join(safeExt, datetime)
		absDir := filepath.Join(h.ivrDir, relDir)
		if err := os.MkdirAll(absDir, 0o755); err != nil {
			_ = os.Remove(rawPath)
			response.Internal(c, "Failed to prepare IVR directory")
			return
		}
		baseName := safeSoundName(file.Filename)
		storeName = filepath.ToSlash(filepath.Join(relDir, baseName))
		storePath = filepath.Join(absDir, baseName)

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
		"path":     sound.Path,
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

// ListSystemSounds returns the built-in FreeSWITCH sound library grouped by category.
// These are global (not per-extension) and read from the mounted FS sounds dir.
func (h *SoundHandler) ListSystemSounds(c *gin.Context) {
	baseDir := os.Getenv("FS_SYSTEM_SOUNDS_DIR")
	if baseDir == "" {
		baseDir = "../docker/freeswitch_sounds/en/us/callie"
	}
	category := c.Query("category")

	type soundEntry struct {
		Name     string `json:"name"`
		Category string `json:"category"`
		File     string `json:"file"`
	}

	var results []soundEntry
	categories, err := os.ReadDir(baseDir)
	if err != nil {
		log.Printf("system-sounds: cannot read %s: %v", baseDir, err)
		response.OK(c, []any{})
		return
	}
	log.Printf("system-sounds: found %d categories in %s", len(categories), baseDir)
	for _, cat := range categories {
		if !cat.IsDir() {
			continue
		}
		if category != "" && cat.Name() != category {
			continue
		}
		wavDir := filepath.Join(baseDir, cat.Name(), "8000")
		files, err := os.ReadDir(wavDir)
		if err != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".wav") {
				continue
			}
			name := strings.TrimSuffix(f.Name(), ".wav")
			results = append(results, soundEntry{
				Name:     name,
				Category: cat.Name(),
				File:     f.Name(),
			})
		}
	}
	response.OK(c, results)
}
