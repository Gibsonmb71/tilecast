package scheduling

const (
	DisplayModeMirror = "mirror"
	DisplayModeSpan   = "span"
)

// normalizeDisplayMode keeps API responses safe when they are read from an
// older server or an export made before Display Groups had an explicit mode.
// The database migration makes Mirror the stored default for existing rows;
// this second guard keeps the public contract backwards compatible at the
// application boundary as well.
func normalizeDisplayMode(mode string) string {
	if mode == DisplayModeSpan {
		return DisplayModeSpan
	}
	return DisplayModeMirror
}
