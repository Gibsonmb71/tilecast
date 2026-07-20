package forms

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/media"
)

// farFuture keeps a form out of the media refresh worker; the forms worker reschedules to the
// next time-window boundary instead.
const farFuture = "now()+interval '100 years'"

// RebuildProjection recomputes the cached typed-dataset payload for a form (one dataset per
// saved view) and invalidates affected manifests. Only records that are both in a view's
// included states and output-eligible reach the payload, so unapproved records and their
// attachments never enter a manifest. Time-window filtering is applied at projection time and the
// refresh state is rescheduled to the next boundary so signage updates without a Player round trip
// and stays correct offline.
func (s *Service) RebuildProjection(ctx context.Context, formID uuid.UUID) error {
	views, err := s.listViews(ctx, s.db, formID)
	if err != nil {
		return err
	}
	fieldTypes := map[string]string{}
	fieldLabels := map[string]string{}
	if revision, err := s.loadPublishedRevision(ctx, s.db, formID); err == nil {
		for _, spec := range outputFieldSpecs(revision.Schema) {
			fieldTypes[spec.Key] = spec.Type
			fieldLabels[spec.Key] = spec.Label
		}
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}

	now := time.Now().UTC()
	var nextBoundary *time.Time
	noteBoundary := func(candidate *time.Time) {
		if candidate == nil || !candidate.After(now) {
			return
		}
		if nextBoundary == nil || candidate.Before(*nextBoundary) {
			value := *candidate
			nextBoundary = &value
		}
	}

	payload := media.TypedDatasetPayload{Datasets: []media.TypedDataset{}}
	for _, view := range views {
		dataset, err := s.projectView(ctx, formID, view, fieldTypes, fieldLabels, now, noteBoundary)
		if err != nil {
			return err
		}
		payload.Datasets = append(payload.Datasets, dataset)
	}

	// Schedule a wake at the next expiry among eligible records so the worker can auto-expire them
	// even when no view carries a relative time filter.
	var nextExpiry *time.Time
	if err := s.db.QueryRow(ctx, `SELECT min(expires_at) FROM form_records
		WHERE data_source_id=$1 AND deleted_at IS NULL AND eligible AND expires_at IS NOT NULL AND expires_at>now()`, formID).Scan(&nextExpiry); err != nil {
		return err
	}
	noteBoundary(nextExpiry)

	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	nextRefresh := farFuture
	args := []any{formID, string(encoded), len(payload.Datasets)}
	if nextBoundary != nil {
		nextRefresh = "$4"
		args = append(args, *nextBoundary)
	}
	query := `UPDATE data_source_refresh_states SET next_refresh_at=` + nextRefresh + `,
		last_attempt_at=now(),last_success_at=now(),http_result_category='manual',parse_status='success',
		available_item_count=$3,using_cached_data=FALSE,cache_updated_at=now(),cache_expires_at=now()+interval '100 years',
		cached_payload=$2::jsonb,error_code=NULL,locked_at=NULL,locked_by=NULL,updated_at=now()
		WHERE data_source_id=$1`
	tag, err := s.db.Exec(ctx, query, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Seed the refresh row if it is somehow missing so the form still projects.
		if _, err := s.db.Exec(ctx, `INSERT INTO data_source_refresh_states(data_source_id,next_refresh_at,last_attempt_at,last_success_at,http_result_category,parse_status,available_item_count,using_cached_data,cache_updated_at,cache_expires_at,cached_payload)
			VALUES($1,now()+interval '100 years',now(),now(),'manual','success',$2,FALSE,now(),now()+interval '100 years',$3::jsonb)
			ON CONFLICT(data_source_id) DO NOTHING`, formID, len(payload.Datasets), string(encoded)); err != nil {
			return err
		}
	}
	if s.invalidator != nil {
		return s.invalidator.DataSourceChanged(ctx, formID, "form.projected")
	}
	return nil
}

// projectView builds one typed dataset for a saved view. noteBoundary is called with every future
// display/expiry timestamp among candidate records so the caller can schedule the next rebuild.
func (s *Service) projectView(ctx context.Context, formID uuid.UUID, view View, fieldTypes, fieldLabels map[string]string, now time.Time, noteBoundary func(*time.Time)) (media.TypedDataset, error) {
	dataset := media.TypedDataset{ID: view.Key, Kind: "records", Records: []media.TypedRecord{}, Fields: []media.DataSourceField{}}
	outputFields := view.OutputFields
	if len(outputFields) == 0 {
		// Default to every available field, in a stable order.
		keys := make([]string, 0, len(fieldTypes))
		for key := range fieldTypes {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		outputFields = keys
	}
	for _, key := range outputFields {
		dataset.Fields = append(dataset.Fields, media.DataSourceField{Key: key, Label: fieldLabels[key], Type: fieldTypes[key]})
	}

	// Candidate records: in the view's included states AND output-eligible. This is the safety
	// invariant — no unapproved record can ever reach the payload.
	rows, err := s.db.Query(ctx, `SELECT id,state_key,values,display_title,priority,display_at,expires_at,created_at
		FROM form_records
		WHERE data_source_id=$1 AND deleted_at IS NULL AND eligible AND state_key = ANY($2)
		ORDER BY priority DESC,created_at DESC`, formID, includedStates(view))
	if err != nil {
		return media.TypedDataset{}, err
	}
	defer rows.Close()

	type candidate struct {
		id          uuid.UUID
		state       string
		values      map[string]any
		displayText string
		priority    int
		displayAt   *time.Time
		expiresAt   *time.Time
		createdAt   time.Time
	}
	candidates := []candidate{}
	for rows.Next() {
		var c candidate
		var valuesRaw []byte
		if err := rows.Scan(&c.id, &c.state, &valuesRaw, &c.displayText, &c.priority, &c.displayAt, &c.expiresAt, &c.createdAt); err != nil {
			return media.TypedDataset{}, err
		}
		c.values = map[string]any{}
		if len(valuesRaw) > 0 {
			_ = json.Unmarshal(valuesRaw, &c.values)
		}
		candidates = append(candidates, c)
	}
	if err := rows.Err(); err != nil {
		return media.TypedDataset{}, err
	}

	resolve := func(c candidate, field string) any {
		switch field {
		case "state":
			return c.state
		case "displayTitle":
			return c.displayText
		case "priority":
			return c.priority
		case "submittedAt":
			return c.createdAt.Format(time.RFC3339)
		case "displayAt":
			if c.displayAt != nil {
				return c.displayAt.Format(time.RFC3339)
			}
			return nil
		case "expiresAt":
			if c.expiresAt != nil {
				return c.expiresAt.Format(time.RFC3339)
			}
			return nil
		default:
			return c.values[field]
		}
	}
	resolveTime := func(c candidate, field string) *time.Time {
		switch field {
		case "displayAt":
			return c.displayAt
		case "expiresAt":
			return c.expiresAt
		default:
			if text, ok := c.values[field].(string); ok {
				if parsed, err := time.Parse(time.RFC3339, text); err == nil {
					return &parsed
				}
				if parsed, err := time.Parse("2006-01-02", text); err == nil {
					return &parsed
				}
			}
			return nil
		}
	}

	filtered := candidates[:0]
	for _, c := range candidates {
		// Record every future window boundary so the worker can reschedule a rebuild.
		if view.TimeFilter.Enabled {
			if view.TimeFilter.StartBeforeNow && view.TimeFilter.StartField != "" {
				noteBoundary(resolveTime(c, view.TimeFilter.StartField))
			}
			if view.TimeFilter.EndAfterNow && view.TimeFilter.EndField != "" {
				noteBoundary(resolveTime(c, view.TimeFilter.EndField))
			}
		}
		if !passesFieldFilters(resolve, c, view.FieldFilters) {
			continue
		}
		if !passesTimeFilter(c, view.TimeFilter, resolveTime, now) {
			continue
		}
		filtered = append(filtered, c)
	}

	sortCandidates(filtered, view.Sort, resolve)
	if view.RecordLimit > 0 && len(filtered) > view.RecordLimit {
		filtered = filtered[:view.RecordLimit]
	}

	for _, c := range filtered {
		values := map[string]string{}
		for _, key := range outputFields {
			values[key] = stringifyValue(resolve(c, key))
		}
		dataset.Records = append(dataset.Records, media.TypedRecord{ID: c.id.String(), Values: values})
	}
	return dataset, nil
}

func includedStates(view View) []string {
	if len(view.IncludedStates) == 0 {
		// A view with no explicit states still only ever shows eligible records; scope to the
		// canonical approved state so an empty configuration does not accidentally show nothing.
		return []string{"approved"}
	}
	return view.IncludedStates
}

// passesFieldFilters applies the bounded operator set over a record's resolved values.
func passesFieldFilters[T any](resolve func(T, string) any, c T, filters []FieldFilter) bool {
	for _, filter := range filters {
		actual := stringifyValue(resolve(c, filter.Field))
		switch filter.Operator {
		case "equals":
			if actual != filter.Value {
				return false
			}
		case "not_equals":
			if actual == filter.Value {
				return false
			}
		case "contains":
			if !strings.Contains(strings.ToLower(actual), strings.ToLower(filter.Value)) {
				return false
			}
		case "empty":
			if strings.TrimSpace(actual) != "" {
				return false
			}
		case "not_empty":
			if strings.TrimSpace(actual) == "" {
				return false
			}
		case "greater_than":
			if !numericCompare(actual, filter.Value, true) {
				return false
			}
		case "less_than":
			if !numericCompare(actual, filter.Value, false) {
				return false
			}
		}
	}
	return true
}

func numericCompare(actual, expected string, greater bool) bool {
	a, err1 := strconv.ParseFloat(strings.TrimSpace(actual), 64)
	b, err2 := strconv.ParseFloat(strings.TrimSpace(expected), 64)
	if err1 != nil || err2 != nil {
		return false
	}
	if greater {
		return a > b
	}
	return a < b
}

func passesTimeFilter[T any](c T, filter TimeFilter, resolveTime func(T, string) *time.Time, now time.Time) bool {
	if !filter.Enabled {
		return true
	}
	if filter.StartBeforeNow && filter.StartField != "" {
		start := resolveTime(c, filter.StartField)
		if start != nil && start.After(now) {
			return false
		}
	}
	if filter.EndAfterNow && filter.EndField != "" {
		end := resolveTime(c, filter.EndField)
		if end != nil && !end.After(now) {
			return false
		}
	}
	return true
}

func sortCandidates[T any](items []T, rules []SortRule, resolve func(T, string) any) {
	if len(rules) == 0 {
		return
	}
	sort.SliceStable(items, func(i, j int) bool {
		for _, rule := range rules {
			a := stringifyValue(resolve(items[i], rule.Field))
			b := stringifyValue(resolve(items[j], rule.Field))
			if a == b {
				continue
			}
			less := a < b
			if af, err1 := strconv.ParseFloat(a, 64); err1 == nil {
				if bf, err2 := strconv.ParseFloat(b, 64); err2 == nil {
					less = af < bf
				}
			}
			if rule.Direction == "desc" {
				return !less
			}
			return less
		}
		return false
	})
}
