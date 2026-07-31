package playlists

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/database"
	"github.com/tilecast/tilecast/apps/server/internal/plugins"
)

// stubProjector stands in for the plugins service so this test covers manifest
// assembly's half of the contract — media resolution — and nothing else.
type stubProjector struct{ items []plugins.ManifestPlugin }

func (p *stubProjector) ManifestForScreen(context.Context, uuid.UUID) ([]plugins.ManifestPlugin, error) {
	// Fresh configs per call: assembly mutates them in place.
	out := make([]plugins.ManifestPlugin, 0, len(p.items))
	for _, item := range p.items {
		config, ok := item.Config.(*plugins.ManifestBrandBugConfig)
		if !ok {
			out = append(out, item)
			continue
		}
		copied := *config
		out = append(out, plugins.ManifestPlugin{ID: item.ID, Type: item.Type, Version: item.Version, Config: &copied})
	}
	return out, nil
}

func brandBug(assetID *uuid.UUID, text string) plugins.ManifestPlugin {
	return plugins.ManifestPlugin{
		ID: uuid.New(), Type: "brand_bug", Version: 1,
		Config: &plugins.ManifestBrandBugConfig{
			Name: "Sponsor", Corner: "top_right", ImageAssetID: assetID, Text: text,
			WidthPercent: 12, TextSizePercent: 3, OpacityPercent: 90, MarginPercent: 3,
			TextColor: "#ffffff", BackgroundStyle: "scrim",
		},
	}
}

func TestBrandBugLogoBecomesAManifestAsset(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	lockPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer lockPool.Close()
	lock, err := lockPool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()
	if _, err = lock.Exec(ctx, `SELECT pg_advisory_lock(7421999)`); err != nil {
		t.Fatal(err)
	}
	defer lock.Exec(ctx, `SELECT pg_advisory_unlock(7421999)`) //nolint:errcheck
	if err = database.Migrate(ctx, databaseURL); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err = pool.Exec(ctx, `TRUNCATE organization_settings,users CASCADE`); err != nil {
		t.Fatal(err)
	}
	org, userID, screenID := uuid.New(), uuid.New(), uuid.New()
	assetID, variantID := uuid.New(), uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO organization_settings(singleton,organization_name,id) VALUES(TRUE,'Plugin Assets',$1)`, org); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,username,password_hash,role,active) VALUES($1,'Owner','plugin-assets-owner','unused','owner',TRUE)`, userID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO screens(id,organization_id,player_installation_id,name,platform,device_manufacturer,
		device_model,android_version,player_version,screen_width,screen_height,density,locale,timezone)
		VALUES($1,$2,$3,'Lobby','linux','Test','Display','Linux','1',1920,1080,1,'en-US','UTC')`, screenID, org, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO screen_manifest_state(screen_id) VALUES($1)`, screenID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,
		original_size,width,height,processing_status,created_by)
		VALUES($1,$2,'District logo','image','logo.png','image/png',$3,100,600,200,'ready',$4)`, assetID, org, make([]byte, 32), userID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO asset_variants(id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,
		sha256,width,height,player_compatible) VALUES($1,$2,'original','local','originals/logo','image/png',100,$3,600,200,TRUE)`,
		variantID, assetID, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}

	service := NewService(pool, &testNotifier{})
	projector := &stubProjector{items: []plugins.ManifestPlugin{brandBug(&assetID, "Presented by Example")}}
	service.SetPluginProjector(projector)

	manifest, _, err := service.BuildManifest(ctx, screenID)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Plugins) != 1 {
		t.Fatalf("plugins=%#v", manifest.Plugins)
	}
	config, ok := manifest.Plugins[0].Config.(*plugins.ManifestBrandBugConfig)
	if !ok || config.ImageVariantID == nil || *config.ImageVariantID != variantID {
		t.Fatalf("logo variant was not resolved: %#v", manifest.Plugins[0].Config)
	}
	var projected *ManifestAsset
	for index, asset := range manifest.Assets {
		if asset.VariantID == variantID {
			projected = &manifest.Assets[index]
		}
	}
	if projected == nil {
		t.Fatalf("logo was not projected as an asset: %#v", manifest.Assets)
	}
	if projected.DownloadPath != "/api/v1/player/assets/"+assetID.String()+"/variants/"+variantID.String() {
		t.Fatalf("download path=%q", projected.DownloadPath)
	}

	// A logo that disappeared after the instance was saved must degrade to the
	// mark's text, never fail the manifest.
	missing := uuid.New()
	projector.items = []plugins.ManifestPlugin{brandBug(&missing, "Presented by Example")}
	manifest, _, err = service.BuildManifest(ctx, screenID)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Plugins) != 1 {
		t.Fatalf("text-only fallback was dropped: %#v", manifest.Plugins)
	}
	config, ok = manifest.Plugins[0].Config.(*plugins.ManifestBrandBugConfig)
	if !ok || config.ImageAssetID != nil || config.ImageVariantID != nil {
		t.Fatalf("unavailable logo was still published: %#v", manifest.Plugins[0].Config)
	}

	// The worker marks a variant player-compatible before the asset finishes
	// processing, so compatibility alone must not publish a logo.
	processingID, processingVariantID := uuid.New(), uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,
		original_size,width,height,processing_status,created_by)
		VALUES($1,$2,'Fresh logo','image','fresh.png','image/png',$3,100,600,200,'processing',$4)`, processingID, org, make([]byte, 32), userID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO asset_variants(id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,
		sha256,width,height,player_compatible) VALUES($1,$2,'original','local','originals/fresh','image/png',100,$3,600,200,TRUE)`,
		processingVariantID, processingID, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	projector.items = []plugins.ManifestPlugin{brandBug(&processingID, "Presented by Example")}
	manifest, _, err = service.BuildManifest(ctx, screenID)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Plugins) != 1 {
		t.Fatalf("text-only fallback was dropped: %#v", manifest.Plugins)
	}
	config, ok = manifest.Plugins[0].Config.(*plugins.ManifestBrandBugConfig)
	if !ok || config.ImageAssetID != nil || config.ImageVariantID != nil {
		t.Fatalf("processing logo was published: %#v", manifest.Plugins[0].Config)
	}
	for _, asset := range manifest.Assets {
		if asset.VariantID == processingVariantID {
			t.Fatalf("processing logo was projected as an asset: %#v", manifest.Assets)
		}
	}

	// With nothing left to draw, the mark is not published at all.
	projector.items = []plugins.ManifestPlugin{brandBug(&missing, "")}
	manifest, _, err = service.BuildManifest(ctx, screenID)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Plugins) != 0 {
		t.Fatalf("undrawable mark was published: %#v", manifest.Plugins)
	}
}
