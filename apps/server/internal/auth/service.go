package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrSetupComplete      = errors.New("initial setup has already been completed")
	ErrUnauthenticated    = errors.New("authentication required")
	ErrInactive           = errors.New("user account is inactive")
	usernamePattern       = regexp.MustCompile(`^[a-zA-Z0-9._@+-]{3,254}$`)
)

type User struct {
	ID          uuid.UUID  `json:"id"`
	Name        string     `json:"name"`
	Username    string     `json:"username"`
	Role        string     `json:"role"`
	Active      bool       `json:"active"`
	CreatedAt   time.Time  `json:"createdAt"`
	LastLoginAt *time.Time `json:"lastLoginAt,omitempty"`
}

type Session struct {
	User      User
	Token     string
	CSRFToken string
	ExpiresAt time.Time
}

type SetupInput struct {
	OrganizationName string
	OwnerName        string
	Username         string
	Password         string
}

type LoginInput struct {
	Username string
	Password string
}

type Service struct {
	db            *pgxpool.Pool
	sessionTTL    time.Duration
	dummyPassword string
}

func NewService(db *pgxpool.Pool, sessionTTL time.Duration) *Service {
	dummy, _ := HashPassword("tilecast invalid credential sentinel")
	return &Service{db: db, sessionTTL: sessionTTL, dummyPassword: dummy}
}

func (s *Service) SetupRequired(ctx context.Context) (bool, error) {
	var count int
	if err := s.db.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&count); err != nil {
		return false, fmt.Errorf("count users: %w", err)
	}
	return count == 0, nil
}

func (s *Service) Setup(ctx context.Context, input SetupInput) (Session, error) {
	input.OrganizationName = strings.TrimSpace(input.OrganizationName)
	input.OwnerName = strings.TrimSpace(input.OwnerName)
	input.Username = strings.ToLower(strings.TrimSpace(input.Username))
	if err := validateSetup(input); err != nil {
		return Session{}, err
	}
	passwordHash, err := HashPassword(input.Password)
	if err != nil {
		return Session{}, err
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return Session{}, fmt.Errorf("begin setup: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7421037)"); err != nil {
		return Session{}, fmt.Errorf("lock setup: %w", err)
	}
	var count int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&count); err != nil {
		return Session{}, fmt.Errorf("check setup state: %w", err)
	}
	if count != 0 {
		return Session{}, ErrSetupComplete
	}

	user := User{ID: uuid.New(), Name: input.OwnerName, Username: input.Username, Role: "owner", Active: true, CreatedAt: time.Now().UTC()}
	if _, err := tx.Exec(ctx, `INSERT INTO organization_settings (organization_name) VALUES ($1)`, input.OrganizationName); err != nil {
		return Session{}, fmt.Errorf("create organization: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO users (id, name, username, password_hash, role, active, created_at, last_login_at) VALUES ($1,$2,$3,$4,$5,TRUE,$6,$6)`, user.ID, user.Name, user.Username, passwordHash, user.Role, user.CreatedAt); err != nil {
		return Session{}, fmt.Errorf("create owner: %w", err)
	}
	user.LastLoginAt = &user.CreatedAt

	session, err := s.createSession(ctx, tx, user)
	if err != nil {
		return Session{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id) VALUES ($1,$2,'organization.setup','organization','singleton')`, uuid.New(), user.ID); err != nil {
		return Session{}, fmt.Errorf("record setup audit log: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, fmt.Errorf("commit setup: %w", err)
	}
	return session, nil
}

func (s *Service) Login(ctx context.Context, input LoginInput) (Session, error) {
	username := strings.ToLower(strings.TrimSpace(input.Username))
	var user User
	var passwordHash string
	err := s.db.QueryRow(ctx, `SELECT id,name,username,password_hash,role,active,created_at,last_login_at FROM users WHERE lower(username)=$1`, username).Scan(
		&user.ID, &user.Name, &user.Username, &passwordHash, &user.Role, &user.Active, &user.CreatedAt, &user.LastLoginAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		VerifyPassword(s.dummyPassword, input.Password)
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, fmt.Errorf("find user: %w", err)
	}
	if !VerifyPassword(passwordHash, input.Password) {
		return Session{}, ErrInvalidCredentials
	}
	if !user.Active {
		return Session{}, ErrInactive
	}

	now := time.Now().UTC()
	if _, err := s.db.Exec(ctx, `UPDATE users SET last_login_at=$1 WHERE id=$2`, now, user.ID); err != nil {
		return Session{}, fmt.Errorf("update last login: %w", err)
	}
	user.LastLoginAt = &now
	return s.createSession(ctx, s.db, user)
}

type querier interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (s *Service) createSession(ctx context.Context, db querier, user User) (Session, error) {
	token, err := randomToken(32)
	if err != nil {
		return Session{}, err
	}
	csrf, err := randomToken(24)
	if err != nil {
		return Session{}, err
	}
	expires := time.Now().UTC().Add(s.sessionTTL)
	hash := sha256.Sum256([]byte(token))
	if _, err := db.Exec(ctx, `INSERT INTO sessions (id,user_id,token_hash,csrf_token,expires_at) VALUES ($1,$2,$3,$4,$5)`, uuid.New(), user.ID, hash[:], csrf, expires); err != nil {
		return Session{}, fmt.Errorf("create session: %w", err)
	}
	return Session{User: user, Token: token, CSRFToken: csrf, ExpiresAt: expires}, nil
}

func (s *Service) Authenticate(ctx context.Context, token string) (Session, error) {
	if token == "" {
		return Session{}, ErrUnauthenticated
	}
	hash := sha256.Sum256([]byte(token))
	var session Session
	err := s.db.QueryRow(ctx, `
		SELECT u.id,u.name,u.username,u.role,u.active,u.created_at,u.last_login_at,s.csrf_token,s.expires_at
		FROM sessions s JOIN users u ON u.id=s.user_id
		WHERE s.token_hash=$1 AND s.expires_at>now()`, hash[:]).Scan(
		&session.User.ID, &session.User.Name, &session.User.Username, &session.User.Role, &session.User.Active,
		&session.User.CreatedAt, &session.User.LastLoginAt, &session.CSRFToken, &session.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrUnauthenticated
	}
	if err != nil {
		return Session{}, fmt.Errorf("read session: %w", err)
	}
	if !session.User.Active {
		return Session{}, ErrInactive
	}
	session.Token = token
	_, _ = s.db.Exec(ctx, `UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1 AND last_seen_at<now()-interval '5 minutes'`, hash[:])
	return session, nil
}

func (s *Service) Logout(ctx context.Context, token string, userID uuid.UUID) error {
	hash := sha256.Sum256([]byte(token))
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin logout: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE token_hash=$1`, hash[:]); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO audit_logs (id,user_id,action,resource_type,resource_id) VALUES ($1,$2,'auth.logout','session',NULL)`, uuid.New(), userID); err != nil {
		return fmt.Errorf("record logout audit log: %w", err)
	}
	return tx.Commit(ctx)
}

func validateSetup(input SetupInput) error {
	if len(input.OrganizationName) < 2 || len(input.OrganizationName) > 120 {
		return errors.New("organization name must be between 2 and 120 characters")
	}
	if len(input.OwnerName) < 2 || len(input.OwnerName) > 120 {
		return errors.New("owner name must be between 2 and 120 characters")
	}
	if !usernamePattern.MatchString(input.Username) {
		return errors.New("username must be 3 to 254 characters and contain only letters, numbers, or . _ @ + -")
	}
	if len(input.Password) < 12 || len(input.Password) > 1024 {
		return errors.New("password must be between 12 and 1024 characters")
	}
	return nil
}

func randomToken(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate secure token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}
