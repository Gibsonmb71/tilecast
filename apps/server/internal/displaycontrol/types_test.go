package displaycontrol

import "testing"

func TestValidateCommandPayload(t *testing.T) {
	valid := []struct {
		name    string
		command string
		payload map[string]any
	}{
		{"power on", CommandPowerOn, map[string]any{}},
		{"input", CommandSetInput, map[string]any{"input": "1.0.0.0"}},
		{"volume", CommandSetVolume, map[string]any{"volume": float64(50)}},
		{"brightness", CommandSetBrightness, map[string]any{"brightness": float64(75)}},
	}
	for _, test := range valid {
		t.Run(test.name, func(t *testing.T) {
			if err := ValidateCommandPayload(test.command, test.payload); err != nil {
				t.Fatalf("valid payload rejected: %v", err)
			}
		})
	}

	invalid := []struct {
		name    string
		command string
		payload map[string]any
	}{
		{"out of range volume", CommandSetVolume, map[string]any{"volume": float64(101)}},
		{"fractional brightness", CommandSetBrightness, map[string]any{"brightness": 1.5}},
		{"unsafe input", CommandSetInput, map[string]any{"input": "1; reboot"}},
		{"input with unrelated field", CommandSetInput, map[string]any{"input": "1.0.0.0", "volume": float64(10)}},
		{"volume with unrelated field", CommandSetVolume, map[string]any{"volume": float64(10), "brightness": float64(20)}},
		{"extra power field", CommandPowerOn, map[string]any{"volume": float64(10)}},
		{"probe is not a policy action", CommandProbe, map[string]any{}},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			if err := ValidateCommandPayload(test.command, test.payload); err == nil {
				t.Fatal("invalid payload was accepted")
			}
		})
	}
}

func TestValidateCapabilities(t *testing.T) {
	if err := ValidateCapabilities(map[string]string{
		CapabilityPower:      ProviderHDMICEC,
		CapabilityBrightness: ProviderDDCCI,
	}); err != nil {
		t.Fatal(err)
	}
	if err := ValidateCapabilities(map[string]string{"shell": ProviderNetwork}); err == nil {
		t.Fatal("unknown capability was accepted")
	}
}
