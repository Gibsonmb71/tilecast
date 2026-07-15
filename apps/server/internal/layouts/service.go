package layouts

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Notifier interface{ ManifestChanged(uuid.UUID, int64) }
type Service struct {
	db       *pgxpool.Pool
	notifier Notifier
}

func NewService(db *pgxpool.Pool) *Service       { return &Service{db: db} }
func (s *Service) SetNotifier(notifier Notifier) { s.notifier = notifier }

func defaultDocument(orientation string, width, height int) Document {
	return Document{SchemaVersion: 1, Canvas: Canvas{Width: width, Height: height, Orientation: orientation, BackgroundColor: "#0E141B", SafeAreaPercent: 5}, Placements: []Placement{}}
}

func validateDetails(name, description, orientation string, width, height int) error {
	name = strings.TrimSpace(name)
	if len(name) < 1 || len(name) > 180 {
		return errors.New("layout name must be between 1 and 180 characters")
	}
	if len(description) > 2000 {
		return errors.New("layout description must be at most 2000 characters")
	}
	return ValidateDocument(defaultDocument(orientation, width, height))
}

func (s *Service) Create(ctx context.Context, userID uuid.UUID, name, description, orientation string, width, height int) (Layout, error) {
	name, description = strings.TrimSpace(name), strings.TrimSpace(description)
	if err := validateDetails(name, description, orientation, width, height); err != nil {
		return Layout{}, err
	}
	var org uuid.UUID
	if err := s.db.QueryRow(ctx, `SELECT id FROM organization_settings WHERE singleton=TRUE`).Scan(&org); err != nil {
		return Layout{}, err
	}
	document := defaultDocument(orientation, width, height)
	encoded, _ := json.Marshal(document)
	id := uuid.New()
	_, err := s.db.Exec(ctx, `INSERT INTO layouts(id,organization_id,name,description,orientation,canvas_width,canvas_height,draft_document,created_by,updated_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, id, org, name, description, orientation, width, height, encoded, userID)
	if err != nil {
		return Layout{}, err
	}
	_ = s.audit(ctx, userID, "layout.created", id)
	return s.Get(ctx, id)
}

func (s *Service) List(ctx context.Context, search string, page, pageSize int) (ListResult, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 30
	}
	if pageSize > 100 {
		pageSize = 100
	}
	search = strings.TrimSpace(search)
	var result ListResult
	result.Page, result.PageSize = page, pageSize
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM layouts WHERE deleted_at IS NULL AND($1='' OR name ILIKE '%'||$1||'%')`, search).Scan(&result.Total); err != nil {
		return result, err
	}
	rows, err := s.db.Query(ctx, `SELECT l.id,l.name,l.description,l.orientation,l.canvas_width,l.canvas_height,l.draft_revision,r.revision,r.published_at,l.created_at,l.updated_at FROM layouts l LEFT JOIN layout_revisions r ON r.id=l.published_revision_id WHERE l.deleted_at IS NULL AND($1='' OR l.name ILIKE '%'||$1||'%') ORDER BY l.updated_at DESC,l.id LIMIT $2 OFFSET $3`, search, pageSize, (page-1)*pageSize)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	result.Items = []Summary{}
	for rows.Next() {
		var item Summary
		if err = rows.Scan(&item.ID, &item.Name, &item.Description, &item.Orientation, &item.CanvasWidth, &item.CanvasHeight, &item.DraftRevision, &item.PublishedRevision, &item.PublishedAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return result, err
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Layout, error) {
	var result Layout
	var raw []byte
	result.ID = id
	err := s.db.QueryRow(ctx, `SELECT l.name,l.description,l.orientation,l.canvas_width,l.canvas_height,l.draft_document,l.draft_revision,l.published_revision_id,r.revision,r.published_at,l.created_at,l.updated_at FROM layouts l LEFT JOIN layout_revisions r ON r.id=l.published_revision_id WHERE l.id=$1 AND l.deleted_at IS NULL`, id).Scan(&result.Name, &result.Description, &result.Orientation, &result.CanvasWidth, &result.CanvasHeight, &raw, &result.DraftRevision, &result.PublishedRevisionID, &result.PublishedRevision, &result.PublishedAt, &result.CreatedAt, &result.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Layout{}, ErrNotFound
	}
	if err != nil {
		return Layout{}, err
	}
	if err = json.Unmarshal(raw, &result.Draft); err != nil {
		return Layout{}, err
	}
	result.Dependencies, err = s.draftDependencies(ctx, id)
	if err != nil {
		return Layout{}, err
	}
	result.Usage = Usage{Screens: []UsageItem{}, Schedules: []UsageItem{}}
	rows, err := s.db.Query(ctx, `SELECT DISTINCT sc.id,sc.name FROM screens sc LEFT JOIN screen_playlist_assignments a ON a.screen_id=sc.id LEFT JOIN screen_group_memberships m ON m.screen_id=sc.id LEFT JOIN screen_group_playlist_assignments ga ON ga.screen_group_id=m.screen_group_id WHERE a.layout_id=$1 OR ga.layout_id=$1 ORDER BY sc.name`, id)
	if err != nil {
		return Layout{}, err
	}
	for rows.Next() {
		var item UsageItem
		if err = rows.Scan(&item.ID, &item.Name); err != nil {
			rows.Close()
			return Layout{}, err
		}
		result.Usage.Screens = append(result.Usage.Screens, item)
	}
	rows.Close()
	rows, err = s.db.Query(ctx, `SELECT id,name FROM schedules WHERE layout_id=$1 AND deleted_at IS NULL ORDER BY name`, id)
	if err != nil {
		return Layout{}, err
	}
	for rows.Next() {
		var item UsageItem
		if err = rows.Scan(&item.ID, &item.Name); err != nil {
			rows.Close()
			return Layout{}, err
		}
		result.Usage.Schedules = append(result.Usage.Schedules, item)
	}
	rows.Close()
	return result, rows.Err()
}

func (s *Service) UpdateDetails(ctx context.Context, id, userID uuid.UUID, name, description string) (Layout, error) {
	current, err := s.Get(ctx, id)
	if err != nil {
		return Layout{}, err
	}
	name, description = strings.TrimSpace(name), strings.TrimSpace(description)
	if err = validateDetails(name, description, current.Orientation, current.CanvasWidth, current.CanvasHeight); err != nil {
		return Layout{}, err
	}
	command, err := s.db.Exec(ctx, `UPDATE layouts SET name=$1,description=$2,updated_by=$3,updated_at=now() WHERE id=$4 AND deleted_at IS NULL`, name, description, userID, id)
	if err != nil {
		return Layout{}, err
	}
	if command.RowsAffected() == 0 {
		return Layout{}, ErrNotFound
	}
	_ = s.audit(ctx, userID, "layout.updated", id)
	return s.Get(ctx, id)
}

func (s *Service) SaveDraft(ctx context.Context, id, userID uuid.UUID, expected int64, document Document) (Layout, error) {
	if err := ValidateDocument(document); err != nil {
		return Layout{}, err
	}
	deps := Dependencies(document)
	if err := s.validateDependencies(ctx, deps); err != nil {
		return Layout{}, err
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		return Layout{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Layout{}, err
	}
	defer tx.Rollback(ctx)
	command, err := tx.Exec(ctx, `UPDATE layouts SET draft_document=$1,draft_revision=draft_revision+1,orientation=$2,canvas_width=$3,canvas_height=$4,updated_by=$5,updated_at=now() WHERE id=$6 AND deleted_at IS NULL AND draft_revision=$7`, encoded, document.Canvas.Orientation, document.Canvas.Width, document.Canvas.Height, userID, id, expected)
	if err != nil {
		return Layout{}, err
	}
	if command.RowsAffected() == 0 {
		var exists bool
		_ = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM layouts WHERE id=$1 AND deleted_at IS NULL)`, id).Scan(&exists)
		if !exists {
			return Layout{}, ErrNotFound
		}
		return Layout{}, ErrConflict
	}
	if err = s.replaceDraftDependencies(ctx, tx, id, deps); err != nil {
		return Layout{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Layout{}, err
	}
	return s.Get(ctx, id)
}

func (s *Service) Publish(ctx context.Context, id, userID uuid.UUID, expected int64) (Revision, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Revision{}, err
	}
	defer tx.Rollback(ctx)
	var raw []byte
	var current int64
	err = tx.QueryRow(ctx, `SELECT draft_document,draft_revision FROM layouts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, id).Scan(&raw, &current)
	if errors.Is(err, pgx.ErrNoRows) {
		return Revision{}, ErrNotFound
	}
	if err != nil {
		return Revision{}, err
	}
	if current != expected {
		return Revision{}, ErrConflict
	}
	var document Document
	if err = json.Unmarshal(raw, &document); err != nil {
		return Revision{}, err
	}
	if err = ValidateDocument(document); err != nil {
		return Revision{}, err
	}
	deps := Dependencies(document)
	if err = s.validateDependenciesTx(ctx, tx, deps); err != nil {
		return Revision{}, err
	}
	if err = s.validatePlaybackLimitsTx(ctx, tx, document); err != nil {
		return Revision{}, err
	}
	if err = s.validateStructuredBindingsTx(ctx, tx, document); err != nil {
		return Revision{}, err
	}
	canonical, _ := json.Marshal(document)
	sum := sha256.Sum256(canonical)
	digest := hex.EncodeToString(sum[:])
	var revision int64
	if err = tx.QueryRow(ctx, `SELECT COALESCE(max(revision),0)+1 FROM layout_revisions WHERE layout_id=$1`, id).Scan(&revision); err != nil {
		return Revision{}, err
	}
	revisionID := uuid.New()
	_, err = tx.Exec(ctx, `INSERT INTO layout_revisions(id,layout_id,revision,document,document_sha256,published_by)VALUES($1,$2,$3,$4,$5,$6)`, revisionID, id, revision, canonical, digest, userID)
	if err != nil {
		return Revision{}, err
	}
	for _, dep := range deps {
		if _, err = tx.Exec(ctx, `INSERT INTO layout_revision_dependencies(revision_id,dependency_type,dependency_id)VALUES($1,$2,$3)`, revisionID, dep.Type, dep.ID); err != nil {
			return Revision{}, err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE layouts SET published_revision_id=$1,updated_by=$2,updated_at=now() WHERE id=$3`, revisionID, userID, id)
	if err != nil {
		return Revision{}, err
	}
	if err = insertAuditTx(ctx, tx, userID, "layout.published", id); err != nil {
		return Revision{}, err
	}
	rows, err := tx.Query(ctx, `WITH affected AS (
		SELECT screen_id FROM screen_playlist_assignments WHERE layout_id=$1
		UNION SELECT m.screen_id FROM screen_group_playlist_assignments a JOIN screen_group_memberships m ON m.screen_group_id=a.screen_group_id WHERE a.layout_id=$1
		UNION SELECT t.screen_id FROM schedules s JOIN schedule_targets t ON t.schedule_id=s.id WHERE s.layout_id=$1 AND s.deleted_at IS NULL AND t.screen_id IS NOT NULL
		UNION SELECT m.screen_id FROM schedules s JOIN schedule_targets t ON t.schedule_id=s.id JOIN screen_group_memberships m ON m.screen_group_id=t.screen_group_id WHERE s.layout_id=$1 AND s.deleted_at IS NULL
	) UPDATE screen_manifest_state state SET manifest_version=manifest_version+1,changed_at=now(),change_reason='layout.published' FROM affected WHERE state.screen_id=affected.screen_id RETURNING state.screen_id,state.manifest_version`, id)
	if err != nil {
		return Revision{}, err
	}
	type notice struct {
		screen  uuid.UUID
		version int64
	}
	notices := []notice{}
	for rows.Next() {
		var n notice
		if err = rows.Scan(&n.screen, &n.version); err != nil {
			rows.Close()
			return Revision{}, err
		}
		notices = append(notices, n)
	}
	rows.Close()
	if err = tx.Commit(ctx); err != nil {
		return Revision{}, err
	}
	if s.notifier != nil {
		for _, n := range notices {
			s.notifier.ManifestChanged(n.screen, n.version)
		}
	}
	return s.GetRevision(ctx, id, revisionID)
}

func (s *Service) Revisions(ctx context.Context, id uuid.UUID, page, pageSize int) (RevisionList, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	result := RevisionList{Items: []Revision{}, Page: page, PageSize: pageSize}
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM layout_revisions WHERE layout_id=$1`, id).Scan(&result.Total); err != nil {
		return result, err
	}
	rows, err := s.db.Query(ctx, `SELECT id,revision,document,document_sha256,published_by,published_at FROM layout_revisions WHERE layout_id=$1 ORDER BY revision DESC LIMIT $2 OFFSET $3`, id, pageSize, (page-1)*pageSize)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var item Revision
		var raw []byte
		item.LayoutID = id
		if err = rows.Scan(&item.ID, &item.Revision, &raw, &item.DocumentSHA256, &item.PublishedBy, &item.PublishedAt); err != nil {
			return result, err
		}
		if err = json.Unmarshal(raw, &item.Document); err != nil {
			return result, err
		}
		result.Items = append(result.Items, item)
	}
	if result.Total == 0 {
		var exists bool
		if err = s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM layouts WHERE id=$1 AND deleted_at IS NULL)`, id).Scan(&exists); err != nil {
			return result, err
		}
		if !exists {
			return result, ErrNotFound
		}
	}
	return result, rows.Err()
}

func (s *Service) GetRevision(ctx context.Context, layoutID, revisionID uuid.UUID) (Revision, error) {
	var result Revision
	var raw []byte
	result.ID = revisionID
	result.LayoutID = layoutID
	err := s.db.QueryRow(ctx, `SELECT revision,document,document_sha256,published_by,published_at FROM layout_revisions WHERE id=$1 AND layout_id=$2`, revisionID, layoutID).Scan(&result.Revision, &raw, &result.DocumentSHA256, &result.PublishedBy, &result.PublishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Revision{}, ErrNotFound
	}
	if err != nil {
		return Revision{}, err
	}
	err = json.Unmarshal(raw, &result.Document)
	return result, err
}

func (s *Service) Restore(ctx context.Context, id, revisionID, userID uuid.UUID, expected int64) (Layout, error) {
	revision, err := s.GetRevision(ctx, id, revisionID)
	if err != nil {
		return Layout{}, err
	}
	return s.SaveDraft(ctx, id, userID, expected, revision.Document)
}

func (s *Service) Duplicate(ctx context.Context, id, userID uuid.UUID) (Layout, error) {
	source, err := s.Get(ctx, id)
	if err != nil {
		return Layout{}, err
	}
	copy, err := s.Create(ctx, userID, source.Name+" copy", source.Description, source.Orientation, source.CanvasWidth, source.CanvasHeight)
	if err != nil {
		return Layout{}, err
	}
	return s.SaveDraft(ctx, copy.ID, userID, copy.DraftRevision, source.Draft)
}

func (s *Service) Delete(ctx context.Context, id, userID uuid.UUID) error {
	var inUse bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM screen_playlist_assignments WHERE layout_id=$1) OR EXISTS(SELECT 1 FROM screen_group_playlist_assignments WHERE layout_id=$1) OR EXISTS(SELECT 1 FROM schedules WHERE layout_id=$1 AND deleted_at IS NULL)`, id).Scan(&inUse); err != nil {
		return err
	}
	if inUse {
		return ErrInUse
	}
	command, err := s.db.Exec(ctx, `UPDATE layouts SET deleted_at=now(),updated_by=$1,updated_at=now() WHERE id=$2 AND deleted_at IS NULL`, userID, id)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	_ = s.audit(ctx, userID, "layout.deleted", id)
	return nil
}

func (s *Service) draftDependencies(ctx context.Context, id uuid.UUID) ([]Dependency, error) {
	rows, err := s.db.Query(ctx, `SELECT dependency_type,dependency_id FROM layout_draft_dependencies WHERE layout_id=$1 ORDER BY dependency_type,dependency_id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Dependency{}
	for rows.Next() {
		var item Dependency
		if err = rows.Scan(&item.Type, &item.ID); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
func (s *Service) replaceDraftDependencies(ctx context.Context, tx pgx.Tx, id uuid.UUID, deps []Dependency) error {
	if _, err := tx.Exec(ctx, `DELETE FROM layout_draft_dependencies WHERE layout_id=$1`, id); err != nil {
		return err
	}
	for _, dep := range deps {
		if _, err := tx.Exec(ctx, `INSERT INTO layout_draft_dependencies(layout_id,dependency_type,dependency_id)VALUES($1,$2,$3)`, id, dep.Type, dep.ID); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) validateDependencies(ctx context.Context, deps []Dependency) error {
	return s.validateDependencyQuery(ctx, s.db, deps)
}
func (s *Service) validatePlaybackLimitsTx(ctx context.Context, tx pgx.Tx, document Document) error {
	videoCapable, audioEmitting := 0, 0
	for _, placement := range document.Placements {
		if !placement.Visible {
			continue
		}
		video, audio := false, false
		switch placement.Type {
		case "asset":
			var assetType string
			if err := tx.QueryRow(ctx, `SELECT type FROM assets WHERE id=$1`, placement.AssetID).Scan(&assetType); err != nil {
				return err
			}
			video = assetType == "video"
			audio = video && (placement.Playback == nil || !placement.Playback.Muted)
		case "app":
			var provider string
			if err := tx.QueryRow(ctx, `SELECT provider FROM sources WHERE asset_id=$1`, placement.AppID).Scan(&provider); err != nil {
				return err
			}
			video = provider == "website" || provider == "youtube"
			muted := false
			if len(placement.Overrides) > 0 {
				var overrides struct {
					Muted *bool `json:"muted"`
				}
				_ = json.Unmarshal(placement.Overrides, &overrides)
				muted = overrides.Muted != nil && *overrides.Muted
			}
			audio = video && !muted
		case "playlistZone":
			if err := tx.QueryRow(ctx, `SELECT EXISTS(
				SELECT 1 FROM playlist_items i JOIN assets a ON a.id=i.asset_id
				LEFT JOIN sources src ON src.asset_id=a.id
				WHERE i.playlist_id=$1 AND (a.type='video' OR src.provider IN ('website','youtube'))
			)`, placement.PlaylistID).Scan(&video); err != nil {
				return err
			}
			audio = video && (placement.Playback == nil || !placement.Playback.Muted)
		}
		if video {
			videoCapable++
		}
		if audio {
			audioEmitting++
		}
	}
	if videoCapable > 1 {
		return errors.New("layout may contain only one visible video-capable placement or playlist zone")
	}
	if audioEmitting > 1 {
		return errors.New("layout may contain only one audio-emitting placement or playlist zone")
	}
	return nil
}

func (s *Service) validateStructuredBindingsTx(ctx context.Context, tx pgx.Tx, document Document) error {
	placedApps := map[uuid.UUID]bool{}
	for _, placement := range document.Placements {
		if placement.Type == "app" && placement.AppID != nil {
			placedApps[*placement.AppID] = true
		}
	}
	for _, placement := range document.Placements {
		if placement.Primitive == nil || placement.Primitive.Binding == nil {
			continue
		}
		binding := placement.Primitive.Binding
		if !placedApps[binding.SourceID] {
			return errors.New("structured binding requires its data Source to be placed in the Layout")
		}
		var provider string
		if err := tx.QueryRow(ctx, `SELECT provider FROM sources WHERE asset_id=$1`, binding.SourceID).Scan(&provider); err != nil {
			return err
		}
		if provider != "csv" && provider != "json" {
			return errors.New("structured binding requires a CSV or JSON data Source")
		}
	}
	return nil
}

func (s *Service) validateDependenciesTx(ctx context.Context, tx pgx.Tx, deps []Dependency) error {
	return s.validateDependencyQuery(ctx, tx, deps)
}

type queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *Service) validateDependencyQuery(ctx context.Context, q queryer, deps []Dependency) error {
	for _, dep := range deps {
		var valid bool
		switch dep.Type {
		case "app":
			err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assets a JOIN sources s ON s.asset_id=a.id WHERE a.id=$1 AND a.deleted_at IS NULL AND a.processing_status='ready')`, dep.ID).Scan(&valid)
			if err != nil {
				return err
			}
		case "asset":
			err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assets WHERE id=$1 AND deleted_at IS NULL AND processing_status='ready')`, dep.ID).Scan(&valid)
			if err != nil {
				return err
			}
		case "playlist":
			err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM playlists WHERE id=$1 AND deleted_at IS NULL)`, dep.ID).Scan(&valid)
			if err != nil {
				return err
			}
		default:
			return errors.New("layout dependency type is invalid")
		}
		if !valid {
			return fmt.Errorf("layout %s dependency %s is unavailable", dep.Type, dep.ID)
		}
	}
	return nil
}
func (s *Service) audit(ctx context.Context, userID uuid.UUID, action string, id uuid.UUID) error {
	_, err := s.db.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,$3,'layout',$4)`, uuid.New(), userID, action, id.String())
	return err
}
func insertAuditTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, action string, id uuid.UUID) error {
	_, err := tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,$3,'layout',$4)`, uuid.New(), userID, action, id.String())
	return err
}
