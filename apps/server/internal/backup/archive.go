package backup

import (
	"archive/tar"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"time"
)

// Limits bounds archive reading so corrupt or malicious archives cannot
// exhaust the server. Zero values fall back to conservative defaults.
type Limits struct {
	MaxFiles         int
	MaxExpandedBytes int64
}

func (l Limits) normalized() Limits {
	if l.MaxFiles <= 0 {
		l.MaxFiles = 2_000_000
	}
	if l.MaxExpandedBytes <= 0 {
		l.MaxExpandedBytes = 4 << 40 // 4 TiB
	}
	return l
}

// archiveWriter writes tar entries while hashing each file body.
type archiveWriter struct {
	tw    *tar.Writer
	files []ManifestFile
}

func newArchiveWriter(w io.Writer) *archiveWriter {
	return &archiveWriter{tw: tar.NewWriter(w)}
}

// addFile streams size bytes from r into the archive under path, recording
// the SHA-256 checksum in the manifest file list.
func (a *archiveWriter) addFile(path string, size int64, modTime time.Time, r io.Reader) error {
	if err := validateArchivePath(path); err != nil {
		return err
	}
	header := &tar.Header{
		Name:     path,
		Typeflag: tar.TypeReg,
		Mode:     0o640,
		Size:     size,
		ModTime:  modTime.UTC(),
		Format:   tar.FormatPAX,
	}
	if err := a.tw.WriteHeader(header); err != nil {
		return fmt.Errorf("write archive header for %s: %w", path, err)
	}
	digest := sha256.New()
	written, err := io.Copy(a.tw, io.TeeReader(r, digest))
	if err != nil {
		return fmt.Errorf("archive %s: %w", path, err)
	}
	if written != size {
		return fmt.Errorf("archive %s: size changed while archiving (expected %d bytes, read %d)", path, size, written)
	}
	a.files = append(a.files, ManifestFile{Path: path, SizeBytes: size, SHA256: hex.EncodeToString(digest.Sum(nil))})
	return nil
}

// finish appends the manifest as the final entry and closes the tar stream.
func (a *archiveWriter) finish(m Manifest) error {
	m.Files = a.files
	payload, err := encodeManifest(m)
	if err != nil {
		return err
	}
	header := &tar.Header{
		Name:     ManifestPath,
		Typeflag: tar.TypeReg,
		Mode:     0o640,
		Size:     int64(len(payload)),
		ModTime:  m.CreatedAt.UTC(),
		Format:   tar.FormatPAX,
	}
	if err := a.tw.WriteHeader(header); err != nil {
		return fmt.Errorf("write manifest header: %w", err)
	}
	if _, err := a.tw.Write(payload); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}
	if err := a.tw.Close(); err != nil {
		return fmt.Errorf("finish archive: %w", err)
	}
	return nil
}

// archiveEntry is passed to walkArchive callbacks. Body must be fully
// consumed or skipped by the callback before it returns.
type archiveEntry struct {
	Path string
	Size int64
	Body io.Reader
}

// walkArchive streams every entry of a backup archive from disk, enforcing
// the structural security rules in walkTarStream. The handle callback may
// skip bodies; unread bodies are skipped automatically by the tar reader.
func walkArchive(path string, limits Limits, handle func(archiveEntry) error) (Manifest, error) {
	file, err := os.Open(path)
	if err != nil {
		return Manifest{}, fmt.Errorf("open archive: %w", err)
	}
	defer file.Close()
	return walkTarStream(file, limits, handle)
}
