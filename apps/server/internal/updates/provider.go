package updates

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	GitHubOwner = "Gibsonmb71"
	GitHubRepo  = "tilecast"
)

type Asset struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Size int64  `json:"size"`
}

type ProviderRelease struct {
	ID          int64     `json:"id"`
	Tag         string    `json:"tag_name"`
	Draft       bool      `json:"draft"`
	Prerelease  bool      `json:"prerelease"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []Asset   `json:"assets"`
}

type ProviderResult struct {
	Releases    []ProviderRelease
	ETag        string
	NotModified bool
	RateReset   *time.Time
}

type Provider interface {
	Releases(context.Context, string) (ProviderResult, error)
	Download(context.Context, string, int64) ([]byte, error)
	Open(context.Context, string) (*http.Response, error)
}

type GitHubProvider struct {
	client *http.Client
	token  string
}

func NewGitHubProvider(token string) *GitHubProvider {
	client := &http.Client{Timeout: 30 * time.Second}
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("too many GitHub redirects")
		}
		host := strings.ToLower(req.URL.Hostname())
		if host != "github.com" && host != "api.github.com" && !strings.HasSuffix(host, ".githubusercontent.com") {
			return errors.New("GitHub asset redirected to an untrusted host")
		}
		return nil
	}
	return &GitHubProvider{client: client, token: token}
}

func (p *GitHubProvider) Releases(ctx context.Context, etag string) (ProviderResult, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+GitHubOwner+"/"+GitHubRepo+"/releases?per_page=30", nil)
	p.headers(req)
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	response, err := p.client.Do(req)
	if err != nil {
		return ProviderResult{}, fmt.Errorf("GitHub release request failed: %w", err)
	}
	defer response.Body.Close()
	result := ProviderResult{ETag: response.Header.Get("ETag")}
	if reset, parseErr := strconv.ParseInt(response.Header.Get("X-RateLimit-Reset"), 10, 64); parseErr == nil && reset > 0 {
		value := time.Unix(reset, 0).UTC()
		result.RateReset = &value
	}
	if response.StatusCode == http.StatusNotModified {
		result.NotModified = true
		return result, nil
	}
	if response.StatusCode == http.StatusForbidden && response.Header.Get("X-RateLimit-Remaining") == "0" {
		return result, errors.New("GitHub API rate limit reached")
	}
	if response.StatusCode != http.StatusOK {
		return result, fmt.Errorf("GitHub Releases returned HTTP %d", response.StatusCode)
	}
	body := io.LimitReader(response.Body, 2<<20)
	decoder := json.NewDecoder(body)
	if err := decoder.Decode(&result.Releases); err != nil {
		return result, errors.New("GitHub returned an invalid release response")
	}
	filtered := result.Releases[:0]
	for _, release := range result.Releases {
		if !release.Draft {
			filtered = append(filtered, release)
		}
	}
	result.Releases = filtered
	return result, nil
}

func (p *GitHubProvider) Download(ctx context.Context, rawURL string, maximum int64) ([]byte, error) {
	response, err := p.Open(ctx, rawURL)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub asset returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength > maximum {
		return nil, errors.New("GitHub asset exceeds the allowed size")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maximum+1))
	if err != nil {
		return nil, errors.New("GitHub asset download failed")
	}
	if int64(len(body)) > maximum {
		return nil, errors.New("GitHub asset exceeds the allowed size")
	}
	return body, nil
}

func (p *GitHubProvider) Open(ctx context.Context, rawURL string) (*http.Response, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "api.github.com" || !strings.HasPrefix(parsed.Path, "/repos/"+GitHubOwner+"/"+GitHubRepo+"/releases/assets/") {
		return nil, errors.New("untrusted GitHub release asset URL")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	p.headers(req)
	req.Header.Set("Accept", "application/octet-stream")
	return p.client.Do(req)
}

func (p *GitHubProvider) headers(req *http.Request) {
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "Tilecast-Server/0.9 (+https://github.com/Gibsonmb71/tilecast)")
	if p.token != "" {
		req.Header.Set("Authorization", "Bearer "+p.token)
	}
}
