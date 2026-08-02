package httpapi

import (
	"testing"

	"github.com/tilecast/tilecast/apps/server/internal/displaycontrol"
)

func TestGroupDisplayControlUsesIndependentCapabilities(t *testing.T) {
	capabilities := map[string]string{
		displaycontrol.CapabilityPower: displaycontrol.ProviderHDMICEC,
		displaycontrol.CapabilityMute:  displaycontrol.ProviderDDCCI,
	}
	if !supportsGroupDisplayControl(capabilities, displaycontrol.CommandPowerOn) {
		t.Fatal("CEC power capability should support a group power action")
	}
	if !supportsGroupDisplayControl(capabilities, displaycontrol.CommandPowerOff) {
		t.Fatal("CEC power capability should support power off")
	}
	if !supportsGroupDisplayControl(capabilities, displaycontrol.CommandMute) {
		t.Fatal("DDC/CI mute capability should support a group mute action")
	}
	if supportsGroupDisplayControl(capabilities, displaycontrol.CommandSetVolume) {
		t.Fatal("volume is not part of the initial group action contract")
	}
	if supportsGroupDisplayControl(map[string]string{
		displaycontrol.CapabilityPower: displaycontrol.ProviderUnsupported,
	}, displaycontrol.CommandPowerOn) {
		t.Fatal("an explicitly unsupported provider must not appear controllable")
	}
}

func TestGroupDisplayControlRejectsUnknownGroupAction(t *testing.T) {
	if displayControlGroupCommandValid(displaycontrol.CommandSetBrightness) {
		t.Fatal("brightness requires a per-screen payload and is not a group action")
	}
	if displayControlGroupCommandValid("display_run_shell") {
		t.Fatal("group actions must remain a closed command set")
	}
}
