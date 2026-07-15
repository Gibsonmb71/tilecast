package media

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

var appColorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

type clockAppProvider struct{}

func (clockAppProvider) Normalize(_ context.Context, raw json.RawMessage) (any, error) {
	var c ClockAppConfig
	if err := decodeSourceConfig(raw, &c); err != nil {
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
	if err := normalizeAppColors(&c.ForegroundColor, &c.BackgroundColor); err != nil {
		return nil, err
	}
	return c, nil
}

type dateAppProvider struct{}

func (dateAppProvider) Normalize(_ context.Context, raw json.RawMessage) (any, error) {
	var c DateAppConfig
	if err := decodeSourceConfig(raw, &c); err != nil {
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
	if err := normalizeAppColors(&c.ForegroundColor, &c.BackgroundColor); err != nil {
		return nil, err
	}
	return c, nil
}

type qrCodeAppProvider struct{}

func (qrCodeAppProvider) Normalize(_ context.Context, raw json.RawMessage) (any, error) {
	var c QRCodeAppConfig
	if err := decodeSourceConfig(raw, &c); err != nil {
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
	if err := normalizeAppColors(&c.ForegroundColor, &c.BackgroundColor); err != nil {
		return nil, err
	}
	return c, nil
}

type tickerAppProvider struct{ service *Service }

func (p tickerAppProvider) Normalize(ctx context.Context, raw json.RawMessage) (any, error) {
	var c TickerAppConfig
	if err := decodeSourceConfig(raw, &c); err != nil {
		return nil, err
	}
	var provider string
	if err := p.service.db.QueryRow(ctx, `SELECT s.provider FROM sources s JOIN assets a ON a.id=s.asset_id WHERE s.asset_id=$1 AND a.deleted_at IS NULL`, c.SourceAssetID).Scan(&provider); err != nil {
		return nil, errors.New("ticker data Source was not found")
	}
	if provider != "rss" && provider != "atom" && provider != "json" && provider != "csv" {
		return nil, errors.New("ticker requires an RSS, Atom, JSON, or CSV data Source")
	}
	c.Field = sanitizeCalendarText(c.Field, 80)
	if c.Field == "" {
		c.Field = "title"
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
	if err := normalizeAppColors(&c.ForegroundColor, &c.BackgroundColor); err != nil {
		return nil, err
	}
	return c, nil
}

func normalizeAppColors(foreground, background *string) error {
	if *foreground == "" {
		*foreground = "#F5F7FA"
	}
	if *background == "" {
		*background = "#0E141B"
	}
	if !appColorPattern.MatchString(*foreground) || !appColorPattern.MatchString(*background) {
		return errors.New("App colors must use six-digit hexadecimal values")
	}
	return nil
}
