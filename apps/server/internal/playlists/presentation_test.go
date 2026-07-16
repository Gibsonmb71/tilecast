package playlists

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProjectDataDocumentCoercesTypedValues(t *testing.T) {
	raw := json.RawMessage(`{
		"fields":[
			{"key":"name","label":"Name","type":"text"},
			{"key":"price","label":"Price","type":"currency"},
			{"key":"active","label":"Active","type":"boolean"}
		],
		"records":[{"id":"row-1","values":{"name":"Coffee","price":"3.50","active":"true"}}],
		"usingCachedData":false,
		"unavailable":false
	}`)
	document, err := projectDataDocument(raw)
	if err != nil {
		t.Fatal(err)
	}
	if document.SchemaVersion != 1 || len(document.Datasets) != 1 || len(document.Datasets[0].Records) != 1 {
		t.Fatalf("unexpected document: %#v", document)
	}
	values := document.Datasets[0].Records[0].Values
	if values["name"].Kind != "text" || values["price"].Kind != "currency" || values["price"].Number == nil || *values["price"].Number != 3.5 || values["active"].Boolean == nil || !*values["active"].Boolean {
		t.Fatalf("typed values were not coerced: %#v", values)
	}
}

func TestCompileWidgetPresentationUsesNodesNotProviderDispatch(t *testing.T) {
	raw := json.RawMessage(`{
		"dataSourceId":"123e4567-e89b-12d3-a456-426614174000",
		"fields":["title","subtitle"],
		"maximumItems":8,
		"foregroundColor":"#FFFFFF",
		"backgroundColor":"#000000"
	}`)
	presentation, err := compileWidgetPresentation("list", raw)
	if err != nil {
		t.Fatal(err)
	}
	if presentation.Kind != "native" || presentation.Native == nil || presentation.Native.Root.Type != "surface" {
		t.Fatalf("unexpected presentation: %#v", presentation)
	}
	encoded, err := json.Marshal(presentation)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err = json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if _, exists := decoded["provider"]; exists {
		t.Fatal("Player presentation leaked provider dispatch metadata")
	}
}

func TestCompileWebPresentationIsHTTPSAndLifecycleBounded(t *testing.T) {
	raw := json.RawMessage(`{
		"url":"https://example.org/signage",
		"allowedHosts":["example.org"],
		"loadTimeoutSeconds":30,
		"lifecycle":"keep_warm",
		"warmSeconds":900
	}`)
	presentation, err := compileWidgetPresentation("website", raw)
	if err != nil {
		t.Fatal(err)
	}
	if presentation.Web == nil || presentation.Web.Mode != "remote" || presentation.Web.WarmSeconds != 300 {
		t.Fatalf("unexpected web descriptor: %#v", presentation.Web)
	}
	if _, err = compileWidgetPresentation("website", json.RawMessage(`{"url":"http://example.org"}`)); err == nil {
		t.Fatal("public insecure web presentation was accepted")
	}
}

func TestProjectMultiDatasetDocument(t *testing.T) {
	raw := json.RawMessage(`{"datasets":[{"id":"current","kind":"object","fields":[{"key":"aqi","label":"AQI","type":"integer"}],"values":{"aqi":"42"},"attribution":"Example"},{"id":"hourly","kind":"time_series","fields":[{"key":"pm2_5","label":"PM2.5","type":"number"}],"points":[{"at":"2026-07-16T12:00:00Z","values":{"pm2_5":"8.5"}}]}]}`)
	document, err := projectDataDocument(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(document.Datasets) != 2 || document.Datasets[0].Value == nil || document.Datasets[0].Value.Object["aqi"].Integer == nil {
		t.Fatalf("document=%+v", document)
	}
	if len(document.Datasets[1].Points) != 1 || document.Datasets[1].Points[0].Values["pm2_5"].Number == nil {
		t.Fatalf("points=%+v", document.Datasets[1].Points)
	}
}

func TestCompileWorldClockAndChartCapabilities(t *testing.T) {
	clock, err := compileWidgetPresentation("world_clock", json.RawMessage(`{"zones":[{"label":"New York","timezone":"America/New_York"}],"format":"12","showDate":true,"columns":1}`))
	if err != nil || clock.Native == nil || clock.RequiredCapabilities["environment.time"] != 1 {
		t.Fatalf("clock=%+v err=%v", clock, err)
	}
	chart, err := compileWidgetPresentation("chart", json.RawMessage(`{"dataSourceId":"11111111-1111-1111-1111-111111111111","dataset":"hourly","chartType":"line","series":[{"field":"pm2_5","label":"PM2.5"}]}`))
	if err != nil || chart.RequiredCapabilities["content.line_chart"] != 2 {
		t.Fatalf("chart=%+v err=%v", chart, err)
	}
}

func TestSchoolStatusBannerCompilesFromReleaseDefinition(t *testing.T) {
	raw := json.RawMessage(`{
		"dataSourceId":"11111111-1111-1111-1111-111111111111",
		"heading":"District status","statusField":"status","messageField":"message",
		"severityField":"severity","showUpdatedTime":true,
		"foregroundColor":"#ffffff","backgroundColor":"#17324d",
		"emptyState":"Status unavailable"
	}`)
	presentation, err := compileWidgetPresentation("school-status-banner", raw)
	if err != nil {
		t.Fatal(err)
	}
	if presentation.Native == nil || presentation.Native.Root.Type != "surface" {
		t.Fatal("release definition did not compile to a native surface")
	}
	if presentation.RequiredCapabilities["content.badge"] != 1 ||
		presentation.RequiredCapabilities["collection.conditional"] != 2 {
		t.Fatalf("unexpected capabilities: %#v", presentation.RequiredCapabilities)
	}
	encoded, _ := json.Marshal(presentation)
	if strings.Contains(string(encoded), "$config") || strings.Contains(string(encoded), "$ifConfig") {
		t.Fatal("Player presentation contains unresolved Server placeholders")
	}
}

func TestCompatibilityChecksOnlyPresentationRequirements(t *testing.T) {
	presentation := &WidgetPresentation{
		SchemaVersion: 1,
		Kind:          "native",
		RequiredCapabilities: map[string]int{
			"layout.surface": 1,
			"content.text":   1,
		},
	}
	player := playerPresentationCapabilities{
		SchemaVersions: []int32{1},
		Native: map[string]int{
			"layout.surface": 1,
			"content.text":   1,
		},
		Reported: true,
	}
	if err := checkPresentationCompatibility("Enrollment Chart", presentation, player); err != nil {
		t.Fatalf("unrelated global capabilities made content incompatible: %v", err)
	}
	presentation.RequiredCapabilities["content.line_chart"] = 2
	player.Native["content.line_chart"] = 1
	err := checkPresentationCompatibility("Enrollment Chart", presentation, player)
	if err == nil || !strings.Contains(err.Error(), "content.line_chart@2") ||
		!strings.Contains(err.Error(), "content.line_chart@1") {
		t.Fatalf("missing capability was not identified exactly: %v", err)
	}
}
