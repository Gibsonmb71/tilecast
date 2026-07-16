package media

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// DataSourceRefreshWorker periodically fetches, parses, and caches Data Source data.
type DataSourceRefreshWorker struct {
	service *Service
	logger  *slog.Logger
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	id      string
}

func NewDataSourceRefreshWorker(service *Service, logger *slog.Logger) *DataSourceRefreshWorker {
	if logger == nil {
		logger = slog.Default()
	}
	return &DataSourceRefreshWorker{service: service, logger: logger, id: uuid.NewString()}
}

func (worker *DataSourceRefreshWorker) Start(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	worker.cancel = cancel
	worker.wg.Add(1)
	go func() {
		defer worker.wg.Done()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			worked, err := worker.runOne(ctx)
			if err != nil && ctx.Err() == nil {
				worker.logger.Error("data source refresh failed", "error", err)
			}
			if worked {
				continue
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (worker *DataSourceRefreshWorker) Stop() {
	if worker.cancel != nil {
		worker.cancel()
	}
	worker.wg.Wait()
}

func (worker *DataSourceRefreshWorker) runOne(ctx context.Context) (bool, error) {
	tx, err := worker.service.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var dataSourceID uuid.UUID
	var provider string
	var raw json.RawMessage
	err = tx.QueryRow(ctx, `SELECT state.data_source_id,ds.provider,ds.configuration
		FROM data_source_refresh_states state
		JOIN data_sources ds ON ds.id=state.data_source_id AND ds.deleted_at IS NULL
		WHERE state.next_refresh_at<=now()
		  AND (state.locked_at IS NULL OR state.locked_at<now()-interval '10 minutes')
		ORDER BY state.next_refresh_at,state.data_source_id
		LIMIT 1 FOR UPDATE OF state SKIP LOCKED`).Scan(&dataSourceID, &provider, &raw)
	if err == pgx.ErrNoRows {
		return false, tx.Commit(ctx)
	}
	if err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE data_source_refresh_states SET locked_at=now(),locked_by=$2,last_attempt_at=now(),updated_at=now() WHERE data_source_id=$1`, dataSourceID, worker.id); err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	refreshSeconds := 300
	var prepared any
	var diagnostics DataSourceDiagnostics
	var refreshErr error
	var upstreamLastModified string
	var upstreamExpiresAt *time.Time
	var notModified bool
	if provider == "calendar" {
		var config CalendarConfig
		if err = json.Unmarshal(raw, &config); err == nil {
			refreshSeconds = config.RefreshIntervalSeconds
			prepared, diagnostics, refreshErr = worker.service.refreshCalendar(ctx, dataSourceID, config)
		}
	} else if provider == "weather" {
		var config WeatherSourceConfig
		if err = json.Unmarshal(raw, &config); err == nil {
			refreshSeconds = config.RefreshIntervalSeconds
			var previousLastModified *string
			_ = worker.service.db.QueryRow(ctx, `SELECT upstream_last_modified FROM data_source_refresh_states WHERE data_source_id=$1`, dataSourceID).Scan(&previousLastModified)
			lastModified := ""
			if previousLastModified != nil {
				lastModified = *previousLastModified
			}
			prepared, diagnostics, upstreamLastModified, upstreamExpiresAt, notModified, refreshErr = worker.service.refreshWeather(ctx, dataSourceID, config, lastModified)
		}
	} else {
		var config StructuredSourceConfig
		if err = json.Unmarshal(raw, &config); err == nil {
			refreshSeconds = config.RefreshIntervalSeconds
			prepared, diagnostics, refreshErr = worker.service.refreshStructured(ctx, dataSourceID, provider, config)
		}
	}
	if err != nil {
		return true, worker.fail(ctx, dataSourceID, refreshSeconds, DataSourceDiagnostics{ParseStatus: "invalid_configuration"}, "invalid_configuration")
	}
	if refreshErr != nil {
		return true, worker.fail(ctx, dataSourceID, refreshSeconds, diagnostics, "source_refresh_failed")
	}
	if notModified {
		next := nextDataSourceRefresh(refreshSeconds, upstreamExpiresAt)
		_, err = worker.service.db.Exec(ctx, `UPDATE data_source_refresh_states SET next_refresh_at=$2,last_success_at=now(),http_result_category=$3,parse_status='success',using_cached_data=FALSE,error_code=NULL,upstream_expires_at=$4,locked_at=NULL,locked_by=NULL,updated_at=now() WHERE data_source_id=$1`, dataSourceID, next, diagnostics.HTTPResultCategory, upstreamExpiresAt)
		return true, err
	}
	payload, err := json.Marshal(prepared)
	if err != nil {
		return true, worker.fail(ctx, dataSourceID, refreshSeconds, diagnostics, "cache_encoding_failed")
	}
	next := nextDataSourceRefresh(refreshSeconds, upstreamExpiresAt)
	var playerDataChanged bool
	err = worker.service.db.QueryRow(ctx, `WITH previous AS MATERIALIZED (
		SELECT cached_payload,using_cached_data,error_code FROM data_source_refresh_states WHERE data_source_id=$1
	), updated AS (
		UPDATE data_source_refresh_states SET next_refresh_at=$2,last_success_at=now(),http_result_category=$3,parse_status=$4,available_event_count=$5,available_item_count=$6,using_cached_data=FALSE,cache_updated_at=$7,cache_expires_at=$8,cached_payload=$9::jsonb,error_code=NULL,upstream_last_modified=NULLIF($10,''),upstream_expires_at=$11,locked_at=NULL,locked_by=NULL,updated_at=now() WHERE data_source_id=$1 RETURNING data_source_id
	) SELECT previous.cached_payload IS DISTINCT FROM $9::jsonb OR previous.using_cached_data OR previous.error_code IS NOT NULL FROM previous,updated`, dataSourceID, next, diagnostics.HTTPResultCategory, diagnostics.ParseStatus, diagnostics.AvailableEventCount, diagnostics.AvailableItemCount, diagnostics.CacheUpdatedAt, diagnostics.CacheExpiresAt, string(payload), upstreamLastModified, upstreamExpiresAt).Scan(&playerDataChanged)
	if err == nil && playerDataChanged && worker.service.invalidator != nil {
		err = worker.service.invalidator.DataSourceChanged(ctx, dataSourceID, "data_source.refreshed")
	}
	return true, err
}

func nextDataSourceRefresh(refreshSeconds int, upstreamExpiresAt *time.Time) time.Time {
	next := time.Now().Add(time.Duration(refreshSeconds) * time.Second)
	if upstreamExpiresAt != nil && upstreamExpiresAt.After(next) {
		return *upstreamExpiresAt
	}
	return next
}

func (worker *DataSourceRefreshWorker) fail(ctx context.Context, dataSourceID uuid.UUID, refreshSeconds int, diagnostics DataSourceDiagnostics, code string) error {
	if refreshSeconds < 300 {
		refreshSeconds = 300
	}
	next := time.Now().Add(time.Duration(refreshSeconds) * time.Second)
	var playerDataChanged bool
	err := worker.service.db.QueryRow(ctx, `WITH previous AS MATERIALIZED (
		SELECT using_cached_data,error_code FROM data_source_refresh_states WHERE data_source_id=$1
	), updated AS (
		UPDATE data_source_refresh_states SET next_refresh_at=$2,http_result_category=$3,parse_status=$4,using_cached_data=(cache_updated_at IS NOT NULL AND cache_expires_at>now()),error_code=$5,locked_at=NULL,locked_by=NULL,updated_at=now() WHERE data_source_id=$1 RETURNING using_cached_data,error_code
	) SELECT previous.using_cached_data IS DISTINCT FROM updated.using_cached_data OR (previous.error_code IS NULL) IS DISTINCT FROM (updated.error_code IS NULL) FROM previous,updated`, dataSourceID, next, diagnostics.HTTPResultCategory, diagnostics.ParseStatus, code).Scan(&playerDataChanged)
	if err == nil && playerDataChanged && worker.service.invalidator != nil {
		err = worker.service.invalidator.DataSourceChanged(ctx, dataSourceID, "data_source.cache_state_changed")
	}
	return err
}
