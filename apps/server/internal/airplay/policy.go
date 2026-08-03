package airplay

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	UxPlayBaseline = "1.73.6"
	VideoPort      = 42000
	AudioPort      = 42002
	MaxScreens     = 64
)

// PreparationWait bounds ordinary group preparation: every display starts a
// GStreamer receiver, which is a process start.
//
// PresentationNetworkPreparationWait bounds a session whose gateway also has to
// join a Presentation Network. WPA2-Enterprise authentication plus DHCP on a
// managed school network is not a process start — a PEAP handshake through a
// RADIUS server followed by a DHCP lease routinely takes tens of seconds — so the
// window is longer. Both are stamped into the session row rather than kept in a
// timer, so a server restart mid-preparation neither loses the bound nor grants a
// fresh one, and sessions without a Presentation Network keep exactly the window
// they had before.
const (
	PreparationWait                    = 45 * time.Second
	PresentationNetworkPreparationWait = 150 * time.Second
)

// PreparationDeadline is the durable bound reconciliation enforces.
func PreparationDeadline(from time.Time, presentationNetwork bool) time.Time {
	if presentationNetwork {
		return from.Add(PresentationNetworkPreparationWait)
	}
	return from.Add(PreparationWait)
}

type VideoProfile string

const (
	Profile1080p30 VideoProfile = "1080p30"
	Profile720p30  VideoProfile = "720p30"
)

type Capability struct {
	AirPlaySupported bool
	HardwareDecode   bool
	MaxProfile       string
	MulticastSupport *bool
	Decoder          string
	Platform         string
	Online           bool
	Wired            bool
	ScreenID         string
	ScreenName       string
	LastKnownIP      string
}

type GatewayCandidate struct {
	ID               string
	Name             string
	Online           bool
	Platform         string
	AirPlaySupported bool
	HardwareDecode   bool
	Wired            bool

	// Presentation Network eligibility. These fields matter only when the target
	// actually uses Presentation Networks; a room with no assignment keeps the
	// existing Ethernet-only selection exactly as it was.
	//
	// PresentationNetworkAssigned is the administrator's intent. The other two are
	// facts the player reported: whether NetworkManager and the root-owned helper
	// can manage a temporary connection at all, and whether a Wi-Fi adapter
	// exists. All three have to hold, because a gateway that cannot join the
	// sender's network is a receiver nobody can discover.
	PresentationNetworkAssigned bool
	PresentationNetworkReady    bool
	WifiAdapterPresent          bool

	// WiredIPv4 is the address this display receives group RTP on. The gateway
	// needs one too: it consumes its own forwarded stream over the same Ethernet
	// path as the rest of the room.
	WiredIPv4 string
}

// GatewayIneligibility explains, per candidate, why it could not be the gateway.
// The reasons are what let the session API say "no member can join the
// Presentation Network because none has a Wi-Fi adapter" instead of a generic
// "no gateway available".
type GatewayIneligibility struct {
	ID     string
	Name   string
	Reason string
}

const (
	// GatewayReasonOffline and friends are stable codes the HTTP layer turns into
	// operator sentences. They are ordered by how an operator fixes them.
	GatewayReasonOffline                 = "offline"
	GatewayReasonNotLinux                = "not_linux"
	GatewayReasonAirPlayUnsupported      = "airplay_unsupported"
	GatewayReasonNoPresentationNetwork   = "presentation_network_unassigned"
	GatewayReasonPresentationUnsupported = "presentation_network_unsupported"
	GatewayReasonNoWifiAdapter           = "wifi_adapter_unavailable"
	GatewayReasonNoWiredAddress          = "wired_address_unavailable"
)

// GatewayRequirement is what the target demands of whichever display becomes the
// gateway. It is derived from the session, not from a candidate, so the same
// deterministic ranking serves both an ordinary Ethernet-only room and one that
// has to reach a Wi-Fi VLAN.
type GatewayRequirement struct {
	// PresentationNetwork is true when at least one participating display has a
	// Presentation Network assigned. Once an administrator has assigned one, a
	// gateway without it would advertise a receiver the sender cannot see, so
	// failing with a precise reason beats silently presenting into a void.
	PresentationNetwork bool
	// WiredIPv4 is true for a group session, where every display — including the
	// gateway — receives the forwarded H.264 stream over Ethernet.
	WiredIPv4 bool
}

// ChooseGateway picks the AirPlay gateway deterministically.
//
// The ranking is unchanged: hardware decode, then a wired connection, then Linux,
// then AirPlay support, then name and ID for stability. What Presentation
// Networks add is *eligibility*, not a second ranking — a candidate that cannot
// satisfy the requirement is filtered out before the sort, so a room with no
// Presentation Network behaves exactly as it did before.
//
// A configured preferred gateway remains a preference rather than a constraint.
// If the preferred display cannot satisfy the requirement, selection falls back
// to the best candidate that can, because refusing the whole session over a
// preference an administrator set before assigning a network would be a worse
// answer than quietly using the display that works.
func ChooseGateway(candidates []GatewayCandidate, preferredID string, requirement GatewayRequirement) (GatewayCandidate, []GatewayIneligibility, bool) {
	eligible := make([]GatewayCandidate, 0, len(candidates))
	rejected := make([]GatewayIneligibility, 0, len(candidates))
	for _, candidate := range candidates {
		if reason := gatewayRejection(candidate, requirement); reason != "" {
			rejected = append(rejected, GatewayIneligibility{ID: candidate.ID, Name: candidate.Name, Reason: reason})
			continue
		}
		eligible = append(eligible, candidate)
	}
	for _, candidate := range eligible {
		if preferredID != "" && candidate.ID == preferredID {
			return candidate, rejected, true
		}
	}
	sort.Slice(eligible, func(i, j int) bool {
		left, right := eligible[i], eligible[j]
		if score(left) != score(right) {
			return score(left) > score(right)
		}
		return strings.ToLower(left.Name)+"\x00"+left.ID < strings.ToLower(right.Name)+"\x00"+right.ID
	})
	if len(eligible) == 0 {
		return GatewayCandidate{}, rejected, false
	}
	return eligible[0], rejected, true
}

func score(candidate GatewayCandidate) int {
	value := 0
	if candidate.HardwareDecode {
		value += 8
	}
	if candidate.Wired {
		value += 4
	}
	if candidate.Platform == "linux" {
		value += 2
	}
	if candidate.AirPlaySupported {
		value++
	}
	return value
}

// gatewayRejection returns the first reason a candidate cannot serve, or "".
// Order matters: it is the order in which an operator would act on the problem.
func gatewayRejection(candidate GatewayCandidate, requirement GatewayRequirement) string {
	switch {
	case !candidate.Online:
		return GatewayReasonOffline
	case candidate.Platform != "linux":
		return GatewayReasonNotLinux
	case !candidate.AirPlaySupported:
		return GatewayReasonAirPlayUnsupported
	}
	if requirement.PresentationNetwork {
		switch {
		case !candidate.PresentationNetworkAssigned:
			return GatewayReasonNoPresentationNetwork
		case !candidate.WifiAdapterPresent:
			return GatewayReasonNoWifiAdapter
		case !candidate.PresentationNetworkReady:
			return GatewayReasonPresentationUnsupported
		}
	}
	// The gateway consumes its own forwarded RTP stream over the same Ethernet
	// path as every follower, so it needs a wired address just as they do.
	if requirement.WiredIPv4 && !ValidWiredIPv4(candidate.WiredIPv4) {
		return GatewayReasonNoWiredAddress
	}
	return ""
}

// GatewayLimitation renders the ineligibility set as one operator sentence.
//
// It names the limitation rather than counting failures, because "no member can
// act as the Wi-Fi gateway: none has a Wi-Fi adapter" tells an operator what to
// buy, and "no gateway available" does not. When members fail for different
// reasons the most actionable one wins, using the same order as the checks above.
func GatewayLimitation(rejected []GatewayIneligibility, requirement GatewayRequirement) string {
	if len(rejected) == 0 {
		return "No online Linux AirPlay-capable gateway is available."
	}
	priority := []string{
		GatewayReasonNoPresentationNetwork,
		GatewayReasonNoWifiAdapter,
		GatewayReasonPresentationUnsupported,
		GatewayReasonNoWiredAddress,
		GatewayReasonAirPlayUnsupported,
		GatewayReasonNotLinux,
		GatewayReasonOffline,
	}
	byReason := map[string][]string{}
	for _, item := range rejected {
		byReason[item.Reason] = append(byReason[item.Reason], item.Name)
	}
	for _, reason := range priority {
		names := byReason[reason]
		if len(names) == 0 {
			continue
		}
		subject := strings.Join(names, ", ")
		switch reason {
		case GatewayReasonNoPresentationNetwork:
			return "No display in this room can act as the AirPlay gateway: a Presentation Network is required, and " +
				subject + " has no Presentation Network assigned. Assign one in Settings → Presentation Networks."
		case GatewayReasonNoWifiAdapter:
			return "No display in this room can act as the AirPlay gateway: joining the Presentation Network needs a Wi-Fi adapter, and " +
				subject + " has none. Only the gateway needs Wi-Fi; the other displays stay on Ethernet."
		case GatewayReasonPresentationUnsupported:
			return "No display in this room can act as the AirPlay gateway: " + subject +
				" cannot manage a temporary Wi-Fi connection. NetworkManager and the Tilecast presentation-network helper are both required."
		case GatewayReasonNoWiredAddress:
			return "No display in this room can act as the AirPlay gateway: " + subject +
				" has not reported a usable Ethernet IPv4 address for group video fan-out."
		case GatewayReasonAirPlayUnsupported:
			return subject + " is not AirPlay-ready, so no display in this room can act as the gateway."
		case GatewayReasonNotLinux:
			return subject + " is not a Linux AirPlay player, so no display in this room can act as the gateway."
		case GatewayReasonOffline:
			return subject + " is not online, so no display in this room can act as the gateway."
		}
	}
	return "No online Linux AirPlay-capable gateway is available."
}

// ValidWiredIPv4 is the single definition of "an address group RTP may be sent
// to", applied on both the player and the server boundary.
//
// Unspecified, loopback, multicast, and link-local addresses are all things a
// dual-homed box can plausibly report and none of them is a destination another
// display can reach. Rejecting them here is what turns a silent black room into
// a precise readiness error.
func ValidWiredIPv4(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	address := net.ParseIP(value)
	if address == nil {
		return false
	}
	v4 := address.To4()
	return v4 != nil && !v4.IsUnspecified() && !v4.IsLoopback() &&
		!v4.IsMulticast() && !v4.IsLinkLocalUnicast()
}

func CommonProfile(capabilities []Capability) (VideoProfile, error) {
	if len(capabilities) == 0 {
		return "", errors.New("no AirPlay-capable screens were selected")
	}
	for _, capability := range capabilities {
		if !capability.AirPlaySupported {
			return "", fmt.Errorf("screen %s does not support AirPlay", capability.ScreenName)
		}
	}
	all1080 := true
	for _, capability := range capabilities {
		if !capability.HardwareDecode || capability.MaxProfile != string(Profile1080p30) {
			all1080 = false
			break
		}
	}
	if all1080 {
		return Profile1080p30, nil
	}
	for _, capability := range capabilities {
		if capability.MaxProfile != string(Profile1080p30) && capability.MaxProfile != string(Profile720p30) {
			return "", fmt.Errorf("screen %s has no supported H.264 AirPlay profile", capability.ScreenName)
		}
	}
	return Profile720p30, nil
}

func RandomPIN() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", value.Int64()), nil
}

func RandomDeviceID() (string, error) {
	var bytes [6]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	bytes[0] = (bytes[0] | 0x02) & 0xfe
	parts := make([]string, len(bytes))
	for index, value := range bytes {
		parts[index] = fmt.Sprintf("%02x", value)
	}
	return strings.Join(parts, ":"), nil
}

func MulticastAddress(sessionByte byte) string {
	// Keep the address in the reserved, controlled range and avoid .0.
	if sessionByte == 0 {
		sessionByte = 1
	}
	return "239.255.42." + strconv.Itoa(int(sessionByte))
}

func SelectTransport(requested string, screenCount int, multicastReady bool) string {
	requested = strings.ToLower(strings.TrimSpace(requested))
	if requested == "unicast" {
		return "unicast"
	}
	if requested == "multicast" && multicastReady {
		return "multicast"
	}
	if requested == "auto" || requested == "" {
		if screenCount > 4 && multicastReady {
			return "multicast"
		}
	}
	// Multicast is an optimization. Never make an otherwise valid session fail
	// merely because the LAN cannot carry multicast.
	return "unicast"
}
