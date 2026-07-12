package media

import "strings"

type CompatibilityProfile struct {
	MaxWidth, MaxHeight int
	MaxFrameRate        float64
}
type ProcessingDecision string

const (
	UseOriginal ProcessingDecision = "original"
	Remux       ProcessingDecision = "remux"
	Transcode   ProcessingDecision = "transcode"
)

type CompatibilityDecision struct {
	Action  ProcessingDecision
	Reasons []string
}

func DecideVideo(info VideoInfo, profile CompatibilityProfile) CompatibilityDecision {
	reasons := []string{}
	transcode := false
	if info.VideoCodec != "h264" {
		reasons = append(reasons, "unsupported_video_codec")
		transcode = true
	}
	if info.PixelFormat != "yuv420p" {
		reasons = append(reasons, "unsupported_pixel_format")
		transcode = true
	}
	if info.AudioCodec != "" && info.AudioCodec != "aac" {
		reasons = append(reasons, "unsupported_audio_codec")
		transcode = true
	}
	if info.AudioCodec == "aac" && info.AudioProfile != "" && !strings.EqualFold(info.AudioProfile, "LC") {
		reasons = append(reasons, "unsupported_audio_profile")
		transcode = true
	}
	if info.Width > profile.MaxWidth || info.Height > profile.MaxHeight {
		reasons = append(reasons, "excessive_resolution")
		transcode = true
	}
	if info.FrameRate > profile.MaxFrameRate+0.01 {
		reasons = append(reasons, "excessive_frame_rate")
		transcode = true
	}
	if info.Rotation%360 != 0 {
		reasons = append(reasons, "rotation_metadata")
		transcode = true
	}
	containerMP4 := strings.Contains(info.Container, "mp4") || strings.Contains(info.Container, "mov")
	if !containerMP4 {
		reasons = append(reasons, "unsuitable_container")
	}
	if !info.FastStart {
		reasons = append(reasons, "missing_fast_start")
	}
	if transcode {
		return CompatibilityDecision{Transcode, reasons}
	}
	if !containerMP4 || !info.FastStart {
		return CompatibilityDecision{Remux, reasons}
	}
	return CompatibilityDecision{UseOriginal, reasons}
}
