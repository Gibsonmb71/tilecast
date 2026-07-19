package backup

import (
	"archive/tar"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
)

// VerifyResult reports a successful full verification.
type VerifyResult struct {
	Manifest      Manifest
	ArchiveSHA256 string
	SizeBytes     int64
	FileCount     int
}

// Verify reads the entire archive, enforcing structural security rules and
// comparing every entry against the manifest checksums. It fails on missing
// components, extra or missing files, checksum mismatches, unsafe entries,
// corrupt archives, and unsupported format versions.
func Verify(ctx context.Context, path string, limits Limits) (VerifyResult, error) {
	observed := make(map[string]ManifestFile)
	archiveDigest := sha256.New()

	file, err := os.Open(path)
	if err != nil {
		return VerifyResult{}, fmt.Errorf("open archive: %w", err)
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return VerifyResult{}, fmt.Errorf("stat archive: %w", err)
	}

	// Hash the raw archive bytes while walking entries.
	tee := io.TeeReader(file, archiveDigest)
	manifest, err := walkTarStream(tee, limits, func(entry archiveEntry) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		digest := sha256.New()
		n, err := io.Copy(digest, entry.Body)
		if err != nil {
			return fmt.Errorf("read archive entry %s: %w", entry.Path, err)
		}
		observed[entry.Path] = ManifestFile{Path: entry.Path, SizeBytes: n, SHA256: hex.EncodeToString(digest.Sum(nil))}
		return nil
	})
	if err != nil {
		return VerifyResult{}, err
	}
	// Consume any trailing bytes so the archive hash covers the whole file.
	if _, err := io.Copy(io.Discard, tee); err != nil {
		return VerifyResult{}, fmt.Errorf("read archive trailer: %w", err)
	}

	if len(observed) != len(manifest.Files) {
		return VerifyResult{}, fmt.Errorf("archive holds %d files but the manifest lists %d", len(observed), len(manifest.Files))
	}
	for _, expected := range manifest.Files {
		actual, ok := observed[expected.Path]
		if !ok {
			return VerifyResult{}, fmt.Errorf("archive is missing %s listed in the manifest", expected.Path)
		}
		if actual.SizeBytes != expected.SizeBytes {
			return VerifyResult{}, fmt.Errorf("%s is %d bytes but the manifest expects %d", expected.Path, actual.SizeBytes, expected.SizeBytes)
		}
		if actual.SHA256 != expected.SHA256 {
			return VerifyResult{}, fmt.Errorf("%s failed its checksum", expected.Path)
		}
	}

	return VerifyResult{
		Manifest:      manifest,
		ArchiveSHA256: hex.EncodeToString(archiveDigest.Sum(nil)),
		SizeBytes:     stat.Size(),
		FileCount:     len(manifest.Files),
	}, nil
}

// Inspect reads only the archive headers and manifest without hashing file
// bodies. Structural security rules still apply.
func Inspect(ctx context.Context, path string, limits Limits) (Manifest, int64, error) {
	stat, err := os.Stat(path)
	if err != nil {
		return Manifest{}, 0, fmt.Errorf("stat archive: %w", err)
	}
	manifest, err := walkArchive(path, limits, func(entry archiveEntry) error {
		return ctx.Err()
	})
	if err != nil {
		return Manifest{}, 0, err
	}
	return manifest, stat.Size(), nil
}

// walkTarStream mirrors walkArchive over an io.Reader so verification can
// hash the raw archive bytes in the same pass.
func walkTarStream(r io.Reader, limits Limits, handle func(archiveEntry) error) (Manifest, error) {
	limits = limits.normalized()
	reader := tar.NewReader(r)
	var manifest *Manifest
	var count int
	var expanded int64
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return Manifest{}, fmt.Errorf("archive is corrupt: %w", err)
		}
		count++
		if count > limits.MaxFiles {
			return Manifest{}, fmt.Errorf("archive contains more than %d entries", limits.MaxFiles)
		}
		if header.Typeflag != tar.TypeReg {
			return Manifest{}, fmt.Errorf("archive entry %q is not a regular file", header.Name)
		}
		if err := validateArchivePath(header.Name); err != nil {
			return Manifest{}, err
		}
		if header.Size < 0 {
			return Manifest{}, fmt.Errorf("archive entry %q has a negative size", header.Name)
		}
		expanded += header.Size
		if expanded > limits.MaxExpandedBytes {
			return Manifest{}, fmt.Errorf("archive expands beyond the configured limit of %d bytes", limits.MaxExpandedBytes)
		}
		if header.Name == ManifestPath {
			if manifest != nil {
				return Manifest{}, fmt.Errorf("archive contains more than one manifest")
			}
			if header.Size > 256<<20 {
				return Manifest{}, fmt.Errorf("archive manifest is unreasonably large")
			}
			payload, err := io.ReadAll(io.LimitReader(reader, header.Size))
			if err != nil {
				return Manifest{}, fmt.Errorf("read manifest: %w", err)
			}
			decoded, err := decodeManifest(payload)
			if err != nil {
				return Manifest{}, err
			}
			manifest = &decoded
			continue
		}
		if err := handle(archiveEntry{Path: header.Name, Size: header.Size, Body: reader}); err != nil {
			return Manifest{}, err
		}
	}
	if manifest == nil {
		return Manifest{}, fmt.Errorf("archive has no manifest and cannot be a Tilecast backup")
	}
	if err := manifest.Validate(); err != nil {
		return Manifest{}, err
	}
	return *manifest, nil
}
