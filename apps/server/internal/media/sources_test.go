package media

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestYouTubeSourceNormalizesVideoAndPlaylistURLs(t *testing.T) {
	provider := youtubeSourceProvider{service: &Service{}}
	video, err := provider.Normalize(context.Background(), json.RawMessage(`{"url":"https://youtu.be/dQw4w9WgXcQ","volume":75}`))
	if err != nil {
		t.Fatal(err)
	}
	videoConfig := video.(YouTubeConfig)
	if videoConfig.Kind != "video" || videoConfig.VideoID != "dQw4w9WgXcQ" {
		t.Fatalf("unexpected video configuration: %#v", videoConfig)
	}
	playlist, err := provider.Normalize(context.Background(), json.RawMessage(`{"url":"https://www.youtube.com/playlist?list=PL1234567890","loop":true}`))
	if err != nil {
		t.Fatal(err)
	}
	playlistConfig := playlist.(YouTubeConfig)
	if playlistConfig.Kind != "playlist" || playlistConfig.PlaylistID != "PL1234567890" {
		t.Fatalf("unexpected playlist configuration: %#v", playlistConfig)
	}
}

func TestYouTubeSourceRejectsUnsupportedAndMalformedConfiguration(t *testing.T) {
	provider := youtubeSourceProvider{service: &Service{}}
	for _, raw := range []string{
		`{"url":"https://example.com/watch?v=dQw4w9WgXcQ"}`,
		`{"url":"http://youtube.com/watch?v=dQw4w9WgXcQ"}`,
		`{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ","unknown":true}`,
		`{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ","startSeconds":20,"endSeconds":10}`,
	} {
		if _, err := provider.Normalize(context.Background(), json.RawMessage(raw)); err == nil {
			t.Fatalf("expected configuration to be rejected: %s", raw)
		}
	}
}

func TestSourceConfigurationRequiresOneJSONObject(t *testing.T) {
	var config YouTubeConfig
	err := decodeSourceConfig(json.RawMessage(`{"url":"https://youtu.be/dQw4w9WgXcQ"} {}`), &config)
	if err == nil || !strings.Contains(err.Error(), "one JSON object") {
		t.Fatalf("expected one-object error, got %v", err)
	}
}
