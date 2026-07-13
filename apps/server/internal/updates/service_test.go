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

func TestManifestRejectsTrailingJSON(t *testing.T) {
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	raw, _ := json.Marshal(Manifest{SchemaVersion: 1, Product: "tilecast-player", ApplicationID: ApplicationID, VersionCode: 9, VersionName: "0.9.0", Channel: "stable", MinimumSDK: 23, APKAssetName: "tilecast-player.apk", APKSizeBytes: 42, APKSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SigningCertificateSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"})
	raw = append(raw, []byte(` {}`)...)
	signature := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(private, raw)))
	if _, err := ParseAndVerifyManifest(raw, signature, public); err == nil {
		t.Fatal("multiple JSON values were accepted")
	}
}
