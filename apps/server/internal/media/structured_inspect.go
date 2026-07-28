package media

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Structured Source inspection answers the question an author actually has in front of a
// CSV, JSON, or feed connection: what fields does this data contain, what do they look
// like, and which of them should each display slot use? Studio previously required the
// author to know the column names and type them from memory.
//
// Inspection deliberately does not run the full configuration normalizer: a mapping cannot
// be filled in before the fields behind it are known, so requiring a valid mapping first
// would make the whole feature unreachable.

const (
	// Samples are for recognizing a field, not for previewing the data, so a few short
	// values per field are enough.
	inspectSampleLimit = 3
	inspectSampleChars = 80
	// A wide spreadsheet stays usable in a picker; beyond this the response is truncated.
	inspectFieldLimit = 80
	// Rows read for sampling. The whole body is already bounded by the fetch policy.
	inspectSampleRows = 20
)

// StructuredField is one mappable field discovered in the connected data.
type StructuredField struct {
	// Key is the value an author maps: a CSV header name or a JSON Pointer.
	Key     string   `json:"key"`
	Label   string   `json:"label"`
	Samples []string `json:"samples"`
}

// StructuredInspection reports the shape of the connected data before a mapping exists.
type StructuredInspection struct {
	Provider string            `json:"provider"`
	Fields   []StructuredField `json:"fields"`
	RowCount int               `json:"rowCount"`
	// Delimiter is the delimiter the parser detected for CSV, reported so Studio can show
	// what will be used rather than leaving "Detect" unexplained.
	Delimiter string `json:"delimiter,omitempty"`
	// Suggested is a starting mapping derived from field names. It is a suggestion only;
	// the author remains the authority.
	Suggested StructuredMapping `json:"suggested"`
	// Available reports which record fields this Source can actually fill, so Studio never
	// offers a display toggle for a field the provider cannot produce.
	Available StructuredFields `json:"available"`
}

// mappingCandidates lists the field names each display slot recognizes, most specific
// first. Matching is case-insensitive and ignores spaces, underscores, and hyphens.
var mappingCandidates = map[string][]string{
	"title":    {"title", "name", "item", "event", "subject", "headline", "label", "summary"},
	"subtitle": {"subtitle", "detail", "details", "description", "room", "location", "category", "note"},
	"date":     {"date", "startdate", "start", "starttime", "datetime", "when", "day", "published", "publishedat"},
	"imageUrl": {"image", "imageurl", "imagelink", "photo", "picture", "thumbnail"},
	"link":     {"link", "url", "website", "href", "moreinfo", "page"},
}

func normalizeFieldName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.NewReplacer(" ", "", "_", "", "-", "", ".", "").Replace(value)
}

// suggestMapping assigns each display slot the best-matching field name, never assigning
// one field to two slots.
func suggestMapping(names []string) StructuredMapping {
	normalized := make([]string, len(names))
	for i, name := range names {
		normalized[i] = normalizeFieldName(name)
	}
	used := map[int]bool{}
	// Exact header names win outright; a compound header such as "Event Name" or
	// "Start Date" is matched on the second pass so a plainly named column is never lost
	// to a longer one.
	pick := func(slot string, exact bool) string {
		for _, candidate := range mappingCandidates[slot] {
			for i, name := range normalized {
				if used[i] {
					continue
				}
				if name != candidate && (exact || !strings.Contains(name, candidate)) {
					continue
				}
				used[i] = true
				return names[i]
			}
		}
		return ""
	}
	slots := []string{"title", "subtitle", "date", "imageUrl", "link"}
	chosen := map[string]string{}
	for _, exact := range []bool{true, false} {
		for _, slot := range slots {
			if chosen[slot] == "" {
				chosen[slot] = pick(slot, exact)
			}
		}
	}
	// A Source must map at least one display field to be savable. When no name matched,
	// the first field is a better starting point than an empty form the author can only
	// fix after a failed save.
	if chosen["title"] == "" && len(names) > 0 {
		for i, name := range names {
			if used[i] {
				continue
			}
			chosen["title"] = name
			break
		}
	}
	return StructuredMapping{
		Title:    chosen["title"],
		Subtitle: chosen["subtitle"],
		Date:     chosen["date"],
		ImageURL: chosen["imageUrl"],
		Link:     chosen["link"],
	}
}

func inspectSample(value string) string {
	return sanitizeCalendarText(value, inspectSampleChars)
}

func appendSample(field *StructuredField, value string) {
	value = inspectSample(value)
	if value == "" || len(field.Samples) >= inspectSampleLimit {
		return
	}
	for _, existing := range field.Samples {
		if existing == value {
			return
		}
	}
	field.Samples = append(field.Samples, value)
}

// InspectStructured fetches the configured Source and reports its fields. The caller has
// already been authorized; the fetch itself uses the same guarded policy as a refresh.
func (s *Service) InspectStructured(ctx context.Context, provider string, raw json.RawMessage) (StructuredInspection, error) {
	var c StructuredSourceConfig
	if err := decodeConfig(raw, &c); err != nil {
		return StructuredInspection{}, err
	}
	c.URL = strings.TrimSpace(c.URL)
	if provider == "csv" && c.UploadedContent != "" {
		if len(c.UploadedContent) > int(s.cfg.SourceFetch.MaximumBytes) {
			return StructuredInspection{}, errors.New("uploaded CSV exceeds the configured source size limit")
		}
		if !utf8.ValidString(c.UploadedContent) {
			return StructuredInspection{}, errors.New("uploaded CSV must use UTF-8 encoding")
		}
	} else if _, err := s.validateSourceURL(ctx, c.URL); err != nil {
		return StructuredInspection{}, err
	}
	body, _, err := s.fetchStructured(ctx, provider, c)
	if err != nil {
		return StructuredInspection{}, err
	}
	switch provider {
	case "csv":
		return inspectCSV(body, c)
	case "json":
		return inspectJSON(body)
	case "rss", "atom":
		return inspectFeed(provider, body)
	}
	return StructuredInspection{}, errors.New("this Data Source provider does not support field detection")
}

// InspectStructuredByID inspects an already-saved Source using its stored configuration.
// A saved CSV upload keeps its bytes on the Server and they are stripped from detail
// responses, so an editor reopening that Source has nothing to send back; without this,
// detection would silently stop working the moment a Source was saved.
func (s *Service) InspectStructuredByID(ctx context.Context, id uuid.UUID) (StructuredInspection, error) {
	raw, err := s.rawDataSource(ctx, id)
	if err != nil {
		return StructuredInspection{}, err
	}
	switch raw.Provider {
	case "rss", "atom", "json", "csv":
		return s.InspectStructured(ctx, raw.Provider, raw.Configuration)
	}
	return StructuredInspection{}, errors.New("this Data Source provider does not support field detection")
}

func inspectCSV(body []byte, c StructuredSourceConfig) (StructuredInspection, error) {
	if !utf8.Valid(body) {
		return StructuredInspection{}, errors.New("CSV must use UTF-8 encoding")
	}
	delimiter := detectDelimiter(string(body))
	if c.Delimiter != "" {
		delimiter = []rune(c.Delimiter)[0]
	}
	reader := csv.NewReader(strings.NewReader(string(body)))
	reader.FieldsPerRecord = -1
	reader.Comma = delimiter
	rows, err := reader.ReadAll()
	if err != nil {
		return StructuredInspection{}, err
	}
	if len(rows) == 0 {
		return StructuredInspection{}, errors.New("CSV contains no rows")
	}
	headers := rows[0]
	inspection := StructuredInspection{
		Provider:  "csv",
		RowCount:  len(rows) - 1,
		Delimiter: string(delimiter),
		Available: StructuredFields{Title: true, Subtitle: true, Date: true, Image: true, Link: true},
	}
	names := []string{}
	for index, header := range headers {
		name := strings.TrimSpace(header)
		if name == "" || len(inspection.Fields) >= inspectFieldLimit {
			continue
		}
		field := StructuredField{Key: name, Label: name}
		for _, row := range rows[1:] {
			if len(row) > index {
				appendSample(&field, row[index])
			}
			if len(field.Samples) >= inspectSampleLimit {
				break
			}
		}
		inspection.Fields = append(inspection.Fields, field)
		names = append(names, name)
	}
	if len(inspection.Fields) == 0 {
		return StructuredInspection{}, errors.New("CSV header row contains no column names")
	}
	inspection.Suggested = suggestMapping(names)
	return inspection, nil
}

func inspectJSON(body []byte) (StructuredInspection, error) {
	var document any
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.UseNumber()
	if err := decoder.Decode(&document); err != nil {
		return StructuredInspection{}, err
	}
	root, list, ok := findRecordList(document, "")
	if !ok {
		return StructuredInspection{}, errors.New("JSON response contains no array of records")
	}
	inspection := StructuredInspection{
		Provider:  "json",
		RowCount:  len(list),
		Available: StructuredFields{Title: true, Subtitle: true, Date: true, Image: true, Link: true},
	}
	inspection.Suggested.RootList = root
	byKey := map[string]*StructuredField{}
	order := []string{}
	for index, item := range list {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if index >= inspectSampleRows {
			break
		}
		keys := make([]string, 0, len(object))
		for key := range object {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if _, scalar := object[key].(map[string]any); scalar {
				continue
			}
			if _, scalar := object[key].([]any); scalar {
				continue
			}
			pointer := "/" + strings.ReplaceAll(strings.ReplaceAll(key, "~", "~0"), "/", "~1")
			field, seen := byKey[pointer]
			if !seen {
				if len(order) >= inspectFieldLimit {
					continue
				}
				field = &StructuredField{Key: pointer, Label: key}
				byKey[pointer] = field
				order = append(order, pointer)
			}
			appendSample(field, scalarText(object[key]))
		}
	}
	if len(order) == 0 {
		return StructuredInspection{}, errors.New("JSON records contain no scalar fields")
	}
	names := []string{}
	for _, pointer := range order {
		inspection.Fields = append(inspection.Fields, *byKey[pointer])
		names = append(names, byKey[pointer].Label)
	}
	suggested := suggestMapping(names)
	// Suggestions are matched on the readable key and returned as JSON Pointers, which is
	// what the mapping stores.
	toPointer := func(label string) string {
		if label == "" {
			return ""
		}
		for _, pointer := range order {
			if byKey[pointer].Label == label {
				return pointer
			}
		}
		return ""
	}
	inspection.Suggested.Title = toPointer(suggested.Title)
	inspection.Suggested.Subtitle = toPointer(suggested.Subtitle)
	inspection.Suggested.Date = toPointer(suggested.Date)
	inspection.Suggested.ImageURL = toPointer(suggested.ImageURL)
	inspection.Suggested.Link = toPointer(suggested.Link)
	return inspection, nil
}

// findRecordList locates the first array of objects in a bounded walk of the document and
// returns the JSON Pointer that selects it. A top-level array uses the empty pointer,
// which is what the JSON parser already treats as "the whole document".
func findRecordList(document any, pointer string) (string, []any, bool) {
	switch value := document.(type) {
	case []any:
		for _, item := range value {
			if _, ok := item.(map[string]any); ok {
				return pointer, value, true
			}
		}
		if len(value) == 0 {
			return pointer, value, true
		}
	case map[string]any:
		rest := make([]string, 0, len(value))
		for key := range value {
			rest = append(rest, key)
		}
		sort.Strings(rest)
		// A conventional envelope key wins over alphabetical order.
		keys := []string{}
		for _, preferred := range []string{"items", "data", "records", "results", "entries", "rows"} {
			if _, ok := value[preferred]; ok {
				keys = append(keys, preferred)
			}
		}
		keys = append(keys, rest...)
		for _, key := range keys {
			child := "/" + strings.ReplaceAll(strings.ReplaceAll(key, "~", "~0"), "/", "~1")
			if found, list, ok := findRecordList(value[key], pointer+child); ok {
				return found, list, ok
			}
		}
	}
	return "", nil, false
}

// inspectFeed reports which normalized record fields a feed actually carries. Feed fields
// are fixed, so there is nothing to map; the value of inspection here is that Studio can
// stop offering an Author toggle to a feed that publishes no authors.
func inspectFeed(provider string, body []byte) (StructuredInspection, error) {
	records, err := parseFeed(body, StructuredSourceConfig{MaxItems: structuredMaxItems, Sort: "source"})
	if err != nil {
		return StructuredInspection{}, err
	}
	inspection := StructuredInspection{Provider: provider, RowCount: len(records)}
	fields := map[string]*StructuredField{}
	order := []string{"title", "date", "author", "description", "image", "link"}
	labels := map[string]string{
		"title": "Title", "date": "Date", "author": "Author",
		"description": "Description", "image": "Image", "link": "Link",
	}
	for _, key := range order {
		fields[key] = &StructuredField{Key: key, Label: labels[key]}
	}
	for _, record := range records {
		appendSample(fields["title"], record.Title)
		appendSample(fields["date"], record.Date)
		appendSample(fields["author"], record.Author)
		appendSample(fields["description"], record.Description)
		appendSample(fields["image"], record.ImageURL)
		appendSample(fields["link"], record.Link)
	}
	for _, key := range order {
		if len(fields[key].Samples) == 0 {
			continue
		}
		inspection.Fields = append(inspection.Fields, *fields[key])
	}
	inspection.Available = StructuredFields{
		Title:       len(fields["title"].Samples) > 0,
		Date:        len(fields["date"].Samples) > 0,
		Author:      len(fields["author"].Samples) > 0,
		Description: len(fields["description"].Samples) > 0,
		Image:       len(fields["image"].Samples) > 0,
		Link:        len(fields["link"].Samples) > 0,
	}
	// Feeds have no subtitle of their own; the Widget uses the description excerpt.
	inspection.Available.Subtitle = false
	return inspection, nil
}
