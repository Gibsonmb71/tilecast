package presentations

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
)

var (
	ErrNotFound = errors.New("presentation override not found")
	ErrConflict = errors.New("presentation override conflicts with another presentation")
	ErrInvalid  = errors.New("presentation override is invalid")
)

// Override is the dashboard-facing record for a Quick Present session.
type Override struct {
	ID           uuid.UUID  `json:"id"`
	TargetType   string     `json:"targetType"`
	TargetID     uuid.UUID  `json:"targetId"`
	TargetName   string     `json:"targetName"`
	ContentType  string     `json:"contentType"`
	ContentID    uuid.UUID  `json:"contentId"`
	ContentName  string     `json:"contentName"`
	DurationSecs int        `json:"durationSeconds"`
	StartedAt    time.Time  `json:"startedAt"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	AfterAction  string     `json:"afterAction"`
	WakeDisplay  bool       `json:"wakeDisplay"`
	StoppedAt    *time.Time `json:"stoppedAt,omitempty"`
	StopReason   string     `json:"stopReason,omitempty"`
}

type CreateInput struct {
	TargetType  string
	TargetID    uuid.UUID
	ContentType string
	ContentID   uuid.UUID
	Duration    time.Duration
	AfterAction string
	WakeDisplay bool
	CreatedBy   uuid.UUID
}

// ManifestProjection is deliberately shaped for the playlist package. The
// server stores a generic content reference, while the Player receives the
// same concrete playlist/layout graph it already knows how to render.
func (o Override) ManifestProjection() playlists.PresentationOverride {
	return playlists.PresentationOverride{
		ID:          o.ID,
		TargetType:  o.TargetType,
		TargetID:    o.TargetID,
		ContentType: o.ContentType,
		ContentID:   o.ContentID,
		ContentName: o.ContentName,
		StartedAt:   o.StartedAt,
		ExpiresAt:   o.ExpiresAt,
		WakeDisplay: o.WakeDisplay,
	}
}
