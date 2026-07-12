package web

import (
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

// Production builds replace static/index.html and add static/assets before compiling.
//
//go:embed static
var files embed.FS

func Handler() http.Handler {
	static, _ := fs.Sub(files, "static")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "." || name == "" {
			name = "index.html"
		}
		if info, err := fs.Stat(static, name); err == nil && !info.IsDir() {
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			if contentType := mime.TypeByExtension(path.Ext(name)); contentType != "" {
				w.Header().Set("Content-Type", contentType)
			}
			http.ServeFileFS(w, r, static, name)
			return
		}
		r.URL.Path = "/"
		http.ServeFileFS(w, r, static, "index.html")
	})
}
