package media

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/google/uuid"
)

type Storage interface {
	CreateUpload(key string) (*os.File, error)
	Open(key string) (*os.File, error)
	Stat(key string) (os.FileInfo, error)
	Commit(tempKey, finalKey string) error
	Delete(key string) error
	WriteAtomic(key string, write func(io.Writer) error) error
	Path(key string) (string, error)
	AvailableBytes() (uint64, error)
	CheckWritable() error
}

type LocalStorage struct{ root string }

func NewLocalStorage(root string) (*LocalStorage, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve media root: %w", err)
	}
	for _, dir := range []string{"originals", "variants", "thumbnails", "uploads", "trash"} {
		if err := os.MkdirAll(filepath.Join(abs, dir), 0o750); err != nil {
			return nil, fmt.Errorf("create media directory: %w", err)
		}
	}
	if info, err := os.Lstat(abs); err != nil || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("media root must be a real directory, not a symlink")
	}
	storage := &LocalStorage{root: abs}
	probe := filepath.Join(abs, ".write-test")
	if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
		return nil, fmt.Errorf("media root is not writable: %w", err)
	}
	_ = os.Remove(probe)
	return storage, nil
}

func UploadKey(id uuid.UUID) string {
	return filepath.ToSlash(filepath.Join("uploads", id.String()+".part"))
}
func OriginalKey(assetID uuid.UUID, extension string) string {
	return filepath.ToSlash(filepath.Join("originals", assetID.String(), "original"+extension))
}
func VariantKey(assetID, variantID uuid.UUID, extension string) string {
	return filepath.ToSlash(filepath.Join("variants", assetID.String(), variantID.String()+extension))
}
func PreviewKey(assetID, variantID uuid.UUID, poster bool) string {
	dir := "thumbnails"
	name := variantID.String() + ".jpg"
	if poster {
		name = variantID.String() + "-poster.jpg"
	}
	return filepath.ToSlash(filepath.Join(dir, assetID.String(), name))
}

func (s *LocalStorage) Path(key string) (string, error) {
	if key == "" || filepath.IsAbs(key) || strings.Contains(key, "\\") {
		return "", errors.New("invalid storage key")
	}
	clean := filepath.Clean(key)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("storage path escapes media root")
	}
	path := filepath.Join(s.root, clean)
	rel, err := filepath.Rel(s.root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("storage path escapes media root")
	}
	current := s.root
	parts := strings.Split(clean, string(filepath.Separator))
	for _, part := range parts[:len(parts)-1] {
		current = filepath.Join(current, part)
		info, statErr := os.Lstat(current)
		if statErr == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("storage paths may not traverse symlinks")
		}
		if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
			return "", statErr
		}
	}
	return path, nil
}

func (s *LocalStorage) CreateUpload(key string) (*os.File, error) {
	path, err := s.Path(key)
	if err != nil {
		return nil, err
	}
	return os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
}
func (s *LocalStorage) Open(key string) (*os.File, error) {
	path, err := s.Path(key)
	if err != nil {
		return nil, err
	}
	return os.Open(path)
}
func (s *LocalStorage) Stat(key string) (os.FileInfo, error) {
	path, err := s.Path(key)
	if err != nil {
		return nil, err
	}
	return os.Stat(path)
}
func (s *LocalStorage) Delete(key string) error {
	path, err := s.Path(key)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
func (s *LocalStorage) Commit(tempKey, finalKey string) error {
	src, err := s.Path(tempKey)
	if err != nil {
		return err
	}
	dst, err := s.Path(finalKey)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		return err
	}
	return os.Rename(src, dst)
}
func (s *LocalStorage) WriteAtomic(key string, write func(io.Writer) error) error {
	path, err := s.Path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tilecast-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := write(tmp); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
func (s *LocalStorage) AvailableBytes() (uint64, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(s.root, &stat); err != nil {
		return 0, err
	}
	return stat.Bavail * uint64(stat.Bsize), nil
}

func (s *LocalStorage) CheckWritable() error {
	key := filepath.ToSlash(filepath.Join("uploads", ".readiness"))
	if err := s.WriteAtomic(key, func(w io.Writer) error { _, err := w.Write([]byte("ok")); return err }); err != nil {
		return err
	}
	return s.Delete(key)
}
