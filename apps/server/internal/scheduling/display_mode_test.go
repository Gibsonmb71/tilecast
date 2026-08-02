package scheduling

import "testing"

func TestNormalizeDisplayModeDefaultsToMirror(t *testing.T) {
	for _, mode := range []string{"", "mirror", "legacy", "MIRROR"} {
		if got := normalizeDisplayMode(mode); got != DisplayModeMirror {
			t.Fatalf("normalizeDisplayMode(%q) = %q, want %q", mode, got, DisplayModeMirror)
		}
	}
}

func TestNormalizeDisplayModePreservesSpan(t *testing.T) {
	if got := normalizeDisplayMode(DisplayModeSpan); got != DisplayModeSpan {
		t.Fatalf("normalizeDisplayMode(span) = %q, want %q", got, DisplayModeSpan)
	}
}
