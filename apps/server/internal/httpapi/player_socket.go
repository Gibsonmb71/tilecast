package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
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

	var writeMu sync.Mutex
	send := func(message any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return wsjson.Write(ctx, connection, message)
	}
	unregister := s.devices.RegisterPresenceWithNotifier(principal.ScreenID, func() {
		cancel()
		_ = connection.Close(websocket.StatusPolicyViolation, "credential revoked or screen disabled")
	}, func(message map[string]any) error { return send(message) })
	defer unregister()
	if err := s.devices.MarkConnected(r.Context(), principal.ScreenID, r.RemoteAddr); err != nil {
		return
	}
	defer s.devices.MarkDisconnected(context.Background(), principal.ScreenID)

	if err := send(map[string]any{"type": "server.hello", "protocolVersion": 1, "screenId": principal.ScreenID, "screenName": principal.ScreenName}); err != nil {
		return
	}
	var pendingCommands bool
	_ = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM player_commands WHERE screen_id=$1 AND state IN ('pending','delivered') AND expires_at>now())`, principal.ScreenID).Scan(&pendingCommands)
	if pendingCommands {
		_ = send(map[string]any{"type": "commands.available"})
	}

	pingDone := make(chan struct{})
	go func() {
		defer close(pingDone)
		pingTicker := time.NewTicker(30 * time.Second)
		commandTicker := time.NewTicker(5 * time.Second)
		defer pingTicker.Stop()
		defer commandTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-commandTicker.C:
				var commandsWaiting, commandStuck bool
				if err := s.db.QueryRow(ctx, `SELECT
					EXISTS(SELECT 1 FROM player_commands WHERE screen_id=$1 AND state IN ('pending','delivered','acknowledged','running') AND expires_at>now()),
					EXISTS(SELECT 1 FROM player_commands WHERE screen_id=$1 AND state='pending' AND created_at<=now()-interval '15 seconds' AND expires_at>now())`, principal.ScreenID).Scan(&commandsWaiting, &commandStuck); err != nil {
					continue
				}
				if commandsWaiting {
					if err := send(map[string]any{"type": "commands.available"}); err != nil {
						cancel()
						return
					}
				}
				if commandStuck {
					_ = connection.Close(websocket.StatusNormalClosure, "retry pending commands")
					cancel()
					return
				}
			case timestamp := <-pingTicker.C:
				if err := send(map[string]any{"type": "server.ping", "timestamp": timestamp.UTC().Format(time.RFC3339)}); err != nil {
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
				// A rejected heartbeat leaves last_heartbeat_at stale while the
				// socket keeps the screen "online"; log the reason instead of
				// silently discarding it so the mismatch is diagnosable.
				if err := s.devices.Heartbeat(ctx, principal, heartbeat, r.RemoteAddr); err != nil {
					s.logger.Warn("player heartbeat rejected over socket",
						"error", err, "screen_id", principal.ScreenID)
				}
				s.advanceCanaryDeploymentsForScreen(ctx, principal.ScreenID)
			}
			if s.playlists != nil {
				var status playlists.PlayerStatus
				if err := json.Unmarshal(message.Payload, &status); err == nil {
					_ = s.playlists.ReportStatus(ctx, principal.ScreenID, status)
				}
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
