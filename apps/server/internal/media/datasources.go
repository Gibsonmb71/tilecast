package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// dataSourceProvider returns the normalizer for one Data Source provider.
func (s *Service) dataSourceProvider(name string) (configNormalizer, error) {
	switch name {
	case "calendar":
		return calendarSourceProvider{s}, nil
	case "rss", "atom", "json", "csv":
		return structuredSourceProvider{s, name}, nil
	default:
		return nil, errors.New("data source provider is not supported")
	}
}

func (s *Service) CreateDataSource(ctx context.Context, user uuid.UUID, input DataSourceInput) (DataSource, error) {
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	if input.Name == "" || len(input.Name) > 180 || len(input.Description) > 2000 {
		return DataSource{}, errors.New("data source name or description is invalid")
	}
	provider, err := s.dataSourceProvider(input.Provider)
	if err != nil {
		return DataSource{}, err
	}
	configuration, err := provider.Normalize(ctx, input.Configuration)
	if err != nil {
		return DataSource{}, err
	}
	encoded, _ := json.Marshal(configuration)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return DataSource{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var organizationID uuid.UUID
	if err = tx.QueryRow(ctx, `SELECT id FROM organization_settings WHERE singleton`).Scan(&organizationID); err != nil {
		return DataSource{}, err
	}
	id := uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO data_sources(id,organization_id,name,description,provider,config_version,configuration,created_by) VALUES($1,$2,$3,$4,$5,1,$6::jsonb,$7)`, id, organizationID, input.Name, input.Description, input.Provider, string(encoded), user); err != nil {
		return DataSource{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO data_source_refresh_states(data_source_id) VALUES($1)`, id); err != nil {
		return DataSource{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'data_source.created','data_source',$3,jsonb_build_object('provider',$4::text))`, uuid.New(), user, id.String(), input.Provider); err != nil {
		return DataSource{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return DataSource{}, err
	}
	return s.GetDataSource(ctx, id)
}

func (s *Service) UpdateDataSource(ctx context.Context, id, user uuid.UUID, input DataSourceInput) (DataSource, error) {
	existing, err := s.rawDataSource(ctx, id)
	if err != nil {
		return DataSource{}, err
	}
	if input.Provider == "" {
		input.Provider = existing.Provider
	}
	if input.Provider != existing.Provider {
		return DataSource{}, errors.New("data source provider cannot be changed")
	}
	// Preserve previously uploaded CSV content when the client omits it on update.
	if input.Provider == "csv" {
		var incoming StructuredSourceConfig
		if json.Unmarshal(input.Configuration, &incoming) == nil && incoming.Uploaded && incoming.UploadedContent == "" {
			var previous StructuredSourceConfig
			if json.Unmarshal(existing.Configuration, &previous) == nil {
				incoming.UploadedContent = previous.UploadedContent
				input.Configuration, _ = json.Marshal(incoming)
			}
		}
	}
	provider, err := s.dataSourceProvider(input.Provider)
	if err != nil {
		return DataSource{}, err
	}
	configuration, err := provider.Normalize(ctx, input.Configuration)
	if err != nil {
		return DataSource{}, err
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 180 || len(input.Description) > 2000 {
		return DataSource{}, errors.New("data source name or description is invalid")
	}
	encoded, _ := json.Marshal(configuration)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return DataSource{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	tag, err := tx.Exec(ctx, `UPDATE data_sources SET name=$2,description=$3,configuration=$4::jsonb,config_version=1,updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id, input.Name, strings.TrimSpace(input.Description), string(encoded))
	if err != nil || tag.RowsAffected() == 0 {
		return DataSource{}, ErrNotFound
	}
	if _, err = tx.Exec(ctx, `INSERT INTO data_source_refresh_states(data_source_id,next_refresh_at) VALUES($1,now()) ON CONFLICT(data_source_id) DO UPDATE SET next_refresh_at=now(),error_code=NULL,locked_at=NULL,locked_by=NULL,updated_at=now()`, id); err != nil {
		return DataSource{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id) VALUES($1,$2,'data_source.updated','data_source',$3)`, uuid.New(), user, id.String()); err != nil {
		return DataSource{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return DataSource{}, err
	}
	if s.invalidator != nil {
		_ = s.invalidator.DataSourceChanged(ctx, id, "data_source.updated")
	}
	return s.GetDataSource(ctx, id)
}

func (s *Service) DuplicateDataSource(ctx context.Context, id, user uuid.UUID) (DataSource, error) {
	existing, err := s.rawDataSource(ctx, id)
	if err != nil {
		return DataSource{}, err
	}
	return s.CreateDataSource(ctx, user, DataSourceInput{Provider: existing.Provider, Name: existing.Name + " copy", Description: existing.Description, Configuration: existing.Configuration})
}

const dataSourceSelect = `SELECT d.id,d.provider,d.name,d.description,d.config_version,d.configuration,u.id,u.name,d.created_at,d.updated_at FROM data_sources d LEFT JOIN users u ON u.id=d.created_by`

func scanDataSource(row rowScanner) (DataSource, error) {
	var d DataSource
	var creatorID *uuid.UUID
	var creatorName *string
	if err := row.Scan(&d.ID, &d.Provider, &d.Name, &d.Description, &d.ConfigVersion, &d.Configuration, &creatorID, &creatorName, &d.CreatedAt, &d.UpdatedAt); err != nil {
		return DataSource{}, err
	}
	if creatorID != nil {
		d.Creator = &Creator{ID: *creatorID, Name: *creatorName}
	}
	return d, nil
}

// rawDataSource returns the stored Data Source including any uploaded CSV payload.
func (s *Service) rawDataSource(ctx context.Context, id uuid.UUID) (DataSource, error) {
	d, err := scanDataSource(s.db.QueryRow(ctx, dataSourceSelect+` WHERE d.id=$1 AND d.deleted_at IS NULL`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return DataSource{}, ErrNotFound
	}
	return d, err
}

// GetDataSource returns the Data Source with bulky uploaded content stripped for the API.
func (s *Service) GetDataSource(ctx context.Context, id uuid.UUID) (DataSource, error) {
	d, err := s.rawDataSource(ctx, id)
	if err != nil {
		return DataSource{}, err
	}
	d.Configuration = stripUploadedContent(d.Provider, d.Configuration)
	return d, nil
}

// PreviewDataSourceByID resolves a saved Data Source using its full stored
// configuration, including any uploaded CSV payload that the API responses strip.
// It returns the same StructuredPreview/CalendarPreview shape the provider preview
// endpoint produces so consumers (e.g. the Layout preview) get the Player's records.
func (s *Service) PreviewDataSourceByID(ctx context.Context, id uuid.UUID, previewDate string) (any, error) {
	raw, err := s.rawDataSource(ctx, id)
	if err != nil {
		return nil, err
	}
	if raw.Provider == "calendar" {
		return s.CalendarPreview(ctx, raw.Configuration)
	}
	return s.StructuredPreview(ctx, raw.Provider, raw.Configuration, previewDate)
}

func stripUploadedContent(provider string, raw json.RawMessage) json.RawMessage {
	if provider != "csv" {
		return raw
	}
	var config map[string]any
	if json.Unmarshal(raw, &config) == nil {
		if _, uploaded := config["uploadedContent"]; uploaded {
			delete(config, "uploadedContent")
			config["uploaded"] = true
			if encoded, err := json.Marshal(config); err == nil {
				return encoded
			}
		}
	}
	return raw
}

func (s *Service) ListDataSources(ctx context.Context, o DataSourceListOptions) (DataSourceListResult, error) {
	if o.Page < 1 {
		o.Page = 1
	}
	if o.PageSize < 1 {
		o.PageSize = 24
	}
	if o.PageSize > 100 {
		o.PageSize = 100
	}
	sortSQL := "d.updated_at DESC,d.id DESC"
	switch o.Sort {
	case "oldest":
		sortSQL = "d.created_at ASC,d.id ASC"
	case "name":
		sortSQL = "lower(d.name) ASC,d.id ASC"
	}
	where := []string{"d.deleted_at IS NULL"}
	args := []any{}
	add := func(query string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(query, len(args)))
	}
	if q := strings.TrimSpace(o.Search); q != "" {
		add("d.name ILIKE '%%' || $%d || '%%'", q)
	}
	if o.Provider != "" {
		add("d.provider=$%d", o.Provider)
	}
	clause := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(ctx, "SELECT count(*) FROM data_sources d WHERE "+clause, args...).Scan(&total); err != nil {
		return DataSourceListResult{}, err
	}
	args = append(args, o.PageSize, (o.Page-1)*o.PageSize)
	rows, err := s.db.Query(ctx, dataSourceSelect+" WHERE "+clause+" ORDER BY "+sortSQL+fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)-1, len(args)), args...)
	if err != nil {
		return DataSourceListResult{}, err
	}
	defer rows.Close()
	items := []DataSource{}
	for rows.Next() {
		d, err := scanDataSource(rows)
		if err != nil {
			return DataSourceListResult{}, err
		}
		d.Configuration = stripUploadedContent(d.Provider, d.Configuration)
		items = append(items, d)
	}
	return DataSourceListResult{Items: items, Total: total, Page: o.Page, PageSize: o.PageSize}, rows.Err()
}

// GetDataSourceDetail assembles the full Data Source detail view.
func (s *Service) GetDataSourceDetail(ctx context.Context, id uuid.UUID) (DataSourceDetail, error) {
	raw, err := s.rawDataSource(ctx, id)
	if err != nil {
		return DataSourceDetail{}, err
	}
	detail := DataSourceDetail{DataSource: raw}
	detail.Configuration = stripUploadedContent(raw.Provider, raw.Configuration)
	detail.Diagnostics, err = s.DataSourceRefreshDiagnostics(ctx, id)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return DataSourceDetail{}, err
	}
	detail.Diagnostics.DataSourceID = id
	detail.Fields = availableDataSourceFields(raw.Provider, raw.Configuration)
	detail.CachedRecords = detail.Diagnostics.AvailableEventCount + detail.Diagnostics.AvailableItemCount
	detail.Status = dataSourceStatus(detail.Diagnostics)
	if raw.Provider != "calendar" {
		var config StructuredSourceConfig
		if json.Unmarshal(raw.Configuration, &config) == nil && config.DateSelection.Enabled {
			selection := config.DateSelection
			detail.DateSelection = &selection
		}
	}
	detail.WidgetUsage, err = s.dataSourceWidgetUsage(ctx, id)
	if err != nil {
		return DataSourceDetail{}, err
	}
	detail.BindingUsage, err = s.dataSourceBindingUsage(ctx, id)
	if err != nil {
		return DataSourceDetail{}, err
	}
	return detail, nil
}

func dataSourceStatus(d DataSourceDiagnostics) string {
	switch {
	case d.ErrorCode != nil && !d.UsingCachedData:
		return "error"
	case d.UsingCachedData:
		return "stale"
	case d.LastSuccessfulAt != nil:
		return "ready"
	default:
		return "pending"
	}
}

// dataSourceProviderAndFields returns the provider and the set of selectable field keys.
func (s *Service) dataSourceProviderAndFields(ctx context.Context, id uuid.UUID) (string, map[string]bool, error) {
	var provider string
	var configuration json.RawMessage
	err := s.db.QueryRow(ctx, `SELECT provider,configuration FROM data_sources WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&provider, &configuration)
	if err != nil {
		return "", nil, err
	}
	fields := map[string]bool{}
	for _, f := range availableDataSourceFields(provider, configuration) {
		fields[f.Key] = true
	}
	return provider, fields, nil
}

// availableDataSourceFields derives the typed field schema a Data Source exposes.
func availableDataSourceFields(provider string, raw json.RawMessage) []DataSourceField {
	fields := []DataSourceField{}
	if provider == "calendar" {
		var config CalendarConfig
		_ = json.Unmarshal(raw, &config)
		add := func(on bool, key, label, typ string) {
			if on {
				fields = append(fields, DataSourceField{Key: key, Label: label, Type: typ})
			}
		}
		add(config.Fields.Title, "title", "Title", "text")
		add(config.Fields.StartTime, "startTime", "Start time", "datetime")
		add(config.Fields.EndTime, "endTime", "End time", "datetime")
		add(config.Fields.Date, "date", "Date", "date")
		add(config.Fields.Location, "location", "Location", "text")
		add(config.Fields.DescriptionExcerpt, "descriptionExcerpt", "Description", "text")
		return fields
	}
	var config StructuredSourceConfig
	_ = json.Unmarshal(raw, &config)
	add := func(on bool, key, label, typ string) {
		if on {
			fields = append(fields, DataSourceField{Key: key, Label: label, Type: typ})
		}
	}
	add(config.Fields.Title, "title", "Title", "text")
	add(config.Fields.Subtitle, "subtitle", "Subtitle", "text")
	add(config.Fields.Date, "date", "Date", "date")
	add(config.Fields.Author, "author", "Author", "text")
	add(config.Fields.Description, "description", "Description", "text")
	add(config.Fields.Image, "imageUrl", "Image", "url")
	add(config.Fields.Link, "link", "Link", "url")
	if config.Mapping != nil {
		for name := range config.Mapping.ValueFields {
			fields = append(fields, DataSourceField{Key: name, Label: name, Type: "text"})
		}
	}
	return fields
}

func (s *Service) dataSourceWidgetUsage(ctx context.Context, id uuid.UUID) ([]DataSourceWidgetUsage, error) {
	rows, err := s.db.Query(ctx, `SELECT a.id,a.name,w.provider FROM widgets w JOIN assets a ON a.id=w.asset_id AND a.deleted_at IS NULL WHERE w.configuration->>'dataSourceId'=$1::text ORDER BY lower(a.name),a.id`, id.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	usage := []DataSourceWidgetUsage{}
	for rows.Next() {
		var u DataSourceWidgetUsage
		if err = rows.Scan(&u.ID, &u.Name, &u.Provider); err != nil {
			return nil, err
		}
		usage = append(usage, u)
	}
	return usage, rows.Err()
}

func (s *Service) dataSourceBindingUsage(ctx context.Context, id uuid.UUID) ([]DataSourceBindingUsage, error) {
	rows, err := s.db.Query(ctx, `SELECT DISTINCT l.id,l.name FROM layouts l WHERE l.deleted_at IS NULL AND (EXISTS(SELECT 1 FROM layout_draft_dependencies d WHERE d.layout_id=l.id AND d.dependency_id=$1 AND d.dependency_type='data_source') OR EXISTS(SELECT 1 FROM layout_revisions r JOIN layout_revision_dependencies d ON d.revision_id=r.id WHERE r.layout_id=l.id AND d.dependency_id=$1 AND d.dependency_type='data_source')) ORDER BY l.name`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	usage := []DataSourceBindingUsage{}
	for rows.Next() {
		var u DataSourceBindingUsage
		if err = rows.Scan(&u.LayoutID, &u.LayoutName); err != nil {
			return nil, err
		}
		usage = append(usage, u)
	}
	return usage, rows.Err()
}

// DeleteDataSource removes a Data Source, refusing when a Widget or Layout binding uses it.
func (s *Service) DeleteDataSource(ctx context.Context, id, user uuid.UUID) error {
	widgets, err := s.dataSourceWidgetUsage(ctx, id)
	if err != nil {
		return err
	}
	bindings, err := s.dataSourceBindingUsage(ctx, id)
	if err != nil {
		return err
	}
	if len(widgets) > 0 || len(bindings) > 0 {
		names := []string{}
		for _, w := range widgets {
			names = append(names, "widget "+w.Name)
		}
		for _, b := range bindings {
			names = append(names, "Layout "+b.LayoutName)
		}
		return &DependencyError{Resource: "data source", UsedBy: names}
	}
	tag, err := s.db.Exec(ctx, `UPDATE data_sources SET deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id) VALUES($1,$2,'data_source.deleted','data_source',$3)`, uuid.New(), user, id.String())
	return nil
}

// DependencyError reports that a record could not be deleted because other records use it.
type DependencyError struct {
	Resource string
	UsedBy   []string
}

func (e *DependencyError) Error() string {
	return e.Resource + " is in use by " + strings.Join(e.UsedBy, ", ")
}
