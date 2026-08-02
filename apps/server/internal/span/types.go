package span

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"github.com/google/uuid"
)

const (
	ModeMirror = "mirror"
	ModeSpan   = "span"
	MinCanvas  = 320
	MaxCanvas  = 16384
	MaxPanels  = 64
)

type Canvas struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// Panel is the persisted geometry for one logical screen in a Span group.
// Bezel values are the physical pixels hidden at each edge when the wall is
// assembled; they are deliberately kept separate from the logical viewport.
type Panel struct {
	ScreenID    uuid.UUID `json:"screenId"`
	PanelOrder  int       `json:"order"`
	X           int       `json:"x"`
	Y           int       `json:"y"`
	Width       int       `json:"width"`
	Height      int       `json:"height"`
	Rotation    int       `json:"rotation"`
	BezelLeft   int       `json:"bezelLeft"`
	BezelTop    int       `json:"bezelTop"`
	BezelRight  int       `json:"bezelRight"`
	BezelBottom int       `json:"bezelBottom"`
	ScreenName  string    `json:"screenName,omitempty"`
}

type Geometry struct {
	Canvas Canvas  `json:"canvas"`
	Panels []Panel `json:"panels"`
}

type Preparation struct {
	ID              uuid.UUID `json:"id"`
	ScreenID        uuid.UUID `json:"screenId"`
	SourceAssetID   uuid.UUID `json:"sourceAssetId"`
	SourceVariantID uuid.UUID `json:"sourceVariantId"`
	Status          string    `json:"status"`
	Progress        *float64  `json:"progress,omitempty"`
	Width           *int      `json:"width,omitempty"`
	Height          *int      `json:"height,omitempty"`
	DurationSeconds *float64  `json:"durationSeconds,omitempty"`
	FrameRate       *float64  `json:"frameRate,omitempty"`
	ErrorCode       *string   `json:"errorCode,omitempty"`
	ErrorMessage    *string   `json:"errorMessage,omitempty"`
	UpdatedAt       string    `json:"updatedAt"`
}

var validRotations = map[int]bool{0: true, 90: true, 180: true, 270: true}

func ValidateMode(mode string) error {
	if mode != ModeMirror && mode != ModeSpan {
		return errors.New("display mode must be mirror or span")
	}
	return nil
}

func ValidateGeometry(canvas Canvas, panels []Panel) error {
	if canvas.Width < MinCanvas || canvas.Width > MaxCanvas || canvas.Height < MinCanvas || canvas.Height > MaxCanvas {
		return fmt.Errorf("Span canvas must be between %d and %d pixels on each side", MinCanvas, MaxCanvas)
	}
	if len(panels) < 1 || len(panels) > MaxPanels {
		return fmt.Errorf("Span geometry must contain between 1 and %d panels", MaxPanels)
	}
	seenScreens := make(map[uuid.UUID]bool, len(panels))
	seenOrders := make(map[int]bool, len(panels))
	for _, panel := range panels {
		if panel.ScreenID == uuid.Nil {
			return errors.New("Span panel must name a screen")
		}
		if seenScreens[panel.ScreenID] {
			return errors.New("Span geometry cannot contain a screen more than once")
		}
		seenScreens[panel.ScreenID] = true
		if panel.PanelOrder < 0 || panel.PanelOrder >= MaxPanels || seenOrders[panel.PanelOrder] {
			return errors.New("Span panel order must be unique and between 0 and 63")
		}
		seenOrders[panel.PanelOrder] = true
		if panel.X < 0 || panel.Y < 0 || panel.Width < 1 || panel.Height < 1 || panel.X+panel.Width > canvas.Width || panel.Y+panel.Height > canvas.Height {
			return errors.New("Span panel geometry must fit inside the logical canvas")
		}
		if !validRotations[panel.Rotation] {
			return errors.New("Span panel rotation must be 0, 90, 180, or 270 degrees")
		}
		if panel.BezelLeft < 0 || panel.BezelTop < 0 || panel.BezelRight < 0 || panel.BezelBottom < 0 || panel.BezelLeft > 500 || panel.BezelTop > 500 || panel.BezelRight > 500 || panel.BezelBottom > 500 {
			return errors.New("Span bezel compensation must be between 0 and 500 pixels")
		}
	}
	ordered := append([]Panel(nil), panels...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].PanelOrder < ordered[j].PanelOrder })
	for i := range ordered {
		for j := i + 1; j < len(ordered); j++ {
			if rectanglesOverlap(ordered[i], ordered[j]) {
				return errors.New("Span panels may not overlap")
			}
		}
	}
	return nil
}

func rectanglesOverlap(a, b Panel) bool {
	return a.X < b.X+b.Width && b.X < a.X+a.Width && a.Y < b.Y+b.Height && b.Y < a.Y+a.Height
}

// Preset returns deterministic non-overlapping geometry. columns=0 chooses a
// compact grid; callers can pass 1 for a vertical wall or 2 for a two-column
// wall. Empty members are rejected by ValidateGeometry, not hidden here.
func Preset(canvas Canvas, screens []uuid.UUID, columns int) []Panel {
	if columns <= 0 {
		columns = 1
		for columns*columns < len(screens) {
			columns++
		}
	}
	if columns > len(screens) {
		columns = len(screens)
	}
	if columns < 1 {
		columns = 1
	}
	rows := (len(screens) + columns - 1) / columns
	result := make([]Panel, 0, len(screens))
	for index, screenID := range screens {
		row, column := index/columns, index%columns
		left := column * canvas.Width / columns
		right := (column + 1) * canvas.Width / columns
		top := row * canvas.Height / rows
		bottom := (row + 1) * canvas.Height / rows
		result = append(result, Panel{ScreenID: screenID, PanelOrder: index, X: left, Y: top, Width: right - left, Height: bottom - top})
	}
	return result
}

func GeometryHash(canvas Canvas, panel Panel) string {
	canonical := struct {
		Canvas Canvas `json:"canvas"`
		Panel  Panel  `json:"panel"`
	}{canvas, panel}
	// ScreenName is display metadata and must never cause a video to be
	// re-encoded. It is cleared before hashing to keep the cache deterministic.
	canonical.Panel.ScreenName = ""
	raw, _ := json.Marshal(canonical)
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}
