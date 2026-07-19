package backup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	stagingSuffix    = ".restore-staging"
	preRestoreSuffix = ".pre-restore"
)

// mediaSubdirectories are recreated in a staged media root so the restored
// tree matches what media.NewLocalStorage expects.
var mediaSubdirectories = []string{"originals", "variants", "thumbnails", "uploads", "trash"}

// stageFiles extracts the media and updates components of a verified archive
// into staging directories beside the live roots (same volume, so activation
// is an atomic rename). Every file is re-hashed against the manifest during
// extraction. Local GitHub OAuth state is preserved from the live updates
// root because backups never contain it.
func stageFiles(ctx context.Context, archivePath string, manifest Manifest, mediaRoot, updatesRoot string, limits Limits, progress func(done, total int)) error {
	mediaStaging := mediaRoot + stagingSuffix
	updatesStaging := updatesRoot + stagingSuffix
	for _, staging := range []string{mediaStaging, updatesStaging} {
		if err := os.RemoveAll(staging); err != nil {
			return fmt.Errorf("clear stale staging directory: %w", err)
		}
	}
	for _, sub := range mediaSubdirectories {
		if err := os.MkdirAll(filepath.Join(mediaStaging, sub), 0o750); err != nil {
			return fmt.Errorf("prepare media staging: %w", err)
		}
	}
	if err := os.MkdirAll(updatesStaging, 0o750); err != nil {
		return fmt.Errorf("prepare updates staging: %w", err)
	}

	expected := make(map[string]ManifestFile, len(manifest.Files))
	for _, file := range manifest.Files {
		expected[file.Path] = file
	}

	total := 0
	for _, file := range manifest.Files {
		if !strings.HasPrefix(file.Path, databasePrefix) {
			total++
		}
	}
	done := 0
	_, err := walkArchive(archivePath, limits, func(entry archiveEntry) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if strings.HasPrefix(entry.Path, databasePrefix) {
			return nil
		}
		want, ok := expected[entry.Path]
		if !ok {
			return fmt.Errorf("archive entry %s is not listed in the manifest", entry.Path)
		}
		target, err := stagedPathFor(entry.Path, mediaStaging, updatesStaging)
		if err != nil {
			return err
		}
		if err := extractRegularFile(entry, want, target); err != nil {
			return err
		}
		done++
		if progress != nil && total > 0 {
			progress(done, total)
		}
		return nil
	})
	if err != nil {
		return err
	}

	// Keep the local GitHub connection working after restore: OAuth state is
	// deliberately excluded from archives.
	entries, err := os.ReadDir(updatesRoot)
	if err == nil {
		for _, entry := range entries {
			if entry.Type().IsRegular() && strings.HasPrefix(entry.Name(), "github-oauth") {
				if err := copyFile(filepath.Join(updatesRoot, entry.Name()), filepath.Join(updatesStaging, entry.Name())); err != nil {
					return fmt.Errorf("preserve GitHub connection state: %w", err)
				}
			}
		}
	}
	return nil
}

// stagedPathFor maps an archive entry to its staged location, re-checking
// that the joined path stays inside the staging root.
func stagedPathFor(entryPath, mediaStaging, updatesStaging string) (string, error) {
	var root, rel string
	switch {
	case strings.HasPrefix(entryPath, mediaPrefix):
		root, rel = mediaStaging, strings.TrimPrefix(entryPath, mediaPrefix)
	case strings.HasPrefix(entryPath, updatesPrefix):
		root, rel = updatesStaging, strings.TrimPrefix(entryPath, updatesPrefix)
	default:
		return "", fmt.Errorf("archive entry %s is outside the expected layout", entryPath)
	}
	target := filepath.Join(root, filepath.FromSlash(rel))
	cleanRoot := filepath.Clean(root) + string(os.PathSeparator)
	if !strings.HasPrefix(filepath.Clean(target), cleanRoot) {
		return "", fmt.Errorf("archive entry %s escapes the staging directory", entryPath)
	}
	return target, nil
}

func extractRegularFile(entry archiveEntry, want ManifestFile, target string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return fmt.Errorf("prepare directory for %s: %w", entry.Path, err)
	}
	out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o640)
	if err != nil {
		return fmt.Errorf("create %s: %w", entry.Path, err)
	}
	digest := sha256.New()
	written, err := io.Copy(out, io.TeeReader(io.LimitReader(entry.Body, entry.Size), digest))
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return fmt.Errorf("extract %s: %w", entry.Path, err)
	}
	if written != want.SizeBytes || hex.EncodeToString(digest.Sum(nil)) != want.SHA256 {
		return fmt.Errorf("%s failed its checksum during extraction", entry.Path)
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// activateStagedFiles swaps staged trees into place, keeping the previous
// trees under a .pre-restore suffix until the whole restore succeeds. On any
// failure it undoes the renames it already performed.
func activateStagedFiles(mediaRoot, updatesRoot string) error {
	type swap struct{ live, staging, previous string }
	swaps := []swap{
		{mediaRoot, mediaRoot + stagingSuffix, mediaRoot + preRestoreSuffix},
		{updatesRoot, updatesRoot + stagingSuffix, updatesRoot + preRestoreSuffix},
	}
	var completed []swap
	rollback := func() {
		for i := len(completed) - 1; i >= 0; i-- {
			s := completed[i]
			os.Rename(s.live, s.staging)
			os.Rename(s.previous, s.live)
		}
	}
	for _, s := range swaps {
		if err := os.RemoveAll(s.previous); err != nil {
			rollback()
			return fmt.Errorf("clear stale pre-restore directory: %w", err)
		}
		if _, err := os.Stat(s.live); err == nil {
			if err := os.Rename(s.live, s.previous); err != nil {
				rollback()
				return fmt.Errorf("set aside current files: %w", err)
			}
		}
		if err := os.Rename(s.staging, s.live); err != nil {
			os.Rename(s.previous, s.live)
			rollback()
			return fmt.Errorf("activate restored files: %w", err)
		}
		completed = append(completed, s)
	}
	return nil
}

// rollbackActivatedFiles restores the .pre-restore trees after a failed
// activation or validation.
func rollbackActivatedFiles(mediaRoot, updatesRoot string) error {
	var firstErr error
	for _, root := range []string{mediaRoot, updatesRoot} {
		previous := root + preRestoreSuffix
		if _, err := os.Stat(previous); os.IsNotExist(err) {
			continue
		}
		if err := os.RemoveAll(root); err != nil && firstErr == nil {
			firstErr = err
		}
		if err := os.Rename(previous, root); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// finalizeActivatedFiles removes the .pre-restore and staging leftovers once
// a restore has fully succeeded.
func finalizeActivatedFiles(mediaRoot, updatesRoot string) {
	for _, root := range []string{mediaRoot, updatesRoot} {
		os.RemoveAll(root + preRestoreSuffix)
		os.RemoveAll(root + stagingSuffix)
	}
}

// validateRestoredFiles checks that the activated roots are present and
// writable, mirroring the media storage write probe.
func validateRestoredFiles(mediaRoot, updatesRoot string) error {
	for _, sub := range mediaSubdirectories {
		if err := os.MkdirAll(filepath.Join(mediaRoot, sub), 0o750); err != nil {
			return fmt.Errorf("restored media tree is invalid: %w", err)
		}
	}
	for _, root := range []string{mediaRoot, updatesRoot} {
		probe := filepath.Join(root, ".write-test")
		if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
			return fmt.Errorf("restored storage at %s is not writable: %w", root, err)
		}
		os.Remove(probe)
	}
	return nil
}
