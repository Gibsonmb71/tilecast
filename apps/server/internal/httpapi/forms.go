package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/forms"
)

// writeFormError maps a forms domain error to the appropriate HTTP status.
func (s *server) writeFormError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, forms.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "The requested form resource was not found.")
	case errors.Is(err, forms.ErrForbidden):
		writeError(w, http.StatusForbidden, "insufficient_access", "You do not have access to this form.")
	case errors.Is(err, forms.ErrConflict):
		writeError(w, http.StatusConflict, "conflict", "The record was modified by someone else. Reload and try again.")
	case errors.Is(err, forms.ErrValidation):
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", strings.TrimPrefix(err.Error(), "form request is invalid: "))
	default:
		s.internalError(w, r, err)
	}
}

func sessionUser(r *http.Request) auth.User {
	return r.Context().Value(sessionContextKey).(auth.Session).User
}

// authorizeForm enforces a per-form capability, writing the appropriate error and returning false
// when the caller is not permitted. It returns the resolved form id and acting user id.
func (s *server) authorizeForm(w http.ResponseWriter, r *http.Request, need forms.Capability) (uuid.UUID, uuid.UUID, bool) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	user := sessionUser(r)
	allowed, err := s.forms.Authorize(r.Context(), id, user.ID, need)
	if err != nil {
		s.writeFormError(w, r, err)
		return uuid.Nil, uuid.Nil, false
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "insufficient_access", "You do not have access to this form.")
		return uuid.Nil, uuid.Nil, false
	}
	return id, user.ID, true
}

// --- Form definition ---

type createFormRequest struct {
	Name        string           `json:"name"`
	Description string           `json:"description"`
	DraftSchema forms.FormSchema `json:"draftSchema"`
}

func (s *server) createForm(w http.ResponseWriter, r *http.Request) {
	var body createFormRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := sessionUser(r)
	form, err := s.forms.CreateForm(r.Context(), user.ID, forms.FormInput{Name: body.Name, Description: body.Description, DraftSchema: body.DraftSchema})
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": form})
}

func (s *server) getForm(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapViewOwn)
	if !ok {
		return
	}
	form, err := s.forms.GetForm(r.Context(), id, userID)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": form})
}

type draftRequest struct {
	Schema forms.FormSchema `json:"schema"`
}

func (s *server) updateFormDraft(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapManage)
	if !ok {
		return
	}
	var body draftRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	form, err := s.forms.UpdateDraft(r.Context(), id, userID, forms.DraftInput{Schema: body.Schema})
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": form})
}

func (s *server) publishForm(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapManage)
	if !ok {
		return
	}
	revision, err := s.forms.PublishRevision(r.Context(), id, userID)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": revision})
}

func (s *server) configureFormWorkflow(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapManage)
	if !ok {
		return
	}
	var body forms.Workflow
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if err := s.forms.ConfigureWorkflow(r.Context(), id, userID, forms.WorkflowInput{Workflow: body}); err != nil {
		s.writeFormError(w, r, err)
		return
	}
	form, err := s.forms.GetForm(r.Context(), id, userID)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": form})
}

// --- Records ---

func (s *server) listFormRecords(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapViewOwn)
	if !ok {
		return
	}
	query := r.URL.Query()
	page, _ := strconv.Atoi(query.Get("page"))
	pageSize, _ := strconv.Atoi(query.Get("pageSize"))
	filter := forms.RecordFilter{Search: query.Get("search"), Sort: query.Get("sort"), Page: page, PageSize: pageSize}
	if states := strings.TrimSpace(query.Get("states")); states != "" {
		filter.States = strings.Split(states, ",")
	}
	// Scope to the caller's own submissions unless they can view all records.
	canViewAll, err := s.forms.Authorize(r.Context(), id, userID, forms.CapViewAll)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	if !canViewAll {
		filter.SubmittedBy = &userID
	}
	result, err := s.forms.ListRecords(r.Context(), id, filter)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

type recordRequest struct {
	Values       map[string]any `json:"values"`
	DisplayTitle *string        `json:"displayTitle"`
	Priority     *int           `json:"priority"`
	DisplayAt    *time.Time     `json:"displayAt"`
	ExpiresAt    *time.Time     `json:"expiresAt"`
	Version      *int           `json:"version"`
}

func (s *server) createFormRecord(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapSubmit)
	if !ok {
		return
	}
	var body recordRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	record, err := s.forms.CreateRecord(r.Context(), id, userID, recordInput(body))
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": record})
}

func (s *server) getFormRecord(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapViewOwn)
	if !ok {
		return
	}
	recordID, ok := urlUUID(w, r, "recordId")
	if !ok {
		return
	}
	detail, err := s.forms.GetRecord(r.Context(), recordID)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	if detail.DataSourceID != id || !s.recordVisible(r, id, userID, detail.SubmittedBy) {
		writeError(w, http.StatusNotFound, "not_found", "The requested form resource was not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": detail})
}

// recordVisible enforces view_own scoping: a caller without view_all may only see their own
// submissions.
func (s *server) recordVisible(r *http.Request, formID, userID uuid.UUID, submittedBy *uuid.UUID) bool {
	canViewAll, err := s.forms.Authorize(r.Context(), formID, userID, forms.CapViewAll)
	if err != nil {
		return false
	}
	if canViewAll {
		return true
	}
	return submittedBy != nil && *submittedBy == userID
}

func (s *server) updateFormRecord(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapSubmit)
	if !ok {
		return
	}
	recordID, ok := urlUUID(w, r, "recordId")
	if !ok {
		return
	}
	var body recordRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if body.Version == nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "A record version is required for edits.")
		return
	}
	existing, err := s.forms.GetRecord(r.Context(), recordID)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	if existing.DataSourceID != id {
		writeError(w, http.StatusNotFound, "not_found", "The requested form resource was not found.")
		return
	}
	record, err := s.forms.UpdateRecord(r.Context(), recordID, userID, recordInput(body), *body.Version)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": record})
}

func (s *server) deleteFormRecord(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapManage)
	if !ok {
		return
	}
	recordID, ok := urlUUID(w, r, "recordId")
	if !ok {
		return
	}
	existing, err := s.forms.GetRecord(r.Context(), recordID)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	if existing.DataSourceID != id {
		writeError(w, http.StatusNotFound, "not_found", "The requested form resource was not found.")
		return
	}
	if err := s.forms.DeleteRecord(r.Context(), recordID, userID); err != nil {
		s.writeFormError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type transitionRequest struct {
	ToState string `json:"toState"`
	Note    string `json:"note"`
	Version int    `json:"version"`
}

func (s *server) transitionFormRecord(w http.ResponseWriter, r *http.Request) {
	// The specific transition's required capability is enforced inside forms.Transition; the
	// caller only needs to be able to see the form to attempt one.
	id, userID, ok := s.authorizeForm(w, r, forms.CapViewOwn)
	if !ok {
		return
	}
	recordID, ok := urlUUID(w, r, "recordId")
	if !ok {
		return
	}
	var body transitionRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	existing, err := s.forms.GetRecord(r.Context(), recordID)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	if existing.DataSourceID != id {
		writeError(w, http.StatusNotFound, "not_found", "The requested form resource was not found.")
		return
	}
	record, err := s.forms.Transition(r.Context(), recordID, userID, body.ToState, body.Note, body.Version)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": record})
}

type commentRequest struct {
	Body string `json:"body"`
}

func (s *server) addFormRecordComment(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapReview)
	if !ok {
		return
	}
	recordID, ok := urlUUID(w, r, "recordId")
	if !ok {
		return
	}
	var body commentRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	existing, err := s.forms.GetRecord(r.Context(), recordID)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	if existing.DataSourceID != id {
		writeError(w, http.StatusNotFound, "not_found", "The requested form resource was not found.")
		return
	}
	comment, err := s.forms.AddComment(r.Context(), recordID, userID, body.Body)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": comment})
}

type attachmentRequest struct {
	AssetID  uuid.UUID `json:"assetId"`
	FieldKey string    `json:"fieldKey"`
}

func (s *server) attachFormRecordAsset(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapSubmit)
	if !ok {
		return
	}
	recordID, ok := urlUUID(w, r, "recordId")
	if !ok {
		return
	}
	var body attachmentRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	existing, err := s.forms.GetRecord(r.Context(), recordID)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	if existing.DataSourceID != id {
		writeError(w, http.StatusNotFound, "not_found", "The requested form resource was not found.")
		return
	}
	attachment, err := s.forms.AttachAsset(r.Context(), recordID, body.AssetID, userID, body.FieldKey)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": attachment})
}

// --- Views ---

func (s *server) listFormViews(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapViewAll)
	if !ok {
		return
	}
	form, err := s.forms.GetForm(r.Context(), id, userID)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": form.Views})
}

type viewRequest struct {
	Key            string              `json:"key"`
	Name           string              `json:"name"`
	IncludedStates []string            `json:"includedStates"`
	FieldFilters   []forms.FieldFilter `json:"fieldFilters"`
	TimeFilter     forms.TimeFilter    `json:"timeFilter"`
	Sort           []forms.SortRule    `json:"sort"`
	OutputFields   []string            `json:"outputFields"`
	RecordLimit    int                 `json:"recordLimit"`
	Position       int                 `json:"position"`
}

func (s *server) upsertFormView(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapManage)
	if !ok {
		return
	}
	var body viewRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	view, err := s.forms.UpsertView(r.Context(), id, userID, forms.ViewInput{
		Key: body.Key, Name: body.Name, IncludedStates: body.IncludedStates, FieldFilters: body.FieldFilters,
		TimeFilter: body.TimeFilter, Sort: body.Sort, OutputFields: body.OutputFields, RecordLimit: body.RecordLimit, Position: body.Position,
	})
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": view})
}

func (s *server) deleteFormView(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapManage)
	if !ok {
		return
	}
	viewID, ok := urlUUID(w, r, "viewId")
	if !ok {
		return
	}
	if err := s.forms.DeleteView(r.Context(), id, viewID, userID); err != nil {
		s.writeFormError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Grants ---

func (s *server) listFormGrants(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.authorizeForm(w, r, forms.CapManage)
	if !ok {
		return
	}
	grants, err := s.forms.ListGrants(r.Context(), id)
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": grants})
}

type grantRequest struct {
	UserID     uuid.UUID `json:"userId"`
	Capability string    `json:"capability"`
}

func (s *server) setFormGrant(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapManage)
	if !ok {
		return
	}
	var body grantRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	grant, err := s.forms.SetGrant(r.Context(), id, userID, forms.GrantInput{UserID: body.UserID, Capability: forms.Capability(body.Capability)})
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": grant})
}

func (s *server) revokeFormGrant(w http.ResponseWriter, r *http.Request) {
	id, userID, ok := s.authorizeForm(w, r, forms.CapManage)
	if !ok {
		return
	}
	grantID, ok := urlUUID(w, r, "grantId")
	if !ok {
		return
	}
	if err := s.forms.RevokeGrant(r.Context(), id, grantID, userID); err != nil {
		s.writeFormError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Central approvals inbox ---

func (s *server) listApprovals(w http.ResponseWriter, r *http.Request) {
	user := sessionUser(r)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := s.forms.PendingApprovals(r.Context(), user.ID, forms.ApprovalFilter{Limit: limit})
	if err != nil {
		s.writeFormError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"items": items}})
}

func recordInput(body recordRequest) forms.RecordInput {
	return forms.RecordInput{Values: body.Values, DisplayTitle: body.DisplayTitle, Priority: body.Priority, DisplayAt: body.DisplayAt, ExpiresAt: body.ExpiresAt}
}
