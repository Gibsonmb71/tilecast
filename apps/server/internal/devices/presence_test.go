package devices

import (
	"testing"

	"github.com/google/uuid"
)

func TestPresenceNotificationUsesActiveConnection(t *testing.T) {
	hub := NewPresenceHub()
	screen := uuid.New()
	var version int64
	unregister := hub.ConnectWithNotifier(screen, func() {}, func(message map[string]any) error { version = message["manifestVersion"].(int64); return nil })
	if !hub.Notify(screen, map[string]any{"type": "manifest.changed", "manifestVersion": int64(7)}) || version != 7 {
		t.Fatal("notification was not delivered")
	}
	unregister()
	if hub.Notify(screen, map[string]any{"type": "manifest.changed"}) {
		t.Fatal("notification was delivered after disconnect")
	}
}

func TestPresenceCleanupOnlyRemovesItsOwnConnection(t *testing.T) {
	hub := NewPresenceHub()
	screen := uuid.New()
	first := hub.ConnectWithNotifier(screen, func() {}, nil)
	second := hub.ConnectWithNotifier(screen, func() {}, nil)

	if first() {
		t.Fatal("replaced connection reported that it removed the active connection")
	}
	if !hub.Connected(screen) {
		t.Fatal("replaced connection cleanup removed the active connection")
	}
	if !second() {
		t.Fatal("active connection did not report that it removed itself")
	}
	if hub.Connected(screen) {
		t.Fatal("active connection remained registered after cleanup")
	}
}
