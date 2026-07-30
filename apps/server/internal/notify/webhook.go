package notify

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ErrPermanent marks a failure that retrying cannot fix: a rejected address, a
// 4xx from a receiver, a URL that no longer parses. The worker stops retrying
// and records the reason instead of burning the attempt budget.
var ErrPermanent = errors.New("permanent delivery failure")

// WebhookSender posts an event to one receiver.
type WebhookSender interface {
	Post(ctx context.Context, target WebhookTarget, payload []byte) error
}

// WebhookTarget is the receiver, resolved from notification_webhooks.
type WebhookTarget struct {
	ID            string
	Name          string
	URL           string
	SigningSecret string
}

// HTTPWebhookSender posts signed JSON over HTTP.
type HTTPWebhookSender struct {
	client *http.Client
	cfg    Config
}

// NewWebhookSender builds the production sender.
func NewWebhookSender(cfg Config) *HTTPWebhookSender {
	timeout := cfg.WebhookTimeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &HTTPWebhookSender{cfg: cfg, client: &http.Client{
		Timeout: timeout,
		// A webhook must not be turned into a redirect-following crawler of
		// the deployment's own network.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// SignatureHeader and TimestampHeader name the headers a receiver verifies.
const (
	SignatureHeader = "X-Tilecast-Signature"
	TimestampHeader = "X-Tilecast-Timestamp"
	EventHeader     = "X-Tilecast-Event"
)

// Sign returns the value of the signature header for a body and timestamp.
// The timestamp is inside the signed string so a captured request cannot be
// replayed later with a fresh header.
func Sign(secret string, timestamp int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%d.", timestamp)
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// Post delivers one signed event.
func (s *HTTPWebhookSender) Post(ctx context.Context, target WebhookTarget, payload []byte) error {
	if err := ValidateWebhookURL(target.URL); err != nil {
		return fmt.Errorf("%w: %s", ErrPermanent, err.Error())
	}
	ctx, cancel := ctxWithTimeout(ctx, s.cfg.WebhookTimeout)
	defer cancel()

	timestamp := time.Now().Unix()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target.URL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("%w: %s", ErrPermanent, err.Error())
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "Tilecast")
	request.Header.Set(TimestampHeader, strconv.FormatInt(timestamp, 10))
	request.Header.Set(SignatureHeader, Sign(target.SigningSecret, timestamp, payload))

	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	// Read a bounded amount so a receiver cannot stream an unbounded error
	// body into the delivery log.
	body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
	switch {
	case response.StatusCode >= 200 && response.StatusCode < 300:
		return nil
	case response.StatusCode == http.StatusTooManyRequests, response.StatusCode >= 500:
		return fmt.Errorf("receiver returned %d", response.StatusCode)
	default:
		// 3xx lands here too: redirects are not followed, and a receiver that
		// moved needs its URL updated rather than retried for six hours.
		return fmt.Errorf("%w: receiver returned %d %s", ErrPermanent, response.StatusCode,
			strings.TrimSpace(truncate(string(body), 200)))
	}
}

// ValidateWebhookURL applies the same restraint as the rest of Tilecast's
// outbound fetching: HTTPS only unless the target is plainly on the local
// network, and never a credentialed URL.
func ValidateWebhookURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return errors.New("the URL could not be read")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("the URL must start with http:// or https://")
	}
	if parsed.Host == "" {
		return errors.New("the URL has no host")
	}
	if parsed.User != nil {
		// Credentials in a URL end up in logs and in the settings export.
		return errors.New("the URL must not contain a username or password")
	}
	if parsed.Scheme == "http" && !isPrivateHost(parsed.Hostname()) {
		return errors.New("a public URL must use https://")
	}
	return nil
}

func isPrivateHost(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

// NewSigningSecret generates a webhook signing key.
func NewSigningSecret() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "whsec_" + base64.RawURLEncoding.EncodeToString(raw), nil
}

// WebhookPayload is the JSON body posted to a receiver. It is a stable public
// contract: fields may be added, never removed or repurposed.
type WebhookPayload struct {
	Event      string         `json:"event"`
	Category   string         `json:"category"`
	Severity   string         `json:"severity"`
	Title      string         `json:"title"`
	Message    string         `json:"message"`
	OccurredAt time.Time      `json:"occurredAt"`
	URL        string         `json:"url,omitempty"`
	Data       map[string]any `json:"data,omitempty"`
}

// EncodePayload renders the webhook body for an event.
func EncodePayload(event Event) ([]byte, error) {
	return json.Marshal(WebhookPayload{
		Event:      event.Key,
		Category:   event.Category,
		Severity:   event.Severity,
		Title:      event.Subject,
		Message:    event.Body,
		OccurredAt: event.OccurredAt.UTC(),
		URL:        event.URL,
		Data:       event.Payload,
	})
}
