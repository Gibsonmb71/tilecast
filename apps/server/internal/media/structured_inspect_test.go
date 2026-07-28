package media

import "testing"

func TestInspectCSVDetectsColumnsSamplesAndMapping(t *testing.T) {
	body := "Event Name;Room;Start Date;More Info\nBoard meeting;204;2026-09-01;https://example.org/board\nPTO night;Gym;2026-09-02;https://example.org/pto\n"
	inspection, err := inspectCSV([]byte(body), StructuredSourceConfig{})
	if err != nil {
		t.Fatal(err)
	}
	if inspection.Delimiter != ";" || inspection.RowCount != 2 || len(inspection.Fields) != 4 {
		t.Fatalf("inspection=%#v", inspection)
	}
	if inspection.Fields[0].Key != "Event Name" || len(inspection.Fields[0].Samples) != 2 ||
		inspection.Fields[0].Samples[0] != "Board meeting" {
		t.Fatalf("first field=%#v", inspection.Fields[0])
	}
	if inspection.Suggested.Title != "Event Name" || inspection.Suggested.Subtitle != "Room" ||
		inspection.Suggested.Date != "Start Date" || inspection.Suggested.Link != "More Info" {
		t.Fatalf("suggested=%#v", inspection.Suggested)
	}
	// CSV records carry no author or description, so Studio must never offer those toggles.
	if inspection.Available.Author || inspection.Available.Description || !inspection.Available.Title {
		t.Fatalf("available=%#v", inspection.Available)
	}
}

func TestInspectCSVRejectsAnEmptyHeaderRow(t *testing.T) {
	if _, err := inspectCSV([]byte(",,\n1,2,3\n"), StructuredSourceConfig{}); err == nil {
		t.Fatal("expected an error for a CSV without column names")
	}
}

func TestSuggestMappingNeverReusesOneField(t *testing.T) {
	// "description" is a candidate for subtitle only after "detail" and it must not also be
	// claimed by another slot.
	mapping := suggestMapping([]string{"description", "url"})
	if mapping.Subtitle != "description" || mapping.Link != "url" || mapping.Title != "" {
		t.Fatalf("mapping=%#v", mapping)
	}
}

// Without a recognizable name there is still exactly one thing Studio can do that beats an
// empty form: map the first field, which the author can then change.
func TestSuggestMappingFallsBackToTheFirstFieldForTitle(t *testing.T) {
	mapping := suggestMapping([]string{"col_a", "col_b"})
	if mapping.Title != "col_a" || mapping.Subtitle != "" {
		t.Fatalf("mapping=%#v", mapping)
	}
}

func TestInspectJSONFindsTheRecordListAndPointers(t *testing.T) {
	body := `{"meta":{"generated":"now"},"items":[{"title":"Lunch","room":"Cafeteria","price":3},{"title":"Dinner","room":"Hall","price":5}]}`
	inspection, err := inspectJSON([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if inspection.Suggested.RootList != "/items" || inspection.RowCount != 2 {
		t.Fatalf("inspection=%#v", inspection)
	}
	if inspection.Suggested.Title != "/title" || inspection.Suggested.Subtitle != "/room" {
		t.Fatalf("suggested=%#v", inspection.Suggested)
	}
	keys := map[string]bool{}
	for _, field := range inspection.Fields {
		keys[field.Key] = true
	}
	if !keys["/price"] || len(inspection.Fields) != 3 {
		t.Fatalf("fields=%#v", inspection.Fields)
	}
}

func TestInspectJSONSupportsATopLevelArray(t *testing.T) {
	inspection, err := inspectJSON([]byte(`[{"name":"Lunch"}]`))
	if err != nil {
		t.Fatal(err)
	}
	if inspection.Suggested.RootList != "" || inspection.Suggested.Title != "/name" {
		t.Fatalf("suggested=%#v", inspection.Suggested)
	}
}

func TestInspectJSONRejectsADocumentWithoutRecords(t *testing.T) {
	if _, err := inspectJSON([]byte(`{"status":"ok"}`)); err == nil {
		t.Fatal("expected an error for a document with no record array")
	}
}

func TestInspectFeedReportsOnlyFieldsTheFeedCarries(t *testing.T) {
	body := `<?xml version="1.0"?><rss><channel>` +
		`<item><title>Board news</title><link>https://example.org/a</link><pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate></item>` +
		`<item><title>PTO night</title><link>https://example.org/b</link><pubDate>Wed, 02 Sep 2026 10:00:00 GMT</pubDate></item>` +
		`</channel></rss>`
	inspection, err := inspectFeed("rss", []byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if !inspection.Available.Title || !inspection.Available.Date || !inspection.Available.Link {
		t.Fatalf("available=%#v", inspection.Available)
	}
	if inspection.Available.Author || inspection.Available.Description || inspection.Available.Image {
		t.Fatalf("expected absent feed fields to be unavailable: %#v", inspection.Available)
	}
	if inspection.RowCount != 2 {
		t.Fatalf("rowCount=%d", inspection.RowCount)
	}
}
