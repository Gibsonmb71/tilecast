.PHONY: android-build android-check bootstrap build check dev-dashboard dev-server docs-check format test

bootstrap:
	npm install
	cd apps/server && go mod download

build:
	npm run build
	rm -rf apps/server/internal/web/static
	mkdir -p apps/server/internal/web/static
	cp -R apps/dashboard/dist/. apps/server/internal/web/static/
	cd apps/server && go build ./cmd/tilecast
	cd apps/player-android && ./gradlew assembleDebug

check:
	$(MAKE) docs-check
	npm run format:check
	npm run lint
	npm test
	cd apps/server && test -z "$$(gofmt -l .)" && go vet ./... && go test ./...
	cd apps/player-android && ./gradlew testDebugUnitTest lintDebug

android-build:
	cd apps/player-android && ./gradlew assembleDebug assembleRelease

android-check:
	cd apps/player-android && ./gradlew testDebugUnitTest lintDebug

dev-dashboard:
	npm run dev

dev-server:
	cd apps/server && go run ./cmd/tilecast

format:
	npm run format
	cd apps/server && gofmt -w $$(find . -name '*.go' -type f)

test:
	npm test
	cd apps/server && go test ./...

docs-check:
	bash scripts/check-docs-ste.sh
