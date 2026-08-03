package airplay

import (
	"strings"
	"testing"
)

func TestChooseGatewayDeterministicAndPreferred(t *testing.T) {
	candidates := []GatewayCandidate{
		{ID: "b", Name: "Cafeteria TV", Online: true, Platform: "linux", AirPlaySupported: true, HardwareDecode: true, Wired: true},
		{ID: "a", Name: "Cafeteria TV", Online: true, Platform: "linux", AirPlaySupported: true, HardwareDecode: true, Wired: true},
	}
	selected, _, ok := ChooseGateway(candidates, "", GatewayRequirement{})
	if !ok || selected.ID != "a" {
		t.Fatalf("selected %+v, ok=%v; want deterministic id a", selected, ok)
	}
	selected, _, ok = ChooseGateway(candidates, "b", GatewayRequirement{})
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

func TestPresentationNetworkGatewayUsesOnlyEligibleMember(t *testing.T) {
	candidates := []GatewayCandidate{
		{
			ID: "follower", Name: "Hallway", Online: true, Platform: "linux",
			AirPlaySupported: true, WiredIPv4: "192.0.2.20",
		},
		{
			ID: "gateway", Name: "Cafeteria", Online: true, Platform: "linux",
			AirPlaySupported: true, HardwareDecode: true, WiredIPv4: "192.0.2.21",
			PresentationNetworkAssigned: true, PresentationNetworkReady: true,
			WifiAdapterPresent: true,
		},
	}

	selected, rejected, ok := ChooseGateway(candidates, "", GatewayRequirement{
		PresentationNetwork: true,
		WiredIPv4:           true,
	})
	if !ok || selected.ID != "gateway" {
		t.Fatalf("selected=%+v ok=%v, want the sole Wi-Fi-capable gateway", selected, ok)
	}
	if len(rejected) != 1 || rejected[0].ID != "follower" || rejected[0].Reason != GatewayReasonNoPresentationNetwork {
		t.Fatalf("rejected=%+v, want the Ethernet-only follower rejected only as a gateway", rejected)
	}
}

func TestPreferredPresentationGatewayFallsBackWhenItCannotJoinWiFi(t *testing.T) {
	candidates := []GatewayCandidate{
		{
			ID: "preferred", Name: "Preferred", Online: true, Platform: "linux",
			AirPlaySupported: true, PresentationNetworkAssigned: true,
			PresentationNetworkReady: false, WifiAdapterPresent: true,
			WiredIPv4: "192.0.2.30",
		},
		{
			ID: "fallback", Name: "Fallback", Online: true, Platform: "linux",
			AirPlaySupported: true, PresentationNetworkAssigned: true,
			PresentationNetworkReady: true, WifiAdapterPresent: true,
			WiredIPv4: "192.0.2.31",
		},
	}
	selected, _, ok := ChooseGateway(candidates, "preferred", GatewayRequirement{
		PresentationNetwork: true,
		WiredIPv4:           true,
	})
	if !ok || selected.ID != "fallback" {
		t.Fatalf("selected=%+v ok=%v, want eligible fallback", selected, ok)
	}
}

func TestPresentationNetworkGatewayFailureExplainsMissingCapability(t *testing.T) {
	selected, rejected, ok := ChooseGateway([]GatewayCandidate{
		{
			ID: "one", Name: "One", Online: true, Platform: "linux",
			AirPlaySupported: true, PresentationNetworkAssigned: true,
			PresentationNetworkReady: false, WifiAdapterPresent: true,
		},
		{
			ID: "two", Name: "Two", Online: true, Platform: "linux",
			AirPlaySupported: true, PresentationNetworkAssigned: true,
			PresentationNetworkReady: false, WifiAdapterPresent: true,
		},
	}, "", GatewayRequirement{PresentationNetwork: true})
	if ok || selected.ID != "" {
		t.Fatalf("selected=%+v ok=%v, want no gateway", selected, ok)
	}
	message := GatewayLimitation(rejected, GatewayRequirement{PresentationNetwork: true})
	if message == "" || !containsAll(message, "cannot manage a temporary Wi-Fi connection", "NetworkManager", "presentation-network helper") {
		t.Fatalf("limitation=%q, want an actionable Wi-Fi capability explanation", message)
	}
}

func TestEthernetOnlyGatewaySelectionDoesNotRequirePresentationNetwork(t *testing.T) {
	selected, _, ok := ChooseGateway([]GatewayCandidate{
		{ID: "android", Name: "Android", Online: true, Platform: "android-tv", AirPlaySupported: true, WiredIPv4: "192.0.2.40"},
		{ID: "linux", Name: "Linux", Online: true, Platform: "linux", AirPlaySupported: true, WiredIPv4: "192.0.2.41"},
	}, "", GatewayRequirement{})
	if !ok || selected.ID != "linux" {
		t.Fatalf("selected=%+v ok=%v, want the normal Ethernet-only ranking", selected, ok)
	}
}

func TestValidWiredIPv4RejectsAddressesThatCouldBeWiFiOrUnreachable(t *testing.T) {
	for _, value := range []string{"", "0.0.0.0", "127.0.0.1", "224.0.0.1", "169.254.1.20", "2001:db8::1"} {
		if ValidWiredIPv4(value) {
			t.Fatalf("ValidWiredIPv4(%q)=true, want false", value)
		}
	}
	if !ValidWiredIPv4("192.0.2.55") {
		t.Fatal("ValidWiredIPv4 rejected a usable IPv4 address")
	}
}

func containsAll(value string, needles ...string) bool {
	for _, needle := range needles {
		if !strings.Contains(value, needle) {
			return false
		}
	}
	return true
}
