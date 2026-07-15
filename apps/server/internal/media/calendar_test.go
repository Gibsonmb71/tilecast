package media

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestParseCalendarExpandsRecurrenceAcrossDST(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	ics := `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:daily-briefing
DTSTART;TZID=America/New_York:20260307T090000
DTEND;TZID=America/New_York:20260307T100000
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Morning <b>briefing</b>
LOCATION:Main Hall
DESCRIPTION:Line one\nLine two
END:VEVENT
END:VCALENDAR`
	events, err := ParseCalendar([]byte(strings.ReplaceAll(ics, "\n", "\r\n")), "District", loc, time.Date(2026, 3, 6, 0, 0, 0, 0, loc), time.Date(2026, 3, 11, 0, 0, 0, 0, loc))
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 {
		t.Fatalf("events=%#v", events)
	}
	if events[0].Start.Hour() != 14 || events[1].Start.Hour() != 13 {
		t.Fatalf("DST was not preserved: %s %s", events[0].Start, events[1].Start)
	}
	if events[0].Title != "Morning briefing" || events[0].DescriptionExcerpt != "Line one Line two" {
		t.Fatalf("text was not sanitized: %#v", events[0])
	}
}

func TestParseCalendarSupportsAllDayEvents(t *testing.T) {
	ics := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:holiday\r\nDTSTART;VALUE=DATE:20261225\r\nDTEND;VALUE=DATE:20261226\r\nSUMMARY:Holiday\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
	events, err := ParseCalendar([]byte(ics), "Closures", time.UTC, time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC), time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil || len(events) != 1 || !events[0].AllDay || events[0].End.Sub(events[0].Start) != 24*time.Hour {
		t.Fatalf("events=%#v err=%v", events, err)
	}
}

func TestCalendarURLBlocksPrivateNetworksByDefault(t *testing.T) {
	service := &Service{cfg: Config{SourceFetch: SourceFetchPolicy{Timeout: time.Second}}}
	if _, err := service.validateSourceURL(context.Background(), "http://127.0.0.1/calendar.ics"); err == nil || !strings.Contains(err.Error(), "public Source URLs") {
		t.Fatalf("private HTTP URL was accepted: %v", err)
	}
	if _, err := service.validateSourceURL(context.Background(), "https://127.0.0.1/calendar.ics"); err == nil || !strings.Contains(err.Error(), "private network") {
		t.Fatalf("private HTTPS URL was accepted: %v", err)
	}
}

func TestCalendarURLAllowsPrivateNetworkOnlyWhenConfigured(t *testing.T) {
	service := &Service{cfg: Config{SourceFetch: SourceFetchPolicy{AllowPrivateNetworks: true, Timeout: time.Second}}}
	if _, err := service.validateSourceURL(context.Background(), "http://127.0.0.1/calendar.ics"); err != nil {
		t.Fatalf("configured private URL was rejected: %v", err)
	}
}
