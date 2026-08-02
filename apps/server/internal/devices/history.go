package devices

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

func recordPlayerHistory(ctx context.Context, db execer, screenID, credentialID uuid.UUID, metadata DeviceMetadata) error {
	if _, err := db.Exec(ctx, `INSERT INTO screen_player_history (id,screen_id,credential_id,installation_id,platform,manufacturer,model,android_version,player_version,screen_width,screen_height,density,locale,timezone,paired_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())`, uuid.New(), screenID, credentialID, metadata.PlayerInstallationID, metadata.Platform, metadata.Manufacturer, metadata.Model, metadata.AndroidVersion, metadata.PlayerVersion, metadata.ScreenWidth, metadata.ScreenHeight, metadata.Density, metadata.Locale, metadata.Timezone); err != nil {
		return fmt.Errorf("record player hardware history: %w", err)
	}
	return nil
}

func (s *Service) ListPlayerHistory(ctx context.Context, screenID uuid.UUID) ([]PlayerHistory, error) {
	rows, err := s.db.Query(ctx, `SELECT id,screen_id,credential_id,installation_id,platform,manufacturer,model,android_version,player_version,screen_width,screen_height,density,locale,timezone,paired_at,retired_at,retirement_reason FROM screen_player_history WHERE screen_id=$1 ORDER BY paired_at DESC,id DESC`, screenID)
	if err != nil {
		return nil, fmt.Errorf("list player history: %w", err)
	}
	defer rows.Close()
	result := make([]PlayerHistory, 0)
	for rows.Next() {
		var history PlayerHistory
		if err := rows.Scan(&history.ID, &history.ScreenID, &history.CredentialID, &history.InstallationID, &history.Platform, &history.Manufacturer, &history.Model, &history.AndroidVersion, &history.PlayerVersion, &history.ScreenWidth, &history.ScreenHeight, &history.Density, &history.Locale, &history.Timezone, &history.PairedAt, &history.RetiredAt, &history.RetirementReason); err != nil {
			return nil, fmt.Errorf("scan player history: %w", err)
		}
		result = append(result, history)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
