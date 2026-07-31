package notify

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// EmailSender exists so the worker can be tested without a mail server. The
// production implementation is SMTPSender.
type EmailSender interface {
	Send(ctx context.Context, message Message) error
}

// Message is one outbound email.
type Message struct {
	From     mail.Address
	To       string
	Subject  string
	Body     string
	Category string
}

// SMTPSender delivers over SMTP using the standard library.
type SMTPSender struct{ cfg Config }

// NewSMTPSender builds a sender from deployment configuration.
func NewSMTPSender(cfg Config) *SMTPSender { return &SMTPSender{cfg: cfg} }

// ErrEmailNotConfigured is returned when no SMTP host is set. Callers treat it
// as "notifications are off", not as a failure to report.
var ErrEmailNotConfigured = errors.New("smtp host is not configured")

// Send delivers one message. It returns a plain error; the caller decides
// whether to retry, and never logs the message body.
func (s *SMTPSender) Send(ctx context.Context, message Message) error {
	if !s.cfg.EmailConfigured() {
		return ErrEmailNotConfigured
	}
	recipient, err := mail.ParseAddress(strings.TrimSpace(message.To))
	if err != nil {
		// A malformed subscriber address is permanent: retrying cannot fix it.
		return fmt.Errorf("%w: %s", ErrPermanent, "recipient address is not valid")
	}
	if message.From.Address == "" {
		return fmt.Errorf("%w: %s", ErrPermanent, "no from address is configured")
	}

	ctx, cancel := ctxWithTimeout(ctx, s.cfg.SMTPTimeout)
	defer cancel()

	client, err := s.dial(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = client.Quit() }()

	if err := s.authenticate(client); err != nil {
		return err
	}
	if err := client.Mail(message.From.Address); err != nil {
		return fmt.Errorf("smtp sender rejected: %w", err)
	}
	if err := client.Rcpt(recipient.Address); err != nil {
		return fmt.Errorf("smtp recipient rejected: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := writer.Write(buildMIME(message.From, *recipient, message)); err != nil {
		_ = writer.Close()
		return err
	}
	return writer.Close()
}

func (s *SMTPSender) dial(ctx context.Context) (*smtp.Client, error) {
	address := net.JoinHostPort(s.cfg.SMTPHost, strconv.Itoa(s.cfg.SMTPPort))
	dialer := &net.Dialer{Timeout: s.cfg.SMTPTimeout}
	mode := strings.ToLower(strings.TrimSpace(s.cfg.SMTPTLS))

	if mode == "implicit" {
		conn, err := tls.DialWithDialer(dialer, "tcp", address, s.tlsConfig())
		if err != nil {
			return nil, err
		}
		if deadline, ok := ctx.Deadline(); ok {
			_ = conn.SetDeadline(deadline)
		}
		return smtp.NewClient(conn, s.cfg.SMTPHost)
	}

	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, err
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	client, err := smtp.NewClient(conn, s.cfg.SMTPHost)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if mode == "none" {
		return client, nil
	}
	if ok, _ := client.Extension("STARTTLS"); !ok {
		_ = client.Close()
		// Silently continuing in the clear would send operational detail about
		// an organization's screens across the network unencrypted, so this is
		// a refusal rather than a downgrade.
		return nil, fmt.Errorf("%w: the mail server does not offer STARTTLS; set TILECAST_SMTP_TLS=none to accept an unencrypted relay", ErrPermanent)
	}
	if err := client.StartTLS(s.tlsConfig()); err != nil {
		_ = client.Close()
		return nil, err
	}
	return client, nil
}

func (s *SMTPSender) tlsConfig() *tls.Config {
	return &tls.Config{
		ServerName: s.cfg.SMTPHost,
		// Only for a self-hosted relay with a private certificate authority, and
		// only when the operator opts in by environment. It says nothing about
		// sending credentials in the clear, which is a separate opt-in.
		InsecureSkipVerify: s.cfg.SMTPAllowInsecure, //nolint:gosec // documented opt-in
		MinVersion:         tls.VersionTLS12,
	}
}

func (s *SMTPSender) authenticate(client *smtp.Client) error {
	if strings.TrimSpace(s.cfg.SMTPUsername) == "" {
		return nil
	}
	encrypted := false
	if state, ok := client.TLSConnectionState(); ok && state.HandshakeComplete {
		encrypted = true
	}
	if !encrypted && !s.cfg.SMTPAllowPlaintextAuth {
		// Failing here makes the reason legible in the delivery log rather than
		// arriving as an authentication error. Accepting a private
		// certificate is deliberately not enough to reach this: that is
		// TILECAST_SMTP_ALLOW_INSECURE, and it is a different decision.
		return fmt.Errorf("%w: refusing to send SMTP credentials over an unencrypted connection; set TILECAST_SMTP_ALLOW_PLAINTEXT_AUTH=true to accept that", ErrPermanent)
	}
	ok, _ := client.Extension("AUTH")
	if !ok {
		return fmt.Errorf("%w: the mail server does not accept authentication", ErrPermanent)
	}
	if encrypted {
		return client.Auth(smtp.PlainAuth("", s.cfg.SMTPUsername, s.cfg.SMTPPassword, s.cfg.SMTPHost))
	}
	return client.Auth(plaintextPlainAuth{username: s.cfg.SMTPUsername, password: s.cfg.SMTPPassword, host: s.cfg.SMTPHost})
}

// plaintextPlainAuth is PLAIN without net/smtp's own refusal to send it over an
// unencrypted connection, which otherwise makes
// TILECAST_SMTP_ALLOW_PLAINTEXT_AUTH do nothing for any relay that is not
// localhost. The host check net/smtp performs to keep credentials from going to
// a server the client did not name is kept: only the encryption rule is the
// operator's to waive, and they waive it explicitly.
type plaintextPlainAuth struct{ username, password, host string }

func (a plaintextPlainAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if server.Name != a.host {
		return "", nil, errors.New("wrong host name")
	}
	return "PLAIN", []byte("\x00" + a.username + "\x00" + a.password), nil
}

func (a plaintextPlainAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if more {
		return nil, errors.New("unexpected server challenge")
	}
	return nil, nil
}

// buildMIME renders a minimal, well-formed plain-text message. Tilecast does
// not send HTML email: these messages are read on phones in hallways, they
// carry no branding value, and a text body cannot leak a tracking pixel.
func buildMIME(from, to mail.Address, message Message) []byte {
	var b strings.Builder
	b.WriteString("From: " + from.String() + "\r\n")
	b.WriteString("To: " + to.String() + "\r\n")
	b.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", message.Subject) + "\r\n")
	b.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	b.WriteString("Auto-Submitted: auto-generated\r\n")
	if message.Category != "" {
		b.WriteString("X-Tilecast-Category: " + message.Category + "\r\n")
	}
	b.WriteString("\r\n")
	// A bare "." starts the terminating sequence in SMTP DATA. The first line
	// has no preceding CRLF, so it needs its own check or a body beginning with
	// a dot truncates the message.
	body := strings.ReplaceAll(normalizeNewlines(message.Body), "\r\n.", "\r\n..")
	if strings.HasPrefix(body, ".") {
		body = "." + body
	}
	b.WriteString(body)
	b.WriteString("\r\n")
	return []byte(b.String())
}

func normalizeNewlines(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	return strings.ReplaceAll(value, "\n", "\r\n")
}
