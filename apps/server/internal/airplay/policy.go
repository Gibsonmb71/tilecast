package airplay

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"
)

const (
	UxPlayBaseline = "1.73.6"
	VideoPort      = 42000
	AudioPort      = 42002
	MaxScreens     = 64
)

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
}

func ChooseGateway(candidates []GatewayCandidate, preferredID string) (GatewayCandidate, bool) {
	eligible := make([]GatewayCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.Online && candidate.Platform == "linux" && candidate.AirPlaySupported {
			eligible = append(eligible, candidate)
		}
	}
	for _, candidate := range eligible {
		if preferredID != "" && candidate.ID == preferredID {
			return candidate, true
		}
	}
	sort.Slice(eligible, func(i, j int) bool {
		left, right := eligible[i], eligible[j]
		score := func(candidate GatewayCandidate) int {
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
		if score(left) != score(right) {
			return score(left) > score(right)
		}
		return strings.ToLower(left.Name)+"\x00"+left.ID < strings.ToLower(right.Name)+"\x00"+right.ID
	})
	if len(eligible) == 0 {
		return GatewayCandidate{}, false
	}
	return eligible[0], true
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
