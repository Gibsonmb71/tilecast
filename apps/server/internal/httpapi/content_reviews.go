package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/approvals"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
)

// listContentReviews returns the review queue. There is no submission step: a
// playlist or published Layout is pending whenever its current revision has no
// decision, so editing approved content puts it back here by itself.
func (s *server) listContentReviews(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	switch state {
	case "", "pending", "approved", "rejected":
	default:
		writeError(w, http.StatusBadRequest, "invalid_state",
			"State must be pending, approved, or rejected.")
		return
	}
	items, err := s.approvals.Queue(r.Context(), state)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"required": s.approvals.Required(r.Context()),
		"items":    items,
	}})
}

type contentReviewRequest struct {
	Approve bool   `json:"approve"`
	Note    string `json:"note,omitempty"`
	// Revision is the revision the reviewer was looking at. The decision is
	// refused when the content has changed since, so an approval can never
	// land on a revision nobody read.
	Revision int64 `json:"revision,omitempty"`
}

func (s *server) decideContentReview(w http.ResponseWriter, r *http.Request) {
	contentType := chi.URLParam(r, "type")
	if contentType != approvals.TypePlaylist && contentType != approvals.TypeLayout {
		writeError(w, http.StatusBadRequest, "invalid_type", "Only a playlist or a Layout can be reviewed.")
		return
	}
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body contentReviewRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	review, err := s.approvals.Decide(r.Context(), user.ID, contentType, id, body.Approve, body.Note, body.Revision)
	switch {
	case errors.Is(err, approvals.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found",
			"That content no longer exists, or the Layout is not published.")
		return
	case errors.Is(err, approvals.ErrValidation):
		writeError(w, http.StatusConflict, "review_invalid",
			strings.TrimPrefix(err.Error(), approvals.ErrValidation.Error()+": "))
		return
	case err != nil:
		s.internalError(w, r, err)
		return
	}
	action := "content.review_rejected"
	if body.Approve {
		action = "content.review_approved"
	}
	_, _ = s.db.Exec(r.Context(), `
		INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,result,summary)
		VALUES($1,$2,$3,$4,$5,'success',$6)`,
		uuid.New(), user.ID, action, contentType, id.String(),
		"Reviewed revision "+strconv.FormatInt(review.Revision, 10))
	writeJSON(w, http.StatusOK, map[string]any{"data": review})
}
