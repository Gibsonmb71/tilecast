package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

type socketMessage struct {
	Type            string          `json:"type"`
	ProtocolVersion int             `json:"protocolVersion,omitempty"`
	PlayerVersion   string          `json:"playerVersion,omitempty"`
	Timestamp       string          `json:"timestamp,omitempty"`
	Payload         json.RawMessage `json:"payload,omitempty"`
}

func (s *server) playerSocket(w http.ResponseWriter, r *http.Request) {
	principal := r.Context().Value(deviceContextKey).(devices.DevicePrincipal)
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	defer connection.Close(websocket.StatusNormalClosure, "connection closed") //nolint:errcheck

	unregister := s.devices.RegisterPresence(principal.ScreenID, func() {
		cancel()
		_ = connection.Close(websocket.StatusPolicyViolation, "credential revoked or screen disabled")
	})
	defer unregister()
	if err := s.devices.MarkConnected(r.Context(), principal.ScreenID, r.RemoteAddr); err != nil {
		return
	}
	defer s.devices.MarkDisconnected(context.Background(), principal.ScreenID)

	if err := wsjson.Write(ctx, connection, map[string]any{"type": "server.hello", "protocolVersion": 1, "screenId": principal.ScreenID, "screenName": principal.ScreenName}); err != nil {
		return
	}

	pingDone := make(chan struct{})
	go func() {
		defer close(pingDone)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case timestamp := <-ticker.C:
				if err := wsjson.Write(ctx, connection, map[string]any{"type": "server.ping", "timestamp": timestamp.UTC().Format(time.RFC3339)}); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	for ctx.Err() == nil {
		var message socketMessage
		if err := wsjson.Read(ctx, connection, &message); err != nil {
			break
		}
		switch message.Type {
		case "player.hello":
			if message.ProtocolVersion != 1 {
				_ = connection.Close(websocket.StatusUnsupportedData, "unsupported protocol version")
				cancel()
			}
		case "player.status":
			var heartbeat devices.Heartbeat
			if err := json.Unmarshal(message.Payload, &heartbeat); err == nil {
				_ = s.devices.Heartbeat(ctx, principal, heartbeat, r.RemoteAddr)
			}
		case "player.pong":
			// The open socket itself is the presence signal; pong confirms the peer is processing messages.
		default:
			_ = connection.Close(websocket.StatusUnsupportedData, "unsupported message type")
			cancel()
		}
	}
	cancel()
	<-pingDone
}
