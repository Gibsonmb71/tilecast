package database

import "testing"

func TestEmbeddedMigrationsAreCollectible(t *testing.T) {
	if _, err := LatestMigrationVersion(); err != nil {
		t.Fatalf("collect embedded migrations: %v", err)
	}
}
