package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	_ "golang.org/x/image/webp"
)

const MaxImagePixels = 100_000_000

type DetectedType struct{ AssetType, MIMEType, Extension string }

func DetectType(header []byte) (DetectedType, error) {
	switch {
	case len(header) >= 3 && bytes.Equal(header[:3], []byte{0xff, 0xd8, 0xff}):
		return DetectedType{"image", "image/jpeg", ".jpg"}, nil
	case len(header) >= 8 && bytes.Equal(header[:8], []byte("\x89PNG\r\n\x1a\n")):
		return DetectedType{"image", "image/png", ".png"}, nil
	case len(header) >= 12 && string(header[:4]) == "RIFF" && string(header[8:12]) == "WEBP":
		return DetectedType{"image", "image/webp", ".webp"}, nil
	case len(header) >= 6 && (string(header[:6]) == "GIF87a" || string(header[:6]) == "GIF89a"):
		return DetectedType{"image", "image/gif", ".gif"}, nil
	case len(header) >= 12 && string(header[4:8]) == "ftyp":
		return DetectedType{"video", "video/mp4", ".mp4"}, nil
	case len(header) >= 4 && bytes.Equal(header[:4], []byte{0x1a, 0x45, 0xdf, 0xa3}):
		return DetectedType{"video", "video/x-matroska", ".mkv"}, nil
	default:
		return DetectedType{}, ErrUnsupportedType
	}
}

type ImageInfo struct {
	Width, Height int
	Animated      bool
	FrameCount    int
}

func InspectImage(r io.Reader) (ImageInfo, error) {
	config, format, err := image.DecodeConfig(r)
	if err != nil {
		return ImageInfo{}, fmt.Errorf("decode image: %w", err)
	}
	if config.Width <= 0 || config.Height <= 0 || uint64(config.Width)*uint64(config.Height) > MaxImagePixels {
		return ImageInfo{}, errors.New("image dimensions exceed the supported limit")
	}
	info := ImageInfo{Width: config.Width, Height: config.Height, FrameCount: 1}
	if format == "gif" {
		info.FrameCount = 0
		if seeker, ok := r.(io.ReadSeeker); ok {
			end, seekErr := seeker.Seek(0, io.SeekEnd)
			if seekErr == nil && end <= 32<<20 {
				_, _ = seeker.Seek(0, io.SeekStart)
				decoded, decodeErr := gif.DecodeAll(seeker)
				if decodeErr == nil {
					info.FrameCount = len(decoded.Image)
					info.Animated = info.FrameCount > 1
				}
			}
		}
	}
	return info, nil
}

type ProbeResult struct {
	Format struct {
		FormatName string            `json:"format_name"`
		Duration   string            `json:"duration"`
		BitRate    string            `json:"bit_rate"`
		Tags       map[string]string `json:"tags"`
	} `json:"format"`
	Streams []struct {
		CodecType          string            `json:"codec_type"`
		CodecName          string            `json:"codec_name"`
		Profile            string            `json:"profile"`
		Width              int               `json:"width"`
		Height             int               `json:"height"`
		PixFmt             string            `json:"pix_fmt"`
		AvgFrameRate       string            `json:"avg_frame_rate"`
		SampleAspectRatio  string            `json:"sample_aspect_ratio"`
		DisplayAspectRatio string            `json:"display_aspect_ratio"`
		Channels           int               `json:"channels"`
		SampleRate         string            `json:"sample_rate"`
		Tags               map[string]string `json:"tags"`
		SideDataList       []struct {
			Rotation int `json:"rotation"`
		} `json:"side_data_list"`
	} `json:"streams"`
}

type VideoInfo struct {
	Container                            string
	Duration                             float64
	Width, Height                        int
	FrameRate                            float64
	VideoCodec, PixelFormat, AudioCodec  string
	AudioProfile                         string
	AudioChannels                        int
	Rotation                             int
	FastStart                            bool
	DisplayAspectRatio, PixelAspectRatio string
	BitRate                              int64
	AudioSampleRate                      int
}

func ProbeVideo(ctx context.Context, ffprobePath, path string) (VideoInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffprobePath, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_format", "-show_streams", "-of", "json", path)
	output, err := cmd.Output()
	if err != nil {
		return VideoInfo{}, ErrInspectionFailed
	}
	var probe ProbeResult
	if err := json.Unmarshal(output, &probe); err != nil {
		return VideoInfo{}, ErrInspectionFailed
	}
	info := VideoInfo{Container: probe.Format.FormatName}
	info.Duration, _ = strconv.ParseFloat(probe.Format.Duration, 64)
	info.BitRate, _ = strconv.ParseInt(probe.Format.BitRate, 10, 64)
	for _, stream := range probe.Streams {
		if stream.CodecType == "video" && info.VideoCodec == "" {
			info.VideoCodec, info.PixelFormat, info.Width, info.Height = stream.CodecName, stream.PixFmt, stream.Width, stream.Height
			info.FrameRate = parseRate(stream.AvgFrameRate)
			info.DisplayAspectRatio, info.PixelAspectRatio = stream.DisplayAspectRatio, stream.SampleAspectRatio
			if v, ok := stream.Tags["rotate"]; ok {
				info.Rotation, _ = strconv.Atoi(v)
			}
			for _, side := range stream.SideDataList {
				if side.Rotation != 0 {
					info.Rotation = side.Rotation
				}
			}
		}
		if stream.CodecType == "audio" && info.AudioCodec == "" {
			info.AudioCodec, info.AudioProfile, info.AudioChannels = stream.CodecName, stream.Profile, stream.Channels
			info.AudioSampleRate, _ = strconv.Atoi(stream.SampleRate)
		}
	}
	if info.VideoCodec == "" || info.Width <= 0 || info.Height <= 0 {
		return VideoInfo{}, ErrInspectionFailed
	}
	// FFprobe does not expose atom position directly. The processor performs a fast-start remux
	// unless the compatibility inspection has independently marked the source as fast-start.
	info.FastStart = hasFastStart(path)
	return info, nil
}

func hasFastStart(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	header := make([]byte, 4<<20)
	n, _ := file.Read(header)
	moov := bytes.Index(header[:n], []byte("moov"))
	mdat := bytes.Index(header[:n], []byte("mdat"))
	return moov >= 0 && (mdat < 0 || moov < mdat)
}

func parseRate(value string) float64 {
	parts := strings.Split(value, "/")
	if len(parts) == 2 {
		n, _ := strconv.ParseFloat(parts[0], 64)
		d, _ := strconv.ParseFloat(parts[1], 64)
		if d != 0 {
			return n / d
		}
	}
	valueFloat, _ := strconv.ParseFloat(value, 64)
	return valueFloat
}
