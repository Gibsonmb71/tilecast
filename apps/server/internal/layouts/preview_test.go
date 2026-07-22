package layouts

import (
	"bytes"
	"image"
	"image/jpeg"
	"testing"
)

func jpegPreview(t *testing.T, width, height int) []byte {
	t.Helper()
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, width, height)), &jpeg.Options{Quality: 70}); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func TestValidatePreviewImageAcceptsCanvasAspectRatio(t *testing.T) {
	for _, test := range []struct {
		width, height             int
		canvasWidth, canvasHeight int
	}{{960, 540, 1920, 1080}, {540, 960, 1080, 1920}, {960, 746, 1000, 777}} {
		width, height, err := validatePreviewImage(jpegPreview(t, test.width, test.height), test.canvasWidth, test.canvasHeight)
		if err != nil || width != test.width || height != test.height {
			t.Fatalf("preview %dx%d for %dx%d: dimensions=%dx%d err=%v", test.width, test.height, test.canvasWidth, test.canvasHeight, width, height, err)
		}
	}
}

func TestValidatePreviewImageRejectsInvalidImages(t *testing.T) {
	for _, data := range [][]byte{nil, []byte("not jpeg"), jpegPreview(t, 960, 540), jpegPreview(t, 961, 540)} {
		if _, _, err := validatePreviewImage(data, 1080, 1920); err == nil {
			t.Fatal("invalid Layout preview image was accepted")
		}
	}
}
