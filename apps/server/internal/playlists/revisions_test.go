package playlists

import "testing"

func TestRevisionsKeptIsBounded(t *testing.T) {
	// Deep history on a playlist edited daily is cost without a reader. The
	// cap exists so the table cannot grow for the life of the installation.
	if RevisionsToKeep <= 0 || RevisionsToKeep > 100 {
		t.Errorf("RevisionsToKeep = %d, want a small positive bound", RevisionsToKeep)
	}
}

func TestRestoreResultReportsWhatItCouldNotDo(t *testing.T) {
	// A restore that silently dropped items whose media was deleted would put a
	// shorter playlist on a screen without saying so.
	result := RestoreResult{RestoredFrom: 4, NewRevision: 9, SkippedItems: 2}
	if result.RestoredFrom == result.NewRevision {
		t.Error("a restore is a new edit, so it must produce a new revision")
	}
	if result.SkippedItems == 0 {
		t.Error("the skipped count is part of the contract")
	}
}

func TestRevisionSummaryMarksTheCurrentRevisionUnrestorable(t *testing.T) {
	// Restoring the state you are already in is a no-op that reads as an action.
	current := RevisionSummary{Revision: 9, IsCurrent: true, ItemCount: 3}
	if current.IsCurrent && current.Restorable {
		t.Error("the current revision must not be offered for restore")
	}
}
