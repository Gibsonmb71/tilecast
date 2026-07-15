package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type sourceProvider interface {
	Normalize(context.Context, json.RawMessage) (any, error)
}

type websiteSourceProvider struct{ service *Service }
type youtubeSourceProvider struct{ service *Service }

var youtubeIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{6,128}$`)

func decodeSourceConfig(raw json.RawMessage, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("source configuration must contain one JSON object")
		}
		return err
	}
	return nil
}

func (p websiteSourceProvider) Normalize(ctx context.Context, raw json.RawMessage) (any, error) {
	var config WebsiteConfig
	if err := decodeSourceConfig(raw, &config); err != nil {
		return nil, err
	}
	input := WebsiteInput{WebsiteConfig: config, javascriptSet: true, domStorageSet: true}
	normalized, err := p.service.normalizeWebsite(ctx, input)
	return normalized.WebsiteConfig, err
}

func (p youtubeSourceProvider) Normalize(ctx context.Context, raw json.RawMessage) (any, error) {
	var config YouTubeConfig
	if err := decodeSourceConfig(raw, &config); err != nil {
		return nil, err
	}
	config.URL = strings.TrimSpace(config.URL)
	u, err := url.Parse(config.URL)
	if err != nil || u.Scheme != "https" {
		return nil, errors.New("YouTube URL must use HTTPS")
	}
	host := strings.ToLower(strings.TrimPrefix(u.Hostname(), "www."))
	var videoID, playlistID string
	switch host {
	case "youtu.be":
		videoID = strings.Split(strings.Trim(u.Path, "/"), "/")[0]
	case "youtube.com", "m.youtube.com", "music.youtube.com":
		videoID = u.Query().Get("v")
		playlistID = u.Query().Get("list")
	default:
		return nil, errors.New("URL must use youtube.com or youtu.be")
	}
	if strings.Contains(u.Path, "/playlist") || (playlistID != "" && videoID == "") {
		config.Kind = "playlist"
		config.VideoID = ""
		config.PlaylistID = playlistID
		if !youtubeIDPattern.MatchString(playlistID) {
			return nil, errors.New("YouTube playlist URL is invalid")
		}
	} else {
		config.Kind = "video"
		config.VideoID = videoID
		config.PlaylistID = ""
		if !youtubeIDPattern.MatchString(videoID) {
			return nil, errors.New("YouTube video URL is invalid")
		}
	}
	if config.StartSeconds < 0 || config.StartSeconds > 86400 {
		return nil, errors.New("start time must be between 0 and 86400 seconds")
	}
	if config.EndSeconds != nil && *config.EndSeconds <= config.StartSeconds {
		return nil, errors.New("end time must be later than start time")
	}
	if config.Volume < 0 || config.Volume > 100 {
		return nil, errors.New("volume must be between 0 and 100 percent")
	}
	if config.CaptionLanguage != "" && !regexp.MustCompile(`^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?$`).MatchString(config.CaptionLanguage) {
		return nil, errors.New("caption language must be a language code")
	}
	if config.FailureBehavior == "" {
		config.FailureBehavior = "placeholder"
	}
	if config.FailureBehavior != "placeholder" && config.FailureBehavior != "fallback_image" && config.FailureBehavior != "skip" {
		return nil, errors.New("failure behavior is invalid")
	}
	if config.PlaylistPlaybackMode == "" {
		config.PlaylistPlaybackMode = "until_end"
	}
	if config.PlaylistPlaybackMode != "until_end" && config.PlaylistPlaybackMode != "fixed_duration" {
		return nil, errors.New("playlist playback mode is invalid")
	}
	if config.PlaylistPlaybackMode == "fixed_duration" {
		if config.FixedDurationSeconds == nil || *config.FixedDurationSeconds < 1 || *config.FixedDurationSeconds > 86400 {
			return nil, errors.New("fixed duration must be between 1 and 86400 seconds")
		}
	} else {
		config.FixedDurationSeconds = nil
	}
	if config.FallbackImageAssetID != nil {
		var valid bool
		if err := p.service.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assets WHERE id=$1 AND type='image' AND processing_status='ready' AND deleted_at IS NULL)`, *config.FallbackImageAssetID).Scan(&valid); err != nil {
			return nil, err
		}
		if !valid {
			return nil, errors.New("fallback asset must be a ready image")
		}
	}
	if config.FailureBehavior == "fallback_image" && config.FallbackImageAssetID == nil {
		return nil, errors.New("fallback image behavior requires a fallback image")
	}
	return config, nil
}

func (s *Service) sourceProvider(name string) (sourceProvider, error) {
	switch name {
	case "website":
		return websiteSourceProvider{s}, nil
	case "youtube":
		return youtubeSourceProvider{s}, nil
	case "calendar":
		return calendarSourceProvider{s}, nil
	default:
		return nil, errors.New("source provider is not supported")
	}
}

func (s *Service) CreateSource(ctx context.Context, user uuid.UUID, input SourceInput) (Asset, error) {
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	if input.Name == "" || len(input.Name) > 180 || len(input.Description) > 2000 {
		return Asset{}, errors.New("source name or description is invalid")
	}
	provider, err := s.sourceProvider(input.Provider)
	if err != nil {
		return Asset{}, err
	}
	if input.Provider != "website" {
		var count int
		if err = s.db.QueryRow(ctx, `SELECT count(*) FROM sources JOIN assets ON assets.id=sources.asset_id WHERE assets.deleted_at IS NULL`).Scan(&count); err != nil {
			return Asset{}, err
		}
		if count >= s.cfg.Website.MaxWebsites {
			return Asset{}, errors.New("source limit reached")
		}
	}
	configuration, err := provider.Normalize(ctx, input.Configuration)
	if err != nil {
		return Asset{}, err
	}
	if input.Provider == "website" {
		config := configuration.(WebsiteConfig)
		return s.CreateWebsite(ctx, user, WebsiteInput{Name: input.Name, Description: input.Description, WebsiteConfig: config, javascriptSet: true, domStorageSet: true})
	}
	encoded, _ := json.Marshal(configuration)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Asset{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var organizationID uuid.UUID
	if err = tx.QueryRow(ctx, `SELECT id FROM organization_settings WHERE singleton`).Scan(&organizationID); err != nil {
		return Asset{}, err
	}
	id := uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO assets(id,organization_id,name,description,type,original_filename,detected_mime_type,sha256,original_size,processing_status,created_by) VALUES($1,$2,$3,$4,'source','','application/vnd.tilecast.source+json',''::bytea,0,'ready',$5)`, id, organizationID, input.Name, input.Description, user); err != nil {
		return Asset{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO sources(asset_id,provider,config_version,configuration) VALUES($1,$2,1,$3::jsonb)`, id, input.Provider, string(encoded)); err != nil {
		return Asset{}, err
	}
	if input.Provider == "calendar" {
		if _, err = tx.Exec(ctx, `INSERT INTO source_refresh_states(asset_id) VALUES($1)`, id); err != nil {
			return Asset{}, err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'source.created','source',$3,jsonb_build_object('provider',$4::text))`, uuid.New(), user, id.String(), input.Provider); err != nil {
		return Asset{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Asset{}, err
	}
	return s.GetAsset(ctx, id)
}

func (s *Service) UpdateSource(ctx context.Context, id, user uuid.UUID, input SourceInput) (Asset, error) {
	existing, err := s.GetAsset(ctx, id)
	if err != nil || existing.Source == nil {
		return Asset{}, ErrNotFound
	}
	if input.Provider == "" {
		input.Provider = existing.Source.Provider
	}
	if input.Provider != existing.Source.Provider {
		return Asset{}, errors.New("source provider cannot be changed")
	}
	provider, err := s.sourceProvider(input.Provider)
	if err != nil {
		return Asset{}, err
	}
	configuration, err := provider.Normalize(ctx, input.Configuration)
	if err != nil {
		return Asset{}, err
	}
	if input.Provider == "website" {
		config := configuration.(WebsiteConfig)
		return s.UpdateWebsite(ctx, id, user, WebsiteInput{Name: input.Name, Description: input.Description, WebsiteConfig: config, javascriptSet: true, domStorageSet: true})
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 180 || len(input.Description) > 2000 {
		return Asset{}, errors.New("source name or description is invalid")
	}
	encoded, _ := json.Marshal(configuration)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Asset{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	tag, err := tx.Exec(ctx, `UPDATE assets SET name=$2,description=$3,updated_at=now() WHERE id=$1 AND type='source' AND deleted_at IS NULL`, id, input.Name, strings.TrimSpace(input.Description))
	if err != nil || tag.RowsAffected() == 0 {
		return Asset{}, ErrNotFound
	}
	if _, err = tx.Exec(ctx, `UPDATE sources SET configuration=$2::jsonb,config_version=1,updated_at=now() WHERE asset_id=$1`, id, string(encoded)); err != nil {
		return Asset{}, err
	}
	if input.Provider == "calendar" {
		if _, err = tx.Exec(ctx, `INSERT INTO source_refresh_states(asset_id,next_refresh_at) VALUES($1,now()) ON CONFLICT(asset_id) DO UPDATE SET next_refresh_at=now(),error_code=NULL,locked_at=NULL,locked_by=NULL,updated_at=now()`, id); err != nil {
			return Asset{}, err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id) VALUES($1,$2,'source.updated','source',$3)`, uuid.New(), user, id.String()); err != nil {
		return Asset{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Asset{}, err
	}
	if s.invalidator != nil {
		_ = s.invalidator.AssetChanged(ctx, id, "source.updated")
	}
	return s.GetAsset(ctx, id)
}

func (s *Service) DuplicateSource(ctx context.Context, id, user uuid.UUID) (Asset, error) {
	asset, err := s.GetAsset(ctx, id)
	if err != nil || asset.Source == nil {
		return Asset{}, ErrNotFound
	}
	return s.CreateSource(ctx, user, SourceInput{Provider: asset.Source.Provider, Name: asset.Name + " copy", Description: asset.Description, Configuration: asset.Source.Configuration})
}

func (s *Service) loadSource(ctx context.Context, id uuid.UUID) (*Source, error) {
	var source Source
	err := s.db.QueryRow(ctx, `SELECT provider,config_version,configuration FROM sources WHERE asset_id=$1`, id).Scan(&source.Provider, &source.ConfigVersion, &source.Configuration)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &source, err
}
