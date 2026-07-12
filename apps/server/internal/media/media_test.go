package media

import (
	"bytes"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestAssetTransitions(t *testing.T) {
	if !CanTransitionAsset(StatusQueued, StatusInspecting) || !CanTransitionAsset(StatusFailed, StatusQueued) {
		t.Fatal("expected valid processing transitions")
	}
	if CanTransitionAsset(StatusReady, StatusProcessing) || CanTransitionAsset(StatusDeleted, StatusReady) {
		t.Fatal("accepted invalid processing transition")
	}
}

func TestUploadTransitions(t *testing.T) {
	if !CanTransitionUpload(UploadPending, UploadUploading) || !CanTransitionUpload(UploadUploading, UploadFinalizing) || !CanTransitionUpload(UploadFinalizing, UploadFinalized) {
		t.Fatal("expected valid upload transitions")
	}
	if CanTransitionUpload(UploadFinalized, UploadUploading) {
		t.Fatal("finalized upload must be terminal")
	}
}

func TestLocalStorageContainmentAndKeys(t *testing.T) {
	storage, err := NewLocalStorage(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"../outside", "/tmp/outside", `uploads\outside`} {
		if _, err := storage.Path(key); err == nil {
			t.Fatalf("accepted unsafe key %q", key)
		}
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(storage.root, "variants", "linked")); err != nil {
		t.Fatal(err)
	}
	if _, err := storage.Path("variants/linked/escape.bin"); err == nil {
		t.Fatal("accepted a path traversing a symlink")
	}
	assetID, variantID := uuid.New(), uuid.New()
	for _, key := range []string{UploadKey(assetID), OriginalKey(assetID, ".png"), VariantKey(assetID, variantID, ".mp4"), PreviewKey(assetID, variantID, false)} {
		path, err := storage.Path(key)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(path, assetID.String()) {
			t.Fatalf("key is not generated from asset id: %s", path)
		}
	}
}

func TestLocalStorageAtomicCommitAndCapacity(t *testing.T) {
	storage, err := NewLocalStorage(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.New()
	key := UploadKey(id)
	file, err := storage.CreateUpload(key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.Write([]byte("tilecast")); err != nil {
		t.Fatal(err)
	}
	if err = file.Sync(); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	final := OriginalKey(id, ".png")
	if err = storage.Commit(key, final); err != nil {
		t.Fatal(err)
	}
	if _, err = storage.Stat(key); !os.IsNotExist(err) {
		t.Fatalf("temporary file remains: %v", err)
	}
	if info, err := storage.Stat(final); err != nil || info.Size() != 8 {
		t.Fatalf("unexpected committed file: %v %#v", err, info)
	}
	if available, err := storage.AvailableBytes(); err != nil || available == 0 {
		t.Fatalf("capacity check failed: %d %v", available, err)
	}
}

func TestDetectSupportedTypesIgnoresExtension(t *testing.T) {
	cases := []struct {
		header     []byte
		mime, kind string
	}{{[]byte("\xff\xd8\xffrest"), "image/jpeg", "image"}, {[]byte("\x89PNG\r\n\x1a\nrest"), "image/png", "image"}, {append([]byte("RIFF0000WEBP"), 0), "image/webp", "image"}, {[]byte("GIF89arest"), "image/gif", "image"}, {[]byte("0000ftypisom"), "video/mp4", "video"}, {[]byte{0x1a, 0x45, 0xdf, 0xa3}, "video/x-matroska", "video"}}
	for _, tc := range cases {
		got, err := DetectType(tc.header)
		if err != nil || got.MIMEType != tc.mime || got.AssetType != tc.kind {
			t.Fatalf("detection = %#v, %v", got, err)
		}
	}
	if _, err := DetectType([]byte("#EXTM3U")); err == nil {
		t.Fatal("accepted playlist")
	}
}

func TestInspectImageAndPixelLimit(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 32, 18))); err != nil {
		t.Fatal(err)
	}
	info, err := InspectImage(bytes.NewReader(encoded.Bytes()))
	if err != nil || info.Width != 32 || info.Height != 18 {
		t.Fatalf("unexpected info %#v %v", info, err)
	}
	// A valid PNG header with unreasonably large IHDR dimensions must be rejected before pixel decoding.
	data := append([]byte(nil), encoded.Bytes()...)
	copy(data[16:20], []byte{0x00, 0x01, 0x86, 0xa0})
	copy(data[20:24], []byte{0x00, 0x01, 0x86, 0xa0})
	if _, err := InspectImage(bytes.NewReader(data)); err == nil {
		t.Fatal("accepted image exceeding pixel limit")
	}
}

func TestCompatibilityDecisions(t *testing.T) {
	profile := CompatibilityProfile{MaxWidth: 1920, MaxHeight: 1080, MaxFrameRate: 60}
	compatible := VideoInfo{Container: "mov,mp4,m4a", VideoCodec: "h264", PixelFormat: "yuv420p", AudioCodec: "aac", Width: 1920, Height: 1080, FrameRate: 60, FastStart: true}
	if got := DecideVideo(compatible, profile); got.Action != UseOriginal {
		t.Fatalf("compatible video decision: %#v", got)
	}
	compatible.FastStart = false
	if got := DecideVideo(compatible, profile); got.Action != Remux {
		t.Fatalf("fast-start decision: %#v", got)
	}
	compatible.VideoCodec = "vp9"
	compatible.Width = 3840
	if got := DecideVideo(compatible, profile); got.Action != Transcode {
		t.Fatalf("incompatible decision: %#v", got)
	}
}

func TestETagStable(t *testing.T) {
	if got := ETag("AABBcc"); got != `"sha256-aabbcc"` {
		t.Fatalf("etag=%q", got)
	}
}

func TestWriteAtomic(t *testing.T) {
	storage, err := NewLocalStorage(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key := filepath.ToSlash(filepath.Join("variants", uuid.NewString(), "test.bin"))
	if err := storage.WriteAtomic(key, func(w io.Writer) error { _, err := w.Write([]byte("ready")); return err }); err != nil {
		t.Fatal(err)
	}
	f, err := storage.Open(key)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	buffer := make([]byte, 5)
	if _, err = f.Read(buffer); err != nil || string(buffer) != "ready" {
		t.Fatalf("atomic output %q %v", buffer, err)
	}
}
