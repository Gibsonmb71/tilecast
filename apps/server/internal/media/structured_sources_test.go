package media

import (
	"strings"
	"testing"
)

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
