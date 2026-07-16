package media

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestUploadedCSVContentDrivesRecords documents why saved Data Sources must be
// previewed by id: the uploaded CSV payload parses into records, but the API
// strips that payload from detail responses, so re-parsing a stripped config
// (as an older Layout preview did) yields nothing — hence "No items available".
func TestUploadedCSVContentDrivesRecords(t *testing.T) {
	body := "title,option_2\nGrilled Cheese,Veggie Wrap\n"
	config := StructuredSourceConfig{
		MaxItems: 10,
		Sort:     "source",
		Mapping: &StructuredMapping{
			Title:       "title",
			ValueFields: map[string]string{"option_2": "option_2"},
		},
	}
	records, err := parseCSVRecords([]byte(body), config)
	if err != nil || len(records) != 1 || records[0].Title != "Grilled Cheese" ||
		records[0].Values["option_2"] != "Veggie Wrap" {
		t.Fatalf("records=%#v err=%v", records, err)
	}

	raw, _ := json.Marshal(StructuredSourceConfig{Uploaded: true, UploadedContent: body})
	stripped := stripUploadedContent("csv", raw)
	var got StructuredSourceConfig
	if err := json.Unmarshal(stripped, &got); err != nil {
		t.Fatal(err)
	}
	if got.UploadedContent != "" {
		t.Fatalf("expected uploadedContent to be stripped, got %q", got.UploadedContent)
	}
	if !got.Uploaded {
		t.Fatal("expected uploaded flag to be retained after stripping")
	}
}

func TestStructuredSourceParsers(t *testing.T) {
	config := StructuredSourceConfig{MaxItems: 10, Sort: "source", Mapping: &StructuredMapping{RootList: "/items", Title: "/name", Subtitle: "/room"}}
	jsonRecords, err := parseJSONRecords([]byte(`{"items":[{"name":"Lunch","room":"Cafeteria"}]}`), config)
	if err != nil || len(jsonRecords) != 1 || jsonRecords[0].Title != "Lunch" || jsonRecords[0].Subtitle != "Cafeteria" {
		t.Fatalf("json records=%#v err=%v", jsonRecords, err)
	}
	config.Mapping = &StructuredMapping{Title: "name", Subtitle: "room"}
	csvRecords, err := parseCSVRecords([]byte("name,room\nLunch,Cafeteria\n"), config)
	if err != nil || len(csvRecords) != 1 || csvRecords[0].Title != "Lunch" {
		t.Fatalf("csv records=%#v err=%v", csvRecords, err)
	}
	feedRecords, err := parseFeed([]byte(`<?xml version="1.0"?><rss><channel><item><title>Board news</title><description><![CDATA[<b>Approved</b>]]></description><link>https://example.com/news</link></item></channel></rss>`), config)
	if err != nil || len(feedRecords) != 1 || feedRecords[0].Description != "Approved" || !strings.HasPrefix(feedRecords[0].Link, "https://") {
		t.Fatalf("feed records=%#v err=%v", feedRecords, err)
	}
}

func TestJSONPointerIsConstrained(t *testing.T) {
	value, err := jsonPointer(map[string]any{"a/b": []any{"ok"}}, "/a~1b/0")
	if err != nil || value != "ok" {
		t.Fatalf("value=%v err=%v", value, err)
	}
	if _, err = jsonPointer(map[string]any{}, "$.items"); err == nil {
		t.Fatal("expected non-pointer path to fail")
	}
}

func TestSelectStructuredRecordsUsesConfiguredLocalDate(t *testing.T) {
	records := []StructuredRecord{
		{ID: "monday", Date: "2026-11-02"},
		{ID: "sunday", Date: "2026-11-01"},
	}
	selection := DateSelection{
		Enabled:         true,
		Timezone:        "America/New_York",
		Mode:            "today",
		NoMatchBehavior: "empty",
	}

	selected := selectStructuredRecords(records, selection, "2026-11-01")
	if len(selected) != 1 || selected[0].ID != "sunday" {
		t.Fatalf("selected=%#v", selected)
	}
}

func TestSelectStructuredRecordsDoesNotReusePastByDefault(t *testing.T) {
	records := []StructuredRecord{{ID: "yesterday", Date: "2026-08-02"}}
	selection := DateSelection{
		Enabled:         true,
		Timezone:        "America/New_York",
		Mode:            "today",
		NoMatchBehavior: "empty",
	}

	if selected := selectStructuredRecords(records, selection, "2026-08-03"); len(selected) != 0 {
		t.Fatalf("expected empty selection, got %#v", selected)
	}
	selection.NoMatchBehavior = "last_known_good"
	selected := selectStructuredRecords(records, selection, "2026-08-03")
	if len(selected) != 1 || selected[0].ID != "yesterday" {
		t.Fatalf("selected=%#v", selected)
	}
}

func TestStructuredSourceParsersAllowDataOnlyMappings(t *testing.T) {
	mapping := StructuredMapping{Date: "date", ValueFields: map[string]string{"option_1": "option_1", "option_2": "option_2"}}
	if err := validateStructuredMapping(mapping, "csv"); err != nil {
		t.Fatalf("data-only mapping rejected: %v", err)
	}
	config := StructuredSourceConfig{MaxItems: 10, Sort: "source", Mapping: &mapping, DateSelection: DateSelection{Enabled: true, DateFormat: "iso_date", Timezone: "America/New_York", Mode: "today", NoMatchBehavior: "empty"}}
	records, err := parseCSVRecords([]byte("date,option_1,option_2\n2026-08-03,Chicken tenders,Cheeseburger\n"), config)
	if err != nil || len(records) != 1 {
		t.Fatalf("records=%#v err=%v", records, err)
	}
	if records[0].Title != "" || records[0].Values["option_1"] != "Chicken tenders" || records[0].Values["option_2"] != "Cheeseburger" {
		t.Fatalf("unexpected data-only record: %#v", records[0])
	}
}
