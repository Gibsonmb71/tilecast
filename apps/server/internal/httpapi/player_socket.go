package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"
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
	commandRows, commandErr := s.db.Query(r.Context(), `UPDATE website_data_clear_commands SET status='expired' WHERE screen_id=$1 AND status='pending' AND expires_at<=now() RETURNING id`, principal.ScreenID)
	if commandErr == nil {
		commandRows.Close()
	}
	pendingRows, pendingErr := s.db.Query(r.Context(), `SELECT id,expires_at FROM website_data_clear_commands WHERE screen_id=$1 AND status='pending' AND expires_at>now() ORDER BY created_at`, principal.ScreenID)
	if pendingErr == nil {
		for pendingRows.Next() {
			var id uuid.UUID
			var expires time.Time
			if pendingRows.Scan(&id, &expires) == nil {
				_ = send(map[string]any{"type": "website.clear_data", "commandId": id, "expiresAt": expires})
			}
		}
		pendingRows.Close()
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
				_ = s.devices.Heartbeat(ctx, principal, heartbeat, r.RemoteAddr)
			}
			if s.playlists != nil {
				var status playlists.PlayerStatus
				if err := json.Unmarshal(message.Payload, &status); err == nil {
					_ = s.playlists.ReportStatus(ctx, principal.ScreenID, status)
				}
			}
		case "website.data_cleared":
			var result struct {
				CommandID     uuid.UUID `json:"commandId"`
				Success       bool      `json:"success"`
				ErrorCategory string    `json:"errorCategory"`
			}
			if json.Unmarshal(message.Payload, &result) == nil {
				status := "failed"
				action := "website.data_clear_failed"
				if result.Success {
					status = "completed"
					action = "website.data_clear_completed"
				}
				tag, _ := s.db.Exec(ctx, `UPDATE website_data_clear_commands SET status=$3,completed_at=now(),error_category=NULLIF($4,'') WHERE id=$1 AND screen_id=$2 AND status='pending' AND expires_at>now()`, result.CommandID, principal.ScreenID, status, result.ErrorCategory)
				if tag.RowsAffected() > 0 {
					_, _ = s.db.Exec(ctx, `INSERT INTO audit_logs(id,action,resource_type,resource_id)VALUES($1,$2,'screen',$3)`, uuid.New(), action, principal.ScreenID.String())
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
