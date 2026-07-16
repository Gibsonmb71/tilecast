package media

// The provider registry is a closed, code-only catalogue. Each provider declares a role
// (widget or data_source) and its capabilities. Unknown providers, arbitrary configuration
// keys, scripts, HTML templates, and executable expressions are rejected by the normalizers.

type ProviderRole string

const (
	RoleWidget     ProviderRole = "widget"
	RoleDataSource ProviderRole = "data_source"
)

// ProviderDescriptor captures the fixed capabilities of one provider.
type ProviderDescriptor struct {
	ID                          string
	Role                        ProviderRole
	Renderable                  bool
	RequiresDataSource          bool
	ProducesFields              bool
	SupportsDateSelection       bool
	RecordBased                 bool
	Temporal                    bool
	Numeric                     bool
	Weather                     bool
	AcceptedDataSourceProviders []string
}

var dataSourceProviderRegistry = map[string]ProviderDescriptor{
	// Data Sources — provide data, never rendered directly.
	"calendar": {ID: "calendar", Role: RoleDataSource, ProducesFields: true, RecordBased: true, Temporal: true},
	"rss":      {ID: "rss", Role: RoleDataSource, ProducesFields: true, SupportsDateSelection: true, RecordBased: true},
	"atom":     {ID: "atom", Role: RoleDataSource, ProducesFields: true, SupportsDateSelection: true, RecordBased: true},
	"json":     {ID: "json", Role: RoleDataSource, ProducesFields: true, SupportsDateSelection: true, RecordBased: true, Temporal: true, Numeric: true},
	"csv":      {ID: "csv", Role: RoleDataSource, ProducesFields: true, SupportsDateSelection: true, RecordBased: true, Temporal: true, Numeric: true},
	"manual":   {ID: "manual", Role: RoleDataSource, ProducesFields: true, SupportsDateSelection: true, RecordBased: true, Temporal: true, Numeric: true},
	"weather":  {ID: "weather", Role: RoleDataSource, ProducesFields: true, RecordBased: true, Temporal: true, Numeric: true, Weather: true},
}

var widgetProviderRegistry = map[string]ProviderDescriptor{
	// Standalone Widgets — display content without a Data Source.
	"website":   {ID: "website", Role: RoleWidget, Renderable: true},
	"youtube":   {ID: "youtube", Role: RoleWidget, Renderable: true},
	"clock":     {ID: "clock", Role: RoleWidget, Renderable: true},
	"date":      {ID: "date", Role: RoleWidget, Renderable: true},
	"qrcode":    {ID: "qrcode", Role: RoleWidget, Renderable: true},
	"countdown": {ID: "countdown", Role: RoleWidget, Renderable: true, Temporal: true},

	// Data-driven Widgets — display one compatible Data Source.
	"ticker":  {ID: "ticker", Role: RoleWidget, Renderable: true, RequiresDataSource: true, RecordBased: true},
	"menu":    {ID: "menu", Role: RoleWidget, Renderable: true, RequiresDataSource: true, RecordBased: true},
	"list":    {ID: "list", Role: RoleWidget, Renderable: true, RequiresDataSource: true, RecordBased: true},
	"table":   {ID: "table", Role: RoleWidget, Renderable: true, RequiresDataSource: true, RecordBased: true},
	"agenda":  {ID: "agenda", Role: RoleWidget, Renderable: true, RequiresDataSource: true, RecordBased: true, Temporal: true},
	"metric":  {ID: "metric", Role: RoleWidget, Renderable: true, RequiresDataSource: true, RecordBased: true, Numeric: true},
	"cards":   {ID: "cards", Role: RoleWidget, Renderable: true, RequiresDataSource: true, RecordBased: true},
	"weather": {ID: "weather", Role: RoleWidget, Renderable: true, RequiresDataSource: true, RecordBased: true, Weather: true},
}

func lookupProvider(id string) (ProviderDescriptor, bool) {
	if descriptor, ok := widgetProviderRegistry[id]; ok {
		return descriptor, true
	}
	descriptor, ok := dataSourceProviderRegistry[id]
	return descriptor, ok
}

func isWidgetProvider(id string) bool {
	_, ok := widgetProviderRegistry[id]
	return ok
}

func isDataSourceProvider(id string) bool {
	_, ok := dataSourceProviderRegistry[id]
	return ok
}

// dataSourceProviderAccepted reports whether a data-driven widget accepts a given
// Data Source provider.
func dataSourceProviderAccepted(widgetProvider, dataSourceProvider string) bool {
	widget, ok := widgetProviderRegistry[widgetProvider]
	if !ok {
		return false
	}
	source, ok := dataSourceProviderRegistry[dataSourceProvider]
	if !ok {
		return false
	}
	for _, p := range widget.AcceptedDataSourceProviders {
		if p == dataSourceProvider {
			return true
		}
	}
	if len(widget.AcceptedDataSourceProviders) > 0 {
		return false
	}
	if widget.Weather {
		return source.Weather
	}
	if widget.Numeric {
		return source.RecordBased && source.Numeric
	}
	if widget.Temporal {
		return source.RecordBased && source.Temporal
	}
	return widget.RecordBased && source.RecordBased
}
