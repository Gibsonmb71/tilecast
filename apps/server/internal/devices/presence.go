package devices

import (
	"sync"

	"github.com/google/uuid"
)

type PresenceHub struct {
	mu          sync.RWMutex
	connections map[uuid.UUID]presenceConnection
}

type presenceConnection struct {
	token  uuid.UUID
	close  func()
	notify func(map[string]any) error
}

func NewPresenceHub() *PresenceHub {
	return &PresenceHub{connections: make(map[uuid.UUID]presenceConnection)}
}

func (h *PresenceHub) Connect(screenID uuid.UUID, closeConnection func()) func() {
	return h.ConnectWithNotifier(screenID, closeConnection, nil)
}

func (h *PresenceHub) ConnectWithNotifier(screenID uuid.UUID, closeConnection func(), notify func(map[string]any) error) func() {
	h.mu.Lock()
	previous := h.connections[screenID]
	token := uuid.New()
	h.connections[screenID] = presenceConnection{token: token, close: closeConnection, notify: notify}
	h.mu.Unlock()
	if previous.close != nil {
		previous.close()
	}
	return func() {
		h.mu.Lock()
		if current, ok := h.connections[screenID]; ok && current.token == token {
			delete(h.connections, screenID)
		}
		h.mu.Unlock()
	}
}

func (h *PresenceHub) Notify(screenID uuid.UUID, message map[string]any) bool {
	h.mu.RLock()
	notify := h.connections[screenID].notify
	h.mu.RUnlock()
	return notify != nil && notify(message) == nil
}

func (h *PresenceHub) Connected(screenID uuid.UUID) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.connections[screenID]
	return ok
}

func (h *PresenceHub) Disconnect(screenID uuid.UUID) {
	h.mu.RLock()
	closeConnection := h.connections[screenID].close
	h.mu.RUnlock()
	if closeConnection != nil {
		closeConnection()
	}
}
