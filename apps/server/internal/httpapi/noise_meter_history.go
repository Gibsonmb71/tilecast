package httpapi

// Noise Meter → History reads.
//
// Players write history only through the ordinary heartbeat; these are the
// separate Studio reads. Every one of them resolves its screens from the
// caller's own scope rather than from the request, and asks the plugins package
// for an aggregation rather than exposing the ten-second table as a generic
// CRUD resource.

import (
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/plugins"
)

// noiseHistoryRanges are the ranges History offers, with the presentation
// resolution each one is drawn at. A month at ten-second resolution is a
// quarter of a million points; nobody needs to download that to see a month.
var noiseHistoryRanges = map[string]struct {
	days       int
	resolution string
}{
	"today":     {days: 1, resolution: "minute"},
	"yesterday": {days: 1, resolution: "minute"},
	"7d":        {days: 7, resolution: "fifteenMinutes"},
	"30d":       {days: 30, resolution: "hour"},
}

type noiseHistoryRequest struct {
	instanceID uuid.UUID
	filter     plugins.NoiseHistoryFilter
	rangeKey   string
	resolution string
}

// resolveNoiseHistoryRequest validates the range, resolves the day boundaries in
// the caller's timezone, and reduces the screens to the ones this account may
// actually see. It writes its own error response and returns false on failure.
func (s *server) resolveNoiseHistoryRequest(w http.ResponseWriter, r *http.Request) (noiseHistoryRequest, bool) {
	var request noiseHistoryRequest
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return request, false
	}
	if _, err := s.plugins.GetNoiseMeter(r.Context(), id); err != nil {
		s.writePluginError(w, r, err)
		return request, false
	}
	request.instanceID = id
	request.rangeKey = r.URL.Query().Get("range")
	if request.rangeKey == "" {
		request.rangeKey = "today"
	}
	window, known := noiseHistoryRanges[request.rangeKey]
	if !known {
		writeError(w, http.StatusBadRequest, "invalid_request", "range must be today, yesterday, 7d, or 30d.")
		return request, false
	}
	request.resolution = window.resolution
	location := time.UTC
	timezone := r.URL.Query().Get("tz")
	if timezone != "" {
		if loaded, err := time.LoadLocation(timezone); err == nil {
			location = loaded
		} else {
			// An unreadable timezone falls back to UTC rather than failing the
			// page: a chart in the wrong day boundary is recoverable, an error
			// where the history should be is not.
			timezone = ""
		}
	}
	now := time.Now().In(location)
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
	from, to := startOfToday, startOfToday.AddDate(0, 0, 1)
	switch request.rangeKey {
	case "yesterday":
		from, to = startOfToday.AddDate(0, 0, -1), startOfToday
	case "7d", "30d":
		from, to = startOfToday.AddDate(0, 0, -(window.days-1)), startOfToday.AddDate(0, 0, 1)
	}
	screens, ok := s.noiseHistoryScreenScope(w, r)
	if !ok {
		return request, false
	}
	request.filter = plugins.NoiseHistoryFilter{
		InstanceID: id, ScreenIDs: screens, From: from.UTC(), To: to.UTC(), Timezone: timezone,
	}
	return request, true
}

// noiseHistoryScreenScope resolves which screens the reply may cover: one
// explicitly requested screen, authorized the same way every other screen
// operation is, or every screen this account is scoped to.
func (s *server) noiseHistoryScreenScope(w http.ResponseWriter, r *http.Request) ([]uuid.UUID, bool) {
	if raw := r.URL.Query().Get("screenId"); raw != "" {
		screenID, err := uuid.Parse(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "screenId is not a valid identifier.")
			return nil, false
		}
		if !s.authorizeScreen(w, r, screenID) {
			return nil, false
		}
		return []uuid.UUID{screenID}, true
	}
	session, _ := r.Context().Value(sessionContextKey).(auth.Session)
	screens, err := s.devices.ListScreensForUser(r.Context(), session.User.ID, session.User.Role)
	if err != nil {
		s.internalError(w, r, err)
		return nil, false
	}
	ids := make([]uuid.UUID, 0, len(screens))
	for _, screen := range screens {
		ids = append(ids, screen.ID)
	}
	return ids, true
}

func (s *server) noiseHistoryScreens(w http.ResponseWriter, r *http.Request) {
	request, ok := s.resolveNoiseHistoryRequest(w, r)
	if !ok {
		return
	}
	items, err := s.plugins.NoiseHistoryScreens(r.Context(), request.filter)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"items": items, "total": len(items)}})
}

func (s *server) noiseHistorySummary(w http.ResponseWriter, r *http.Request) {
	request, ok := s.resolveNoiseHistoryRequest(w, r)
	if !ok {
		return
	}
	summary, err := s.plugins.NoiseHistorySummaryFor(r.Context(), request.filter)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"range":   map[string]any{"key": request.rangeKey, "from": request.filter.From, "to": request.filter.To},
		"summary": summary,
	}})
}

func (s *server) noiseHistorySeries(w http.ResponseWriter, r *http.Request) {
	request, ok := s.resolveNoiseHistoryRequest(w, r)
	if !ok {
		return
	}
	points, err := s.plugins.NoiseHistorySeries(r.Context(), request.filter, request.resolution)
	if err != nil {
		if errors.Is(err, plugins.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"range":      map[string]any{"key": request.rangeKey, "from": request.filter.From, "to": request.filter.To},
		"resolution": request.resolution,
		"points":     points,
	}})
}

func (s *server) noiseHistoryDaily(w http.ResponseWriter, r *http.Request) {
	request, ok := s.resolveNoiseHistoryRequest(w, r)
	if !ok {
		return
	}
	days, err := s.plugins.NoiseHistoryDays(r.Context(), request.filter)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"range": map[string]any{"key": request.rangeKey, "from": request.filter.From, "to": request.filter.To},
		"days":  days,
	}})
}

// exportNoiseHistory streams the selected range and screens as CSV. Rows are
// written as they arrive from the database rather than being collected first,
// and the range is the same one the page is showing.
func (s *server) exportNoiseHistory(w http.ResponseWriter, r *http.Request) {
	request, ok := s.resolveNoiseHistoryRequest(w, r)
	if !ok {
		return
	}
	granularity := r.URL.Query().Get("granularity")
	if granularity == "" {
		granularity = "raw"
	}
	instance, err := s.plugins.GetNoiseMeter(r.Context(), request.instanceID)
	if err != nil {
		s.writePluginError(w, r, err)
		return
	}
	filename := fmt.Sprintf("tilecast-noise-%s-%s-%s.csv",
		safeFilenamePart(instance.Name), request.rangeKey, granularity)
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	writer := csv.NewWriter(w)
	defer writer.Flush()
	level := func(value float64) string { return strconv.FormatFloat(value, 'f', 1, 64) }
	seconds := func(ms int64) string { return strconv.FormatFloat(float64(ms)/1000, 'f', 1, 64) }
	switch granularity {
	case "raw":
		_ = writer.Write([]string{"timestamp", "screen", "average_level", "peak_level",
			"monitored_seconds", "warning_seconds", "loud_seconds", "warning_events"})
		err = s.plugins.NoiseHistoryRaw(r.Context(), request.filter, 500_000,
			func(screenName string, record plugins.NoiseHistoryPoint) error {
				return writer.Write([]string{record.At.UTC().Format(time.RFC3339), screenName,
					level(record.AverageLevel), level(record.PeakLevel), seconds(record.MonitoredMS),
					seconds(record.WarningMS), seconds(record.LoudMS), strconv.FormatInt(record.TriggerCount, 10)})
			})
	case "minute":
		var points []plugins.NoiseHistoryPoint
		points, err = s.plugins.NoiseHistorySeries(r.Context(), request.filter, "minute")
		_ = writer.Write([]string{"timestamp", "average_level", "peak_level",
			"monitored_seconds", "warning_seconds", "loud_seconds", "warning_events"})
		for _, point := range points {
			_ = writer.Write([]string{point.At.UTC().Format(time.RFC3339), level(point.AverageLevel),
				level(point.PeakLevel), seconds(point.MonitoredMS), seconds(point.WarningMS),
				seconds(point.LoudMS), strconv.FormatInt(point.TriggerCount, 10)})
		}
	case "daily":
		var days []plugins.NoiseHistoryDailyExport
		days, err = s.plugins.NoiseHistoryDailyExport(r.Context(), request.filter)
		_ = writer.Write([]string{"date", "average_level", "peak_level", "monitored_minutes",
			"warning_minutes", "loud_minutes", "warning_events", "longest_loud_seconds"})
		minutes := func(ms int64) string { return strconv.FormatFloat(float64(ms)/60000, 'f', 1, 64) }
		for _, day := range days {
			_ = writer.Write([]string{day.Date, level(day.AverageLevel), level(day.PeakLevel),
				minutes(day.MonitoredMS), minutes(day.WarningMS), minutes(day.LoudMS),
				strconv.FormatInt(day.TriggerCount, 10), seconds(day.LongestLoudMS)})
		}
	default:
		writeError(w, http.StatusBadRequest, "invalid_request", "granularity must be raw, minute, or daily.")
		return
	}
	if err != nil {
		// The header is already written, so the export ends where it failed
		// rather than turning into an HTML error inside a CSV download.
		s.logger.Error("noise history export failed", "instance_id", request.instanceID, "error", err)
	}
}

// safeFilenamePart keeps an instance name usable in a Content-Disposition
// filename without quoting games.
func safeFilenamePart(value string) string {
	out := make([]rune, 0, len(value))
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z', character >= '0' && character <= '9':
			out = append(out, character)
		case character >= 'A' && character <= 'Z':
			out = append(out, character+32)
		case character == ' ' || character == '-' || character == '_':
			out = append(out, '-')
		}
		if len(out) >= 48 {
			break
		}
	}
	if len(out) == 0 {
		return "noise-meter"
	}
	return string(out)
}
