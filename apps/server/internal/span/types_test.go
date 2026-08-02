package span

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestPresetArrangements(t *testing.T) {
	screens := []uuid.UUID{uuid.New(), uuid.New(), uuid.New(), uuid.New()}
	canvas := Canvas{Width: 3840, Height: 2160}
	for _, tc := range []struct {
		name    string
		members int
		columns int
		width   int
		height  int
	}{
		{name: "2x1", members: 2, columns: 2, width: 1920, height: 2160},
		{name: "1x2", members: 2, columns: 1, width: 3840, height: 1080},
		{name: "2x2", members: 4, columns: 2, width: 1920, height: 1080},
	} {
		panels := Preset(canvas, screens[:tc.members], tc.columns)
		if err := ValidateGeometry(canvas, panels); err != nil {
			t.Fatalf("%s geometry invalid: %v", tc.name, err)
		}
		if panels[0].Width != tc.width || panels[0].Height != tc.height {
			t.Fatalf("%s first panel = %dx%d, want %dx%d", tc.name, panels[0].Width, panels[0].Height, tc.width, tc.height)
		}
	}
}

func TestValidateGeometryRejectsOverlapAndInvalidRotation(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	canvas := Canvas{Width: 1920, Height: 1080}
	if err := ValidateGeometry(canvas, []Panel{
		{ScreenID: a, PanelOrder: 0, X: 0, Y: 0, Width: 1200, Height: 1080},
		{ScreenID: b, PanelOrder: 1, X: 1000, Y: 0, Width: 920, Height: 1080},
	}); err == nil {
		t.Fatal("overlapping panels were accepted")
	}
	if err := ValidateGeometry(canvas, []Panel{{ScreenID: a, PanelOrder: 0, X: 0, Y: 0, Width: 1920, Height: 1080, Rotation: 45}}); err == nil {
		t.Fatal("invalid rotation was accepted")
	}
}

func TestGeometryHashIgnoresDisplayName(t *testing.T) {
	canvas := Canvas{Width: 3840, Height: 1080}
	p := Panel{ScreenID: uuid.New(), PanelOrder: 0, X: 0, Y: 0, Width: 1920, Height: 1080}
	first := GeometryHash(canvas, p)
	p.ScreenName = "Renamed screen"
	if second := GeometryHash(canvas, p); first != second {
		t.Fatalf("display name changed geometry hash: %s != %s", first, second)
	}
}

func TestPanelFFmpegArgsAreBoundedAndSynchronized(t *testing.T) {
	panel := Panel{ScreenID: uuid.New(), PanelOrder: 1, X: 1920, Y: 0, Width: 1920, Height: 1080, Rotation: 90, BezelLeft: 2, BezelRight: 2}
	args, err := PanelFFmpegArgs("/media/source.mp4", "/media/output.mp4", Canvas{Width: 3840, Height: 1080}, panel)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, expected := range []string{"-fps_mode cfr", "-g 60", "-keyint_min 60", "-force_key_frames expr:gte(t,n_forced*2)", "transpose=1", "scale=1920:1080"} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("ffmpeg args missing %q: %s", expected, joined)
		}
	}
	if _, err := PanelFFmpegArgs("source", "output", Canvas{Width: 1920, Height: 1080}, Panel{ScreenID: uuid.New(), PanelOrder: 0, Width: 10, Height: 10, BezelLeft: 10}); err == nil {
		t.Fatal("bezel compensation that removes a panel was accepted")
	}
}
