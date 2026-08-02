package manifestchanges

import "github.com/google/uuid"

// Change is the committed manifest version a player may be told to fetch.
// Domain mutations collect these while holding their own transaction and
// publish them only after that transaction commits.
type Change struct {
	ScreenID uuid.UUID
	Version  int64
}
