package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

var widgetColorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

type clockWidgetProvider struct{}

func (clockWidgetProvider) Normalize(_ context.Context, raw json.RawMessage) (any, error) {
	var c ClockWidgetConfig
	if err := decodeConfig(raw, &c); err != nil {
		return nil, err
	}
	if c.Timezone == "" {
		c.Timezone = "UTC"
	}
	if _, err := time.LoadLocation(c.Timezone); err != nil {
		return nil, errors.New("clock timezone is invalid")
	}
	if c.Format == "" {
		c.Format = "12"
	}
	if c.Format != "12" && c.Format != "24" {
		return nil, errors.New("clock format is invalid")
	}
	if err := normalizeWidgetColors(&c.ForegroundColor, &c.BackgroundColor); err != nil {
		return nil, err
	}
	if err := validateWidgetTextScale(c.TextScale); err != nil {
		return nil, err
	}
	return c, nil
}

type dateWidgetProvider struct{}

func (dateWidgetProvider) Normalize(_ context.Context, raw json.RawMessage) (any, error) {
	var c DateWidgetConfig
	if err := decodeConfig(raw, &c); err != nil {
		return nil, err
	}
	if c.Timezone == "" {
		c.Timezone = "UTC"
	}
	if _, err := time.LoadLocation(c.Timezone); err != nil {
		return nil, errors.New("date timezone is invalid")
	}
	if c.Format == "" {
		c.Format = "full"
	}
	if c.Format != "full" && c.Format != "long" && c.Format != "medium" && c.Format != "short" {
		return nil, errors.New("date format is invalid")
	}
	if err := normalizeWidgetColors(&c.ForegroundColor, &c.BackgroundColor); err != nil {
		return nil, err
	}
	if err := validateWidgetTextScale(c.TextScale); err != nil {
		return nil, err
	}
	return c, nil
}

type qrCodeWidgetProvider struct{}

func (qrCodeWidgetProvider) Normalize(_ context.Context, raw json.RawMessage) (any, error) {
	var c QRCodeWidgetConfig
	if err := decodeConfig(raw, &c); err != nil {
		return nil, err
	}
	c.Value = strings.TrimSpace(c.Value)
	c.Label = sanitizeCalendarText(c.Label, 120)
	if c.Value == "" || len(c.Value) > 2048 {
		return nil, errors.New("QR Code value must be between 1 and 2048 characters")
	}
	if strings.ContainsAny(c.Value, "\x00\r\n") {
		return nil, errors.New("QR Code value contains unsupported control characters")
	}
	if c.ErrorCorrection == "" {
		c.ErrorCorrection = "medium"
	}
	if c.ErrorCorrection != "low" && c.ErrorCorrection != "medium" && c.ErrorCorrection != "quartile" && c.ErrorCorrection != "high" {
		return nil, errors.New("QR Code error correction is invalid")
	}
	if err := normalizeWidgetColors(&c.ForegroundColor, &c.BackgroundColor); err != nil {
		return nil, err
	}
	if err := validateWidgetTextScale(c.TextScale); err != nil {
		return nil, err
	}
	return c, nil
}

type tickerWidgetProvider struct{ service *Service }

func (p tickerWidgetProvider) Normalize(ctx context.Context, raw json.RawMessage) (any, error) {
	var c TickerWidgetConfig
	if err := decodeConfig(raw, &c); err != nil {
		return nil, err
	}
	provider, fields, err := p.service.dataSourceProviderAndFields(ctx, c.DataSourceID)
	if err != nil {
		return nil, errors.New("ticker data Source was not found")
	}
	if !dataSourceProviderAccepted("ticker", provider) {
		return nil, errors.New("ticker requires an RSS, Atom, Calendar, JSON, or CSV data Source")
	}
	c.Field = sanitizeCalendarText(c.Field, 80)
	if c.Field == "" {
		c.Field = "title"
	}
	if len(fields) > 0 && !fields[c.Field] {
		return nil, errors.New("ticker field is not provided by the selected data Source")
	}
	c.Separator = sanitizeCalendarText(c.Separator, 10)
	if c.Separator == "" {
		c.Separator = " • "
	}
	if c.Speed == "" {
		c.Speed = "normal"
	}
	if c.Speed != "slow" && c.Speed != "normal" && c.Speed != "fast" {
		return nil, errors.New("ticker speed is invalid")
	}
	if c.Direction == "" {
		c.Direction = "left"
	}
	if c.Direction != "left" && c.Direction != "right" {
		return nil, errors.New("ticker direction is invalid")
	}
	if err := normalizeWidgetColors(&c.ForegroundColor, &c.BackgroundColor); err != nil {
		return nil, err
	}
	if err := validateWidgetTextScale(c.TextScale); err != nil {
		return nil, err
	}
	return c, nil
}

type displayWidgetProvider struct {
	service      *Service
	presentation string
}

func (p displayWidgetProvider) Normalize(ctx context.Context, raw json.RawMessage) (any, error) {
	var c DisplayWidgetConfig
	if err := decodeConfig(raw, &c); err != nil {
		return nil, err
	}
	provider, fields, err := p.service.dataSourceProviderAndFields(ctx, c.DataSourceID)
	if err != nil {
		return nil, errors.New("data Source was not found")
	}
	if !dataSourceProviderAccepted(p.presentation, provider) {
		return nil, errors.New(p.presentation + " widget is not compatible with the selected data Source")
	}
	if c.MaximumItems == 0 {
		c.MaximumItems = 20
	}
	if c.MaximumItems < 1 || c.MaximumItems > 100 {
		return nil, errors.New("maximum items must be between 1 and 100")
	}
	normalizedFields, err := normalizeDisplayWidgetFields(p.presentation, c.Fields, fields)
	if err != nil {
		return nil, err
	}
	c.Fields = normalizedFields
	if err := normalizeWidgetColors(&c.ForegroundColor, &c.BackgroundColor); err != nil {
		return nil, err
	}
	if err := validateWidgetTextScale(c.TextScale); err != nil {
		return nil, err
	}
	return c, nil
}

func validateWidgetTextScale(scale *int) error {
	if scale != nil && (*scale < 50 || *scale > 200) {
		return errors.New("widget text scale must be between 50 and 200 percent")
	}
	return nil
}

func normalizeDisplayWidgetFields(presentation string, selected []string, available map[string]bool) ([]string, error) {
	if len(selected) > 12 {
		return nil, errors.New("a widget must select between 1 and 12 fields")
	}

	normalized := make([]string, 0, len(selected))
	seen := map[string]bool{}
	for _, rawField := range selected {
		field := sanitizeCalendarText(rawField, 80)
		if field == "" || seen[field] {
			return nil, errors.New("widget fields must be unique and non-empty")
		}
		if len(available) == 0 || available[field] {
			seen[field] = true
			normalized = append(normalized, field)
			continue
		}
		// The Studio historically initialized Menu Widgets with title/subtitle.
		// When a custom CSV or JSON Source does not expose those fields, discard
		// only those stale implicit defaults while preserving real user choices.
		if presentation == "menu" && (field == "title" || field == "subtitle") {
			continue
		}
		return nil, fmt.Errorf("field %q is not provided by the selected data Source", field)
	}

	if presentation == "menu" && len(normalized) == 0 && len(available) > 0 {
		preferred := []string{
			"option_1",
			"option_2",
			"entree",
			"entrée",
			"primary",
			"primary_option",
			"alternative",
			"secondary",
			"secondary_option",
			"title",
			"subtitle",
		}
		for _, field := range preferred {
			if available[field] && !seen[field] {
				normalized = append(normalized, field)
				seen[field] = true
			}
			if len(normalized) == 2 {
				break
			}
		}
		if len(normalized) == 0 {
			fallback := make([]string, 0, len(available))
			for field := range available {
				switch field {
				case "date", "imageUrl", "link":
					continue
				}
				fallback = append(fallback, field)
			}
			sort.Strings(fallback)
			if len(fallback) > 2 {
				fallback = fallback[:2]
			}
			normalized = append(normalized, fallback...)
		}
	}

	if len(normalized) == 0 {
		return nil, errors.New("a widget must select between 1 and 12 fields")
	}
	return normalized, nil
}

func normalizeWidgetColors(foreground, background *string) error {
	if *foreground == "" {
		*foreground = "#F5F7FA"
	}
	if *background == "" {
		*background = "#0E141B"
	}
	if !widgetColorPattern.MatchString(*foreground) || !widgetColorPattern.MatchString(*background) {
		return errors.New("widget colors must use six-digit hexadecimal values")
	}
	return nil
}
