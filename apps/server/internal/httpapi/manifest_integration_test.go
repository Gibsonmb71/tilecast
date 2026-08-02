package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tilecast/tilecast/apps/server/internal/devices"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
)

func TestPlayerManifestConditionalRequestCannotKeepAnOldVersion(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		env.server.playlists = playlists.NewService(env.pool, nil)
		if _, err := env.pool.Exec(context.Background(), `INSERT INTO screen_manifest_state(screen_id) VALUES($1) ON CONFLICT DO NOTHING`, env.screenID); err != nil {
			t.Fatal(err)
		}
		principal := devices.DevicePrincipal{ScreenID: env.screenID, ScreenName: "Cafeteria TV", Enabled: true}
		request := func(etag string) *httptest.ResponseRecorder {
			r := httptest.NewRequest(http.MethodGet, "/api/v1/player/manifest", nil)
			if etag != "" {
				r.Header.Set("If-None-Match", etag)
			}
			r = r.WithContext(context.WithValue(r.Context(), deviceContextKey, principal))
			response := httptest.NewRecorder()
			env.server.playerManifest(response, r)
			return response
		}

		first := request("")
		if first.Code != http.StatusOK {
			t.Fatalf("first manifest status=%d body=%s", first.Code, first.Body.String())
		}
		etag := first.Header().Get("ETag")
		if etag == "" {
			t.Fatal("first manifest did not include an ETag")
		}
		if cached := request(etag); cached.Code != http.StatusNotModified {
			t.Fatalf("conditional manifest status=%d body=%s", cached.Code, cached.Body.String())
		}

		if _, err := env.pool.Exec(context.Background(), `UPDATE screen_manifest_state SET manifest_version=manifest_version+1,change_reason='nested dependency changed' WHERE screen_id=$1`, env.screenID); err != nil {
			t.Fatal(err)
		}
		fresh := request(etag)
		if fresh.Code != http.StatusOK {
			t.Fatalf("changed manifest status=%d body=%s", fresh.Code, fresh.Body.String())
		}
		if fresh.Header().Get("ETag") == etag {
			t.Fatal("changed manifest reused the old ETag")
		}
	})
}
