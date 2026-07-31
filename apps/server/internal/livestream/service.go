package livestream

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	LeaseDuration = 15 * time.Second
	FrameInterval = 125 * time.Millisecond
	MaxFrameBytes = 100 * 1024
	MaxWidth      = 640
	MaxHeight     = 360
	frameHeader   = 33
)

var (
	ErrNotFound     = errors.New("live stream session was not found")
	ErrInvalidFrame = errors.New("live stream frame is invalid")
)

var frameMagic = [4]byte{'T', 'C', 'L', 'S'}

type Notifier interface {
	Notify(screenID uuid.UUID, message map[string]any) bool
}

type Session struct {
	ID                  uuid.UUID `json:"id"`
	ScreenID            uuid.UUID `json:"screenId"`
	Active              bool      `json:"active"`
	ExpiresAt           time.Time `json:"expiresAt"`
	FrameIntervalMillis int       `json:"frameIntervalMillis"`
	MaxWidth            int       `json:"maxWidth"`
	MaxHeight           int       `json:"maxHeight"`
	MaxFrameBytes       int       `json:"maxFrameBytes"`
}

type Frame struct {
	CapturedAt time.Time
	Width      int
	Height     int
	JPEG       []byte
}

type activeSession struct {
	Session
	done        chan struct{}
	subscribers map[chan Frame]struct{}
}

type Service struct {
	mu       sync.Mutex
	sessions map[uuid.UUID]*activeSession
	notifier Notifier
	now      func() time.Time
}

func NewService(notifier Notifier) *Service {
	return &Service{
		sessions: make(map[uuid.UUID]*activeSession),
		notifier: notifier,
		now:      time.Now,
	}
}

func (s *Service) Start(screenID uuid.UUID) Session {
	now := s.now().UTC()
	s.mu.Lock()
	if previous := s.sessions[screenID]; previous != nil {
		close(previous.done)
	}
	active := &activeSession{
		Session: Session{
			ID:                  uuid.New(),
			ScreenID:            screenID,
			Active:              true,
			ExpiresAt:           now.Add(LeaseDuration),
			FrameIntervalMillis: int(FrameInterval.Milliseconds()),
			MaxWidth:            MaxWidth,
			MaxHeight:           MaxHeight,
			MaxFrameBytes:       MaxFrameBytes,
		},
		done:        make(chan struct{}),
		subscribers: make(map[chan Frame]struct{}),
	}
	s.sessions[screenID] = active
	result := active.Session
	s.mu.Unlock()
	s.notify(screenID)
	return result
}

func (s *Service) Renew(screenID, sessionID uuid.UUID) (Session, error) {
	s.mu.Lock()
	active := s.activeLocked(screenID)
	if active == nil || active.ID != sessionID {
		s.mu.Unlock()
		return Session{}, ErrNotFound
	}
	active.ExpiresAt = s.now().UTC().Add(LeaseDuration)
	result := active.Session
	s.mu.Unlock()
	s.notify(screenID)
	return result, nil
}

func (s *Service) End(screenID, sessionID uuid.UUID) error {
	s.mu.Lock()
	active := s.activeLocked(screenID)
	if active == nil || active.ID != sessionID {
		s.mu.Unlock()
		return ErrNotFound
	}
	delete(s.sessions, screenID)
	close(active.done)
	s.mu.Unlock()
	s.notify(screenID)
	return nil
}

func (s *Service) Current(screenID uuid.UUID) Session {
	s.mu.Lock()
	active := s.activeLocked(screenID)
	var result Session
	if active != nil {
		result = active.Session
	} else {
		result = Session{
			ScreenID:            screenID,
			FrameIntervalMillis: int(FrameInterval.Milliseconds()),
			MaxWidth:            MaxWidth,
			MaxHeight:           MaxHeight,
			MaxFrameBytes:       MaxFrameBytes,
		}
	}
	s.mu.Unlock()
	return result
}

func (s *Service) Publish(screenID, sessionID uuid.UUID, frame Frame) error {
	if err := validateFrame(frame); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	active := s.activeLocked(screenID)
	if active == nil || active.ID != sessionID {
		return ErrNotFound
	}
	frame.JPEG = bytes.Clone(frame.JPEG)
	for subscriber := range active.subscribers {
		select {
		case subscriber <- frame:
		default:
			select {
			case <-subscriber:
			default:
			}
			select {
			case subscriber <- frame:
			default:
			}
		}
	}
	return nil
}

func (s *Service) Subscribe(screenID, sessionID uuid.UUID) (<-chan Frame, <-chan struct{}, func(), error) {
	s.mu.Lock()
	active := s.activeLocked(screenID)
	if active == nil || active.ID != sessionID {
		s.mu.Unlock()
		return nil, nil, nil, ErrNotFound
	}
	frames := make(chan Frame, 1)
	active.subscribers[frames] = struct{}{}
	done := active.done
	s.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			s.mu.Lock()
			if current := s.sessions[screenID]; current != nil && current.ID == sessionID {
				delete(current.subscribers, frames)
			}
			s.mu.Unlock()
		})
	}
	return frames, done, cancel, nil
}

func (s *Service) activeLocked(screenID uuid.UUID) *activeSession {
	active := s.sessions[screenID]
	if active == nil {
		return nil
	}
	if !active.ExpiresAt.After(s.now()) {
		delete(s.sessions, screenID)
		close(active.done)
		return nil
	}
	return active
}

func (s *Service) notify(screenID uuid.UUID) {
	if s.notifier != nil {
		s.notifier.Notify(screenID, map[string]any{"type": "live_stream.session_changed"})
	}
}

func validateFrame(frame Frame) error {
	if frame.CapturedAt.IsZero() {
		return fmt.Errorf("%w: capture time is required", ErrInvalidFrame)
	}
	if frame.Width < 1 || frame.Width > MaxWidth || frame.Height < 1 || frame.Height > MaxHeight {
		return fmt.Errorf("%w: dimensions exceed %dx%d", ErrInvalidFrame, MaxWidth, MaxHeight)
	}
	if len(frame.JPEG) < 4 || len(frame.JPEG) > MaxFrameBytes {
		return fmt.Errorf("%w: JPEG must be between 4 and %d bytes", ErrInvalidFrame, MaxFrameBytes)
	}
	if frame.JPEG[0] != 0xff || frame.JPEG[1] != 0xd8 ||
		frame.JPEG[len(frame.JPEG)-2] != 0xff || frame.JPEG[len(frame.JPEG)-1] != 0xd9 {
		return fmt.Errorf("%w: payload is not a complete JPEG", ErrInvalidFrame)
	}
	return nil
}

func ParseBinaryFrame(payload []byte) (uuid.UUID, Frame, error) {
	if len(payload) < frameHeader+4 {
		return uuid.Nil, Frame{}, fmt.Errorf("%w: binary payload is too short", ErrInvalidFrame)
	}
	if !bytes.Equal(payload[:4], frameMagic[:]) || payload[4] != 1 {
		return uuid.Nil, Frame{}, fmt.Errorf("%w: unsupported binary header", ErrInvalidFrame)
	}
	sessionID, err := uuid.FromBytes(payload[5:21])
	if err != nil {
		return uuid.Nil, Frame{}, fmt.Errorf("%w: invalid session id", ErrInvalidFrame)
	}
	capturedAtMillis := int64(binary.BigEndian.Uint64(payload[21:29]))
	frame := Frame{
		CapturedAt: time.UnixMilli(capturedAtMillis).UTC(),
		Width:      int(binary.BigEndian.Uint16(payload[29:31])),
		Height:     int(binary.BigEndian.Uint16(payload[31:33])),
		JPEG:       payload[33:],
	}
	if err := validateFrame(frame); err != nil {
		return uuid.Nil, Frame{}, err
	}
	return sessionID, frame, nil
}
