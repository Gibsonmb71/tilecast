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
	AcceptedDataSourceProviders []string
}

var providerRegistry = map[string]ProviderDescriptor{
	// Data Sources — provide data, never rendered directly.
	"calendar": {ID: "calendar", Role: RoleDataSource, ProducesFields: true},
	"rss":      {ID: "rss", Role: RoleDataSource, ProducesFields: true, SupportsDateSelection: true},
	"atom":     {ID: "atom", Role: RoleDataSource, ProducesFields: true, SupportsDateSelection: true},
	"json":     {ID: "json", Role: RoleDataSource, ProducesFields: true, SupportsDateSelection: true},
	"csv":      {ID: "csv", Role: RoleDataSource, ProducesFields: true, SupportsDateSelection: true},

	// Standalone Widgets — display content without a Data Source.
	"website": {ID: "website", Role: RoleWidget, Renderable: true},
	"youtube": {ID: "youtube", Role: RoleWidget, Renderable: true},
	"clock":   {ID: "clock", Role: RoleWidget, Renderable: true},
	"date":    {ID: "date", Role: RoleWidget, Renderable: true},
	"qrcode":  {ID: "qrcode", Role: RoleWidget, Renderable: true},

	// Data-driven Widgets — display one compatible Data Source.
	"ticker": {ID: "ticker", Role: RoleWidget, Renderable: true, RequiresDataSource: true, AcceptedDataSourceProviders: []string{"rss", "atom", "calendar", "json", "csv"}},
	"menu":   {ID: "menu", Role: RoleWidget, Renderable: true, RequiresDataSource: true, AcceptedDataSourceProviders: []string{"csv", "json"}},
	"list":   {ID: "list", Role: RoleWidget, Renderable: true, RequiresDataSource: true, AcceptedDataSourceProviders: []string{"calendar", "rss", "atom", "json", "csv"}},
	"table":  {ID: "table", Role: RoleWidget, Renderable: true, RequiresDataSource: true, AcceptedDataSourceProviders: []string{"json", "csv"}},
	"agenda": {ID: "agenda", Role: RoleWidget, Renderable: true, RequiresDataSource: true, AcceptedDataSourceProviders: []string{"calendar", "json", "csv"}},
}

func lookupProvider(id string) (ProviderDescriptor, bool) {
	d, ok := providerRegistry[id]
	return d, ok
}

func isWidgetProvider(id string) bool {
	d, ok := providerRegistry[id]
	return ok && d.Role == RoleWidget
}

func isDataSourceProvider(id string) bool {
	d, ok := providerRegistry[id]
	return ok && d.Role == RoleDataSource
}

// dataSourceProviderAccepted reports whether a data-driven widget accepts a given
// Data Source provider.
func dataSourceProviderAccepted(widgetProvider, dataSourceProvider string) bool {
	d, ok := providerRegistry[widgetProvider]
	if !ok {
		return false
	}
	for _, p := range d.AcceptedDataSourceProviders {
		if p == dataSourceProvider {
			return true
		}
	}
	return false
}
