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

type SourceRefreshWorker struct {
	service *Service
	logger  *slog.Logger
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	id      string
}

func NewSourceRefreshWorker(service *Service, logger *slog.Logger) *SourceRefreshWorker {
	if logger == nil {
		logger = slog.Default()
	}
	return &SourceRefreshWorker{service: service, logger: logger, id: uuid.NewString()}
}

func (worker *SourceRefreshWorker) Start(parent context.Context) {
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
				worker.logger.Error("calendar source refresh failed", "error", err)
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

func (worker *SourceRefreshWorker) Stop() {
	if worker.cancel != nil {
		worker.cancel()
	}
	worker.wg.Wait()
}

func (worker *SourceRefreshWorker) runOne(ctx context.Context) (bool, error) {
	tx, err := worker.service.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var assetID uuid.UUID
	var raw json.RawMessage
	err = tx.QueryRow(ctx, `SELECT state.asset_id,source.configuration
		FROM source_refresh_states state
		JOIN sources source ON source.asset_id=state.asset_id AND source.provider='calendar'
		JOIN assets asset ON asset.id=state.asset_id AND asset.deleted_at IS NULL
		WHERE state.next_refresh_at<=now()
		  AND (state.locked_at IS NULL OR state.locked_at<now()-interval '10 minutes')
		ORDER BY state.next_refresh_at,state.asset_id
		LIMIT 1 FOR UPDATE OF state SKIP LOCKED`).Scan(&assetID, &raw)
	if err == pgx.ErrNoRows {
		return false, tx.Commit(ctx)
	}
	if err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE source_refresh_states SET locked_at=now(),locked_by=$2,last_attempt_at=now(),updated_at=now() WHERE asset_id=$1`, assetID, worker.id); err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, err
	}
	var config CalendarConfig
	if err = json.Unmarshal(raw, &config); err != nil {
		return true, worker.fail(ctx, assetID, config.RefreshIntervalSeconds, SourceRefreshDiagnostics{ParseStatus: "invalid_configuration"}, "invalid_configuration")
	}
	prepared, diagnostics, refreshErr := worker.service.refreshCalendar(ctx, assetID, config)
	if refreshErr != nil {
		return true, worker.fail(ctx, assetID, config.RefreshIntervalSeconds, diagnostics, "source_refresh_failed")
	}
	payload, err := json.Marshal(prepared)
	if err != nil {
		return true, worker.fail(ctx, assetID, config.RefreshIntervalSeconds, diagnostics, "cache_encoding_failed")
	}
	next := time.Now().Add(time.Duration(config.RefreshIntervalSeconds) * time.Second)
	var playerDataChanged bool
	err = worker.service.db.QueryRow(ctx, `WITH previous AS MATERIALIZED (
		SELECT cached_payload,using_cached_data,error_code FROM source_refresh_states WHERE asset_id=$1
	), updated AS (
		UPDATE source_refresh_states SET next_refresh_at=$2,last_success_at=now(),http_result_category=$3,parse_status=$4,available_event_count=$5,using_cached_data=FALSE,cache_updated_at=$6,cache_expires_at=$7,cached_payload=$8::jsonb,error_code=NULL,locked_at=NULL,locked_by=NULL,updated_at=now() WHERE asset_id=$1 RETURNING asset_id
	) SELECT previous.cached_payload->'events' IS DISTINCT FROM ($8::jsonb)->'events' OR previous.using_cached_data OR previous.error_code IS NOT NULL FROM previous,updated`, assetID, next, diagnostics.HTTPResultCategory, diagnostics.ParseStatus, diagnostics.AvailableEventCount, prepared.CachedAt, prepared.StaleAt, string(payload)).Scan(&playerDataChanged)
	if err == nil && playerDataChanged && worker.service.invalidator != nil {
		err = worker.service.invalidator.AssetChanged(ctx, assetID, "calendar_source.refreshed")
	}
	return true, err
}

func (worker *SourceRefreshWorker) fail(ctx context.Context, assetID uuid.UUID, refreshSeconds int, diagnostics SourceRefreshDiagnostics, code string) error {
	if refreshSeconds < 300 {
		refreshSeconds = 300
	}
	next := time.Now().Add(time.Duration(refreshSeconds) * time.Second)
	var playerDataChanged bool
	err := worker.service.db.QueryRow(ctx, `WITH previous AS MATERIALIZED (
		SELECT using_cached_data,error_code FROM source_refresh_states WHERE asset_id=$1
	), updated AS (
		UPDATE source_refresh_states SET next_refresh_at=$2,http_result_category=$3,parse_status=$4,using_cached_data=(cache_updated_at IS NOT NULL AND cache_expires_at>now()),error_code=$5,locked_at=NULL,locked_by=NULL,updated_at=now() WHERE asset_id=$1 RETURNING using_cached_data,error_code
	) SELECT previous.using_cached_data IS DISTINCT FROM updated.using_cached_data OR (previous.error_code IS NULL) IS DISTINCT FROM (updated.error_code IS NULL) FROM previous,updated`, assetID, next, diagnostics.HTTPResultCategory, diagnostics.ParseStatus, code).Scan(&playerDataChanged)
	if err == nil && playerDataChanged && worker.service.invalidator != nil {
		err = worker.service.invalidator.AssetChanged(ctx, assetID, "calendar_source.cache_state_changed")
	}
	return err
}
