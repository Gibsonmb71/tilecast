package media

import (
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const structuredMaxItems = 200

type structuredSourceProvider struct {
	service  *Service
	provider string
}

func (p structuredSourceProvider) Normalize(ctx context.Context, raw json.RawMessage) (any, error) {
	var c StructuredSourceConfig
	if err := decodeSourceConfig(raw, &c); err != nil {
		return nil, err
	}
	if p.provider != "csv" || c.UploadedContent == "" {
		c.URL = strings.TrimSpace(c.URL)
		if _, err := p.service.validateSourceURL(ctx, c.URL); err != nil {
			return nil, err
		}
	} else {
		if len(c.UploadedContent) > int(p.service.cfg.SourceFetch.MaximumBytes) {
			return nil, errors.New("uploaded CSV exceeds the configured source size limit")
		}
		if !utf8.ValidString(c.UploadedContent) {
			return nil, errors.New("uploaded CSV must use UTF-8 encoding")
		}
		c.URL = ""
		c.Uploaded = true
	}
	if c.Presentation == "" {
		c.Presentation = "list"
	}
	if c.Presentation != "list" && c.Presentation != "agenda" && c.Presentation != "cards" && c.Presentation != "ticker" {
		return nil, errors.New("source presentation is invalid")
	}
	if c.MaxItems == 0 {
		c.MaxItems = 20
	}
	if c.MaxItems < 1 || c.MaxItems > structuredMaxItems {
		return nil, fmt.Errorf("source maximum item count must be between 1 and %d", structuredMaxItems)
	}
	if !c.Fields.Title && !c.Fields.Subtitle && !c.Fields.Date && !c.Fields.Author && !c.Fields.Description && !c.Fields.Image && !c.Fields.Link {
		c.Fields = StructuredFields{Title: true, Subtitle: true, Date: true}
	}
	c.FilterKeyword = sanitizeCalendarText(c.FilterKeyword, 120)
	if c.Sort == "" {
		c.Sort = "newest"
	}
	if c.Sort != "newest" && c.Sort != "oldest" && c.Sort != "title" && c.Sort != "source" {
		return nil, errors.New("source sort is invalid")
	}
	minimum := int(p.service.cfg.SourceFetch.MinimumRefresh / time.Second)
	maximum := int(p.service.cfg.SourceFetch.MaximumRefresh / time.Second)
	if c.RefreshIntervalSeconds == 0 {
		c.RefreshIntervalSeconds = 900
	}
	if c.RefreshIntervalSeconds < minimum || c.RefreshIntervalSeconds > maximum {
		return nil, fmt.Errorf("source refresh interval must be between %d and %d seconds", minimum, maximum)
	}
	if c.StalenessLimitHours == 0 {
		c.StalenessLimitHours = 168
	}
	if c.StalenessLimitHours < 1 || c.StalenessLimitHours > 2160 {
		return nil, errors.New("source staleness limit must be between 1 and 2160 hours")
	}
	c.EmptyState = sanitizeCalendarText(c.EmptyState, 240)
	if c.EmptyState == "" {
		c.EmptyState = "No items available"
	}
	if p.provider == "json" || p.provider == "csv" {
		if c.Mapping == nil {
			return nil, errors.New("source field mapping is required")
		}
		if err := validateStructuredMapping(*c.Mapping, p.provider); err != nil {
			return nil, err
		}
	}
	if p.provider == "csv" && c.Delimiter != "" && c.Delimiter != "," && c.Delimiter != ";" && c.Delimiter != "\t" && c.Delimiter != "|" {
		return nil, errors.New("CSV delimiter must be comma, semicolon, tab, or pipe")
	}
	if len(c.Filters) > 8 {
		return nil, errors.New("source filters are limited to eight")
	}
	for i := range c.Filters {
		c.Filters[i].Field = sanitizeCalendarText(c.Filters[i].Field, 120)
		c.Filters[i].Value = sanitizeCalendarText(c.Filters[i].Value, 240)
		if c.Filters[i].Field == "" || (c.Filters[i].Operator != "equals" && c.Filters[i].Operator != "contains") {
			return nil, errors.New("source filter is invalid")
		}
	}
	return c, nil
}

func validateStructuredMapping(m StructuredMapping, provider string) error {
	paths := []string{m.RootList, m.Title, m.Subtitle, m.Date, m.ImageURL, m.Link}
	for _, v := range m.ValueFields {
		paths = append(paths, v)
	}
	for _, path := range paths {
		if path == "" {
			continue
		}
		if provider == "json" && !strings.HasPrefix(path, "/") && path != "" {
			return errors.New("JSON mappings must use JSON Pointer paths")
		}
		if len(path) > 240 {
			return errors.New("source mapping path is too long")
		}
	}
	if m.Title == "" {
		return errors.New("source title mapping is required")
	}
	if len(m.ValueFields) > 12 {
		return errors.New("source value fields are limited to twelve")
	}
	return nil
}

func (s *Service) fetchStructured(ctx context.Context, provider string, c StructuredSourceConfig) ([]byte, string, error) {
	if provider == "csv" && c.UploadedContent != "" {
		return []byte(c.UploadedContent), "uploaded", nil
	}
	u, err := s.validateSourceURL(ctx, c.URL)
	if err != nil {
		return nil, "blocked", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "invalid_request", err
	}
	accept := map[string]string{"rss": "application/rss+xml, application/xml;q=0.9", "atom": "application/atom+xml, application/xml;q=0.9", "json": "application/json", "csv": "text/csv, text/plain;q=0.8"}[provider]
	request.Header.Set("Accept", accept)
	request.Header.Set("User-Agent", "Tilecast-Source-Refresh/1")
	response, err := s.sourceHTTPClient().Do(request)
	if err != nil {
		return nil, "network_error", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Sprintf("http_%d", response.StatusCode), errors.New("source server returned an unsuccessful status")
	}
	contentType := strings.ToLower(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	allowed := map[string]map[string]bool{"rss": {"application/rss+xml": true, "application/xml": true, "text/xml": true}, "atom": {"application/atom+xml": true, "application/xml": true, "text/xml": true}, "json": {"application/json": true, "text/json": true}, "csv": {"text/csv": true, "application/csv": true, "text/plain": true, "application/octet-stream": true}}[provider]
	if !allowed[contentType] {
		return nil, "unsupported_content_type", errors.New("source response content type is not supported")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, s.cfg.SourceFetch.MaximumBytes+1))
	if err != nil {
		return nil, "read_error", err
	}
	if int64(len(body)) > s.cfg.SourceFetch.MaximumBytes {
		return nil, "response_too_large", errors.New("source response exceeds the configured size limit")
	}
	return body, "success", nil
}

type feedDocument struct {
	Channel struct {
		Items []feedItem `xml:"item"`
	} `xml:"channel"`
	Entries []feedItem `xml:"entry"`
}
type feedItem struct {
	Title string `xml:"title"`
	Links []struct {
		Href string `xml:"href,attr"`
		Rel  string `xml:"rel,attr"`
		Text string `xml:",chardata"`
	} `xml:"link"`
	Description string `xml:"description"`
	Summary     string `xml:"summary"`
	Content     string `xml:"content"`
	Author      struct {
		Name string `xml:"name"`
		Text string `xml:",chardata"`
	} `xml:"author"`
	PubDate   string `xml:"pubDate"`
	Published string `xml:"published"`
	Updated   string `xml:"updated"`
	GUID      string `xml:"guid"`
	ID        string `xml:"id"`
	Enclosure struct {
		URL  string `xml:"url,attr"`
		Type string `xml:"type,attr"`
	} `xml:"enclosure"`
}

func parseFeed(body []byte, c StructuredSourceConfig) ([]StructuredRecord, error) {
	var d feedDocument
	if err := xml.Unmarshal(body, &d); err != nil {
		return nil, err
	}
	items := d.Channel.Items
	if len(items) == 0 {
		items = d.Entries
	}
	records := make([]StructuredRecord, 0, len(items))
	for _, item := range items {
		description := item.Description
		if description == "" {
			description = item.Summary
		}
		if description == "" {
			description = item.Content
		}
		link := ""
		for _, candidate := range item.Links {
			if link == "" && strings.TrimSpace(candidate.Text) != "" {
				link = strings.TrimSpace(candidate.Text)
			}
			if link == "" && (candidate.Rel == "" || candidate.Rel == "alternate") {
				link = candidate.Href
			}
		}
		image := ""
		if strings.HasPrefix(strings.ToLower(item.Enclosure.Type), "image/") {
			image = item.Enclosure.URL
		}
		date := firstNonempty(item.PubDate, item.Published, item.Updated)
		id := firstNonempty(item.GUID, item.ID, link, item.Title+date)
		records = append(records, StructuredRecord{ID: stableRecordID(id), Title: sanitizeCalendarText(item.Title, 240), Date: normalizeRecordDate(date), Author: sanitizeCalendarText(firstNonempty(item.Author.Name, item.Author.Text), 160), Description: sanitizeCalendarText(description, 500), ImageURL: safeRemoteRecordURL(image), Link: safeRemoteRecordURL(link)})
	}
	return applyStructuredOptions(records, c), nil
}

func parseJSONRecords(body []byte, c StructuredSourceConfig) ([]StructuredRecord, error) {
	var document any
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.UseNumber()
	if err := decoder.Decode(&document); err != nil {
		return nil, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, errors.New("JSON response must contain one document")
	}
	root, err := jsonPointer(document, c.Mapping.RootList)
	if err != nil {
		return nil, err
	}
	list, ok := root.([]any)
	if !ok {
		return nil, errors.New("JSON root list path does not select an array")
	}
	records := make([]StructuredRecord, 0, min(len(list), structuredMaxItems))
	for index, item := range list {
		value := func(path string) string {
			if path == "" {
				return ""
			}
			v, _ := jsonPointer(item, path)
			return scalarText(v)
		}
		values := map[string]string{}
		for name, path := range c.Mapping.ValueFields {
			values[sanitizeCalendarText(name, 80)] = sanitizeCalendarText(value(path), 240)
		}
		title := sanitizeCalendarText(value(c.Mapping.Title), 240)
		records = append(records, StructuredRecord{ID: stableRecordID(fmt.Sprintf("%d:%s", index, title)), Title: title, Subtitle: sanitizeCalendarText(value(c.Mapping.Subtitle), 240), Date: normalizeRecordDate(value(c.Mapping.Date)), ImageURL: safeRemoteRecordURL(value(c.Mapping.ImageURL)), Link: safeRemoteRecordURL(value(c.Mapping.Link)), Values: values})
	}
	return applyStructuredOptions(records, c), nil
}

func jsonPointer(document any, pointer string) (any, error) {
	if pointer == "" {
		return document, nil
	}
	if !strings.HasPrefix(pointer, "/") {
		return nil, errors.New("invalid JSON Pointer")
	}
	current := document
	for _, token := range strings.Split(pointer[1:], "/") {
		token = strings.ReplaceAll(strings.ReplaceAll(token, "~1", "/"), "~0", "~")
		switch value := current.(type) {
		case map[string]any:
			var ok bool
			current, ok = value[token]
			if !ok {
				return nil, fmt.Errorf("JSON Pointer field %q was not found", token)
			}
		case []any:
			var index int
			if _, err := fmt.Sscanf(token, "%d", &index); err != nil || index < 0 || index >= len(value) {
				return nil, errors.New("JSON Pointer array index is invalid")
			}
			current = value[index]
		default:
			return nil, errors.New("JSON Pointer traverses a scalar value")
		}
	}
	return current, nil
}

func parseCSVRecords(body []byte, c StructuredSourceConfig) ([]StructuredRecord, error) {
	if !utf8.Valid(body) {
		return nil, errors.New("CSV must use UTF-8 encoding")
	}
	reader := csv.NewReader(strings.NewReader(string(body)))
	reader.FieldsPerRecord = -1
	if c.Delimiter != "" {
		reader.Comma = []rune(c.Delimiter)[0]
	} else {
		reader.Comma = detectDelimiter(string(body))
	}
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) < 1 {
		return []StructuredRecord{}, nil
	}
	headers := rows[0]
	lookup := map[string]int{}
	for i, h := range headers {
		lookup[strings.TrimSpace(h)] = i
	}
	field := func(row []string, name string) (string, error) {
		index, ok := lookup[name]
		if !ok {
			return "", fmt.Errorf("CSV header %q was not found", name)
		}
		if index >= len(row) {
			return "", errors.New("CSV contains a malformed row")
		}
		return row[index], nil
	}
	records := []StructuredRecord{}
	for index, row := range rows[1:] {
		if len(row) != len(headers) {
			return nil, fmt.Errorf("CSV row %d has %d columns; expected %d", index+2, len(row), len(headers))
		}
		value := func(name string) string { v, _ := field(row, name); return v }
		values := map[string]string{}
		for name, column := range c.Mapping.ValueFields {
			values[sanitizeCalendarText(name, 80)] = sanitizeCalendarText(value(column), 240)
		}
		title, err := field(row, c.Mapping.Title)
		if err != nil {
			return nil, err
		}
		records = append(records, StructuredRecord{ID: stableRecordID(fmt.Sprintf("%d:%s", index, title)), Title: sanitizeCalendarText(title, 240), Subtitle: sanitizeCalendarText(value(c.Mapping.Subtitle), 240), Date: normalizeRecordDate(value(c.Mapping.Date)), ImageURL: safeRemoteRecordURL(value(c.Mapping.ImageURL)), Link: safeRemoteRecordURL(value(c.Mapping.Link)), Values: values})
	}
	return applyStructuredOptions(records, c), nil
}

func detectDelimiter(value string) rune {
	first := strings.SplitN(value, "\n", 2)[0]
	best := rune(',')
	count := -1
	for _, candidate := range []rune{',', ';', '\t', '|'} {
		n := strings.Count(first, string(candidate))
		if n > count {
			best = candidate
			count = n
		}
	}
	return best
}
func applyStructuredOptions(records []StructuredRecord, c StructuredSourceConfig) []StructuredRecord {
	keyword := strings.ToLower(c.FilterKeyword)
	result := records[:0]
	for _, record := range records {
		text := record.Title + " " + record.Subtitle + " " + record.Description + " " + strings.Join(mapValues(record.Values), " ")
		if keyword != "" && !strings.Contains(strings.ToLower(text), keyword) {
			continue
		}
		matched := true
		for _, filter := range c.Filters {
			candidate := recordValue(record, filter.Field)
			if filter.Operator == "equals" {
				matched = matched && strings.EqualFold(candidate, filter.Value)
			} else {
				matched = matched && strings.Contains(strings.ToLower(candidate), strings.ToLower(filter.Value))
			}
		}
		if matched {
			result = append(result, record)
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		switch c.Sort {
		case "title":
			return strings.ToLower(result[i].Title) < strings.ToLower(result[j].Title)
		case "oldest":
			return result[i].Date < result[j].Date
		case "source":
			return false
		default:
			return result[i].Date > result[j].Date
		}
	})
	if len(result) > c.MaxItems {
		result = result[:c.MaxItems]
	}
	return result
}
func mapValues(values map[string]string) []string {
	result := make([]string, 0, len(values))
	for _, v := range values {
		result = append(result, v)
	}
	return result
}
func recordValue(r StructuredRecord, field string) string {
	switch strings.ToLower(field) {
	case "title":
		return r.Title
	case "subtitle":
		return r.Subtitle
	case "date":
		return r.Date
	case "author":
		return r.Author
	case "description":
		return r.Description
	case "link":
		return r.Link
	default:
		return r.Values[field]
	}
}
func stableRecordID(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:12])
}
func safeRemoteRecordURL(value string) string {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
		return ""
	}
	return u.String()
}
func scalarText(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case json.Number:
		return v.String()
	case float64:
		return fmt.Sprint(v)
	case bool:
		return fmt.Sprint(v)
	default:
		return ""
	}
}
func normalizeRecordDate(value string) string {
	value = strings.TrimSpace(value)
	for _, layout := range []string{time.RFC3339, time.RFC1123Z, time.RFC1123, time.RFC822Z, time.RFC822, "2006-01-02"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC().Format(time.RFC3339)
		}
	}
	return sanitizeCalendarText(value, 80)
}
func firstNonempty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (s *Service) refreshStructured(ctx context.Context, assetID uuid.UUID, provider string, c StructuredSourceConfig) (StructuredPreparedData, SourceRefreshDiagnostics, error) {
	body, category, err := s.fetchStructured(ctx, provider, c)
	diagnostics := SourceRefreshDiagnostics{AssetID: assetID, HTTPResultCategory: &category, ParseStatus: "failed"}
	if err != nil {
		return StructuredPreparedData{}, diagnostics, err
	}
	var records []StructuredRecord
	switch provider {
	case "rss", "atom":
		records, err = parseFeed(body, c)
	case "json":
		records, err = parseJSONRecords(body, c)
	case "csv":
		records, err = parseCSVRecords(body, c)
	}
	if err != nil {
		return StructuredPreparedData{}, diagnostics, fmt.Errorf("source parse failed: %w", err)
	}
	now := time.Now().UTC()
	prepared := StructuredPreparedData{Records: records, CachedAt: now, StaleAt: now.Add(time.Duration(c.StalenessLimitHours) * time.Hour)}
	diagnostics.ParseStatus = "success"
	diagnostics.AvailableItemCount = len(records)
	diagnostics.CacheUpdatedAt = &prepared.CachedAt
	diagnostics.CacheExpiresAt = &prepared.StaleAt
	return prepared, diagnostics, nil
}

func (s *Service) StructuredPreview(ctx context.Context, provider string, raw json.RawMessage) (StructuredPreview, error) {
	normalized, err := (structuredSourceProvider{s, provider}).Normalize(ctx, raw)
	if err != nil {
		return StructuredPreview{}, err
	}
	c := normalized.(StructuredSourceConfig)
	prepared, diagnostics, err := s.refreshStructured(ctx, uuid.Nil, provider, c)
	if err != nil {
		return StructuredPreview{}, err
	}
	return StructuredPreview{Configuration: StructuredPlayerConfig{Presentation: c.Presentation, Fields: c.Fields, EmptyState: c.EmptyState, Data: prepared}, Diagnostics: diagnostics}, nil
}
