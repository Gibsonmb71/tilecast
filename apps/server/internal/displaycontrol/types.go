// Package displaycontrol contains the protocol-neutral Display Control
// contract. Platform players provide the implementation; the server stores
// only bounded capability and result snapshots and queues typed commands.
package displaycontrol

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	ProviderUnsupported = "unsupported"
	ProviderHDMICEC     = "hdmi_cec"
	ProviderDDCCI       = "ddc_ci"
	ProviderNetwork     = "network"
	ProviderRS232       = "rs232"

	CapabilityPower      = "power"
	CapabilityInput      = "input"
	CapabilityVolume     = "volume"
	CapabilityMute       = "mute"
	CapabilityBrightness = "brightness"
	CapabilityProbe      = "probe"

	CommandPowerOn       = "display_power_on"
	CommandPowerOff      = "display_power_off"
	CommandSetInput      = "display_set_input"
	CommandSetVolume     = "display_set_volume"
	CommandMute          = "display_mute"
	CommandUnmute        = "display_unmute"
	CommandSetBrightness = "display_set_brightness"
	CommandProbe         = "display_probe"

	PowerStateUnknown       = "unknown"
	PowerStateOn            = "on"
	PowerStateOff           = "off"
	PowerStateTransitioning = "transitioning"
	PowerStateUnsupported   = "unsupported"
)

var inputPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,32}$`)

var (
	allowedProviders = map[string]bool{
		ProviderUnsupported: true,
		ProviderHDMICEC:     true,
		ProviderDDCCI:       true,
		ProviderNetwork:     true,
		ProviderRS232:       true,
	}
	allowedCapabilities = map[string]bool{
		CapabilityPower: true, CapabilityInput: true, CapabilityVolume: true,
		CapabilityMute: true, CapabilityBrightness: true, CapabilityProbe: true,
	}
	allowedCommands = map[string]bool{
		CommandPowerOn: true, CommandPowerOff: true, CommandSetInput: true,
		CommandSetVolume: true, CommandMute: true, CommandUnmute: true,
		CommandSetBrightness: true, CommandProbe: true,
	}
	allowedPowerStates = map[string]bool{
		PowerStateUnknown: true, PowerStateOn: true, PowerStateOff: true,
		PowerStateTransitioning: true, PowerStateUnsupported: true,
	}
)

// Action is the schedule-safe subset of Display Control commands. Probe is a
// command, but deliberately is not a policy action because it has no state
// change to apply at a schedule boundary.
type Action struct {
	Type       string `json:"type"`
	Input      string `json:"input,omitempty"`
	Volume     *int   `json:"volume,omitempty"`
	Brightness *int   `json:"brightness,omitempty"`
}

func IsCommand(value string) bool { return allowedCommands[value] }

func IsProvider(value string) bool { return allowedProviders[value] }

func IsCapability(value string) bool { return allowedCapabilities[value] }

func IsPowerState(value string) bool { return allowedPowerStates[value] }

func (a Action) Validate() error {
	if !allowedCommands[a.Type] || a.Type == CommandProbe {
		return errors.New("display action type is unsupported")
	}
	switch a.Type {
	case CommandSetInput:
		if a.Volume != nil || a.Brightness != nil || a.Input != strings.TrimSpace(a.Input) || !inputPattern.MatchString(a.Input) {
			return errors.New("display input is invalid")
		}
	case CommandSetVolume:
		if a.Input != "" || a.Brightness != nil || a.Volume == nil || *a.Volume < 0 || *a.Volume > 100 {
			return errors.New("display volume must be between 0 and 100")
		}
	case CommandSetBrightness:
		if a.Input != "" || a.Volume != nil || a.Brightness == nil || *a.Brightness < 0 || *a.Brightness > 100 {
			return errors.New("display brightness must be between 0 and 100")
		}
	case CommandPowerOn, CommandPowerOff, CommandMute, CommandUnmute:
		if a.Input != "" || a.Volume != nil || a.Brightness != nil {
			return errors.New("display action contains fields that do not apply")
		}
	}
	return nil
}

func ValidateCommandPayload(command string, payload map[string]any) error {
	if !allowedCommands[command] {
		return errors.New("display command is unsupported")
	}
	for key := range payload {
		if !map[string]bool{
			"input": true, "volume": true, "brightness": true,
		}[key] {
			return fmt.Errorf("display command contains unsupported field %q", key)
		}
	}
	action := Action{Type: command}
	if value, ok := payload["input"]; ok {
		input, valid := value.(string)
		if !valid {
			return errors.New("display input must be a string")
		}
		action.Input = input
	}
	if value, ok := payload["volume"]; ok {
		volume, valid := integerValue(value)
		if !valid {
			return errors.New("display volume must be an integer")
		}
		action.Volume = &volume
	}
	if value, ok := payload["brightness"]; ok {
		brightness, valid := integerValue(value)
		if !valid {
			return errors.New("display brightness must be an integer")
		}
		action.Brightness = &brightness
	}
	return action.Validate()
}

func integerValue(value any) (int, bool) {
	number, ok := value.(float64)
	if !ok || number != float64(int(number)) {
		return 0, false
	}
	return int(number), true
}

// ValidateCapabilities accepts only capability-to-provider maps. Keeping the
// map closed prevents an untrusted player from making arbitrary Studio controls
// appear available.
func ValidateCapabilities(capabilities map[string]string) error {
	if len(capabilities) > 16 {
		return errors.New("display capabilities are too numerous")
	}
	for capability, provider := range capabilities {
		if !allowedCapabilities[capability] || !allowedProviders[provider] {
			return errors.New("display capabilities are invalid")
		}
	}
	return nil
}
