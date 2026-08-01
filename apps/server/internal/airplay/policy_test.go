package airplay

import "testing"

func TestChooseGatewayDeterministicAndPreferred(t *testing.T) {
	candidates := []GatewayCandidate{
		{ID: "b", Name: "Cafeteria TV", Online: true, Platform: "linux", AirPlaySupported: true, HardwareDecode: true, Wired: true},
		{ID: "a", Name: "Cafeteria TV", Online: true, Platform: "linux", AirPlaySupported: true, HardwareDecode: true, Wired: true},
	}
	selected, ok := ChooseGateway(candidates, "")
	if !ok || selected.ID != "a" {
		t.Fatalf("selected %+v, ok=%v; want deterministic id a", selected, ok)
	}
	selected, ok = ChooseGateway(candidates, "b")
	if !ok || selected.ID != "b" {
		t.Fatalf("preferred gateway %+v, ok=%v", selected, ok)
	}
}

func TestCommonProfileUsesWeakestDisplay(t *testing.T) {
	profile, err := CommonProfile([]Capability{
		{AirPlaySupported: true, HardwareDecode: true, MaxProfile: "1080p30", ScreenName: "A"},
		{AirPlaySupported: true, HardwareDecode: false, MaxProfile: "720p30", ScreenName: "B"},
	})
	if err != nil || profile != Profile720p30 {
		t.Fatalf("profile=%q err=%v, want 720p30", profile, err)
	}
}

func TestSelectTransportFallsBackToUnicast(t *testing.T) {
	if got := SelectTransport("multicast", 12, false); got != "unicast" {
		t.Fatalf("got %q, want unicast fallback", got)
	}
	if got := SelectTransport("auto", 5, true); got != "multicast" {
		t.Fatalf("got %q, want multicast", got)
	}
}

func TestRandomAirplayIdentity(t *testing.T) {
	pin, err := RandomPIN()
	if err != nil || len(pin) != 4 {
		t.Fatalf("pin=%q err=%v", pin, err)
	}
	deviceID, err := RandomDeviceID()
	if err != nil || len(deviceID) != 17 {
		t.Fatalf("device id=%q err=%v", deviceID, err)
	}
}
