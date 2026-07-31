package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/tilecast/tilecast/apps/server/internal/snapshots"
)

const snapshotProofNote = "Captured from Tilecast Player."

func (s *server) listScreenSnapshots(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := s.snapshots.List(r.Context(), id, limit)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	policy := s.snapshots.Policy(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"items":   items,
		"enabled": policy.Enabled,
		// When history is off, an empty list means "not kept", not "nothing
		// happened". Studio needs to be able to tell the difference.
		"retentionDays": policy.RetentionDays,
		"maxPerScreen":  policy.MaxPerScreen,
		"proofNote":     snapshotProofNote,
	}})
}

func (s *server) getScreenSnapshotImage(w http.ResponseWriter, r *http.Request) {
	screenID, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	snapshotID, ok := urlUUID(w, r, "snapshotId")
	if !ok {
		return
	}
	// The screen id is part of the lookup, so the scope middleware on this
	// route also governs the image: a snapshot cannot be fetched through a
	// screen the caller is not authorized for.
	image, err := s.snapshots.GetImage(r.Context(), screenID, snapshotID)
	if errors.Is(err, snapshots.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "That snapshot no longer exists.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	contentType := image.ContentType
	if contentType == "" {
		contentType = "image/jpeg"
	}
	w.Header().Set("Content-Type", contentType)
	// Immutable: a stored snapshot never changes, and the id is unique.
	w.Header().Set("Cache-Control", "private, max-age=86400, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(image.Data)
}

// snapshotUsage reports what the history costs, so an operator sees the size of
// the thing they turned on rather than finding it in a backup.
func (s *server) snapshotUsage(w http.ResponseWriter, r *http.Request) {
	bytes, count, err := s.snapshots.Usage(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"totalBytes": bytes,
		"count":      count,
		"note":       "Snapshots are stored in the database and are included in every backup.",
	}})
}
