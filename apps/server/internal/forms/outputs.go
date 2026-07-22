package forms

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tilecast/tilecast/apps/server/internal/media"
)

// maxOutputPreviewRecords bounds the number of preview records returned per view.
const maxOutputPreviewRecords = 20

// OutputUsage summarizes where a view's dataset is consumed downstream.
type OutputUsage struct {
	Widgets int      `json:"widgets"`
	Layouts int      `json:"layouts"`
	Names   []string `json:"names"`
}

// OutputView is one saved view's generated dataset and status for the Outputs tab. Preview records
// come from the cached projection, which only ever contains output-eligible records.
type OutputView struct {
	Key            string                  `json:"key"`
	Name           string                  `json:"name"`
	Fields         []media.DataSourceField `json:"fields"`
	RecordCount    int                     `json:"recordCount"`
	PreviewRecords []media.TypedRecord     `json:"previewRecords"`
	Usage          OutputUsage             `json:"usage"`
}

// FormOutputs is the Outputs tab payload: per-view datasets plus form-level projection status.
type FormOutputs struct {
	Views         []OutputView `json:"views"`
	LastSuccessAt *time.Time   `json:"lastSuccessAt,omitempty"`
	NextRefreshAt *time.Time   `json:"nextRefreshAt,omitempty"`
	UsingCached   bool         `json:"usingCachedData"`
	ErrorCode     *string      `json:"errorCode,omitempty"`
	Stale         bool         `json:"stale"`
}

// GetOutputs returns the generated datasets for each saved view together with the form's projection
// status (last success, next scheduled refresh/boundary, stale/error). It reads the cached payload
// the Player consumes, so previews never contain unapproved records.
func (s *Service) GetOutputs(ctx context.Context, id uuid.UUID) (FormOutputs, error) {
	if _, err := s.ensureForm(ctx, s.db, id); err != nil {
		return FormOutputs{}, err
	}
	views, err := s.listViews(ctx, s.db, id)
	if err != nil {
		return FormOutputs{}, err
	}
	var raw []byte
	var lastSuccess, nextRefresh *time.Time
	var usingCached bool
	var errorCode *string
	err = s.db.QueryRow(ctx, `SELECT cached_payload,last_success_at,next_refresh_at,using_cached_data,error_code
		FROM data_source_refresh_states WHERE data_source_id=$1`, id).
		Scan(&raw, &lastSuccess, &nextRefresh, &usingCached, &errorCode)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return FormOutputs{}, err
	}
	payload := media.TypedDatasetPayload{Datasets: []media.TypedDataset{}}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &payload)
	}
	byKey := map[string]media.TypedDataset{}
	for _, dataset := range payload.Datasets {
		byKey[dataset.ID] = dataset
	}
	out := FormOutputs{
		Views:         []OutputView{},
		LastSuccessAt: lastSuccess,
		NextRefreshAt: nextRefresh,
		UsingCached:   usingCached,
		ErrorCode:     errorCode,
		Stale:         usingCached || errorCode != nil,
	}
	for _, view := range views {
		dataset := byKey[view.Key]
		records := dataset.Records
		if records == nil {
			records = []media.TypedRecord{}
		}
		preview := records
		if len(preview) > maxOutputPreviewRecords {
			preview = preview[:maxOutputPreviewRecords]
		}
		fields := dataset.Fields
		if fields == nil {
			fields = []media.DataSourceField{}
		}
		usage, err := s.viewUsage(ctx, id, view.Key)
		if err != nil {
			return FormOutputs{}, err
		}
		out.Views = append(out.Views, OutputView{
			Key:            view.Key,
			Name:           view.Name,
			Fields:         fields,
			RecordCount:    len(records),
			PreviewRecords: preview,
			Usage:          usage,
		})
	}
	return out, nil
}

// viewUsage reports how many Widgets reference a form view's dataset.
func (s *Service) viewUsage(ctx context.Context, id uuid.UUID, viewKey string) (OutputUsage, error) {
	return s.datasetUsage(ctx, id, viewKey)
}

// datasetUsage finds the Widgets that reference a specific view's dataset. A Widget names a Form
// dataset by carrying both the Data Source id and the view key in its configuration (only chart
// Widgets select a dataset), so a per-view reference is `dataSourceId==form AND dataset==viewKey`.
// Layout bindings reference a Data Source at the source level (they carry no dataset key), so they
// are not attributable to an individual view and are guarded by the Data Source delete path instead.
func (s *Service) datasetUsage(ctx context.Context, id uuid.UUID, viewKey string) (OutputUsage, error) {
	rows, err := s.db.Query(ctx, `SELECT a.name FROM widgets w
		JOIN assets a ON a.id=w.asset_id AND a.deleted_at IS NULL
		WHERE w.configuration->>'dataSourceId'=$1 AND w.configuration->>'dataset'=$2
		ORDER BY lower(a.name),a.id`, id.String(), viewKey)
	if err != nil {
		return OutputUsage{}, err
	}
	defer rows.Close()
	names := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return OutputUsage{}, err
		}
		names = append(names, "widget "+name)
	}
	if err := rows.Err(); err != nil {
		return OutputUsage{}, err
	}
	return OutputUsage{Widgets: len(names), Layouts: 0, Names: names}, nil
}

// RebuildOutputs re-runs the projection for a form and returns the refreshed Outputs status. The
// projection rebuild invalidates affected manifests via the AssetInvalidator.
func (s *Service) RebuildOutputs(ctx context.Context, id, actor uuid.UUID) (FormOutputs, error) {
	if _, err := s.ensureForm(ctx, s.db, id); err != nil {
		return FormOutputs{}, err
	}
	if err := s.RebuildProjection(ctx, id); err != nil {
		return FormOutputs{}, err
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)
		VALUES($1,$2,'form.output_rebuilt','data_source',$3)`, uuid.New(), actor, id.String()); err != nil {
		return FormOutputs{}, err
	}
	return s.GetOutputs(ctx, id)
}
