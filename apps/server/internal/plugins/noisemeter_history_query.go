package plugins

// The read layer behind Noise Meter → History.
//
// Everything here is an aggregation of the stored ten-second buckets. The
// original records are kept until their retention window expires; these are
// presentation resolutions, computed on the server so a browser never has to
// download and draw thousands of points to see a day.
//
// Two rules run through all of it. Averages are weighted by monitored time, so
// a bucket the microphone only half covered cannot count as much as a whole
// one. And a period with no records stays absent rather than being filled with
// zeroes: a screen that was not monitoring was not silent.

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// NoiseHistoryFilter is one History question: which meter, which screens, and
// over what range. ScreenIDs is always supplied by the caller after scope
// authorization, never taken from the request unchecked.
type NoiseHistoryFilter struct {
	InstanceID uuid.UUID
	ScreenIDs  []uuid.UUID
	From       time.Time
	To         time.Time
	// IANA timezone for day boundaries. Empty means UTC.
	Timezone string
}

type NoiseHistoryScreen struct {
	ScreenID uuid.UUID  `json:"screenId"`
	Name     string     `json:"name"`
	Buckets  int64      `json:"buckets"`
	FirstAt  *time.Time `json:"firstAt,omitempty"`
	LastAt   *time.Time `json:"lastAt,omitempty"`
}

// NoiseHistoryPoint is one presentation bucket: a minute, fifteen minutes, or
// an hour of the underlying ten-second records.
type NoiseHistoryPoint struct {
	At           time.Time `json:"at"`
	AverageLevel float64   `json:"averageLevel"`
	PeakLevel    float64   `json:"peakLevel"`
	MonitoredMS  int64     `json:"monitoredMs"`
	WarningMS    int64     `json:"warningMs"`
	LoudMS       int64     `json:"loudMs"`
	TriggerCount int64     `json:"triggerCount"`
}

type NoiseHistoryDay struct {
	Date         string  `json:"date"`
	AverageLevel float64 `json:"averageLevel"`
	PeakLevel    float64 `json:"peakLevel"`
	MonitoredMS  int64   `json:"monitoredMs"`
	WarningMS    int64   `json:"warningMs"`
	LoudMS       int64   `json:"loudMs"`
	TriggerCount int64   `json:"triggerCount"`
}

// NoiseHistorySummary is descriptive only. There is no score, grade, or ranking
// here, and none belongs here: these are measurements of a room, not a verdict
// about the people in it.
type NoiseHistorySummary struct {
	Buckets      int64    `json:"buckets"`
	AverageLevel *float64 `json:"averageLevel"`
	PeakLevel    *float64 `json:"peakLevel"`
	MonitoredMS  int64    `json:"monitoredMs"`
	NormalMS     int64    `json:"normalMs"`
	WarningMS    int64    `json:"warningMs"`
	LoudMS       int64    `json:"loudMs"`
	// Counted by the Player when its state machine entered the loud state, not
	// inferred afterwards from how many buckets happen to look red.
	WarningEvents int64 `json:"warningEvents"`
	// Longest run of consecutive loud buckets, in milliseconds of loud time.
	LongestLoudMS      int64      `json:"longestLoudMs"`
	LoudestWindowAt    *time.Time `json:"loudestWindowAt,omitempty"`
	LoudestWindowLevel *float64   `json:"loudestWindowLevel,omitempty"`
	FirstAt            *time.Time `json:"firstAt,omitempty"`
	LastAt             *time.Time `json:"lastAt,omitempty"`
}

// noiseHistoryResolutions are the only aggregation widths History offers. A
// closed set keeps one range from asking for a million points.
var noiseHistoryResolutions = map[string]string{
	"minute":         "1 minute",
	"fifteenMinutes": "15 minutes",
	"hour":           "1 hour",
	"day":            "1 day",
}

func (f NoiseHistoryFilter) location() *time.Location {
	if f.Timezone == "" {
		return time.UTC
	}
	location, err := time.LoadLocation(f.Timezone)
	if err != nil {
		return time.UTC
	}
	return location
}

// NoiseHistoryScreens reports which of the caller's screens actually hold
// history for this meter, so the History page can show one screen directly and
// offer a selector only when there is something to select.
func (s *Service) NoiseHistoryScreens(ctx context.Context, filter NoiseHistoryFilter) ([]NoiseHistoryScreen, error) {
	rows, err := s.db.Query(ctx, `SELECT sc.id,sc.name,count(h.*),min(h.bucket_started_at),max(h.bucket_started_at)
		FROM screens sc
		JOIN noise_meter_history h ON h.screen_id=sc.id AND h.plugin_instance_id=$1
			AND h.bucket_started_at>=$3 AND h.bucket_started_at<$4
		WHERE sc.id=ANY($2) AND sc.archived_at IS NULL
		GROUP BY sc.id,sc.name
		ORDER BY lower(sc.name),sc.id`, filter.InstanceID, filter.ScreenIDs, filter.From, filter.To)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []NoiseHistoryScreen{}
	for rows.Next() {
		var item NoiseHistoryScreen
		if err = rows.Scan(&item.ScreenID, &item.Name, &item.Buckets, &item.FirstAt, &item.LastAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// NoiseHistorySeries returns the timeline graph's points at the requested
// resolution. Averages are time-weighted, peaks keep the maximum, and durations
// sum; a presentation bucket with no records is simply not returned.
func (s *Service) NoiseHistorySeries(ctx context.Context, filter NoiseHistoryFilter, resolution string) ([]NoiseHistoryPoint, error) {
	width, ok := noiseHistoryResolutions[resolution]
	if !ok {
		return nil, fmt.Errorf("%w: unknown history resolution", ErrInvalid)
	}
	rows, err := s.db.Query(ctx, `SELECT date_bin($5::interval,h.bucket_started_at,timestamptz 'epoch') AS at,
		COALESCE(sum(h.average_level::numeric*h.monitored_ms)/NULLIF(sum(h.monitored_ms),0),avg(h.average_level))::float8,
		max(h.peak_level)::float8,
		sum(h.monitored_ms)::bigint,sum(h.warning_ms)::bigint,sum(h.loud_ms)::bigint,sum(h.trigger_count)::bigint
		FROM noise_meter_history h
		WHERE h.plugin_instance_id=$1 AND h.screen_id=ANY($2)
			AND h.bucket_started_at>=$3 AND h.bucket_started_at<$4
		GROUP BY at ORDER BY at`, filter.InstanceID, filter.ScreenIDs, filter.From, filter.To, width)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	points := []NoiseHistoryPoint{}
	for rows.Next() {
		var point NoiseHistoryPoint
		if err = rows.Scan(&point.At, &point.AverageLevel, &point.PeakLevel, &point.MonitoredMS,
			&point.WarningMS, &point.LoudMS, &point.TriggerCount); err != nil {
			return nil, err
		}
		points = append(points, point)
	}
	return points, rows.Err()
}

// NoiseHistoryDays is the daily comparison. Days with no monitoring are absent
// rather than zero: a closed school is not a quiet one.
func (s *Service) NoiseHistoryDays(ctx context.Context, filter NoiseHistoryFilter) ([]NoiseHistoryDay, error) {
	rows, err := s.db.Query(ctx, `SELECT to_char((h.bucket_started_at AT TIME ZONE $5)::date,'YYYY-MM-DD'),
		COALESCE(sum(h.average_level::numeric*h.monitored_ms)/NULLIF(sum(h.monitored_ms),0),avg(h.average_level))::float8,
		max(h.peak_level)::float8,
		sum(h.monitored_ms)::bigint,sum(h.warning_ms)::bigint,sum(h.loud_ms)::bigint,sum(h.trigger_count)::bigint
		FROM noise_meter_history h
		WHERE h.plugin_instance_id=$1 AND h.screen_id=ANY($2)
			AND h.bucket_started_at>=$3 AND h.bucket_started_at<$4
		GROUP BY 1 ORDER BY 1`, filter.InstanceID, filter.ScreenIDs, filter.From, filter.To, filter.location().String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	days := []NoiseHistoryDay{}
	for rows.Next() {
		var day NoiseHistoryDay
		if err = rows.Scan(&day.Date, &day.AverageLevel, &day.PeakLevel, &day.MonitoredMS,
			&day.WarningMS, &day.LoudMS, &day.TriggerCount); err != nil {
			return nil, err
		}
		days = append(days, day)
	}
	return days, rows.Err()
}

// NoiseHistorySummaryFor computes the statistics shown above the graph.
func (s *Service) NoiseHistorySummaryFor(ctx context.Context, filter NoiseHistoryFilter) (NoiseHistorySummary, error) {
	var summary NoiseHistorySummary
	err := s.db.QueryRow(ctx, `SELECT count(*)::bigint,
		(COALESCE(sum(average_level::numeric*monitored_ms)/NULLIF(sum(monitored_ms),0),avg(average_level)))::float8,
		max(peak_level)::float8,
		COALESCE(sum(monitored_ms),0)::bigint,COALESCE(sum(warning_ms),0)::bigint,COALESCE(sum(loud_ms),0)::bigint,
		COALESCE(sum(trigger_count),0)::bigint,min(bucket_started_at),max(bucket_started_at)
		FROM noise_meter_history
		WHERE plugin_instance_id=$1 AND screen_id=ANY($2) AND bucket_started_at>=$3 AND bucket_started_at<$4`,
		filter.InstanceID, filter.ScreenIDs, filter.From, filter.To).
		Scan(&summary.Buckets, &summary.AverageLevel, &summary.PeakLevel, &summary.MonitoredMS,
			&summary.WarningMS, &summary.LoudMS, &summary.WarningEvents, &summary.FirstAt, &summary.LastAt)
	if err != nil {
		return NoiseHistorySummary{}, err
	}
	summary.NormalMS = summary.MonitoredMS - summary.WarningMS - summary.LoudMS
	if summary.NormalMS < 0 {
		summary.NormalMS = 0
	}
	if summary.Buckets == 0 {
		return summary, nil
	}
	// Longest continuous loud event: consecutive ten-second buckets that carry
	// any loud time. The row-number offset turns "consecutive" into a constant
	// per run, which is what makes the runs groupable.
	if err = s.db.QueryRow(ctx, `WITH loud AS (
			SELECT bucket_started_at,loud_ms,
				bucket_started_at - (row_number() OVER (ORDER BY bucket_started_at)) * interval '10 seconds' AS run
			FROM noise_meter_history
			WHERE plugin_instance_id=$1 AND screen_id=ANY($2) AND bucket_started_at>=$3 AND bucket_started_at<$4
				AND loud_ms>0)
		SELECT COALESCE(max(total),0)::bigint FROM (SELECT sum(loud_ms) AS total FROM loud GROUP BY run) runs`,
		filter.InstanceID, filter.ScreenIDs, filter.From, filter.To).Scan(&summary.LongestLoudMS); err != nil {
		return NoiseHistorySummary{}, err
	}
	// Loudest fifteen minutes in the range, by time-weighted average.
	var at *time.Time
	var level *float64
	if err = s.db.QueryRow(ctx, `SELECT date_bin(interval '15 minutes',bucket_started_at,timestamptz 'epoch') AS window_at,
			(sum(average_level::numeric*monitored_ms)/NULLIF(sum(monitored_ms),0))::float8 AS level
		FROM noise_meter_history
		WHERE plugin_instance_id=$1 AND screen_id=ANY($2) AND bucket_started_at>=$3 AND bucket_started_at<$4
		GROUP BY window_at HAVING sum(monitored_ms)>0 ORDER BY level DESC NULLS LAST,window_at LIMIT 1`,
		filter.InstanceID, filter.ScreenIDs, filter.From, filter.To).Scan(&at, &level); err == nil {
		summary.LoudestWindowAt, summary.LoudestWindowLevel = at, level
	}
	return summary, nil
}

// NoiseHistoryRaw streams the stored ten-second records for CSV export. The row
// callback keeps the export out of memory: the handler writes each row as it
// arrives rather than materializing a range that can be a month long.
func (s *Service) NoiseHistoryRaw(ctx context.Context, filter NoiseHistoryFilter, limit int,
	emit func(screenName string, record NoiseHistoryPoint) error) error {
	if limit < 1 || limit > 1_000_000 {
		limit = 1_000_000
	}
	rows, err := s.db.Query(ctx, `SELECT sc.name,h.bucket_started_at,h.average_level::float8,h.peak_level::float8,
		h.monitored_ms::bigint,h.warning_ms::bigint,h.loud_ms::bigint,h.trigger_count::bigint
		FROM noise_meter_history h JOIN screens sc ON sc.id=h.screen_id
		WHERE h.plugin_instance_id=$1 AND h.screen_id=ANY($2)
			AND h.bucket_started_at>=$3 AND h.bucket_started_at<$4
		ORDER BY h.bucket_started_at,sc.name LIMIT $5::int`,
		filter.InstanceID, filter.ScreenIDs, filter.From, filter.To, limit)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var point NoiseHistoryPoint
		if err = rows.Scan(&name, &point.At, &point.AverageLevel, &point.PeakLevel, &point.MonitoredMS,
			&point.WarningMS, &point.LoudMS, &point.TriggerCount); err != nil {
			return err
		}
		if err = emit(name, point); err != nil {
			return err
		}
	}
	return rows.Err()
}

// NoiseHistoryDailyExport is the daily CSV, including the two statistics the
// daily rollup cannot be recomputed from: warning events and the longest
// continuous loud run on that day.
type NoiseHistoryDailyExport struct {
	NoiseHistoryDay
	LongestLoudMS int64 `json:"longestLoudMs"`
}

func (s *Service) NoiseHistoryDailyExport(ctx context.Context, filter NoiseHistoryFilter) ([]NoiseHistoryDailyExport, error) {
	days, err := s.NoiseHistoryDays(ctx, filter)
	if err != nil {
		return nil, err
	}
	longest := map[string]int64{}
	rows, err := s.db.Query(ctx, `WITH loud AS (
			SELECT bucket_started_at,loud_ms,
				to_char((bucket_started_at AT TIME ZONE $5)::date,'YYYY-MM-DD') AS day,
				bucket_started_at - (row_number() OVER (ORDER BY bucket_started_at)) * interval '10 seconds' AS run
			FROM noise_meter_history
			WHERE plugin_instance_id=$1 AND screen_id=ANY($2) AND bucket_started_at>=$3 AND bucket_started_at<$4
				AND loud_ms>0)
		SELECT day,max(total)::bigint FROM (SELECT day,run,sum(loud_ms) AS total FROM loud GROUP BY day,run) runs
		GROUP BY day`, filter.InstanceID, filter.ScreenIDs, filter.From, filter.To, filter.location().String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		var total int64
		if err = rows.Scan(&day, &total); err != nil {
			return nil, err
		}
		longest[day] = total
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	out := make([]NoiseHistoryDailyExport, 0, len(days))
	for _, day := range days {
		out = append(out, NoiseHistoryDailyExport{NoiseHistoryDay: day, LongestLoudMS: longest[day.Date]})
	}
	return out, nil
}
