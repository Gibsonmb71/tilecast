package playlists

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tilecast/tilecast/apps/server/internal/contentdefs"
)

type presentationWidgetRequirement struct {
	Name          string
	Provider      string
	PresetID      *string
	Configuration json.RawMessage
	Presentation  *WidgetPresentation
}

type playerPresentationCapabilities struct {
	SchemaVersions []int32
	Native         map[string]int
	WebRuntime     int
	PlayerVersion  int
	Reported       bool
}

type presentationQuery interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

// ValidatePresentationTargets checks the content reachable from one playlist or
// published Layout against every explicitly targeted screen and group member.
func (s *Service) ValidatePresentationTargets(ctx context.Context, playlistID, layoutID *uuid.UUID, screenIDs, groupIDs []uuid.UUID) error {
	if (playlistID == nil) == (layoutID == nil) {
		return errors.New("presentation requires exactly one playlist or Layout")
	}
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT sc.id
		FROM screens sc
		LEFT JOIN screen_group_memberships membership ON membership.screen_id=sc.id
		WHERE sc.deleted_at IS NULL
		  AND (sc.id=ANY($1::uuid[]) OR membership.screen_group_id=ANY($2::uuid[]))
		ORDER BY sc.id`, screenIDs, groupIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	targets := make([]uuid.UUID, 0, len(screenIDs))
	for rows.Next() {
		var screenID uuid.UUID
		if err = rows.Scan(&screenID); err != nil {
			return err
		}
		targets = append(targets, screenID)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	return validatePresentationForScreens(ctx, s.db, playlistID, layoutID, targets)
}

func validatePresentationForScreens(ctx context.Context, q presentationQuery, playlistID, layoutID *uuid.UUID, screenIDs []uuid.UUID) error {
	requirements, requiresV13, err := presentationRequirements(ctx, q, playlistID, layoutID)
	if err != nil {
		return err
	}
	for _, screenID := range screenIDs {
		player, err := readPlayerPresentationCapabilities(ctx, q, screenID)
		if err != nil {
			return err
		}
		if !player.Reported {
			if requiresV13 {
				return fmt.Errorf("%w: Player update required before assigning content that requires manifest v13", ErrConflict)
			}
			continue
		}
		for _, requirement := range requirements {
			if err := checkPresentationCompatibility(requirement.Name, requirement.Presentation, player); err != nil {
				return fmt.Errorf("%w: %v", ErrConflict, err)
			}
		}
	}
	return nil
}

func presentationRequirements(ctx context.Context, q presentationQuery, playlistID, layoutID *uuid.UUID) ([]presentationWidgetRequirement, bool, error) {
	rows, err := q.Query(ctx, `
		WITH selected_playlists AS (
			SELECT $1::uuid AS id WHERE $1::uuid IS NOT NULL
			UNION
			SELECT dependency.dependency_id
			FROM layouts layout
			JOIN layout_revision_dependencies dependency
			  ON dependency.revision_id=layout.published_revision_id
			 AND dependency.dependency_type='playlist'
			WHERE layout.id=$2::uuid
		),
		selected_widgets AS (
			SELECT item.asset_id
			FROM playlist_items item
			WHERE item.playlist_id IN (SELECT id FROM selected_playlists)
			UNION
			SELECT dependency.dependency_id
			FROM layouts layout
			JOIN layout_revision_dependencies dependency
			  ON dependency.revision_id=layout.published_revision_id
			 AND dependency.dependency_type='widget'
			WHERE layout.id=$2::uuid
		)
		SELECT asset.name,widget.provider,widget.preset_id,widget.configuration
		FROM selected_widgets selected
		JOIN widgets widget ON widget.asset_id=selected.asset_id
		JOIN assets asset ON asset.id=widget.asset_id
		WHERE asset.deleted_at IS NULL
		ORDER BY asset.name,widget.asset_id`, playlistID, layoutID)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	requirements := []presentationWidgetRequirement{}
	requiresV13 := false
	for rows.Next() {
		var requirement presentationWidgetRequirement
		if err = rows.Scan(&requirement.Name, &requirement.Provider, &requirement.PresetID, &requirement.Configuration); err != nil {
			return nil, false, err
		}
		requirement.Presentation, err = compileWidgetPresentationForPreset(requirement.Provider, requirement.PresetID, requirement.Configuration)
		if err != nil {
			return nil, false, fmt.Errorf("compile Widget %q: %w", requirement.Name, err)
		}
		if requirement.Presentation == nil {
			continue
		}
		if providerRequiresV13(requirement.Provider) {
			requiresV13 = true
		}
		requirements = append(requirements, requirement)
	}
	return requirements, requiresV13, rows.Err()
}

func providerRequiresV13(provider string) bool {
	if definition, ok := contentdefs.MustLoad().Widget(provider); ok {
		return definition.RequiresManifestV13
	}
	switch provider {
	case "spotlight", "stat_grid", "chart", "progress", "timeline", "world_clock":
		return true
	default:
		return false
	}
}

func readPlayerPresentationCapabilities(ctx context.Context, q presentationQuery, screenID uuid.UUID) (playerPresentationCapabilities, error) {
	var result playerPresentationCapabilities
	err := q.QueryRow(ctx, `
		SELECT COALESCE(presentation_schema_versions,'{}'::int[]),
		       COALESCE(native_presentation_capabilities,'{}'::jsonb),
		       COALESCE(web_runtime_version,0),
		       COALESCE(player_version_code,0)
		FROM screen_player_status
		WHERE screen_id=$1`, screenID).
		Scan(&result.SchemaVersions, &result.Native, &result.WebRuntime, &result.PlayerVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	result.Reported = len(result.SchemaVersions) > 0
	return result, nil
}

func checkPresentationCompatibility(name string, presentation *WidgetPresentation, player playerPresentationCapabilities) error {
	if presentation == nil {
		return nil
	}
	hasSchema := false
	for _, version := range player.SchemaVersions {
		if int(version) == presentation.SchemaVersion {
			hasSchema = true
			break
		}
	}
	if !hasSchema {
		return fmt.Errorf("This screen cannot display %q. Required presentation schema: %d. Reported: %s",
			name, presentation.SchemaVersion, reportedSchemaVersions(player.SchemaVersions))
	}
	capabilities := make([]string, 0, len(presentation.RequiredCapabilities))
	for capability := range presentation.RequiredCapabilities {
		capabilities = append(capabilities, capability)
	}
	sort.Strings(capabilities)
	for _, capability := range capabilities {
		required := presentation.RequiredCapabilities[capability]
		reported := player.Native[capability]
		if capability == "web.remote" {
			reported = player.WebRuntime
		}
		if reported < required {
			return fmt.Errorf("This screen cannot display %q. Required: %s@%d. Reported: %s@%d",
				name, capability, required, capability, reported)
		}
	}
	return nil
}

func reportedSchemaVersions(versions []int32) string {
	if len(versions) == 0 {
		return "none"
	}
	values := make([]string, 0, len(versions))
	for _, version := range versions {
		values = append(values, fmt.Sprint(version))
	}
	return strings.Join(values, ", ")
}
