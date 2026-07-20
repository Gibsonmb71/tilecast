package updates

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestParseAndVerifyManifest(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(Manifest{SchemaVersion: 1, Product: "tilecast-player", ApplicationID: ApplicationID, VersionCode: 9, VersionName: "0.9.0", Channel: "stable", MinimumSDK: 23, APKAssetName: "tilecast-player.apk", APKSizeBytes: 42, APKSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SigningCertificateSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"})
	signature := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(private, raw)))
	manifest, err := ParseAndVerifyManifest(raw, signature, public)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.VersionCode != 9 {
		t.Fatalf("version code = %d", manifest.VersionCode)
	}
	raw[0] ^= 1
	if _, err := ParseAndVerifyManifest(raw, signature, public); err == nil {
		t.Fatal("tampered manifest accepted")
	}
}

func TestManifestRejectsWrongApplicationAndDowngrade(t *testing.T) {
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	for _, test := range []Manifest{
		{SchemaVersion: 1, Product: "tilecast-player", ApplicationID: "other.app", VersionCode: 9, VersionName: "0.9", Channel: "stable", MinimumSDK: 23, APKAssetName: "tilecast-player.apk", APKSizeBytes: 1, APKSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SigningCertificateSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
		{SchemaVersion: 1, Product: "tilecast-player", ApplicationID: ApplicationID, VersionCode: 5, VersionName: "0.5", Channel: "stable", MinimumSDK: 23, APKAssetName: "tilecast-player.apk", APKSizeBytes: 1, APKSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SigningCertificateSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
	} {
		raw, _ := json.Marshal(test)
		signature := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(private, raw)))
		if _, err := ParseAndVerifyManifest(raw, signature, public); err == nil {
			t.Fatal("unsafe manifest accepted")
		}
	}
}

func TestParseAndVerifyManifestLinux(t *testing.T) {
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	sign := func(m Manifest) []byte {
		raw, _ := json.Marshal(m)
		return raw
	}
	sig := func(raw []byte) []byte {
		return []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(private, raw)))
	}

	good := Manifest{SchemaVersion: 1, Product: "tilecast-player", Platform: PlatformLinux, VersionCode: 1000, VersionName: "0.1.0", Channel: "stable", ArtifactAssetName: LinuxArtifactName, ArtifactSizeBytes: 4096, ArtifactSHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	raw := sign(good)
	manifest, err := ParseAndVerifyManifest(raw, sig(raw), public)
	if err != nil {
		t.Fatalf("valid linux manifest rejected: %v", err)
	}
	if manifest.NormalizedPlatform() != PlatformLinux || manifest.AssetName() != LinuxArtifactName || manifest.ArtifactSize() != 4096 {
		t.Fatalf("linux manifest accessors wrong: %+v", manifest)
	}

	for name, bad := range map[string]Manifest{
		"android fields present": {SchemaVersion: 1, Product: "tilecast-player", Platform: PlatformLinux, VersionCode: 1000, VersionName: "0.1.0", Channel: "stable", ArtifactAssetName: LinuxArtifactName, ArtifactSizeBytes: 1, ArtifactSHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", ApplicationID: ApplicationID},
		"wrong artifact name":    {SchemaVersion: 1, Product: "tilecast-player", Platform: PlatformLinux, VersionCode: 1000, VersionName: "0.1.0", Channel: "stable", ArtifactAssetName: "tilecast-player.deb", ArtifactSizeBytes: 1, ArtifactSHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},
		"zero size":              {SchemaVersion: 1, Product: "tilecast-player", Platform: PlatformLinux, VersionCode: 1000, VersionName: "0.1.0", Channel: "stable", ArtifactAssetName: LinuxArtifactName, ArtifactSizeBytes: 0, ArtifactSHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},
	} {
		raw := sign(bad)
		if _, err := ParseAndVerifyManifest(raw, sig(raw), public); err == nil {
			t.Fatalf("invalid linux manifest accepted: %s", name)
		}
	}

	// An Android manifest must not carry Linux artifact fields.
	mixed := Manifest{SchemaVersion: 1, Product: "tilecast-player", ApplicationID: ApplicationID, VersionCode: 9, VersionName: "0.9.0", Channel: "stable", MinimumSDK: 23, APKAssetName: AndroidArtifactName, APKSizeBytes: 42, APKSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SigningCertificateSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ArtifactAssetName: LinuxArtifactName}
	rawMixed := sign(mixed)
	if _, err := ParseAndVerifyManifest(rawMixed, sig(rawMixed), public); err == nil {
		t.Fatal("android manifest carrying linux fields accepted")
	}
}

func TestManifestRejectsTrailingJSON(t *testing.T) {
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	raw, _ := json.Marshal(Manifest{SchemaVersion: 1, Product: "tilecast-player", ApplicationID: ApplicationID, VersionCode: 9, VersionName: "0.9.0", Channel: "stable", MinimumSDK: 23, APKAssetName: "tilecast-player.apk", APKSizeBytes: 42, APKSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SigningCertificateSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"})
	raw = append(raw, []byte(` {}`)...)
	signature := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(private, raw)))
	if _, err := ParseAndVerifyManifest(raw, signature, public); err == nil {
		t.Fatal("multiple JSON values were accepted")
	}
}
