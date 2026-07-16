package media

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestManualSourceNormalizesTypedRows(t *testing.T) {
	raw, _ := json.Marshal(ManualSourceConfig{
		Columns: []ManualColumn{
			{Key: "title", Label: "Title", Type: "text"},
			{Key: "price", Label: "Price", Type: "currency", Currency: "usd"},
			{Key: "active", Label: "Active", Type: "boolean"},
		},
		Rows: []ManualRow{{ID: "d43f00ab-b7d9-4c39-a67b-24f7649c558d", Values: map[string]string{
			"title": "  Soup  ", "price": "5.50", "active": "TRUE",
		}}},
	})
	normalized, err := (manualSourceProvider{}).Normalize(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	config := normalized.(ManualSourceConfig)
	if config.Columns[1].Currency != "USD" || config.Rows[0].Values["price"] != "5.5" || config.Rows[0].Values["active"] != "true" {
		t.Fatalf("unexpected normalized manual data: %#v", config)
	}
}

func TestManualSourceRejectsUnknownRowFields(t *testing.T) {
	raw, _ := json.Marshal(ManualSourceConfig{
		Columns: []ManualColumn{{Key: "title", Label: "Title", Type: "text"}},
		Rows:    []ManualRow{{ID: "d43f00ab-b7d9-4c39-a67b-24f7649c558d", Values: map[string]string{"missing": "value"}}},
	})
	if _, err := (manualSourceProvider{}).Normalize(context.Background(), raw); err == nil {
		t.Fatal("expected an unknown manual field to be rejected")
	}
}

func TestNormalizeWeatherForecastProducesCurrentAndDailyRecords(t *testing.T) {
	var forecast metForecast
	for index, at := range []string{"2026-07-16T12:00:00Z", "2026-07-17T12:00:00Z"} {
		var point struct {
			Time time.Time `json:"time"`
			Data struct {
				Instant struct {
					Details map[string]float64 `json:"details"`
				} `json:"instant"`
				Next1 struct {
					Summary struct {
						SymbolCode string `json:"symbol_code"`
					} `json:"summary"`
					Details map[string]float64 `json:"details"`
				} `json:"next_1_hours"`
				Next6 struct {
					Summary struct {
						SymbolCode string `json:"symbol_code"`
					} `json:"summary"`
					Details map[string]float64 `json:"details"`
				} `json:"next_6_hours"`
			} `json:"data"`
		}
		point.Time, _ = time.Parse(time.RFC3339, at)
		point.Data.Instant.Details = map[string]float64{"air_temperature": 20 + float64(index), "relative_humidity": 55, "wind_speed": 3}
		point.Data.Next1.Details = map[string]float64{"precipitation_amount": 1}
		point.Data.Next1.Summary.SymbolCode = "partlycloudy_day"
		point.Data.Next6.Summary.SymbolCode = "partlycloudy_day"
		forecast.Properties.Timeseries = append(forecast.Properties.Timeseries, point)
	}
	data, err := normalizeWeatherForecast(forecast, WeatherSourceConfig{LocationLabel: "Town Hall", Timezone: "UTC", Units: "metric", ForecastDays: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Records) != 3 || data.Records[0].Values["condition"] != "Partlycloudy" || data.Records[1].Values["high"] != "20" {
		t.Fatalf("unexpected weather records: %#v", data.Records)
	}
}

func TestCountdownWidgetDefaultsVisibleUnits(t *testing.T) {
	raw := json.RawMessage(`{"target":"2026-12-01T09:00","timezone":"America/New_York","mode":"countdown","completionAction":"completed_text","foregroundColor":"#ffffff","backgroundColor":"#000000"}`)
	normalized, err := (countdownWidgetProvider{}).Normalize(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	config := normalized.(CountdownWidgetConfig)
	if !config.ShowDays || !config.ShowHours || !config.ShowMinutes {
		t.Fatalf("expected default countdown units: %#v", config)
	}
}

func TestParseHTTPExpiryPrefersCacheControl(t *testing.T) {
	date := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	header := http.Header{
		"Date":          []string{date.Format(http.TimeFormat)},
		"Cache-Control": []string{"public, max-age=900"},
		"Expires":       []string{date.Add(time.Hour).Format(http.TimeFormat)},
	}
	expires := parseHTTPExpiry(header)
	if expires == nil || !expires.Equal(date.Add(15*time.Minute)) {
		t.Fatalf("expiry=%v", expires)
	}
}

func TestNextDataSourceRefreshHonorsUpstreamExpiry(t *testing.T) {
	upstream := time.Now().Add(2 * time.Hour)
	next := nextDataSourceRefresh(300, &upstream)
	if !next.Equal(upstream) {
		t.Fatalf("next=%v want=%v", next, upstream)
	}
}
